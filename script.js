/* ==========================================
   Class-based App with Store classes (no MemoryStorage)
   - KeyValueStore (localStorage-backed)
   - DraftsStore (depends on KeyValueStore)
   - UsersStore (example of another store)
   - App composes them and exposes CA.App
   ========================================== */
(async function () {
    const root = (typeof window !== "undefined" ? window : globalThis);
    root.CA = root.CA || {};

    /** Key/Value store backed by localStorage */
    class KeyValueStore {
        constructor({namespace = ""} = {}) {
            this.ns = namespace ? namespace + ":" : "";
            this.storage = localStorage; // assume available
        }

        _key(k) {
            return this.ns + String(k ?? "");
        }

        has(key) {
            try {
                return this.storage.getItem(this._key(key)) !== null;
            } catch (e) {
                console.error(e);
                return false;
            }
        }

        get(key) {
            try {
                const raw = this.storage.getItem(this._key(key));
                if (raw == null) return null;
                const trimmed = String(raw).trim();
                if (/^[{\[]/.test(trimmed) || trimmed === "true" || trimmed === "false" || /^-?\d+(\.\d+)?$/.test(trimmed)) {
                    try {
                        return JSON.parse(trimmed);
                    } catch {
                        return raw;
                    }
                }
                return raw;
            } catch (e) {
                console.error(e);
                return null;
            }
        }

        set(key, value) {
            try {
                const toStore = (typeof value === "string") ? value : JSON.stringify(value ?? {});
                this.storage.setItem(this._key(key), toStore);
                return true;
            } catch (e) {
                console.error(e);
                return false;
            }
        }
    }

    /** Drafts store that uses a KeyValueStore */
    class DraftsStore {
        constructor({kv}) {
            if (!kv) throw new Error("DraftsStore requires a KeyValueStore");
            this.kv = kv;
        }

        save(key, value) {
            const k = typeof key === "string" ? key : String(key || "");
            if (!k) return false;
            return this.kv.set(k, value == null ? "" : String(value));
        }

        bindInput(el, key) {
            if (!el) return;
            el.value = String(this.kv.get(key) ?? "");
            el.addEventListener("input", () => this.save(key, el.value));
        }
    }

    /** Example Users store */
    class UsersStore {
        constructor({kv, cacheKey}) {
            this.kv = kv;
            this.cacheKey = cacheKey;
        }

        list() {
            return Array.isArray(this.kv.get(this.cacheKey)) ? this.kv.get(this.cacheKey) : [];
        }

        upsert(user) {
            const arr = this.list();
            const idx = arr.findIndex(u => String(u.uid) === String(user.uid));
            if (idx >= 0) {
                arr[idx] = {...arr[idx], ...user};
            } else {
                arr.push({
                    uid: String(user.uid),
                    name: String(user.name || user.uid),
                    avatar: String(user.avatar || ''),
                    loggedIn: user.loggedIn || false,
                    isFemale: user.isFemale || false
                });
            }
            this.kv.set(this.cacheKey, arr);
            return user;
        }
    }

    /** Main App that composes stores */
    class App {
        constructor() {
            /* ========= Constants / Keys ========= */
            this.LOG = '[321ChatAddons]';
            this.FEMALE_CODE = '2';

            // LocalStorage keys (you chose full keys → no KV namespace elsewhere)
            this.DEBUG_MODE_KEY = '321chataddons.debugMode';
            this.GLOBAL_WATERMARK_KEY = '321chataddons.global.watermark';
            this.ACTIVITY_LOG_KEY = '321chataddons.activityLog';
            this.STORAGE_PREFIX = '321chataddons.pm.';              // drafts, per-message hash
            this.USERS_KEY = '321chataddons.users';
            this.EXC_KEY = '321chataddons.excluded';
            this.REPLIED_CONVOS_KEY = '321chataddons.repliedConversations';
            this.LAST_PCOUNT_MAP_KEY = '321chataddons.lastPcountPerConversation';
            this.DISPLAYED_LOGIDS_KEY = '321chataddons.displayedLogIds';
            this.MAX_LOGIDS_PER_CONVERSATION = 100;

            /* ========= App State ========= */
            this.options = {};
            this.state = {
                READY: false,
                isPruning: false,
                CHAT_CTX: {
                    caction: '', last: '', lastp: '', room: '', notify: '', curset: '', pcount: 0
                }
            };

            // runtime maps (populated in init from storage)
            this.EXCLUDED = {};          // { [uid]: 1 }
            this.REPLIED_CONVOS = {};    // { [uid]: 'DD/MM HH:MM' }
            this.LAST_PCOUNT_MAP = {};   // { [uid]: number }
            this.DISPLAYED_LOGIDS = {};  // { [uid]: string[] }

            /* ========= UI Refs ========= */
            this.ui = {
                sUser: null, sMsg: null, sSend: null, sStat: null, sReset: null,
                bMsg: null, bSend: null, bStat: null, bReset: null,
                sentBox: null, receivedMessagesBox: null, presenceBox: null, logClear: null,
                repliedMessageBox: null, unrepliedMessageBox: null,
                navBc: null,
                debugCheckbox: null
            };

            /* ========= Flags / Scheduling ========= */
            this._isMakingOwnChanges = false;     // avoid reacting to our own DOM edits
            this._rafId = null;                   // requestAnimationFrame id
            this._lastSendAt = 0;                 // throttle PM sending
            this.PRESENCE_LOG_THROTTLE = 5000;    // ms
            this._lastPresenceLog = Object.create(null); // { key: ts }

            // presence helpers
            this._didInitialLog = false;
            this._presenceArmed = false;

            // chat payload throttles
            this._cp_lastCheck = 0;               // last time processed public chat payload
            this._cp_lastPN = 0;                  // last time fetched private messages
            this._cp_CHECK_INTERVAL = 30_000;     // 30s
            this._cp_PN_INTERVAL = 10_000;     // 10s

            /* ========= Observers & Listeners (refs only) ========= */
            this._domObserver = null;
            this._onDocClick = null;
            this._onResize = null;

            /* ========= Network Taps (originals) ========= */
            this._origFetch = null;
            this._xhrOpen = null;
            this._xhrSend = null;

            /* ========= Small Helpers (bound) =========
               (If you later move these to class methods, remove these lambdas.) */
            this.qs = (sel, rootEl) => (rootEl || document).querySelector(sel);
            this.qsa = (sel, rootEl) => Array.from((rootEl || document).querySelectorAll(sel));
            this.escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[c]));
            this.timeHHMM = () => {
                const d = new Date();
                return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
            };

            /* ========= Audio Autoplay Gate (policy-safe) ========= */
            this._audioGate = {
                userInteracted: false,
                pending: null,     // Set<HTMLAudioElement>
                origPlay: null,    // original HTMLAudioElement.prototype.play
                onInteract: null,  // bound handler
                installed: false
            };

            /* ========= Misc ========= */
            this.debug = this.debug || (() => {
            });   // noop if you don’t provide one
            this._escapeMap = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};

            // Dynamic debug method
            this.debug = (...args) => {
                if (this.debugMode) {
                    console.log(this.LOG, '[DEBUG]', ...args);
                }
            };

            this.sel = {
                panel: '#ca-panel',
                // specific send section
                specific: {
                    username: '#ca-specific-username',
                    msg: '#ca-specific-msg',
                    send: '#ca-specific-send',
                    status: '#ca-specific-status',
                    reset: '#ca-specific-reset',
                },
                // logs
                log: {
                    classes: {
                        ca_box_scrollable: '.ca-log-box-scrollable',
                    },
                    sent: '#ca-log-box-sent',
                    received: '#ca-log-box-received',
                    replied: '#ca-log-received-replied',
                    unreplied: '#ca-log-received-unreplied',
                    presence: '#ca-log-box-presence',
                    clear: '#ca-log-clear',
                },
                // nav
                nav: {
                    spec: '#ca-nav-specific',
                    bc: '#ca-nav-bc',
                },
                // broadcast popup
                bcPop: {
                    container: '#ca-bc-pop',
                    header: '#ca-bc-pop-header',
                    close: '#ca-bc-pop-close',
                    msg: '#ca-bc-msg',
                    send: '#ca-bc-send',
                    reset: '#ca-bc-reset',
                    status: '#ca-bc-status',
                },
                specificPop: {
                    container: '#ca-specific-pop',
                    header: '#ca-specific-pop-header',
                    close: '#ca-specific-pop-close',
                    username: '#ca-specific-username',
                    msg: '#ca-specific-msg',
                    send: '#ca-specific-send',
                    reset: '#ca-specific-reset',
                    status: '#ca-specific-status',
                },
                container: '#ca-bc-pop',
                header: '#ca-bc-pop-header',
                close: '#ca-bc-pop-close',
                msg: '#ca-bc-msg',
                send: '#ca-bc-send',
                reset: '#ca-bc-reset',
                status: '#ca-bc-status',
                // user list containers (first existing wins)
                users: {
                    main: '#container_user',
                    online: '.online_user',
                    chatRight: '#chat_right_data',
                    combined: '#container_user, .online_user, #chat_right_data', // still handy if you want a fast query
                },
            };
        }

        async init(options = {}) {
            this.options = options || {};

            // --- Wire up stores so they’re actually used ---
            // Key/value store used all over the App (watermark, tracking, etc.)
            this.Store = this.Store || new KeyValueStore();

            // Load debug mode from storage
            try {
                const storedDebugMode = localStorage.getItem(this.DEBUG_MODE_KEY);
                this.debugMode = storedDebugMode === 'true';
            } catch (err) {
                console.error('Failed to load debug mode:', err);
                this.debugMode = false;
            }

            this.debug('Initializing app with options:', options);

            // Persist message drafts
            this.Drafts = this.Drafts || new DraftsStore({kv: this.Store});

            // Backing store for users (separate namespace so the map stays tidy)
            const usersKV = new KeyValueStore();
            this.UserStore = this.UserStore || new UsersStore({kv: usersKV, cacheKey: this.USERS_KEY});

            // Adapt UsersStore to the API the rest of the code expects: set/has/get/getOrFetch/getOrFetchByName
            if (!this.Users) {
                // keep an in-memory index for fast lookups
                const _index = new Map(
                    (this.UserStore.list() || []).map(u => [String(u.uid), {
                        uid: String(u.uid),
                        name: u.name || String(u.uid),
                        avatar: u.avatar || '',
                        loggedIn: u.loggedIn || false,
                        isFemale: u.isFemale || false
                    }])
                );

                this.Users = {
                    set: (id, name, avatar = '', isFemale = false) => {
                        const existing = _index.get(String(id));
                        const rec = {
                            uid: String(id),
                            name: String(name || id),
                            avatar: String(avatar || ''),
                            loggedIn: existing ? existing.loggedIn : false,
                            isFemale: isFemale
                        };
                        _index.set(rec.uid, rec);
                        this.UserStore.upsert({
                            uid: rec.uid,
                            name: rec.name,
                            avatar: rec.avatar,
                            loggedIn: rec.loggedIn,
                            isFemale: rec.isFemale
                        });
                        return rec;
                    },
                    has: (id) => _index.has(String(id)),
                    get: (id) => _index.get(String(id)) || null,
                    isLoggedIn: (id) => {
                        const user = _index.get(String(id));
                        return user?.loggedIn === true;
                    },
                    setLoggedIn: (id, status) => {
                        const user = _index.get(String(id));
                        if (user) {
                            user.loggedIn = !!status;
                            _index.set(String(id), user);
                            // Persist to storage
                            this.UserStore.upsert({
                                uid: user.uid,
                                name: user.name,
                                avatar: user.avatar,
                                loggedIn: user.loggedIn,
                                isFemale: user.isFemale
                            });
                        }
                    },
                    getAllLoggedIn: () => {
                        return Array.from(_index.values()).filter(u => u.loggedIn);
                    },
                    getFemalesLoggedIn: () => {
                        return Array.from(_index.values()).filter(u => u.loggedIn && u.isFemale);
                    },
                    async getOrFetch(id) {
                        return this.get(id) || {
                            uid: String(id),
                            name: String(id),
                            avatar: '',
                            loggedIn: false,
                            isFemale: false
                        };
                    },
                    async getOrFetchByName(q) {
                        const needle = String(q || '').toLowerCase();
                        // try local first
                        const local = Array.from(_index.values()).filter(u => u.name.toLowerCase() === needle);
                        if (local.length) return local.map(u => ({uid: u.uid, name: u.name}));
                        // fallback to remote search the app already implements
                        return await this.searchUsersRemote(needle);
                    }
                };
            }

            this._installAudioAutoplayGate();

            if (document.body) {
                // small delay to let layout settle
                setTimeout(() => {
                    this.applyInline();
                    this.removeAds(document);
                }, 0);
                setTimeout(() => {
                    this.adjustForFooter();
                }, 500);

                this._wireResize();
                this._wireLogClicks();
            }

            // Initialize watermark once
            this.initializeGlobalWatermark();

            this.EXCLUDED = this._loadExcluded();
            this.REPLIED_CONVOS = this._loadRepliedConvos();
            this.LAST_PCOUNT_MAP = this._loadLastPcountMap();
            this.DISPLAYED_LOGIDS = this._loadDisplayedLogIds();

            // build panel + wire refs + handlers
            this.buildPanel();
            this.addSpecificNavButton();
            this._bindStaticRefs();

            if (this.Drafts) {
                // persist the “send to specific” message + username
                if (this.ui.sMsg) this.Drafts.bindInput(this.ui.sMsg, this.STORAGE_PREFIX + 'draftSpecific');
                if (this.ui.sUser) this.Drafts.bindInput(this.ui.sUser, this.STORAGE_PREFIX + 'specificUsername');
            }

            this.wireSpecificSendButton();   // enable the “Send” button in the panel
            this._wirePanelNav();
            this._wireDebugCheckbox();
            this._wireLogClear();

            await this.restoreLog?.();

            // start presence observer (users list)
            this.startObserver?.();

            this.installNetworkTaps();   // <— enable fetch/XHR interception

            this.installPrivateSendInterceptor();  // <— enable intercept for native /private_process.php
            this.initializeGlobalWatermark?.();    // <— if you have this already; otherwise keep the method below

            return this;
        }

        /* ---------- Helpers ---------- */
        qs(s, r) {
            return (r || document).querySelector(s);
        }

        qsa(s, r) {
            return Array.prototype.slice.call((r || document).querySelectorAll(s));
        }

        trim(s) {
            return String(s || '').replace(/^\s+|\s+$/g, '');
        }

        sleep(ms) {
            return new Promise(r => setTimeout(r, ms));
        }

        randBetween(minMs, maxMs) {
            return Math.floor(minMs + Math.random() * (maxMs - minMs));
        }

        safeMatches(n, sel) {
            try {
                return !!(n && n.nodeType === 1 && typeof n.matches === 'function' && n.matches(sel));
            } catch (e) {
                console.error(e);
                return false;
            }
        }

        safeQuery(n, sel) {
            try {
                return n && n.querySelector ? n.querySelector(sel) : null;
            } catch (e) {
                console.error(e);
                return null;
            }
        }

        escapeHTML(s) {
            return String(s).replace(/[&<>"']/g, c => this._escapeMap[c]);
        }

        decodeHTMLEntities(s) {
            try {
                const txt = document.createElement('textarea');
                txt.innerHTML = String(s);
                return txt.value;
            } catch (e) {
                console.error(e);
                return String(s);
            }
        }

        timeHHMM() {
            const d = new Date();
            const h = String(d.getHours()).padStart(2, '0');
            const m = String(d.getMinutes()).padStart(2, '0');
            return `${h}:${m}`;
        }

        /* =========================
Private send interception
========================= */
        isPrivateProcessUrl(u) {
            try {
                if (!u) return false;
                let s = String(u);
                try {
                    s = new URL(s, location.origin).pathname;
                } catch {
                }
                return s.indexOf('system/action/private_process.php') !== -1;
            } catch {
                return false;
            }
        }

        processPrivateSendResponse(responseText, requestBody) {
            try {
                if (!responseText || typeof responseText !== 'string') return;

                let data;
                try {
                    data = this.parseJSONOrEmpty(responseText);
                } catch (e) {
                    console.error(e);
                    console.error(this.LOG, 'Private process parse error:', e);
                    return;
                }

                data = this.toPrivateSendResponse(data);

                // success = code:1
                if (!data || data.code !== 1) return;

                const logData = data.log || {};
                const content = logData.log_content || '';
                let targetId = '';

                // Extract target from original request body
                try {
                    const params = new URLSearchParams(requestBody || '');
                    targetId = params.get('target') || '';
                } catch (e) {
                    console.error(e);
                }

                if (!content || !targetId) return;

                // Look up user - ensure we always have a valid user object
                let userInfo = null;
                try {
                    userInfo = (this.Users && this.Users.get) ? this.Users.get(targetId) : null;
                } catch (e) {
                    console.error(e);
                }

                // Fallback to minimal user object if not found
                if (!userInfo || !userInfo.uid) {
                    userInfo = {
                        uid: String(targetId),
                        name: String(targetId),
                        avatar: ''
                    };
                }

                console.log(this.LOG, 'Intercepted native message send to', userInfo?.name || targetId, '(ID:', targetId, ')');

                // Log to "Sent" box
                this.logLine('dm-out', content, userInfo);

                // Mark conversation as replied
                this.addOrUpdateLastRepliedDateTimeForConversation?.(targetId);
            } catch (err) {
                console.error(err);
                console.error(this.LOG, 'Process private send error:', err);
            }
        }

        installPrivateSendInterceptor() {
            // fetch()
            try {
                if (!this._pp_origFetch && typeof window.fetch === 'function') {
                    this._pp_origFetch = window.fetch;
                    const self = this;

                    window.fetch = function (...args) {
                        const req = args[0];
                        const init = args[1] || null;
                        const url = (req && typeof req === 'object' && 'url' in req) ? req.url : String(req || '');

                        let capturedBody = '';
                        try {
                            if (self.isPrivateProcessUrl(url)) {
                                capturedBody = self.normalizeBodyToQuery(init && init.body);
                            }
                        } catch (err) {
                            console.error(err);
                        }

                        const p = self._pp_origFetch.apply(this, args);

                        try {
                            if (self.isPrivateProcessUrl(url) && capturedBody) {
                                p.then((res) => {
                                    try {
                                        res.clone().text().then(txt => self.processPrivateSendResponse(txt, capturedBody));
                                    } catch (err) {
                                        console.error(self.LOG, 'Clone response error:', err);
                                    }
                                    return res;
                                });
                            }
                        } catch (e) {
                            console.error(e);
                        }

                        return p;
                    };
                }
            } catch (e) {
                console.error(e);
            }

            // XMLHttpRequest
            try {
                if (!this._pp_xhrOpen) this._pp_xhrOpen = XMLHttpRequest.prototype.open;
                if (!this._pp_xhrSend) this._pp_xhrSend = XMLHttpRequest.prototype.send;

                const self = this;

                XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                    try {
                        this._ca_pm_isTarget = self.isPrivateProcessUrl(url);
                    } catch (e) {
                        console.error(e);
                    }
                    return self._pp_xhrOpen.apply(this, [method, url, ...rest]);
                };

                XMLHttpRequest.prototype.send = function (...sendArgs) {
                    try {
                        let capturedBody = '';
                        try {
                            if (this._ca_pm_isTarget && sendArgs && sendArgs.length) {
                                capturedBody = self.normalizeBodyToQuery(sendArgs[0]);
                            }
                        } catch (err) {
                            console.error(err);
                        }

                        if (this._ca_pm_isTarget && capturedBody) {
                            this.addEventListener('readystatechange', () => {
                                try {
                                    if (this.readyState === 4 && this.status === 200) {
                                        self.processPrivateSendResponse(this?.responseText || '', capturedBody);
                                    }
                                } catch (err) {
                                    console.error(self.LOG, 'XHR readystate error:', err);
                                }
                            });
                        }
                    } catch (e) {
                        console.error(e);
                    }

                    return self._pp_xhrSend.apply(this, sendArgs);
                };
            } catch (e) {
                console.error(e);
            }
        }

        uninstallPrivateSendInterceptor() {
            try {
                if (this._pp_origFetch) {
                    window.fetch = this._pp_origFetch;
                    this._pp_origFetch = null;
                }
            } catch (e) {
                console.error(e);
            }
            try {
                if (this._pp_xhrOpen) {
                    XMLHttpRequest.prototype.open = this._pp_xhrOpen;
                    this._pp_xhrOpen = null;
                }
                if (this._pp_xhrSend) {
                    XMLHttpRequest.prototype.send = this._pp_xhrSend;
                    this._pp_xhrSend = null;
                }
            } catch (e) {
                console.error(e);
            }
        }

        /* ======================================
       Private notifications & conversations
       ====================================== */
        caParsePrivateNotify(html) {
            try {
                const tmp = document.createElement('div');
                tmp.innerHTML = html;
                const nodes = tmp.querySelectorAll('.fmenu_item.fmuser.priv_mess');
                const out = [];
                for (let i = 0; i < nodes.length; i++) {
                    const el = nodes[i];
                    const info = el.querySelector('.fmenu_name.gprivate');
                    if (!info) continue;
                    const id = (info.getAttribute('data') || '').trim();
                    const name = (info.getAttribute('value') || '').trim();
                    const av = (info.getAttribute('data-av') || '').trim();
                    const cntEl = el.querySelector('.ulist_notify .pm_notify');
                    let unread = 0;
                    if (cntEl) {
                        const t = (cntEl.textContent || '').trim();
                        unread = parseInt(t.replace(/\D+/g, ''), 10) || 0;
                    }
                    out.push({uid: id, name, avatar: av, unread});
                }
                console.log(this.LOG, 'Parsed', out.length, 'private conversation' + (out.length !== 1 ? 's' : ''));
                return out;
            } catch (e) {
                console.error(e);
                console.error(this.LOG, 'Parse private notifications error:', e);
                return [];
            }
        }

        caFetchPrivateNotify() {
            const token = this.getToken();
            if (!token) return Promise.resolve([]);

            const body = new URLSearchParams({token, cp: 'chat'}).toString();
            return fetch('/system/float/private_notify.php', {
                method: 'POST', credentials: 'include',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': '*/*',
                    'X-CA-OWN': '1'
                },
                body
            })
                .then(async (r) => {
                    const html = await r.text();
                    const list = this.caParsePrivateNotify(html);
                    return Array.isArray(list) ? list : [];
                })
                .catch((err) => {
                    console.error(this.LOG, 'Fetch private notifications error:', err);
                    return [];
                });
        }

        caUpdatePrivateConversationsList() {
            return this.caFetchPrivateNotify().then((privateConversations) => {
                try {
                    privateConversations = privateConversations || [];
                    console.log(this.LOG, 'Private conversations:', privateConversations.length);
                    // sort: unread desc, then name asc
                    privateConversations.sort((a, b) => {
                        const au = a.unread || 0, bu = b.unread || 0;
                        if (bu !== au) return bu - au;
                        const an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
                        return an < bn ? -1 : an > bn ? 1 : 0;
                    });
                    return privateConversations;
                } catch (e) {
                    console.error(e);
                    console.error(this.LOG, 'Update private list error:', e);
                    return privateConversations || [];
                }
            });
        }

        /* Carry over site chat context and fetch private chat_log for uid */
        caFetchChatLogFor(uid, lastCheckedPcount) {
            try {
                const token = this.getToken();
                if (!token || !uid) return Promise.resolve('');

                const bodyObj = {
                    token,
                    cp: 'chat',
                    fload: '1',
                    preload: '1',
                    priv: String(uid),
                    pcount: lastCheckedPcount
                };

                // carry over CHAT_CTX if present
                try {
                    const CC = (this.state && this.state.CHAT_CTX) ? this.state.CHAT_CTX : null;
                    if (CC) {
                        if (CC.caction) bodyObj.caction = String(CC.caction);
                        if (CC.last) bodyObj.last = String(CC.last);
                        if (CC.room) bodyObj.room = String(CC.room);
                        if (CC.notify) bodyObj.notify = String(CC.notify);
                        if (CC.curset) bodyObj.curset = String(CC.curset);
                        if (CC.lastp) bodyObj.lastp = String(CC.lastp);
                        if (CC.pcount) bodyObj.pcount = String(CC.pcount);
                    }
                } catch (e) {
                    console.error(e);
                    console.error(this.LOG, 'Chat context error:', e);
                }

                // Debug log (sanitized)
                try {
                    const bodyLog = new URLSearchParams(bodyObj).toString().replace(/token=[^&]*/, 'token=[redacted]');
                    console.log(this.LOG, 'caFetchChatLogFor uid=', uid, ' body:', bodyLog);
                } catch (err) {
                    console.error(err);
                }

                const body = new URLSearchParams(bodyObj).toString();

                return fetch('/system/action/chat_log.php?timestamp=234284923', {
                    method: 'POST', credentials: 'include',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-CA-OWN': '1'
                    },
                    body
                })
                    .then((res) => {
                        console.log(this.LOG, 'caFetchChatLogFor: Response status:', res.status, res.statusText);
                        return res.text();
                    })
                    .then((txt) => {
                        console.log(this.LOG, 'caFetchChatLogFor: Response preview:', String(txt || '').slice(0, 300));
                        return txt;
                    })
                    .catch((err) => {
                        console.error(this.LOG, 'Fetch chat log error:', err);
                        return '';
                    });
            } catch (e) {
                console.error(e);
                return Promise.resolve('');
            }
        }

        /* Parse & render the private chat log for a given user */
        async caProcessPrivateLogResponse(uid, response) {
            try {
                this.debug('Processing private log response for user:', uid);

                if (!response || typeof response !== 'string' || response.trim() === '') {
                    console.warn(this.LOG, 'Empty response for conversation', uid);
                    return;
                }

                let conversationChatLog;
                try {
                    conversationChatLog = this.parseJSONOrEmpty(response);
                    conversationChatLog = this.toPrivateChatLogResponse(conversationChatLog);
                } catch (e) {
                    const prev = String(response || '').slice(0, 200);
                    console.warn(this.LOG, 'Parse failed for conversation', uid, '— preview:', prev);
                    return;
                }

                // update CHAT_CTX.last from private response
                try {
                    if (conversationChatLog && conversationChatLog.last) {
                        this.state = this.state || {};
                        this.state.CHAT_CTX = this.state.CHAT_CTX || {};
                        this.state.CHAT_CTX.last = String(conversationChatLog.last);
                    }
                } catch (e) {
                    console.error(e);
                }

                const items = Array.isArray(conversationChatLog?.pload) ? conversationChatLog.pload
                    : (Array.isArray(conversationChatLog?.plogs) ? conversationChatLog.plogs : []);
                if (!items.length) return;

                // my user id (if page exposes it)
                let myUserId = null;
                try { /* global on page */  // eslint-disable-next-line no-undef
                    myUserId = (typeof user_id !== 'undefined') ? String(user_id) : null;
                } catch {
                }

                // chronological
                items.sort((a, b) => (a.log_id || 0) - (b.log_id || 0));

                const watermark = this.getGlobalWatermark?.() || '';
                console.log(this.LOG, 'Processing messages for', uid, '— watermark:', watermark || 'not set');

                let newMessages = 0;
                const skipped = {fromMe: 0, alreadyShown: 0, tooOld: 0};
                let newestLogDate = null;

                for (let i = 0; i < items.length; i++) {
                    const t = items[i];
                    const fromId = (t?.user_id != null) ? String(t.user_id) : null;
                    const logDate = String(t?.log_date ?? '');
                    const logId = (t?.log_id != null) ? String(t.log_id) : null;

                    // track newest date
                    if (logDate && (!newestLogDate || this.parseLogDateToNumber(logDate) > this.parseLogDateToNumber(newestLogDate))) {
                        newestLogDate = logDate;
                    }

                    // skip from me
                    if (myUserId && fromId === myUserId) {
                        skipped.fromMe++;
                        continue;
                    }

                    // skip duplicates
                    if (logId && this.hasDisplayedLogId?.(uid, logId)) {
                        skipped.alreadyShown++;
                        continue;
                    }

                    // skip older than watermark
                    const shouldShow = this.isMessageNewer?.(logDate, false);
                    if (!shouldShow) {
                        skipped.tooOld++;
                        continue;
                    }

                    // decode → escape → normalize whitespace
                    const rawContent = t?.log_content ? String(t.log_content) : '';
                    const decodedContent = this.decodeHTMLEntities ? this.decodeHTMLEntities(rawContent) : rawContent;
                    const content = (this.escapeHTML ? this.escapeHTML(decodedContent) : decodedContent).replace(/\s+/g, ' ').trim();

                    // resolve user
                    const user = (this.Users?.getOrFetch) ? await this.Users.getOrFetch(fromId) : {
                        uid: fromId,
                        name: String(fromId),
                        avatar: ''
                    };

                    // render
                    this.logLine('dm-in', content, user);

                    // mark id
                    if (logId) this.addDisplayedLogId?.(uid, logId);

                    newMessages++;
                }

                if (skipped.fromMe || skipped.alreadyShown || skipped.tooOld) {
                    console.log(this.LOG, 'Skipped — from me:', skipped.fromMe, 'already shown:', skipped.alreadyShown, 'too old:', skipped.tooOld);
                }

                if (newestLogDate) {
                    this.setGlobalWatermark?.(newestLogDate);
                    console.log(this.LOG, 'Updated watermark to:', newestLogDate);
                }

                if (newMessages > 0) {
                    console.log(this.LOG, 'User', uid, '—', newMessages, 'new message' + (newMessages !== 1 ? 's' : ''));
                } else {
                    console.log(this.LOG, 'User', uid, '— no new messages (all older than watermark or from me)');
                }
            } catch (err) {
                console.error(err);
                console.error(this.LOG, 'Process private messages error:', err);
            }
        }

        /* ============ Chat payload processing ============ */
        caProcessChatPayload(txt) {
            try {
                if (!txt || typeof txt !== 'string' || txt.trim() === '') {
                    console.warn(this.LOG, 'Empty or invalid chat payload response');
                    return;
                }

                const now = Date.now();
                this.debug('Processing chat payload, length:', txt.length);

                // tolerant parse & shape
                let data;
                try {
                    data = this.parseJSONOrEmpty(txt);
                } catch (e) {
                    console.error(e);
                    console.error(this.LOG, 'Chat payload: JSON parse failed — preview:', String(txt).slice(0, 200));
                    return;
                }
                data = this.toChatLogResponse(data);

                // update CHAT_CTX.last from public chat response
                try {
                    if (data && data.last) this.state.CHAT_CTX.last = String(data.last);
                } catch (e) {
                    console.error(e);
                    console.error(this.LOG, 'Update CHAT_CTX.last error:', e);
                }

                const pico = Number(data && data.pico);

                // Only process when pico > 0 OR every 30s for refresh
                const timeSinceLastCheck = now - (this._cp_lastCheck || 0);
                const shouldProcess = (pico > 0) || (timeSinceLastCheck >= this._cp_CHECK_INTERVAL);
                if (!shouldProcess) return;

                this._cp_lastCheck = now;

                // No private messages or they are already in this payload
                if (!Number.isFinite(pico) || pico < 1 || (data.pload?.length > 0) || (data.plogs?.length > 0)) return;

                // throttle actual PM fetches when pico > 0
                if (this._cp_lastPN && (now - this._cp_lastPN) <= this._cp_PN_INTERVAL) {
                    console.log(this.LOG, 'Private messages: throttled — last check', Math.round((now - this._cp_lastPN) / 1000), 's ago');
                    return;
                }
                this._cp_lastPN = now;

                console.log(this.LOG, 'Private messages count (pico):', pico, '— checking for new messages');
                if (typeof this.caUpdatePrivateConversationsList !== 'function') return;

                this.caUpdatePrivateConversationsList(false).then((privateConversations) => {
                    try {
                        privateConversations = Array.isArray(privateConversations) ? privateConversations : [];
                        console.log(this.LOG, 'Private conversations returned:', privateConversations.length, privateConversations);

                        const toFetch = privateConversations
                            .filter(pc => pc.unread > 0)
                            .map(it => ({uid: String(it.uid), unread: Number(it.unread) || 0}));

                        if (!toFetch.length) {
                            console.log(this.LOG, 'None of the conversations has new messages');
                            return;
                        }

                        console.log(this.LOG, 'Fetching', toFetch.length, 'conversation' + (toFetch.length !== 1 ? 's' : ''), 'with new messages');

                        (async () => {
                            for (let i = 0; i < toFetch.length; i++) {
                                const conversation = toFetch[i];
                                try {
                                    console.log(this.LOG, 'Fetch chat_log for conversation', conversation.uid, '— unread:', conversation.unread);
                                    const convoLog = await this.caFetchChatLogFor(conversation.uid, this.getLastPcountFor(conversation.uid));
                                    try {
                                        await this.caProcessPrivateLogResponse(conversation.uid, convoLog);
                                        // sync pcount (site increments this on each poll)
                                        this.setLastPcountFor(conversation.uid, this.state.CHAT_CTX.pcount);
                                    } catch (err) {
                                        console.error(err);
                                        console.error(this.LOG, 'Process messages error:', err);
                                    }
                                } catch (err) {
                                    console.error(err);
                                    console.error(this.LOG, 'Fetch error for conversation', conversation.uid, '—', err);
                                }
                            }
                        })();
                    } catch (err) {
                        console.error(err);
                        console.error(this.LOG, 'List processing error:', err);
                    }
                });
            } catch (e) {
                console.error(e);
                console.error(this.LOG, 'Chat payload processing error:', e);
            }
        }

        /* ============ Fetch/XHR interceptors ============ */
        installNetworkTaps() {
            this.debug('Installing network taps (fetch/XHR interceptors)');
            // fetch
            try {
                if (!this._origFetch && typeof window.fetch === 'function') {
                    this._origFetch = window.fetch;
                    const self = this;

                    window.fetch = function (...args) {
                        const req = args[0];
                        const init = args[1] || null;
                        const url = (req && typeof req === 'object' && 'url' in req) ? req.url : String(req || '');

                        try {
                            if (self.isChatLogUrl(url)) {
                                // skip our own calls
                                let own = false;
                                try {
                                    const h = (init && init.headers) || (req && req.headers);
                                    if (h) {
                                        if (typeof h.get === 'function') own = String(h.get('X-CA-OWN') || '') === '1';
                                        else if (Array.isArray(h)) own = h.some(x => String((x[0] || '').toLowerCase()) === 'x-ca-own' && String(x[1] || '') === '1');
                                        else if (typeof h === 'object') own = String(h['X-CA-OWN'] || h['x-ca-own'] || '') === '1';
                                    }
                                } catch (e) {
                                    console.error(e);
                                }

                                if (!own) {
                                    const qs = self.normalizeBodyToQuery(init && init.body);
                                    if (qs) {
                                        self.caUpdateChatCtxFromBody(qs, url);
                                    } else if (req && typeof req === 'object' && typeof req.clone === 'function') {
                                        try {
                                            req.clone().text().then(t => self.caUpdateChatCtxFromBody(t, url));
                                        } catch (err) {
                                            console.error(self.LOG, 'Fetch clone error:', err);
                                        }
                                    }
                                }
                            }
                        } catch (err) {
                            console.error(err);
                        }

                        const p = self._origFetch.apply(this, args);

                        try {
                            if (self.isChatLogUrl(url)) {
                                p.then((res) => {
                                    try {
                                        res?.clone?.().text().then(txt => self.caProcessChatPayload(txt));
                                    } catch (err) {
                                        console.error(self.LOG, 'Response clone error:', err);
                                    }
                                    return res;
                                });
                            }
                        } catch (e) {
                            console.error(e);
                        }

                        return p;
                    };
                }
            } catch (e) {
                console.error(e);
            }

            // XHR
            try {
                if (!this._xhrOpen) this._xhrOpen = XMLHttpRequest.prototype.open;
                if (!this._xhrSend) this._xhrSend = XMLHttpRequest.prototype.send;

                const self = this;

                XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                    try {
                        this._ca_url = String(url || '');
                    } catch (e) {
                        console.error(e);
                        this._ca_url = '';
                    }
                    return self._xhrOpen.apply(this, [method, url, ...rest]);
                };

                XMLHttpRequest.prototype.send = function (...sendArgs) {
                    try {
                        const targetUrl = this._ca_url || '';
                        // capture POST body into context
                        try {
                            if (self.isChatLogUrl(targetUrl) && sendArgs && sendArgs.length) {
                                const qs0 = self.normalizeBodyToQuery(sendArgs[0]);
                                self.caUpdateChatCtxFromBody(qs0 || '', targetUrl);
                            }
                        } catch (err) {
                            console.error(self.LOG, 'XHR body capture error:', err);
                        }

                        this.addEventListener('readystatechange', function () {
                            try {
                                if (this.responseText && this.readyState === 4 && this.status === 200 && self.isChatLogUrl(this.responseURL || this._ca_url || '')) {
                                    self.caProcessChatPayload(this.responseText);
                                }
                            } catch (err) {
                                console.error(self.LOG, 'XHR readystatechange error:', err);
                            }
                        });
                    } catch (e) {
                        console.error(e);
                    }
                    return self._xhrSend.apply(this, sendArgs);
                };
            } catch (e) {
                console.error(e);
            }
        }

        uninstallNetworkTaps() {
            try {
                if (this._origFetch) {
                    window.fetch = this._origFetch;
                    this._origFetch = null;
                }
            } catch (e) {
                console.error(e);
            }
            try {
                if (this._xhrOpen) {
                    XMLHttpRequest.prototype.open = this._xhrOpen;
                    this._xhrOpen = null;
                }
                if (this._xhrSend) {
                    XMLHttpRequest.prototype.send = this._xhrSend;
                    this._xhrSend = null;
                }
            } catch (e) {
                console.error(e);
            }
        }

        buildLogHTML(kind, user = {}, content) {
            const text = typeof content === 'object' ? content?.text : content;
            const status = typeof content === 'object' ? content?.status : null;
            this.debug(`Building log HTML with kind=${kind}, user=${user.uid}, content=${text}`, user);

            switch (kind) {
                case 'dm-in':
                    return `“${this.escapeHTML(text || '')}”`;
                case 'dm-out':
                    return `“${this.escapeHTML(text || '')}”`;
                case 'send-fail': // keep if you still log failures
                    return `failed (${String(status || 0)}) — “${this.escapeHTML(text || '')}”`;
                case 'login':
                    return `logged on`;
                case 'logout':
                    return `logged off`;
                default:
                    return `${this.escapeHTML(text || '')}`;
            }
        }

        logLogin(user) {
            const now = Date.now();
            const key = `login_${user.uid}`;
            if (this._lastPresenceLog[key] && (now - this._lastPresenceLog[key]) < this.PRESENCE_LOG_THROTTLE) return;
            this._lastPresenceLog[key] = now;
            this.logLine('login', null, user);
        }

        logLogout(user) {
            const now = Date.now();
            const key = `logout_${user.uid}`;
            if (this._lastPresenceLog[key] && (now - this._lastPresenceLog[key]) < this.PRESENCE_LOG_THROTTLE) return;
            this._lastPresenceLog[key] = now;
            this.logLine('logout', null, user);
        }

        buildProfileUrlForId(uid) {
            try {
                if (!uid) return '';
                const sel = `a[href*="profile"][href*="${uid}"], a[href*="user"][href*="${uid}"]`;
                const found = document.querySelector(sel);
                if (found?.href) return found.href;
                const fallbacks = [
                    '/profile/' + uid,
                    '/user/' + uid,
                    '/system/profile.php?uid=' + uid,
                ];
                return fallbacks[0];
            } catch (e) {
                console.error(e);
                return '';
            }
        }

        // Wires generic click handling on sent/received/presence logs,
        _attachLogClickHandlers() {
            [this.ui.sentBox, this.ui.receivedMessagesBox, this.ui.presenceBox].forEach(box => {
                if (!box) return;
                // Remove old listener if it exists to avoid duplicates
                if (box._caGenericWired) return;
                box.addEventListener('click', (e) => this._onLogClickGeneric(e, box));
                box._caGenericWired = true;
            });

            const logSentEl = this.ui.sentBox;
            if (logSentEl && !logSentEl._caSentWired) {
                logSentEl.addEventListener('click', (e) => this._onSentCollapseClick(e, logSentEl));
                this.ui.sentBox._caSentWired = true;
            }
        }

        /** Generic handler for log clicks (profile/DM actions). */
        async _onLogClickGeneric(e, box) {
            try {
                // 1) find the .ca-log-entry ancestor (manual walk, no closest())
                let node = e.target;
                let entry = null;
                while (node && node !== box) {
                    if (node.classList && node.classList.contains('ca-log-entry')) {
                        entry = node;
                        break;
                    }
                    node = node.parentNode;
                }
                if (!entry) {
                    console.error(`No entry was found to call the handler for click on ${e.target}`)
                    return;
                }

                // 2) find actionable element with [data-action] inside that entry (manual walk)
                let ptr = e.target;
                let actionEl = null;
                while (ptr && ptr !== entry) {
                    if (ptr.getAttribute && ptr.hasAttribute('data-action')) {
                        actionEl = ptr;
                        break;
                    }
                    ptr = ptr.parentNode;
                }

                // 3) resolve uid
                const uid = entry.getAttribute('data-uid');
                if (!uid) {
                    console.error('Empty uid while trying to open profile/dm from a log line.');
                    return;
                }
                const user = await this.Users.getOrFetch(uid);
                if (!user) {
                    console.warn('[321ChatAddons] unknown uid:', uid);
                    return;
                }

                // 4) explicit actions
                const action = actionEl ? String(actionEl.getAttribute('data-action') || '').toLowerCase() : '';

                if (action === 'open-profile') {
                    e.preventDefault();
                    this.openProfileOnHost(uid);
                    return;
                }
                if (action === 'open-dm') {
                    e.preventDefault();
                    this.applyLegacyAndOpenDm(user);
                    return;
                }

                // 5) fallback: background click opens profile
                e.preventDefault();
                this.openProfileOnHost(uid);
            } catch (err) {
                console.error('Log click handler error:', err);
            }
        }

        /** Sent-only handler: collapse/expand when clicking chevron or message text. */
        _onSentCollapseClick(e, box) {
            try {
                // find .ca-log-entry (manual walk)
                let node = e.target, entry = null;
                while (node && node !== box) {
                    if (node.classList && node.classList.contains('ca-log-entry')) {
                        entry = node;
                        break;
                    }
                    node = node.parentNode;
                }
                if (!entry) return;

                // only for sent entries (ok/fail)
                const isSentEntry =
                    entry.classList &&
                    (entry.classList.contains('ca-log-send-ok') || entry.classList.contains('ca-log-send-fail'));
                if (!isSentEntry) return;

                // only toggle when clicking the expand indicator or the message text
                const tgt = e.target;
                const isExpandBtn = !!(tgt && tgt.classList && tgt.classList.contains('ca-expand-indicator'));
                const isMessageTxt = !!(tgt && tgt.classList && tgt.classList.contains('ca-log-text'));
                if (!isExpandBtn && !isMessageTxt) return;

                // Stop the generic handler from also firing
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();

                // toggle expanded state
                const expanded = entry.classList.toggle('ca-expanded');

                // update indicator arrow
                let child = entry.firstChild, indicator = null;
                while (child) {
                    if (child.classList && child.classList.contains('ca-expand-indicator')) {
                        indicator = child;
                        break;
                    }
                    child = child.nextSibling;
                }
                indicator = indicator || entry.querySelector('.ca-expand-indicator');
                if (indicator) indicator.textContent = expanded ? '▴' : '▾';
            } catch (err) {
                console.error('Sent collapse handler error:', err);
            }
        }

        resolveHostFn(name) {
            const fromSelf = (typeof window[name] === 'function') ? window[name] : null;
            const fromParent = (window.parent && typeof window.parent[name] === 'function') ? window.parent[name] : null;
            return fromSelf || fromParent || null;
        }

        applyLegacyAndOpenDm({uid, name, avatar}) {
            // Legacy toggles
            if (!this.safeSet(window, 'morePriv', 0)) return false;
            if (!this.safeSet(window, 'privReload', 1)) return false;
            if (!this.safeSet(window, 'lastPriv', 0)) return false;

            // Legacy UI calls
            if (!this.safeCall(window, 'closeList')) return false;
            if (!this.safeCall(window, 'hideModal')) return false;
            if (!this.safeCall(window, 'hideOver')) return false;

            // Host hook
            const openDm = this.resolveHostFn('openPrivate');
            if (!openDm) {
                console.warn('[321ChatAddons] openPrivate() not available on host');
                return false;
            }

            // Call openPrivate via safeCall by wrapping it in an object
            return this.safeCall({openPrivate: openDm}, 'openPrivate', uid, name, avatar);
        }

        safeSet(obj, key, value) {
            try {
                if (typeof obj?.[key] === 'undefined') return true; // nothing to do
                obj[key] = value;
                return true;
            } catch (e) {
                console.error(`safeSet failed: window.${key} =`, value, e);
                return false;
            }
        }

        safeCall(obj, key, ...args) {
            try {
                if (typeof obj?.[key] !== 'function') return true; // nothing to do
                obj[key](...args);
                return true;
            } catch (e) {
                console.error(`safeCall failed: window.${key}()`, e);
                return false;
            }
        }

        openProfileOnHost(uid) {
            const getProfile = (typeof window.getProfile === 'function')
                ? window.getProfile
                : (window.parent && typeof window.parent.getProfile === 'function')
                    ? window.parent.getProfile
                    : null;

            console.log(`Open profile on host for uid=${uid}`);

            if (getProfile) {
                try {
                    const uidNum = /^\d+$/.test(uid) ? parseInt(uid, 10) : uid;
                    getProfile(uidNum);
                } catch (err) {
                    console.error(`Failed to open profile for uid ${uid}`, err);
                }
            } else {
                console.warn(`Host profile method not found; falling back to URL (uid: ${uid})`);
                const url = this.buildProfileUrlForId(uid);
                if (url) window.open(url, '_blank');
            }
        }

        //
        // /* ===================== RECIPIENT LISTS ===================== */
        // async buildSpecificListAsync() {
        //     if (!this.ui.sUser) return [];
        //     const q = (this.ui.sUser.value || '').trim();
        //     if (!q) return [];
        //     // expects a Users store with getOrFetchByName
        //     if (this.Users?.getOrFetchByName) {
        //         return await this.Users.getOrFetchByName(q);
        //     }
        //     return []; // or throw if unavailable
        // }

        buildBroadcastList() {
            const list = this.collectFemaleIds();
            const out = [];
            for (let i = 0; i < list.length; i++) {
                const el = list[i].el, uid = list[i].uid;
                if (!this._isAllowedRank?.(el)) continue;
                if (this.REPLIED_CONVOS && this.REPLIED_CONVOS[uid]) continue; // skip already messaged
                const cb = el ? el.querySelector('.ca-ck') : null;
                const include = cb ? cb.checked : !this.EXCLUDED[uid];
                if (include) out.push(list[i]);
            }
            return out;
        }

        resetForText(statEl) {
            this._saveRepliedConvos({});
            if (statEl) statEl.textContent = 'Cleared sent-tracking for this message.';
            return true;
        }

        /* ===================== SEND WITH THROTTLE ===================== */
        sendWithThrottle(id, text, minGapMs = 3500) {
            const now = Date.now();
            const wait = Math.max(0, minGapMs - (now - this._lastSendAt));
            return new Promise(r => setTimeout(r, wait))
                .then(() => this.sendPrivateMessage(id, text))
                .then((r) => {
                    this._lastSendAt = Date.now();
                    return r;
                });
        }

        wireSpecificSendButton() {
            if (!this.ui.sSend || this.ui.sSend._wired) return;
            this.ui.sSend._wired = true;

            this.ui.sSend.addEventListener('click', async () => {
                const stat = this.ui.sStat;
                const nameQ = String(this.ui.sUser?.value || '').trim();
                const text = String(this.ui.sMsg?.value || '').trim();

                if (!text) {
                    if (stat) stat.textContent = 'Type a message first.';
                    return;
                }
                if (!nameQ) {
                    if (stat) stat.textContent = 'Enter a username.';
                    return;
                }

                // try local, then remote search
                let candidates = [];
                try {
                    if (this.Users?.getOrFetchByName) {
                        candidates = await this.Users.getOrFetchByName(nameQ);
                    }
                } catch (e) {
                    console.error(e);
                }

                if (!Array.isArray(candidates) || candidates.length === 0) {
                    if (stat) stat.textContent = 'User not found (female).';
                    return;
                }

                const target = candidates[0]; // first exact match
                const sentMap = this._loadRepliedConvos();
                if (sentMap && sentMap[target.uid]) {
                    if (stat) stat.textContent = `Already sent to ${target.name || target.uid}. Change text to resend.`;
                    return;
                }

                this.ui.sSend.disabled = true;
                try {
                    const r = await this.sendWithThrottle(target.uid, text);
                    if (stat) stat.textContent = r && r.ok
                        ? `Sent to ${target.name || target.uid}.`
                        : `Failed (HTTP ${r ? r.status : 0}).`;
                } catch (err) {
                    if (stat) stat.textContent = 'Error sending.';
                    this.logSendFail?.(target.name || target.uid, target.uid, '', 'ERR', text);
                } finally {
                    this.ui.sSend.disabled = false;
                }
            });
        }

        /* ===================== BROADCAST BUTTON (if you keep popup) ===================== */
        wireBroadcastSendButton() {
            if (!this.ui.bSend || this.ui.bSend._wired) return;
            this.ui.bSend._wired = true;

            this.ui.bSend.addEventListener('click', () => {
                const $bSend = this.ui.bSend, $bMsg = this.ui.bMsg, $bStat = this.ui.bStat;

                const text = String($bMsg?.value || '').trim();
                if (!text) {
                    $bStat && ($bStat.textContent = 'Type the message first.');
                    return;
                }

                const list = this.buildBroadcastList();
                const sent = this._loadRepliedConvos();
                const to = [];
                for (let i = 0; i < list.length; i++) if (!sent[list[i].id]) to.push(list[i]);
                if (!to.length) {
                    $bStat && ($bStat.textContent = 'No new recipients for this message (after exclusions/rank filter).');
                    return;
                }

                $bSend.disabled = true;
                let ok = 0, fail = 0, B = 10, T = Math.ceil(to.length / B);

                const runBatch = (bi) => {
                    if (bi >= T) {
                        $bStat && ($bStat.textContent = `Done. Success: ${ok}, Failed: ${fail}.`);
                        $bSend.disabled = false;
                        return;
                    }
                    const start = bi * B, batch = to.slice(start, start + B);
                    let idx = 0;
                    $bStat && ($bStat.textContent = `Batch ${bi + 1}/${T} — sending ${batch.length}... (OK:${ok} Fail:${fail})`);

                    const one = () => {
                        if (idx >= batch.length) {
                            if (bi < T - 1) {
                                const wait = 10000 + Math.floor(Math.random() * 10000);
                                $bStat && ($bStat.textContent = `Batch ${bi + 1}/${T} done — waiting ${Math.round(wait / 1000)}s...`);
                                return new Promise(r => setTimeout(r, wait)).then(() => runBatch(bi + 1));
                            }
                            return runBatch(bi + 1);
                        }

                        const item = batch[idx++], uname = item.name || item.id, av = this.extractAvatar(item.el);
                        this.sendWithThrottle(item.id, text).then((r) => {
                            if (r && r.ok) {
                                ok++;
                                sent[item.id] = 1;
                            } else {
                                fail++;
                                this.logSendFail?.(uname, item.id, av, r ? r.status : 0, text);
                            }
                            $bStat && ($bStat.textContent = `Batch ${bi + 1}/${T} — ${idx}/${batch.length} sent (OK:${ok} Fail:${fail})`);
                            const delay = 2000 + Math.floor(Math.random() * 3000);
                            return new Promise(r => setTimeout(r, delay));
                        }).then(one).catch(() => {
                            fail++;
                            this.logSendFail?.(uname, item.id, av, 'ERR', text);
                            const delay = 2000 + Math.floor(Math.random() * 3000);
                            return new Promise(r => setTimeout(r, delay)).then(one);
                        });
                    };

                    one();
                };

                runBatch(0);
            });
        }

        /* ===================== USER CLICK SELECTION ===================== */
        wireUserClickSelection() {
            try {
                const c = this.getContainer();
                if (!c) return;
                if (c.getAttribute('data-ca-wired') === '1') return;

                c.addEventListener('click', (e) => {
                    try {
                        const ignore = e.target.closest('a, button, input, label, .ca-ck-wrap, .ca-ck, .ca-sent-chip');
                        if (ignore) return;

                        let n = e.target;
                        while (n && n !== c && !(n.classList && n.classList.contains('user_item'))) n = n.parentNode;
                        if (!n || n === c) return;

                        const nm = this.extractUsername(n);
                        if (!nm) return;
                        const inp = this.qs('#ca-specific-username');
                        if (inp) {
                            inp.value = nm;
                            const ev = new Event('input', {bubbles: true, cancelable: true});
                            inp.dispatchEvent(ev);
                        }
                    } catch (err) {
                        console.error(err);
                    }
                }, false);

                c.setAttribute('data-ca-wired', '1');
            } catch (e) {
                console.error(e);
            }
        }

        _runInitialLogWhenReady() {
            // 0) arm container-level click delegation once (idempotent)
            this.wireUserClickSelection?.();

            const c = this.getContainer();
            if (c) {
                // First, hide all non-female accounts
                this.pruneAllNonFemale();

                // Then process female rows and call _handleVisibilityOrGenderChange for each
                for (const row of this.qsa(`.user_item[data-gender]`, c)) {
                    // Call for every account at startup
                    this._handleVisibilityOrGenderChange(row);

                    // Then process female rows normally
                    if (row.getAttribute('data-gender') === this.FEMALE_CODE) {
                        this.processFemaleRow(row);
                    }
                }

                // NOW start observing - initial setup is complete
                if (this._domObserver && this._domObserverContainer) {
                    setTimeout(() => {
                        this._domObserver.observe(this._domObserverContainer, {
                            childList: true,
                            subtree: true,
                            attributes: true,  // Watch for attribute changes (gender, visibility)
                            attributeFilter: ['data-gender', 'style', 'class']  // Only these attributes
                        });
                        console.log(this.LOG, 'Observer started after initial setup complete');
                    }, 100);
                }
            }
        }

        _handleAddedNode(n) {
            // Set flag FIRST before any processing
            const wasChanging = this._isMakingOwnChanges;
            this._isMakingOwnChanges = true;

            try {
                // Only process the actual added node - don't search for all items
                let itemsToProcess = [];

                if (this.safeMatches(n, '.user_item[data-gender]')) {
                    // The added node itself is a user item
                    itemsToProcess = [n];
                } else if (this.safeMatches(n, '.user_item')) {
                    // It's a user_item but without data-gender yet
                    const gender = n.getAttribute('data-gender');
                    if (gender) {
                        itemsToProcess = [n];
                    }
                } else {
                    // The added node is a container, search only its direct children
                    const children = n.children;
                    if (children) {
                        for (let i = 0; i < children.length; i++) {
                            const child = children[i];
                            if (this.safeMatches(child, '.user_item[data-gender]')) {
                                itemsToProcess.push(child);
                            }
                        }
                    }
                }

                if (itemsToProcess.length === 0) return;

                // Call _handleVisibilityOrGenderChange for each item
                itemsToProcess.forEach(el => this._handleVisibilityOrGenderChange(el));

                // Hide non-females immediately
                itemsToProcess.forEach(el => this.pruneNonFemale(el));

                // Now process only female users from the items we already identified
                const femaleItems = itemsToProcess.filter(el =>
                    el.getAttribute('data-gender') === this.FEMALE_CODE
                );

                if (!femaleItems.length) return;

                femaleItems.forEach((el) => {
                    const uid = this.getUserId(el);
                    if (!uid) return;
                    const wasLoggedIn = this.Users.isLoggedIn(uid);
                    const nm = this.extractUsername(el) || uid;
                    const av = this.extractAvatar(el);

                    this.Users?.set?.(uid, nm, av, true);

                    if (!wasLoggedIn) {
                        this.Users.setLoggedIn(uid, true);
                    }
                    if (this._didInitialLog && this._presenceArmed && !wasLoggedIn) {
                        this.logLogin({uid, name: nm, avatar: av});
                    }

                    this.ensureSentChip(uid, !!(this.REPLIED_CONVOS && this.REPLIED_CONVOS[uid]));
                });
            } finally {
                // Clear flag synchronously - no setTimeout
                if (!wasChanging) {
                    this._isMakingOwnChanges = false;
                }
            }
        }

        _handleRemovedNode(n) {
            let items;
            if (this.safeMatches(n, '.user_item')) items = [n];
            else items = this.qsa('.user_item', n);
            if (!items.length) return;

            items.forEach((el) => {
                const id = this.getUserId(el);
                if (!id) return;
                const isFemale = (el.getAttribute && el.getAttribute('data-gender') === this.FEMALE_CODE);
                if (isFemale && this.Users.isLoggedIn(id)) {
                    const user = this.Users.get(id);
                    const nm = user?.name || id;
                    this.Users.setLoggedIn(id, false);
                    if (this._didInitialLog && this._presenceArmed) {
                        this.logLogout({uid: id, name: nm, avatar: this.extractAvatar(el)});
                    }
                }
            });
        }

        disConnectObserver(observer) {
            if (observer) {
                try {
                    observer.disconnect();
                } catch {
                }
                observer = null;
            }
        }

        startObserver() {
            const attach = () => {
                const c = this.getContainer();
                // Wait until the user list container exists and is an Element/Node
                if (!c || !(c.nodeType === 1 || c.nodeType === 9)) {
                    // try again shortly (layout is still loading / tab not opened yet)
                    setTimeout(attach, 300);
                    return;
                }

                // avoid double-wiring
                this.disConnectObserver(this._domObserver);

                // Safety: track observer call count to detect infinite loops
                let observerCallCount = 0;
                let lastResetTime = Date.now();

                this._domObserver = new MutationObserver((recs) => {
                    try {
                        // Reset counter every second
                        const now = Date.now();
                        if (now - lastResetTime > 1000) {
                            observerCallCount = 0;
                            lastResetTime = now;
                        }

                        observerCallCount++;

                        // Safety: if observer fires too many times, something is wrong
                        if (observerCallCount > 100) {
                            console.error(this.LOG, 'Observer firing too frequently, pausing to prevent freeze');
                            return;
                        }

                        // Early return if we're making changes
                        if (this._isMakingOwnChanges || this.state?.isPruning) {
                            return;
                        }

                        recs.forEach((r) => {
                            if (r.target?.closest?.('#ca-panel')) return;

                            // Handle attribute changes (gender, visibility)
                            if (r.type === 'attributes') {
                                const target = r.target;
                                if (this.safeMatches(target, '.user_item')) {
                                    this._handleVisibilityOrGenderChange(target);
                                }
                                return;
                            }

                            if (r.addedNodes?.length) {
                                for (let i = 0; i < r.addedNodes.length; i++) {
                                    const node = r.addedNodes[i];
                                    if (node.nodeType !== 1) continue;
                                    if (node.closest?.('#ca-panel')) continue;
                                    if (node.classList?.contains('ca-sent-chip') || node.classList?.contains('ca-ck-wrap') || node.classList?.contains('ca-hidden')) continue;

                                    if (this.safeMatches(node, '.user_item') || this.safeQuery(node, '.user_item')) {
                                        this._handleAddedNode(node);
                                    }
                                }
                            }

                            if (r.removedNodes?.length) {
                                for (let j = 0; j < r.removedNodes.length; j++) {
                                    const node = r.removedNodes[j];
                                    if (node.nodeType !== 1) continue;
                                    if (node.closest?.('#ca-panel')) continue;
                                    if (node.classList?.contains('ca-sent-chip') || node.classList?.contains('ca-ck-wrap')) continue;

                                    if (this.safeMatches(node, '.user_item') || this.safeQuery(node, '.user_item')) {
                                        this._handleRemovedNode(node);
                                    }
                                }
                            }
                        });
                    } catch (e) {
                        console.error(e);
                        console.error(this.LOG, 'Observer error:', e);
                    }
                });

                // Store observer but DON'T start observing yet
                // Will be started after initial setup in _runInitialLogWhenReady
                this._domObserverContainer = c;  // Store container for later

                // Run initial setup WITHOUT observer active
                this._runInitialLogWhenReady?.();
            };

            attach();
        }


        _handleVisibilityOrGenderChange(el) {
            try {
                // Accept either `.user_item` or a wrapper with data-uid
                const row = el.closest?.('.user_item, [data-uid]') || el;
                const uid = this.getUserId(row);
                if (!uid) return;

                const isFemale = row.getAttribute('data-gender') === this.FEMALE_CODE;
                const visible = this.isUserVisible(row);
                const name = this.extractUsername(row) || uid;
                const avatar = this.extractAvatar(row);

                if (uid && name && this.Users?.set) this.Users.set(uid, name, avatar, isFemale);

                const wasLoggedIn = this.Users.isLoggedIn(uid);

                this.debug('Handling visibility change:', uid, name, avatar, isFemale, visible);

                // Always apply gender-based hiding/showing
                this.pruneNonFemale(row);

                if (isFemale && visible && !wasLoggedIn) {
                    this.Users.setLoggedIn(uid, true);
                    if (this._didInitialLog && this._presenceArmed) {
                        this.logLogin({uid, name, avatar});
                    }
                    this.ensureSentChip?.(uid, !!(this.REPLIED_CONVOS && this.REPLIED_CONVOS[uid]));
                } else if ((!isFemale || !visible) && wasLoggedIn) {
                    const user = this.Users.get(uid);
                    const prevName = user?.name || name;
                    this.Users.setLoggedIn(uid, false);
                    if (this._didInitialLog && this._presenceArmed) {
                        this.logLogout({uid, name: prevName, avatar});
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }

        // Treat nodes with `.ca-hidden` (self or ancestor) as invisible
        isUserVisible(el) {
            try {
                if (!el || el.nodeType !== 1) return false;
                // If this node OR any ancestor is ca-hidden → invisible
                if (el.classList?.contains('ca-hidden') || el.closest?.('.ca-hidden')) return false;

                const cs = window.getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
                // offsetParent covers many hidden cases; also check size
                return !(el.offsetParent === null && (el.offsetWidth === 0 && el.offsetHeight === 0));

            } catch {
                return true;
            }
        }

        /* ===================== CHAT TAP (partial) ===================== */
        isChatLogUrl(u) {
            try {
                if (!u) return false;
                let s = String(u);
                try {
                    s = new URL(s, location.origin).pathname;
                } catch {
                }
                return s.indexOf('system/action/chat_log.php') !== -1;
            } catch {
                return false;
            }
        }

        caUpdateChatCtxFromBody(bodyLike, urlMaybe) {
            try {
                if (this.caUpdateChatCtxFromBody._initialized) return;

                let qs = this.normalizeBodyToQuery(bodyLike);
                if (!qs && typeof urlMaybe === 'string') {
                    try {
                        const u = new URL(urlMaybe, location.origin);
                        qs = u.search ? u.search.replace(/^\?/, '') : '';
                    } catch {
                    }
                }
                if (!qs) {
                    console.warn(this.LOG, 'No parameters found from chat_log.php call.');
                    return;
                }
                if (qs.indexOf('priv=1') !== -1) return;

                const p = new URLSearchParams(qs);
                const ca = p.get('caction'), lp = p.get('lastp'), la = p.get('last'), rm = p.get('room'),
                    nf = p.get('notify'), cs = p.get('curset'), pc = p.get('pcount');

                this.state = this.state || {};
                this.state.CHAT_CTX = this.state.CHAT_CTX || {
                    caction: '',
                    last: '',
                    lastp: '',
                    room: '',
                    notify: '',
                    curset: '',
                    pcount: 0
                };

                if (ca) this.state.CHAT_CTX.caction = String(ca);
                if (lp) this.state.CHAT_CTX.lastp = String(lp);
                if (rm) this.state.CHAT_CTX.room = String(rm);
                if (nf) this.state.CHAT_CTX.notify = String(nf);
                if (cs) this.state.CHAT_CTX.curset = String(cs);

                this.caUpdateChatCtxFromBody._initialized = true;

                this.state.CHAT_CTX.pcount = String(pc);
                this.state.CHAT_CTX.last = String(la);
            } catch (e) {
                console.error(e);
                console.error(this.LOG, 'Chat context initialization error:', e);
            }
        }

        /** Safe JSON.parse that returns {} on failure */
        parseJSONOrEmpty(str) {
            try {
                return JSON.parse(String(str));
            } catch (e) {
                try {
                    console.error(e);
                } catch (_) {
                }
                return {};
            }
        }

        /** @param {any} x @returns {{log_id:string,log_date:string,user_id:string,user_name:string,user_tumb:string,log_content:string}} */
        toPrivLogItem(x) {
            const o = x && typeof x === 'object' ? x : {};
            return {
                log_id: String(o.log_id ?? ''),
                log_date: String(o.log_date ?? ''),
                user_id: String(o.user_id ?? ''),
                user_name: String(o.user_name ?? ''),
                user_tumb: String(o.user_tumb ?? ''),
                log_content: String(o.log_content ?? '')
            };
        }

        /** @param {any} x @returns {{last:string,pico:number,pload:Array,plogs:Array}} */
        toChatLogResponse(x) {
            const o = x && typeof x === 'object' ? x : {};
            const picoNum = Number.isFinite(o.pico) ? o.pico :
                (typeof o.pico === 'string' ? (Number(o.pico) || 0) : 0);
            const pload = Array.isArray(o.pload) ? o.pload.map(this.toPrivLogItem.bind(this)) : [];
            const plogs = Array.isArray(o.plogs) ? o.plogs.map(this.toPrivLogItem.bind(this)) : [];
            return {
                last: typeof o.last === 'string' ? o.last : '',
                pico: picoNum,
                pload,
                plogs
            };
        }

        /** @param {any} x @returns {{code:number,log:{log_content:string}}} */
        toPrivateSendResponse(x) {
            const o = x && typeof x === 'object' ? x : {};
            const codeNum = Number.isFinite(o.code) ? o.code :
                (typeof o.code === 'string' ? (Number(o.code) || 0) : 0);
            return {
                code: codeNum,
                log: {log_content: String(o?.log?.log_content ?? '')}
            };
        }

        /** @param {any} x @returns {{last:string,pload:Array,plogs:Array}} */
        toPrivateChatLogResponse(x) {
            const o = x && typeof x === 'object' ? x : {};
            const pload = Array.isArray(o.pload) ? o.pload.map(this.toPrivLogItem.bind(this)) : [];
            const plogs = Array.isArray(o.plogs) ? o.plogs.map(this.toPrivLogItem.bind(this)) : [];
            return {
                last: typeof o.last === 'string' ? o.last : '',
                pload,
                plogs
            };
        }

        /* ---------- Time & watermark comparison ---------- */
        isMessageNewer(logDateStr, debugLog = false) {
            try {
                const watermark = this.getGlobalWatermark();
                if (!watermark) return true; // no watermark -> everything is "new"

                const msgNum = this.parseLogDateToNumber(logDateStr);
                const wmNum = this.parseLogDateToNumber(watermark);
                if (!msgNum) return false;

                const isNewer = msgNum >= wmNum;
                if (debugLog) {
                    console.log(this.LOG, 'Date comparison:', {
                        logDate: logDateStr, logDateNum: msgNum,
                        watermark, watermarkNum: wmNum, isNewer
                    });
                }
                return isNewer;
            } catch (e) {
                console.error(e);
                console.error(this.LOG, 'Date comparison error:', e);
                return false;
            }
        }

        /* ---------- Body normalization ---------- */
        normalizeBodyToQuery(body) {
            try {
                if (!body) return '';
                if (typeof body === 'string') return body;
                if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
                if (typeof FormData !== 'undefined' && body instanceof FormData) {
                    const usp = new URLSearchParams();
                    body.forEach((v, k) => usp.append(k, typeof v === 'string' ? v : ''));
                    return usp.toString();
                }
                if (typeof body === 'object') {
                    try {
                        return new URLSearchParams(body).toString();
                    } catch (e) {
                        console.error(e);
                    }
                }
            } catch (e) {
                console.error(e);
                console.error(this.LOG, 'Body normalization error:', e);
            }
            return '';
        }

        pruneNonFemale(el) {
            if (!el) return;
            const isFemale = el.getAttribute('data-gender') === this.FEMALE_CODE;

            if (!isFemale) {
                // Force hide non-female accounts
                el.classList.add('ca-hidden');
                // Also set display:none as a backup
                el.style.setProperty('display', 'none', 'important');
            } else {
                // Ensure female accounts are visible
                el.classList.remove('ca-hidden');
                el.style.removeProperty('display');
            }
        }

        pruneAllNonFemale() {
            const c = this.getContainer();
            if (!c) return;

            this._isMakingOwnChanges = true;
            this.state.isPruning = true;
            try {
                this.qsa('.user_item[data-gender]', c).forEach((el) => this.pruneNonFemale(el));
            } finally {
                this.state.isPruning = false;
                setTimeout(() => {
                    this._isMakingOwnChanges = false;
                }, 0);
            }
        }

        /* ---------- ID/Name/Avatar extraction ---------- */
        getUserId(el) {
            if (!el) return null;
            try {
                const ds = el.dataset || {};
                let id = ds.uid || ds.userid || ds.user || ds.id;
                if (!id) {
                    let n = this.qs('[data-uid]', el);
                    if (n?.dataset?.uid) id = n.dataset.uid;
                    if (!id) {
                        n = this.qs('[data-userid]', el);
                        if (n?.dataset?.userid) id = n.dataset.userid;
                    }
                    if (!id) {
                        n = this.qs('[data-user]', el);
                        if (n?.dataset?.user) id = n.dataset.user;
                    }
                    if (!id) {
                        n = this.qs('[data-id]', el);
                        if (n?.dataset?.id) id = n.dataset.id;
                    }
                }
                if (!id) {
                    let a = this.qs('a[href*="profile"]', el), m = a && a.href.match(/(?:\/profile\/|[?&]uid=)(\d+)/);
                    if (m?.[1]) id = m[1];
                    if (!id) {
                        a = this.qs('a[href*="user"]', el);
                        m = a && a.href.match(/(?:\/user\/|[?&]id=)(\d+)/);
                        if (m?.[1]) id = m[1];
                    }
                }
                return id ? String(id) : null;
            } catch (e) {
                console.error(e);
                return null;
            }
        }

        extractUsername(el) {
            if (!el) return '';
            try {
                const v = el.getAttribute('data-name');
                if (v) return v.trim();
                let n = this.qs('.user_name,.username,.name', el);
                if (n?.textContent) return n.textContent.trim();
                let t = el.getAttribute('title');
                if (t) return t.trim();
                const text = (el.textContent || '').trim();
                if (!text) return '';
                const parts = text.split(/\s+/).filter(Boolean);
                if (!parts.length) return '';
                parts.sort((a, b) => a.length - b.length);
                return parts[0];
            } catch (e) {
                console.error(e);
                return '';
            }
        }

        extractAvatar(el) {
            try {
                if (!el) return '';
                const img = this.safeQuery(el, 'img[src*="avatar"]') || this.safeQuery(el, '.avatar img') || this.safeQuery(el, 'img');
                const src = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
                return src ? src.trim() : '';
            } catch (e) {
                console.error(e);
                return '';
            }
        }

        /* ---------- Collect female IDs ---------- */
        collectFemaleIds() {
            const c = this.getContainer();
            if (!c) return [];
            const els = this.qsa(`.user_item[data-gender="${this.FEMALE_CODE}"]`, c);
            console.log('Collecting female IDs:', els.length);
            const femaleAccounts = [];
            for (let i = 0; i < els.length; i++) {
                const uid = this.getUserId(els[i]);
                if (uid) femaleAccounts.push({el: els[i], uid, name: this.extractUsername(els[i])});
            }
            console.log('Collected female IDs:', femaleAccounts);
            return femaleAccounts;
        }

        /* ---------- Token + POST helpers ---------- */
        getToken() {
            try {
                if (typeof utk !== 'undefined' && utk) return utk;
            } catch (e) {
                console.error(e);
            }
            const inp = this.qs('input[name="token"]');
            if (inp?.value) return inp.value;
            const sc = this.qsa('script');
            for (let i = 0; i < sc.length; i++) {
                const t = sc[i].textContent || '';
                const m = t.match(/\butk\s*=\s*['"]([a-f0-9]{16,64})['"]/i);
                if (m) return m[1];
            }
            return null;
        }

        _withTimeout(startFetchFn, ms = 15000) {
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), ms);
            return startFetchFn(ac.signal)
                .catch(err => ({ok: false, status: 0, body: String((err && err.message) || 'error')}))
                .finally(() => clearTimeout(t));
        }

        sendPrivateMessage(target, content) {
            const token = this.getToken();
            if (!token || !target || !content) return Promise.resolve({ok: false, status: 0, body: 'bad args'});

            this.debug('Sending private message to:', target, 'content length:', content.length);

            const body = new URLSearchParams({
                token,
                cp: 'chat',
                target: String(target),
                content: String(content),
                quote: '0'
            }).toString();
            return this._withTimeout(signal => {
                return fetch('/system/action/private_process.php', {
                    method: 'POST', credentials: 'include', signal,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-CA-OWN': '1'
                    },
                    body
                }).then(res => res.text().then(txt => {
                    let parsed;
                    try {
                        parsed = JSON.parse(txt);
                    } catch (e) {
                        console.error(e);
                    }
                    return {ok: res.ok, status: res.status, body: parsed || txt};
                }));
            }, 15000);
        }

        async searchUsersRemote(query) {
            const token = this.getToken();
            if (!token || !query) return [];

            const body = new URLSearchParams({
                token,
                cp: 'chat',
                query: String(query),
                search_type: '1',
                search_order: '0'
            }).toString();

            try {
                const res = await fetch('/system/action/action_search.php', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'Accept': '*/*',
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-CA-OWN': '1'
                    },
                    body
                });

                const html = await res.text();
                return this.parseUserSearchHTML(html);
            } catch (e) {
                console.error('searchUsersRemote failed:', e);
                return [];
            }
        }

        parseUserSearchHTML(html) {
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            const nodes = tmp.querySelectorAll('.user_item[data-id]');
            const out = [];
            for (let i = 0; i < nodes.length; i++) {
                const el = nodes[i];
                if (el.getAttribute('data-gender') !== this.FEMALE_CODE) continue;
                const id = el.getAttribute('data-id');
                if (!id) continue;
                let name = '';
                const p = el.querySelector('.username');
                if (p?.textContent) name = p.textContent.trim();
                if (!name) {
                    const dn = el.getAttribute('data-name');
                    if (dn) name = dn.trim();
                }
                out.push({el: null, uid: String(id), name});
            }
            return out;
        }

        /* ---------- Mark sent + chips/sorting ---------- */
        markSent(uid) {
            try {
                const userEl = this.findUserElementById(uid);
                if (!userEl) return;

                // only apply if not already marked
                if (!userEl.classList.contains('chataddons-sent')) {
                    userEl.classList.add('chataddons-sent');
                    userEl.style.setProperty('outline', '2px solid #8bc34a66', 'important');
                    userEl.style.setProperty('border-radius', '8px', 'important');
                }

                // update chip (sorting is handled by _placeRowByReplyStatus via observer)
                this.ensureSentChip(uid, !!this.REPLIED_CONVOS[uid]);

                // Trigger re-positioning of the row since reply status changed
                if (userEl) {
                    this._placeRowByReplyStatus(userEl, true); // true = now replied
                }
            } catch (e) {
                console.error(e);
            }
        }

        /* ---------- EXCLUDED (persisted checkboxes) ---------- */
        _loadExcluded() {
            const raw = this.Store.get(this.EXC_KEY);
            if (!raw) return {};
            const arr = Array.isArray(raw) ? raw : [];
            const map = {};
            for (let i = 0; i < arr.length; i++) {
                const k = String(arr[i]);
                if (k) map[k] = 1;
            }
            return map;
        }

        _saveExcluded(map) {
            const arr = [];
            for (const k in map) if (Object.prototype.hasOwnProperty.call(map, k) && map[k]) arr.push(k);
            this.Store.set(this.EXC_KEY, arr);
        }

        /* ---------- REPLIED_CONVOS ---------- */
        _loadRepliedConvos() {
            return this.Store.get(this.REPLIED_CONVOS_KEY) || {};
        }

        _saveRepliedConvos(map) {
            this.Store.set(this.REPLIED_CONVOS_KEY, map);
        }

        /* ---------- Last pcount map ---------- */
        _loadLastPcountMap() {
            try {
                const raw = this.Store.get(this.LAST_PCOUNT_MAP_KEY);
                return raw ? (raw || {}) : {};
            } catch (e) {
                console.error(e);
                return {};
            }
        }

        _saveLastPcountMap(map) {
            this.Store.set(this.LAST_PCOUNT_MAP_KEY, map || {});
        }

        getLastPcountFor(uid) {
            try {
                return (this.LAST_PCOUNT_MAP && Number(this.LAST_PCOUNT_MAP[uid])) || 0;
            } catch (e) {
                console.error(e);
                return 0;
            }
        }

        setLastPcountFor(uid, pc) {
            try {
                if (!uid) return;
                this.LAST_PCOUNT_MAP[uid] = Number(pc) || 0;
                this._saveLastPcountMap(this.LAST_PCOUNT_MAP);
            } catch (e) {
                console.error(e);
            }
        }

        /* ---------- Displayed log_ids per conversation ---------- */
        _loadDisplayedLogIds() {
            try {
                const raw = this.Store.get(this.DISPLAYED_LOGIDS_KEY);
                return raw ? (raw || {}) : {};
            } catch (e) {
                console.error(e);
                return {};
            }
        }

        _saveDisplayedLogIds(map) {
            this.Store.set(this.DISPLAYED_LOGIDS_KEY, map || {});
        }

        getDisplayedLogIdsFor(uid) {
            try {
                if (!uid || !this.DISPLAYED_LOGIDS[uid]) return [];
                return this.DISPLAYED_LOGIDS[uid] || [];
            } catch (e) {
                console.error(e);
                return [];
            }
        }

        addDisplayedLogId(uid, logId) {
            try {
                if (!uid || !logId) return;
                if (!this.DISPLAYED_LOGIDS[uid]) this.DISPLAYED_LOGIDS[uid] = [];
                if (!this.DISPLAYED_LOGIDS[uid].includes(logId)) this.DISPLAYED_LOGIDS[uid].push(logId);
                if (this.DISPLAYED_LOGIDS[uid].length > this.MAX_LOGIDS_PER_CONVERSATION) {
                    this.DISPLAYED_LOGIDS[uid] = this.DISPLAYED_LOGIDS[uid].slice(-this.MAX_LOGIDS_PER_CONVERSATION);
                }
                this._saveDisplayedLogIds(this.DISPLAYED_LOGIDS);
            } catch (e) {
                console.error(e);
                console.error(this.LOG, 'Add displayed log_id error:', e);
            }
        }

        hasDisplayedLogId(uid, logId) {
            try {
                if (!uid || !logId) return false;
                return this.getDisplayedLogIdsFor(uid).includes(logId);
            } catch (e) {
                console.error(e);
                return false;
            }
        }

        /* ---------- DOM find helper ---------- */
        findUserElementById(id, root = document) {
            if (!id) return null;
            try {
                return root.querySelector(`.user_item[data-id="${id}"], .user_item[data-uid="${id}"], .user_item [data-id="${id}"], .user_item [data-uid="${id}"]`);
            } catch (e) {
                console.error('findUserElementById failed:', e);
                return null;
            }
        }

        /* ---------- Sent chip & badges ---------- */
        ensureSentChip(uid, on) {
            const userEl = this.findUserElementById(uid);
            try {
                if (!userEl) return;
                let chip = userEl.querySelector('.ca-sent-chip');
                if (on) {
                    if (!chip) {
                        this._isMakingOwnChanges = true;
                        chip = document.createElement('span');
                        chip.className = 'ca-sent-chip';
                        chip.textContent = '✓';
                        userEl.appendChild(chip);
                        setTimeout(() => {
                            this._isMakingOwnChanges = false;
                        }, 10);
                    } else {
                        chip.textContent = '✓';
                    }
                } else {
                    if (chip?.parentNode) {
                        this._isMakingOwnChanges = true;
                        chip.parentNode.removeChild(chip);
                        setTimeout(() => {
                            this._isMakingOwnChanges = false;
                        }, 10);
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }

        updateSentBadges() {
            try {
                const c = this.getContainer();
                if (!c) return;
                this.qsa('.user_item', c).forEach(el => {
                    const id = this.getUserId(el);
                    this.ensureSentChip(id, !!(id && this.REPLIED_CONVOS[id]));
                });
            } catch (e) {
                console.error(e);
            }
        }

        // Is this row "replied" according to your truth source
        _isRowReplied(row) {
            const uid = this.getUserId?.(row);
            return !!(uid && this.REPLIED_CONVOS && this.REPLIED_CONVOS[uid]);
        }

        // Find the first visible replied row (partition boundary)
        _getFirstVisibleRepliedRow(container) {
            // skip hidden (e.g., non-female or filtered)
            return this.qs('.user_item:not(.ca-hidden) .ca-sent-chip', container)?.closest('.user_item') || null;
        }

        _placeRowByReplyStatus(row, replied = null) {
            const list = this.getContainer?.();
            if (!list || !row) return;

            // if caller already knows, use it; otherwise compute
            const isReplied = (replied != null) ? replied : this._isRowReplied(row);

            if (!this._isMakingOwnChanges) this._isMakingOwnChanges = true;
            try {
                if (isReplied) {
                    list.appendChild(row);
                } else {
                    const firstReplied = this._getFirstVisibleRepliedRow(list);
                    list.insertBefore(row, firstReplied || list.firstChild);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setTimeout(() => {
                    this._isMakingOwnChanges = false;
                }, 0);
            }
        }

        processFemaleRow(row) {
            if (!row) return false;

            // 1) prune just this row
            this.pruneNonFemale(row);

            // 2) eligibility
            const isFemale = row.getAttribute('data-gender') === this.FEMALE_CODE;
            if (!isFemale || row.classList.contains('ca-hidden')) return false;
            if (!this.isUserVisible(row)) return false;
            if (!this._isAllowedRank(row)) return false;

            // 3) per-row UI
            this.ensureBroadcastCheckbox(row);

            // 4) sent chip & reply status
            const uid = this.getUserId?.(row);
            const replied = !!(uid && this.REPLIED_CONVOS && this.REPLIED_CONVOS[uid]);
            if (uid) this.ensureSentChip?.(uid, replied);

            // 5) place the row based on that same status
            this._placeRowByReplyStatus(row, replied);

            return true;
        }


        /* ---------- Rank filter & selection checkbox ---------- */
        _isAllowedRank(el) {
            try {
                const rankAttr = el ? (el.getAttribute('data-rank') || '') : '';
                const roomRankIcon = this.safeQuery(el, '.list_rank');
                const roomRank = roomRankIcon ? (roomRankIcon.getAttribute('data-r') || '') : '';
                return (rankAttr === '1' || rankAttr === '50') && (roomRank !== '4');
            } catch (e) {
                console.error(e);
                return false;
            }
        }

        // more descriptive and self-contained
        ensureBroadcastCheckbox(el) {
            try {
                if (!el || el.nodeType !== 1) return;      // skip invalid
                if (el.getAttribute('data-gender') !== this.FEMALE_CODE) return;
                if (this.qs('.ca-ck-wrap', el)) return;    // already has one
                if (!this._isAllowedRank?.(el)) return;

                const id = this.getUserId?.(el);
                if (!id) return;

                this._isMakingOwnChanges = true;

                const wrap = document.createElement('label');
                wrap.className = 'ca-ck-wrap';
                wrap.title = 'Include in broadcast';

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'ca-ck';

                // initial state could reflect some user list / selection map if you have one
                cb.checked = !!(this.EXCLUDED && !this.EXCLUDED[id]);

                wrap.appendChild(cb);
                el.appendChild(wrap);

                // (optional) event hookup here if you don’t already wire at container level
                cb.addEventListener('change', (e) => this.handleCheckboxChange?.(e, id, el));

            } catch (e) {
                console.error(e);
            } finally {
                setTimeout(() => {
                    this._isMakingOwnChanges = false;
                }, 0);
            }
        }

        /* ---------- Panel UI ---------- */
        appendAfterMain(el) {
            const main = document.querySelector('#chat_right') || document.querySelector('#container_user') || document.body;
            if (main && main.parentElement) main.parentElement.appendChild(el); else document.body.appendChild(el);
        }

        buildPanel() {
            const h = document.createElement('section');
            h.id = this.getCleanSelector(this.sel.panel);
            h.className = 'ca-panel';
            h.innerHTML = `
              <div class="ca-body">
                <div class="ca-nav">
                  <button id="ca-nav-bc" class="ca-nav-btn" type="button">Broadcast</button>
                  <button id="${this.getCleanSelector(this.sel.log.clear)}" class="ca-btn ca-btn-xs" type="button">Clear</button>
                  <label class="ca-debug-toggle" title="Enable debug logging">
                    <input type="checkbox" id="ca-debug-checkbox">
                    <span>Debug</span>
                  </label>
                </div>
            
                <div class="ca-section ca-section-compact">
                  <div class="ca-section-title"><span>Sent Messages</span></div>
                  <div id="${this.getCleanSelector(this.sel.log.sent)}"
                       class="ca-log-box ca-log-box-compact ${this.getCleanSelector(this.sel.log.classes.ca_box_scrollable)}"
                       aria-live="polite"></div>
                </div>
            
                <hr class="ca-divider">
            
                <div class="ca-section ca-section-expand">
                  <div class="ca-section-title"><span>Received Messages</span></div>
                  <div id="${this.getCleanSelector(this.sel.log.received)}" 
                       class="ca-log-box ca-log-box-expand"
                       aria-live="polite">
                    <div class="ca-log-subsection-unreplied-wrapper">
                      <div class="ca-log-subsection-header">Not Replied</div>
                      <div id="${this.getCleanSelector(this.sel.log.unreplied)}"
                            class="${this.getCleanSelector(this.sel.log.classes.ca_box_scrollable)}">
                           </div>
                    </div>
                    <div class="ca-log-subsection-replied-wrapper">
                      <div class="ca-log-subsection-header">Replied</div>
                      <div id="${this.getCleanSelector(this.sel.log.replied)}"
                            class="${this.getCleanSelector(this.sel.log.classes.ca_box_scrollable)}">
                      </div>
                    </div>
                  </div>
                </div>
            
                <div class="ca-section ca-log-section">
                  <hr class="ca-divider">
                  <div class="ca-section-title"><span>Logon/Logoff</span></div>
                  <div id="${this.getCleanSelector(this.sel.log.presence)}"
                       class="ca-log-box ${this.getCleanSelector(this.sel.log.classes.ca_box_scrollable)}"
                       aria-live="polite"></div>
                </div>
              </div>`;


            this.appendAfterMain(h);
            this._attachLogClickHandlers();
        }

        createBroadcastPopup() {
            let pop = document.getElementById('ca-bc-pop');
            if (pop) return pop;

            pop = document.createElement('div');
            pop.id = 'ca-bc-pop';
            pop.className = 'ca-pop';
            pop.innerHTML =
                '<div id="ca-bc-pop-header" class="ca-pop-header">' +
                '  <span>Broadcast</span>' +
                '  <button id="ca-bc-pop-close" class="ca-pop-close" type="button">✕</button>' +
                '</div>' +
                '<div class="ca-pop-body">' +
                '  <textarea id="ca-bc-msg" class="ca-8" rows="5" placeholder="Type the broadcast message..."></textarea>' +
                '  <div class="ca-controls" style="margin-top:4px;">' +
                '    <span id="ca-bc-status" class="ca-status"></span>' +
                '    <a id="ca-bc-reset" href="#" class="ca-reset-link" style="margin-left:auto">Reset tracking</a>' +
                '  </div>' +
                '  <div class="ca-pop-actions">' +
                '    <button id="ca-bc-send" class="ca-btn ca-btn-slim" type="button">Send</button>' +
                '  </div>' +
                '</div>';
            document.body.appendChild(pop);

            const closeBtn = pop.querySelector('#ca-bc-pop-close');
            if (closeBtn) closeBtn.addEventListener('click', () => {
                pop.style.display = 'none';
            });

            // drag
            const hdr = pop.querySelector('#ca-bc-pop-header');
            let ox = 0, oy = 0, sx = 0, sy = 0;
            const mm = (e) => {
                const dx = e.clientX - sx, dy = e.clientY - sy;
                pop.style.left = (ox + dx) + 'px';
                pop.style.top = (oy + dy) + 'px';
                pop.style.transform = 'none';
            };
            const mu = () => {
                document.removeEventListener('mousemove', mm);
                document.removeEventListener('mouseup', mu);
            };
            if (hdr) hdr.addEventListener('mousedown', (e) => {
                sx = e.clientX;
                sy = e.clientY;
                const r = pop.getBoundingClientRect();
                ox = r.left;
                oy = r.top;
                document.addEventListener('mousemove', mm);
                document.addEventListener('mouseup', mu);
            });

            return pop;
        }

        createSpecificPopup() {
            let pop = document.getElementById('ca-specific-pop');
            if (pop) return pop;

            pop = document.createElement('div');
            pop.id = 'ca-specific-pop';
            pop.className = 'ca-pop';
            pop.innerHTML =
                '<div id="ca-specific-pop-header" class="ca-pop-header">' +
                '  <span>Send to specific user</span>' +
                '  <button id="ca-specific-pop-close" class="ca-pop-close" type="button">✕</button>' +
                '</div>' +
                '<div class="ca-pop-body">' +
                '  <div class="ca-row">' +
                '    <input id="ca-specific-username" class="ca-input-slim" type="text" placeholder="Enter username (case-insensitive)">' +
                '    <button id="ca-specific-send" class="ca-btn ca-btn-slim" type="button">Send</button>' +
                '  </div>' +
                '  <div id="ca-specific-status" class="ca-status"></div>' +
                '  <textarea id="ca-specific-msg" class="ca-8" rows="5" placeholder="Type the message..."></textarea>' +
                '  <div class="ca-pop-actions">' +
                '    <a id="ca-specific-reset" href="#" class="ca-reset-link">Reset tracking</a>' +
                '  </div>' +
                '</div>';
            document.body.appendChild(pop);

            const closeBtn = pop.querySelector('#ca-specific-pop-close');
            if (closeBtn) closeBtn.addEventListener('click', () => {
                pop.style.display = 'none';
            });

            // draggable header
            const hdr = pop.querySelector('#ca-specific-pop-header');
            let ox = 0, oy = 0, sx = 0, sy = 0;
            const mm = (e) => {
                const dx = e.clientX - sx, dy = e.clientY - sy;
                pop.style.left = (ox + dx) + 'px';
                pop.style.top = (oy + dy) + 'px';
                pop.style.transform = 'none';
            };
            const mu = () => {
                document.removeEventListener('mousemove', mm);
                document.removeEventListener('mouseup', mu);
            };
            if (hdr) hdr.addEventListener('mousedown', (e) => {
                sx = e.clientX;
                sy = e.clientY;
                const r = pop.getBoundingClientRect();
                ox = r.left;
                oy = r.top;
                document.addEventListener('mousemove', mm);
                document.addEventListener('mouseup', mu);
            });

            return pop;
        }

        openSpecific() {
            console.log(this.LOG, 'openSpecific() called');
            const pop = this.createSpecificPopup();
            console.log(this.LOG, 'Specific popup element:', pop);
            if (pop) {
                // Ensure it's visible and styled as modal
                pop.style.display = 'block';
                pop.style.position = 'fixed';
                pop.style.zIndex = '2147483647';
                console.log(this.LOG, 'Set popup display to block, current display:', pop.style.display);
                if (!this.openSpecific._wired) {
                    this.wireSpecificControls();
                    this.openSpecific._wired = true;
                }
            } else {
                console.error(this.LOG, 'Failed to create specific popup');
            }
        }

        wireSpecificControls() {
            // Rebind specific refs to popup controls
            this.ui.sUser = this.qs(this.sel.specificPop.username);
            this.ui.sMsg = this.qs(this.sel.specificPop.msg);
            this.ui.sSend = this.qs(this.sel.specificPop.send);
            this.ui.sStat = this.qs(this.sel.specificPop.status);
            this.ui.sReset = this.qs(this.sel.specificPop.reset);

            if (this.ui.sReset && !this.ui.sReset._wired) {
                this.ui.sReset._wired = true;
                this.ui.sReset.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.resetForText(this.ui.sStat);
                });
            }

            // Wire the send button - reset the flag since we're binding to new modal elements
            if (this.ui.sSend) {
                this.ui.sSend._wired = false; // Reset flag for modal button
                this.wireSpecificSendButton();
            }
        }


        openBroadcast() {
            console.log(this.LOG, 'openBroadcast() called');
            const pop = this.createBroadcastPopup();
            console.log(this.LOG, 'Broadcast popup element:', pop);
            if (pop) {
                // Ensure it's visible and styled as modal
                pop.style.display = 'block';
                pop.style.position = 'fixed';
                pop.style.zIndex = '2147483647';
                console.log(this.LOG, 'Set popup display to block, current display:', pop.style.display);
                if (!this.openBroadcast._wired) {
                    this.wireBroadcastControls();
                    this.openBroadcast._wired = true;
                }
            } else {
                console.error(this.LOG, 'Failed to create broadcast popup');
            }
        }

        wireBroadcastControls() {
            // rebind refs and handlers for broadcast controls inside popup
            this.ui.bMsg = this.qs('#ca-bc-msg');
            this.ui.bSend = this.qs('#ca-bc-send');
            this.ui.bReset = this.qs('#ca-bc-reset');
            this.ui.bStat = this.qs('#ca-bc-status');

            if (this.ui.bReset && !this.ui.bReset._wired) {
                this.ui.bReset._wired = true;

                this.ui.bReset.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.resetForText(this.ui.bStat);
                });
            }

            if (this.ui.bSend && !this.ui.bSend._wired) {
                this.ui.bSend._wired = true;
                this.ui.bSend.addEventListener('click', () => {
                    const $bSend = this.ui.bSend, $bMsg = this.ui.bMsg, $bStat = this.ui.bStat;

                    const text = (this.trim ? this.trim($bMsg?.value || '') : String($bMsg?.value || '').trim());
                    if (!text) {
                        if ($bStat) $bStat.textContent = 'Type the message first.';
                        return;
                    }

                    const list = this.buildBroadcastList();
                    const sent = this._loadRepliedConvos();
                    const to = [];
                    for (let i = 0; i < list.length; i++) {
                        if (!sent[list[i].uid]) to.push(list[i]);
                    }
                    if (!to.length) {
                        if ($bStat) $bStat.textContent = 'No new recipients for this message (after exclusions/rank filter).';
                        return;
                    }

                    $bSend.disabled = true;
                    let ok = 0, fail = 0, B = 10, T = Math.ceil(to.length / B);

                    const runBatch = (bi) => {
                        if (bi >= T) {
                            if ($bStat) $bStat.textContent = `Done. Success: ${ok}, Failed: ${fail}.`;
                            $bSend.disabled = false;
                            return;
                        }
                        const start = bi * B, batch = to.slice(start, start + B);
                        let idx = 0;
                        if ($bStat) $bStat.textContent = `Batch ${bi + 1}/${T} — sending ${batch.length}... (OK:${ok} Fail:${fail})`;

                        const one = () => {
                            if (idx >= batch.length) {
                                if (bi < T - 1) {
                                    const wait = this.randBetween ? this.randBetween(10000, 20000) : (10000 + Math.floor(Math.random() * 10000));
                                    if ($bStat) $bStat.textContent = `Batch ${bi + 1}/${T} done — waiting ${Math.round(wait / 1000)}s...`;
                                    (this.sleep ? this.sleep(wait) : new Promise(r => setTimeout(r, wait))).then(() => runBatch(bi + 1));
                                } else {
                                    runBatch(bi + 1);
                                }
                                return;
                            }

                            const item = batch[idx++];
                            this.sendWithThrottle(item.uid, text).then((r) => {
                                if (r && r.ok) {
                                    ok++;
                                    sent[item.uid] = 1;
                                }
                                if ($bStat) {
                                    $bStat.textContent = `Batch ${bi + 1}/${T} — ${idx}/${batch.length} sent (OK:${ok} Fail:${fail})`;
                                }
                                return (this.sleep ? this.sleep(this.randBetween ? this.randBetween(2000, 5000) : 2000 + Math.floor(Math.random() * 3000)) : new Promise(r => setTimeout(r, 2500)));
                            }).then(one).catch(() => {
                                const delay = this.randBetween ? this.randBetween(2000, 5000) : 2500;
                                return (this.sleep ? this.sleep(delay) : new Promise(r => setTimeout(r, delay))).then(one);
                            });
                        };

                        one();
                    };
                    runBatch(0);
                });
            }
        }

        addSpecificNavButton() {
            try {
                // Find the Broadcast button and append the Specific button next to it
                const bcBtn = this.qs(this.sel.nav.bc);
                console.log(this.LOG, 'Broadcast button found:', bcBtn);
                if (!bcBtn) return;

                // The ID should be 'ca-nav-specific' not 'a-nav-specific'
                let specBtn = document.getElementById('ca-nav-specific');
                console.log(this.LOG, 'Looking for specific button, found:', specBtn);

                if (!specBtn) {
                    specBtn = document.createElement('button');
                    specBtn.id = 'ca-nav-specific';
                    specBtn.className = 'ca-nav-btn-secondary';
                    specBtn.type = 'button';
                    specBtn.textContent = 'Specific';
                    // insert after Broadcast
                    bcBtn.insertAdjacentElement('afterend', specBtn);
                    console.log(this.LOG, 'Created specific button:', specBtn);
                }
                this.ui.navSpec = specBtn;
                if (!specBtn._wired) {
                    specBtn._wired = true;
                    specBtn.addEventListener('click', () => {
                        console.log(this.LOG, 'Specific button clicked');
                        this.openSpecific();
                    });
                    console.log(this.LOG, 'Wired specific button');
                }
            } catch (e) {
                console.error(this.LOG, 'Error in addSpecificNavButton:', e);
            }
        }

        getCleanSelector(sel) {
            return String(sel || '').trim().substring(1);
        }

        _bindStaticRefs() {
            // specific send controls are now only in the modal popup, not in the panel
            // They will be bound when the modal is opened via wireSpecificControls()

            // logs
            this.ui.sentBox = this.qs(this.sel.log.sent);
            this.ui.receivedMessagesBox = this.qs(this.sel.log.received);
            this.ui.repliedMessageBox = this.qs(this.sel.log.replied);
            this.ui.unrepliedMessageBox = this.qs(this.sel.log.unreplied);
            this.ui.presenceBox = this.qs(this.sel.log.presence);
            this.ui.logClear = this.qs(this.sel.log.clear);

            // nav
            this.ui.navBc = this.qs(this.sel.nav.bc);
            this.ui.navSpec = this.qs(this.sel.nav.spec);

            // debug checkbox
            this.ui.debugCheckbox = this.qs('#ca-debug-checkbox');
        }

        _wirePanelNav() {
            if (this.ui.navBc && !this.ui.navBc._wired) {
                this.ui.navBc._wired = true;
                this.ui.navBc.addEventListener('click', () => {
                    console.log(this.LOG, 'Broadcast button clicked');
                    this.openBroadcast();
                });
            }
            if (this.ui.navSpec && !this.ui.navSpec._wired) {
                this.ui.navSpec._wired = true;
                this.ui.navSpec.addEventListener('click', () => {
                    console.log(this.LOG, 'Specific button clicked');
                    this.openSpecific();
                });
            }
        }

        _wireDebugCheckbox() {
            if (!this.ui.debugCheckbox) return;

            // Set initial state from loaded debugMode
            this.ui.debugCheckbox.checked = this.debugMode;

            this.ui.debugCheckbox.addEventListener('change', (e) => {
                this.debugMode = e.target.checked;

                // Save to both Store and raw localStorage for immediate availability on reload
                try {
                    localStorage.setItem(this.DEBUG_MODE_KEY, String(this.debugMode));
                    if (this.Store) {
                        this.Store.set(this.DEBUG_MODE_KEY, this.debugMode);
                    }
                } catch (err) {
                    console.error('Failed to save debug mode:', err);
                }

                if (this.debugMode) {
                    console.log(this.LOG, '[DEBUG] Debug mode enabled');
                } else {
                    console.log(this.LOG, 'Debug mode disabled');
                }
            });
        }

        _wireLogClear() {
            if (!this.ui.logClear) return;
            this.ui.logClear.addEventListener('click', () => {
                if (this.ui.sentBox) this.ui.sentBox.innerHTML = '';
                // rebuild received with subsections
                if (this.ui.receivedMessagesBox) {
                    this.ui.receivedMessagesBox.innerHTML =
                        '<div class="ca-log-subsection-unreplied-wrapper">' +
                        '  <div class="ca-log-subsection-header">Not Replied</div>' +
                        `  <div id="${this.getCleanSelector(this.sel.log.unreplied)}"></div>` +
                        '</div>' +
                        '<div class="ca-log-subsection-replied-wrapper">' +
                        '  <div class="ca-log-subsection-header">Replied</div>' +
                        `  <div id="${this.getCleanSelector(this.sel.log.replied)}"></div>` +
                        '</div>';

                    // Re-bind refs to the new subsection containers
                    this.ui.repliedMessageBox = this.qs(this.sel.log.replied);
                    this.ui.unrepliedMessageBox = this.qs(this.sel.log.unreplied);
                }
                if (this.ui.presenceBox) this.ui.presenceBox.innerHTML = '';
                this.Store.set(this.ACTIVITY_LOG_KEY, []); // clear persisted log

                // Re-attach event handlers since we replaced the HTML
                this._attachLogClickHandlers?.();
            });
        }

        /* ---------- Activity Log ---------- */
        hasRepliedSince(uid, msgTimestamp) {
            try {
                if (!uid) return false;
                const repliedAt = this.REPLIED_CONVOS && this.REPLIED_CONVOS[uid];
                if (!repliedAt) return false;
                const repliedTime = this.parseLogDateToNumber(repliedAt);
                const msgTime = this.parseLogDateToNumber(msgTimestamp);
                return !!(repliedTime && msgTime && repliedTime > msgTime);
            } catch (e) {
                console.error(e);
                return false;
            }
        }

        determineTargetMessagesContainer(uid, msgTimestamp) {
            const replied = this.hasRepliedSince(uid, msgTimestamp);
            return replied ? this.ui.repliedMessageBox : this.ui.unrepliedMessageBox;
        }

        AppendIfNotYetMarkedReplied(LogEntryEl, uid) {
            try {
                if (typeof this.REPLIED_CONVOS === 'object' && this.REPLIED_CONVOS && this.REPLIED_CONVOS[uid]) {
                    const badge = document.createElement('span');
                    badge.className = 'ca-badge-replied';
                    badge.title = 'Already replied';
                    badge.textContent = '✓';
                    LogEntryEl.appendChild(badge);
                }
            } catch (e) {
                console.error(e);
            }
        }

        renderLogEntry(ts, kind, content, user) {
            // Ensure user object is valid
            if (!user || !user.uid) {
                console.error(this.LOG, 'renderLogEntry: Invalid user object', user);
                return;
            }

            // 1) pick target container
            let targetContainer = null;
            switch (kind) {
                case 'dm-out':
                    targetContainer = this.ui.sentBox;
                    break;
                case 'dm-in':
                    targetContainer = this.ui.receivedMessagesBox;
                    break;
                case 'login':
                case 'logout':
                    targetContainer = this.ui.presenceBox;
                    break;
                default:
                    targetContainer = this.ui.receivedMessagesBox;
                    break;
            }
            if (!targetContainer) return;
            this.debug(`Start rendering entry with timestamp ${ts}, type/kind ${kind}  and content ${content} from user ${user.uid}`, user, `in target container`, targetContainer);

            // 5) entry root
            const entry = document.createElement('div');
            entry.className = 'ca-log-entry ' + ('ca-log-' + kind);

            // 4) build details HTML (safe decode → build)
            const html = this.buildLogHTML(kind, user || {}, content);
            const detailsHTML = this.decodeHTMLEntities ? this.decodeHTMLEntities(html) : html;

            if (user && user.uid != null) entry.setAttribute('data-uid', String(user.uid));

            // 7) timestamp (HH:MM or right part of "DD/MM HH:MM")
            const tsEl = document.createElement('span');
            tsEl.className = 'ca-log-ts';
            tsEl.textContent = (String(ts).split(' ')[1] || String(ts));
            entry.appendChild(tsEl);

            // 8) dot separator
            const dot = document.createElement('span');
            dot.className = 'ca-log-dot';
            entry.appendChild(dot);

            // 9) expand indicator for outgoing (optional – keep if you collapse long items)
            if (kind === 'dm-out') {
                const exp = document.createElement('span');
                exp.className = 'ca-expand-indicator';
                exp.title = 'Click to expand/collapse';
                exp.textContent = '▾';
                entry.appendChild(exp);
            }

            // 👉 NEW: username as its own flex item using your helper
            const userEl = document.createElement('span');
            userEl.className = 'ca-log-user';
            userEl.innerHTML = this.userLinkHTML(user);  // <a href="#">Name</a> etc.
            entry.appendChild(userEl);

            // 10) message text (trusted via buildLogHTML → innerHTML)
            const text = document.createElement('span');
            text.className = 'ca-log-text';
            text.innerHTML = detailsHTML;
            entry.appendChild(text);

            // 11) optional: add a small “dm” link on the right if you use it to open chat
            const dm = document.createElement('a');
            dm.className = 'ca-dm-link ca-dm-right';
            dm.href = '#';
            dm.setAttribute('data-action', 'open-dm');
            dm.textContent = 'dm';
            entry.appendChild(dm);

            // 2) incoming DMs: send to "Not Replied" vs "Replied" section
            //    (do this before DOM creation to choose the real container)
            if (kind === 'dm-in' && targetContainer === this.ui.receivedMessagesBox) {
                console.log(`Start calling method to decide which message box incoming message should be rendered depending on replied status.`);
                this.MarkAndRenderOrMoveRepliedMessage(entry, user.uid, ts);
            } else {
                // 12) insert entry (newest at bottom)
                targetContainer.appendChild(entry);
            }

            // 3) enforce max entries (older removed)
            try {
                this.trimLogBoxToMax?.(targetContainer);
            } catch {
            }

            // 13) auto-scroll the box to the bottom (next frame for reliability)
            requestAnimationFrame(() => {
                try {
                    targetContainer.scrollTop = targetContainer.scrollHeight;
                } catch {
                }
            });
        }

        saveLogEntry(ts, kind, content, uid) {
            if (kind === 'login' || kind === 'logout') return; // don’t persist presence
            let arr = [];
            try {
                const raw = this.Store.get(this.ACTIVITY_LOG_KEY);
                if (raw) arr = raw || [];
            } catch (e) {
                console.error(e);
            }
            arr.unshift({ts, kind, uid, content});
            const LOG_MAX = 200;
            if (arr.length > LOG_MAX) arr = arr.slice(0, LOG_MAX);
            this.Store.set(this.ACTIVITY_LOG_KEY, arr);
        }

        clearNode(el) {
            if (!el) return;
            // Fast and safe: clears children without replacing the node
            el.textContent = '';
        }

        async restoreLog() {
            if (!this.ui.sentBox || !this.ui.receivedMessagesBox || !this.ui.presenceBox) return;

            let arr = [];
            try {
                const raw = this.Store.get(this.ACTIVITY_LOG_KEY);
                if (raw) arr = raw || [];
            } catch (e) {
                console.error(e);
            }

            for (let i = arr.length - 1; i >= 0; i--) {
                const e = arr[i];
                this.debug('Restoring log', e);
                // If you have a Users store/fetcher, adapt here; else build a minimal user object:
                const user = await this.Users.getOrFetch(e.uid);
                this.renderLogEntry(e.ts, e.kind, e.content, user);
            }
        }

        trimLogBoxToMax(targetBox) {
            try {
                if (!targetBox || !targetBox.children) return;
                const boxChildren = Array.from(targetBox.children);
                const LOG_MAX = 200;
                if (boxChildren.length <= LOG_MAX) return;

                const toRemove = boxChildren.length - LOG_MAX;
                for (let i = 0; i < toRemove; i++) {
                    try {
                        boxChildren[i]?.parentNode?.removeChild(boxChildren[i]);
                    } catch (e) {
                        console.error(e);
                        console.error(this.LOG, 'Remove log entry error:', e);
                    }
                }
            } catch (e) {
                console.error(e);
                console.error(this.LOG, 'Trim log error:', e);
            }
        }

        logLine(kind, content, user) {
            const ts = this.getTimeStampInWebsiteFormat();
            this.renderLogEntry(ts, kind, content, user);
            this.saveLogEntry(ts, kind, content, user.uid);
        }

        userLinkHTML(user) {
            const esc = this.escapeHTML;
            return `<a href="#"
            class="ca-user-link"
            title="Open profile"
            data-uid="${esc(String(user.uid || ''))}"
            data-name="${esc(String(user.name || ''))}"
            data-action="open-profile"
            data-avatar="${esc(String(user.avatar || ''))}">
            <strong>${esc(user.name || '?')}</strong>
          </a>`;
        }

        /** Patch HTMLAudioElement.prototype.play so calls are queued until a user gesture occurs */
        _installAudioAutoplayGate() {
            if (this._audioGate.installed) return;

            try {
                const proto = (typeof HTMLAudioElement !== 'undefined' && HTMLAudioElement.prototype) ? HTMLAudioElement.prototype : null;
                if (!proto || typeof proto.play !== 'function') return;

                const gate = this._audioGate;
                gate.pending = new Set();
                gate.origPlay = proto.play.bind(proto); // keep original bound correctly
                gate.userInteracted = false;

                // One shared handler that flips the gate and flushes
                gate.onInteract = (_) => {
                    if (gate.userInteracted) return;
                    gate.userInteracted = true;

                    // Try to play any queued audio elements
                    gate.pending.forEach((audioEl) => {
                        try {
                            const res = gate.origPlay.call(audioEl);
                            if (res && typeof res.catch === 'function') {
                                res.catch(() => { /* swallow */
                                });
                            }
                        } catch (e) {
                            try {
                                console.error(e);
                            } catch (_) {
                            }
                        }
                    });
                    gate.pending.clear();

                    // Remove the capture listeners once opened
                    window.removeEventListener('click', gate.onInteract, true);
                    window.removeEventListener('keydown', gate.onInteract, true);
                    window.removeEventListener('touchstart', gate.onInteract, true);
                };

                // Install capture listeners to detect first user gesture
                window.addEventListener('click', gate.onInteract, true);
                window.addEventListener('keydown', gate.onInteract, true);
                window.addEventListener('touchstart', gate.onInteract, true);

                // Patch play()
                proto.play = function patchedPlay() {
                    try {
                        if (!gate.userInteracted) {
                            // Queue and resolve immediately to avoid NotAllowedError surfacing
                            gate.pending.add(this);
                            return Promise.resolve();
                        }

                        const p = gate.origPlay.call(this);
                        if (p && typeof p.catch === 'function') {
                            p.catch(function (err) {
                                // If policy still blocks (rare), re-queue and swallow
                                const name = (err && (err.name || err)) ? String(err.name || err).toLowerCase() : '';
                                if (name.includes('notallowed')) gate.pending.add(this);
                            }.bind(this));
                        }
                        return p;
                    } catch (e) {
                        try {
                            return gate.origPlay.call(this);
                        } catch (e2) {
                            console.error(e2);
                            return Promise.resolve();
                        }
                    }
                };

                gate.installed = true;
            } catch (e) {
                try {
                    console.error(e);
                } catch (_) {
                }
            }
        }

        /** Restore original behavior and remove listeners */
        _uninstallAudioAutoplayGate() {
            const gate = this._audioGate;
            if (!gate.installed) return;

            try {
                const proto = (typeof HTMLAudioElement !== 'undefined' && HTMLAudioElement.prototype) ? HTMLAudioElement.prototype : null;
                if (proto && gate.origPlay) {
                    proto.play = gate.origPlay; // restore original
                }

                if (gate.onInteract) {
                    window.removeEventListener('click', gate.onInteract, true);
                    window.removeEventListener('keydown', gate.onInteract, true);
                    window.removeEventListener('touchstart', gate.onInteract, true);
                }

                if (gate.pending) gate.pending.clear();

            } catch (e) {
                try {
                    console.error(e);
                } catch (_) {
                }
            } finally {
                gate.userInteracted = false;
                gate.pending = null;
                gate.origPlay = null;
                gate.onInteract = null;
                gate.installed = false;
            }
        }

        /* ---------- 321ChatAddons: bottom log helpers ---------- */
        caGetLogBox() {
            try {
                const panel = document.getElementById('ca-panel') || document;
                return panel.querySelector('.ca-log-box');
            } catch (e) {
                console.error(e);
                return null;
            }
        }

        caAppendLog(type, text) {
            try {
                const box = this.caGetLogBox();
                if (!box) return;

                const entry = document.createElement('div');
                entry.className = 'ca-log-entry ' + (type === 'broadcast' ? 'ca-log-broadcast' : (type === 'reset' ? 'ca-log-reset' : ''));

                const ts = document.createElement('div');
                ts.className = 'ca-log-ts';
                ts.textContent = this.timeHHMM();
                const dot = document.createElement('div');
                dot.className = 'ca-log-dot';
                const msg = document.createElement('div');
                msg.className = 'ca-log-text';

                const safe = this.escapeHTML(String(text || ''));
                if (type === 'broadcast') {
                    msg.innerHTML = safe + ' <span class="ca-badge-bc">BROADCAST</span>';
                } else {
                    msg.innerHTML = safe;
                }

                entry.appendChild(ts);
                entry.appendChild(dot);
                entry.appendChild(msg);

                // Prepend so newest appears at top with column-reverse
                box.insertBefore(entry, box.firstChild || null);
            } catch (e) {
                console.error(e);
            }
        }

        /* ---------- Click wiring for reset/broadcast logging ---------- */
        _handleDocumentClick(e) {
            try {
                const resetA = e.target && (e.target.closest && e.target.closest('.ca-pop .ca-reset-link, .ca-reset-link, .ca-reset'));
                if (resetA) this.caAppendLog('reset', 'Tracking has been reset');

                const bcBtn = e.target && (e.target.closest && e.target.closest('#ca-bc-send'));
                if (bcBtn) this.caAppendLog('broadcast', 'Message sent');
            } catch (e) {
                console.error(e);
            }
        }

        _wireLogClicks() {
            // bind once so we can remove later if needed
            this._onDocClick = this._onDocClick || this._handleDocumentClick.bind(this);
            document.addEventListener('click', this._onDocClick);
        }

        /* ---------- Keep original page sizing ---------- */
        applyInline() {
            try {
                const a = this.qsa('.pboxed');
                for (let i = 0; i < a.length; i++) a[i].style.setProperty('height', '800px', 'important');

                const b = this.qsa('.pboxed .pcontent');
                for (let j = 0; j < b.length; j++) b[j].style.setProperty('height', '610px', 'important');
            } catch (e) {
                console.error(e);
            }
        }

        removeAds(root) {
            try {
                const scope = root && root.querySelectorAll ? root : document;

                // Remove known widget containers
                document.querySelectorAll('.coo-widget').forEach(e => e.remove());

                // Remove bit.ly anchors (but not those inside our panel)
                const links = scope.querySelectorAll('a[href*="bit.ly"]');
                if (!links || !links.length) return;
                links.forEach(a => {
                    if (a && !a.closest('#ca-panel') && a.parentNode) {
                        a.parentNode.removeChild(a);
                    }
                });
            } catch (e) {
                console.error(e);
            }
        }

        adjustForFooter() {
            try {
                const panel = document.getElementById('ca-panel');
                if (!panel) return;

                const chatRight = document.getElementById('chat_right') || document.querySelector('#chat_right');
                if (!chatRight) return;

                const rect = chatRight.getBoundingClientRect();
                let h = rect?.height;

                if (!h || h <= 0) {
                    h = chatRight.offsetHeight || chatRight.clientHeight || 0;
                }

                if (h > 0) {
                    h = Math.max(400, Math.min(h, 1200));
                    panel.style.height = h + 'px';
                    panel.style.maxHeight = h + 'px';
                }

                const logsSec = panel.querySelector('.ca-log-section');
                if (logsSec) logsSec.style.paddingBottom = '';
            } catch (e) {
                console.error(e);
                console.error(this.LOG, 'adjustForFooter error:', e);
            }
        }

        _wireResize() {
            let resizeTimer = null;
            this._onResize = this._onResize || (() => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => {
                    this.adjustForFooter();
                }, 250);
            });
            window.addEventListener('resize', this._onResize);
        }

        /* ---------- Containers / lists ---------- */
        getContainer() {
            return this.qs(this.sel.users.main) || this.qs(this.sel.users.chatRight) || this.qs(this.sel.users.online);
        }

        /* ---------- Global watermark helpers (uses this.Store) ---------- */
        getGlobalWatermark() {
            try {
                // expects this.Store with get(key)
                return this.Store?.get(this.GLOBAL_WATERMARK_KEY) || '';
            } catch (e) {
                console.error(e);
                return '';
            }
        }

        setGlobalWatermark(dateStr) {
            try {
                if (dateStr) this.Store?.set(this.GLOBAL_WATERMARK_KEY, String(dateStr));
            } catch (e) {
                console.error(e);
            }
        }

        getTimeStampInWebsiteFormat() {
            const now = new Date();
            const day = String(now.getDate()).padStart(2, '0');
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            return `${day}/${month} ${hours}:${minutes}`;
        }

        initializeGlobalWatermark() {
            try {
                const current = this.getGlobalWatermark();
                this.debug(this.LOG, 'Checking watermark... current value:', current || '(not set)');

                if (current && current.length > 0) {
                    this.debug(this.LOG, 'Watermark already set:', current);
                    return;
                }

                const timestamp = this.getTimeStampInWebsiteFormat();
                this.debug(this.LOG, 'Setting initial watermark to:', timestamp);
                this.setGlobalWatermark(timestamp);

                const verify = this.getGlobalWatermark();
                if (verify === timestamp) {
                    this.debug(this.LOG, 'Watermark successfully initialized:', timestamp);
                } else {
                    console.warn(this.LOG, 'Watermark set but verification failed. Expected:', timestamp, 'Got:', verify);
                }
            } catch (err) {
                console.error(err);
                console.error(this.LOG, 'Initialize watermark error:', err);
            }
        }

        /* ---------- Parse "DD/MM HH:MM" into comparable number (MMDDHHMM) ---------- */
        parseLogDateToNumber(logDateStr) {
            try {
                if (!logDateStr || typeof logDateStr !== 'string') return 0;

                // Example format: "23/10 11:25"
                const parts = logDateStr.trim().split(/[\s\/:/]+/);
                if (parts.length < 4) return 0;

                const day = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10);
                const hours = parseInt(parts[2], 10);
                const minutes = parseInt(parts[3], 10);

                if ([day, month, hours, minutes].some(n => Number.isNaN(n))) return 0;

                // MMDDHHMM — good enough for comparing within the same year
                return (month * 1_000_000) + (day * 10_000) + (hours * 100) + minutes;
            } catch (e) {
                console.error(e);
                console.error(this.LOG, 'Parse log_date error:', e, '— input:', logDateStr);
                return 0;
            }
        }

        addOrUpdateLastRepliedDateTimeForConversation(uid) {
            // persist replied timestamp
            this.REPLIED_CONVOS = this.REPLIED_CONVOS || {};
            this.REPLIED_CONVOS[uid] = this.getTimeStampInWebsiteFormat?.() || '';
            this.debug('Marking conversation as replied:', uid, 'timestamp:', this.REPLIED_CONVOS[uid]);
            this._saveRepliedConvos(this.REPLIED_CONVOS);
            this.AppendIfNotYetMarkedReplied(this.getLogEntryByUid(uid));
            // lso mark the regular profile picture as replied in the menu
            this.markSent?.(uid);
        }

        getLogEntryByUid(uid) {
            // find the log entry
            if (!uid) return;
            const el = document.querySelector(`.ca-log-entry[data-uid="${uid}"]`);
            if (!el) {
                console.error(`.ca-log-entry[data-uid="${uid}"] not found`);
            }
            return el;
        }

        MarkAndRenderOrMoveRepliedMessage(logEntryEl, uid, timestamp) {
            const targetContainerEl = this.determineTargetMessagesContainer(uid, timestamp);
            if (!targetContainerEl) {
                console.error(this.LOG || '[321ChatAddons]', 'Unreplied/Replied containers not found');
                return;
            }

            this.debug(`Marking and rendering/moving replied message for ${uid} at ${timestamp} an logEntryElL`, logEntryEl);

            if (targetContainerEl === this.ui.unrepliedMessageBox) {
                this.debug('Message is new and unreplied. Appending it to the unreplied box.', this.ui.unrepliedMessageBox);
                this.ui.unrepliedMessageBox.appendChild(logEntryEl);
            } else if (this.ui.unrepliedMessageBox.contains(logEntryEl) && targetContainerEl === this.ui.repliedMessageBox) {
                this.debug('Removing unreplied message from unreplied container to recreate it in the replied container');
                this.ui.unrepliedMessageBox.removeChild(logEntryEl);
                // NOT NEEDED HERE I THINK: this.markConversationAsReplied(uid);
            } else if (targetContainerEl === this.ui.repliedMessageBox) {
                this.debug(`Moving message from unreplied container to replied container`);
                this.ui.repliedMessageBox.appendChild(logEntryEl);
            }
        }

        destroy() {
            this._uninstallAudioAutoplayGate();
            this.uninstallNetworkTaps();
            this.uninstallPrivateSendInterceptor();
            this.disConnectObserver(this._domObserver);
        }
    }

// Expose the single App instance
    root.CA.App = new App();
    await root.CA.App.init();
})();
