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
        constructor({namespace = "", storage} = {}) {
            this.ns = namespace ? namespace + ":" : "";
            this.storage = storage || localStorage;
        }

        _key(k) {
            return this.ns + String(k ?? "");
        }

        has(key) {
            return this.storage.getItem(this._key(key)) !== null;
        }

        get(key) {
            const raw = this.storage.getItem(this._key(key));
            if (raw == null) return null;
            const trimmed = String(raw).trim();
            if (/^[{\[]/.test(trimmed) || trimmed === "true" || trimmed === "false" || /^-?\d+(\.\d+)?$/.test(trimmed)) {
                return JSON.parse(trimmed);
            }
            return raw;
        }

        set(key, value) {
            const toStore = (typeof value === "string") ? value : JSON.stringify(value ?? {});
            this.storage.setItem(this._key(key), toStore);
            return true;
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

    class ActivityLogStore {
        constructor({kv, cacheKey, max = 200, app} = {}) {
            if (!kv) throw new Error('ActivityLogStore requires a KeyValueStore');
            this.kv = kv;
            this.cacheKey = cacheKey;
            this.max = max;
            this.app = app;
        }

        // ---- storage helpers (arrays only) ----
        _getAll() {
            const raw = this.kv.get(this.cacheKey);
            return Array.isArray(raw) ? raw : [];
        }

        _save(changedLog) {
            this._saveAll([changedLog])
            return changedLog;
        }

        _saveAll(changedLogs) {
            if (!Array.isArray(changedLogs)) {
                throw new Error('changedLogs expects an array');
            }

            const existing = this._getAll();

            // Make a Set of all GUIDs we’re about to replace
            const incomingIds = new Set(changedLogs.map(log => String(log.guid)));

            // Keep only logs whose GUID isn’t being replaced
            const filtered = existing.filter(log => !incomingIds.has(String(log.guid)));

            // Append the new ones
            const next = filtered.concat(changedLogs);

            this.kv.set(this.cacheKey, next);
            return changedLogs;
        }

        parseLogDateToNumber(logDateStr) {
            if (!logDateStr || typeof logDateStr !== 'string') return 0;

            const parts = logDateStr.trim().split(/[\s\/:]+/);
            if (parts.length < 4) return 0;

            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10);
            const hours = parseInt(parts[2], 10);
            const minutes = parseInt(parts[3], 10);

            if ([day, month, hours, minutes].some(n => Number.isNaN(n))) return 0;

            return (month * 1_000_000) + (day * 10_000) + (hours * 100) + minutes;
        }

        list({order = 'desc'} = {}) {
            const arr = [...this._getAll()];
            arr.sort((a, b) => {
                const ta = this.parseLogDateToNumber(a?.ts);
                const tb = this.parseLogDateToNumber(b?.ts);
                return order === 'asc' ? ta - tb : tb - ta;
            });
            return arr;
        }

        get(guid) {
            return this._getAll().find(log => String(log.guid) === String(guid)) || null;
        }

        getAllByUserUid(uid, onlyUnread = false) {
            const result = this._getAll().filter(
                log => String(log.uid) === String(uid) && (!onlyUnread || log.unread)
            );
            this.app.verbose(`Got all logs for ${uid} with only unread flag set to ${onlyUnread}:`, result);
            return result;
        }

        hasSentMessageToUser(uid) {
            return this.getAllSentMessagesByUserId(uid).length > 0;
        }

        getAllReceivedMessagesByUserId(uid, onlyUnread = false) {
            return this.getAllByUserUid(uid, onlyUnread).filter(log => log.kind === `dm-in`);
        }

        getAllSentMessagesByUserId(uid, onlyUnread = false) {
            return this.getAllByUserUid(uid, onlyUnread).filter(log => log.kind === `dm-out`);
        }

        getUnreadReceivedMessageCountByUserUid(uid) {
            return this.getAllReceivedMessagesByUserId(uid, true).length;
        }

        getAllSentMessagesCountByUserId(uid) {
            return this.getAllSentMessagesByUserId(uid).length;
        }

        has({guid, uid}) {
            const e = this.get(guid);
            return !!(e && (!uid || String(e.uid) === String(uid)));
        }

        // Merge a single patch with existing (NO SAVE)
        _mergeLog(changedLog) {
            if (!changedLog || !changedLog.guid) {
                throw new Error('_mergeOne requires changedLog.guid');
            }
            const existing = this.get(changedLog.guid);
            return existing ? {...existing, ...changedLog} : changedLog;
        }

        _MergeLogs(changedLogs) {
            if (!Array.isArray(changedLogs)) {
                throw new Error('_mergeMany expects an array');
            }

            const mergedLogsResult = [];

            for (const changedLog of changedLogs) {
                mergedLogsResult.push(this._mergeLog(changedLog));
            }

            return mergedLogsResult;
        }

        set(changedLog) {
            if (!changedLog || !changedLog.guid) {
                throw new Error('set() requires changedLog.guid');
            }
            const mergedLogResult = this._mergeLog(changedLog);
            // keep your existing save here:
            this._save(mergedLogResult);
            return mergedLogResult;
        }

        setAll(changedLogs) {
            if (!Array.isArray(changedLogs)) {
                console.error(`ChangedLogs needs to be an array, got ${typeof changedLogs}`);
                return null;
            }
            const mergedList = this._MergeLogs(changedLogs);
            // keep your existing saveAll here:
            this._saveAll(mergedList);
            return mergedList;
        }

        markRead(guid) {
            const log = this.get(guid);
            log.unread = false;
            return this.set(log);
        }

        markReadFromDate(uid, fromDateStr) {
            if (!uid || !fromDateStr) {
                console.error(`Uid ${uid} or fromDateStr ${fromDateStr} is invalid`);
                return [];
            }

            const allUnreadMessagesForUid = this.getAllByUserUid(uid, true)
                .filter(log => this.parseLogDateToNumber(log.ts) <= this.parseLogDateToNumber(fromDateStr))
                .map(log => ({...log, unread: false}))
            this.app.verbose(`Unread messages for Uuid:`, allUnreadMessagesForUid);
            return this.setAll(allUnreadMessagesForUid);
        }

        remove(guid) {
            if (!guid) return false;
            const all = this._getAll();
            const next = all.filter(l => String(l.guid) !== String(guid));
            this.kv.set(this.cacheKey, next);
            return next.length !== all.length;
        }

        clearByKind(kind) {
            if (!kind) return 0;
            const all = this._getAll();
            const next = all.filter(l => l?.kind !== kind);
            this.kv.set(this.cacheKey, next);
            return all.length - next.length;
        }

        clearEvents() {
            return this.clearByKind('event');
        }

        clear() {
            this.kv.set(this.cacheKey, []);
        }
    }

    /** Users store (array-backed, like ActivityLogStore) */
    class UsersStore {
        constructor({kv, cacheKey, app} = {}) {
            if (!kv) throw new Error('UsersStore requires a KeyValueStore');
            this.kv = kv;
            this.cacheKey = cacheKey;
            this.app = app; // for app.searchUserRemote
        }

        // ---- storage helpers (arrays only) ----
        _getAll() {
            const raw = this.kv.get(this.cacheKey);
            return Array.isArray(raw) ? raw : [];
        }

        parsedDmInUpToLog(uid) {
            return this.get(uid)?.parsedDmInUpToLog !== 0;
        }

        _save(userToEdit) {
            if (!userToEdit?.uid) {
                throw new Error('_save requires user.uid');
            }

            const users = this._getAll();
            const uid = String(userToEdit.uid);

            const updated =
                users.some(u => String(u.uid) === uid)
                    ? users.map(u => (String(u.uid) === uid ? userToEdit : u))
                    : [...users, userToEdit];

            this.kv.set(this.cacheKey, updated);
            return userToEdit;
        }

        _saveAll(usersToEdit) {
            if (!Array.isArray(usersToEdit)) {
                throw new Error('changedUsers expects an array');
            }

            const changedUsers = this._getAll().map(user => {
                const existingUser = usersToEdit.find(u => String(u.uid) === String(user.uid));
                if (existingUser) {
                    return {...existingUser, ...user};
                }
                return user;
            })

            this.kv.set(this.cacheKey, changedUsers);
            return changedUsers;
        }

        // ---- API (array) ----
        list() {
            return [...this._getAll()];
        }

        get(uid) {
            return this._getAll().find(u => String(u.uid) === String(uid)) || null;
        }

        has(uid) {
            return !!this.get(uid);
        }

        // Merge a single patch with existing (NO SAVE)
        _mergeUser(newUser) {
            if (!newUser || newUser.uid == null) {
                console.error('_mergeUser requires patch.uid');
            }
            const existing = this.get(newUser.uid);
            return existing ? {...existing, ...newUser} : {
                ...newUser,
                parsedDmInUpToLog: 0,
                isIncludedForBroadcast: true
            };
        }

        // Merge many patches with existing (NO SAVE)
        _mergeUsers(changedUsers) {
            if (!Array.isArray(changedUsers)) {
                throw new Error('_mergeUsers expects an array');
            }
            return changedUsers
                .filter(u => u && u.uid != null)
                .map(u => this._mergeUser(u));
        }

        // alias used by call sites
        upsert(user) {
            return this.set(user);
        }

        set(user) {
            if (!user || user.uid == null) {
                console.error('set() requires user.uid');
                return null;
            }
            const merged = this._mergeUser(user);
            this.app.verbose(`Saving merged user`, user);
            return this._save(merged);
        }

        setAll(users) {
            if (!Array.isArray(users)) {
                console.error(`setAll expects an array, got ${typeof users}`);
                return null;
            }
            const merged = this._mergeUsers(users);
            this._saveAll(merged);
            return merged;
        }

        setParsedDmInUpToLog(uid, parsedDmInUpToLog) {
            const u = this.get(uid);
            if (!u) {
                console.error(`User ${uid} not found, cannot set parsedDmInUpToLog`);
                return null;
            }
            this.app.debug(`Setting last read for user ${uid} to ${parsedDmInUpToLog}`);
            const updated = {...u, parsedDmInUpToLog};
            return this.set(updated);
        }

        getParsedDmInUpToLog(uid) {
            const u = this.get(uid);
            if (!u) {
                console.error(`User ${uid} not found, cannot get parsedDmInUpToLog`);
                return null;
            }
            return u.parsedDmInUpToLog;
        }

        hasParsedDmAlready(uid) {
            const u = this.get(uid);
            if (!u) {
                console.error(`User ${uid} not found, cannot check hasParsedDmAlready`);
            }
            return u.parsedDmInUpToLog !== 0;
        }

        isLoggedIn(uid) {
            return !!(this.get(uid)?.isLoggedIn);
        }

        setLoggedIn(uid, status) {
            const user = this.get(uid);
            if (!user) {
                console.log(`User ${uid} not found, cannot set isLoggedIn to ${status}`);
                return null;
            }
            return this.set({...user, isLoggedIn: status});
        }

        getAllLoggedIn() {
            return this.list().filter(u => u.isLoggedIn === true);
        }

        getFemalesLoggedIn() {
            return this.getAllLoggedIn().filter(u => u.isFemale);
        }

        getMalesLoggedIn() {
            return this.getAllLoggedIn().filter(u => !u.isFemale);
        }

        getFemalesLoggedInCount() {
            return this.getFemalesLoggedIn().length;
        }

        getMalesLoggedInCount() {
            return this.getMalesLoggedIn().length;
        }

        async getOrFetch(id) {
            let u = this.get(id);
            if (!u && this.app?.searchUserRemote) {
                const fetched = await this.app.searchUserRemote(String(id));
                if (fetched) {
                    u = this.set({...fetched, uid: String(fetched.uid ?? id)});
                }
            }
            return u || null;
        }

        async getOrFetchByName(q) {
            const needle = String(q || '').toLowerCase();
            const local = this.list().filter(
                u => (u.name || String(u.uid)).toLowerCase() === needle
            );
            if (local.length) return local;
            return [];
        }

        includeUserForBroadcast(uid, include) {
            if (uid == null) return null;
            const u = this.get(uid) || {uid: String(uid)};
            return this.set({...u, isIncludedForBroadcast: !!include});
        }

        isIncludedForBroadcast(uid) {
            if (uid == null || uid === '') {
                console.error(`isIncludedForBroadcast requires uid`);
                return null;
            }

            const user = this.get(uid);
            if (!user) {
                console.error(`User ${uid} not found, cannot check isIncludedForBroadcast`);
                return false;
            }

            return user.isIncludedForBroadcast;
        }

        clear() {
            this.kv.set(this.cacheKey, []);
        }
    }

    /** Storage shim that never persists anything (Block mode) */
    class NullStorage {
        getItem(_) {
            return null;
        }

        setItem(_, __) {
        }

        removeItem(_) {
        }

        clear() {
        }

        key(_) {
            return null;
        }

        get length() {
            return 0;
        }
    }

    /** Main App that composes stores */
    class App {
        constructor() {
            /* ========= Constants / Keys ========= */
            this.LOG = '';
            this.FEMALE_CODE = '2';

            // LocalStorage keys (you chose full keys → no KV namespace elsewhere)
            this.STORAGE_COOKIE = '321chataddons.storageMode';
            this.STORAGE_KEY_PREFIX = '321chataddons.';
            this.DEBUG_COOKIE = '321chataddons.debug';
            this.VERBOSE_COOKIE = '321chataddons.verbose';
            this.DEBUG_MODE_KEY = '321chataddons.debugMode';
            this.VERBOSE_MODE_KEY = '321chataddons.verboseMode';
            this.GLOBAL_WATERMARK_KEY = '321chataddons.global.watermark';
            this.ACTIVITY_LOG_KEY = '321chataddons.activityLog';
            this.STORAGE_PREFIX = '321chataddons.pm.';              // drafts, per-message hash
            this.USERS_KEY = '321chataddons.users';
            this.MAX_LOGIDS_PER_CONVERSATION = 100;

            /* ========= App State ========= */
            this.options = {};
            this.state = {
                READY: false,
                isPruning: false,
                CHAT_CTX: {
                    caction: '', room: '', notify: '', curset: ''
                }
            };

            /* ========= UI Refs ========= */
            this.ui = {
                sUser: null, sMsg: null, sSend: null, sStat: null,
                bMsg: null, bSend: null, bStat: null, bReset: null,
                sentBox: null, receivedMessagesBox: null, presenceBox: null, logClear: null,
                repliedMessageBox: null, unrepliedMessageBox: null,
                navBc: null,
                debugCheckbox: null,
                verboseCheckbox: null,
                // User list containers
                managedContainer: null,      // Wrapper div
                managedList: null,           // Actual list (<div class="online_user">)
                managedCount: null,          // Counter element
                hostWrapper: null,           // Wrapper for host container
                hostContainer: null,         // The host's user list
                hostCount: null              // Counter for host users
            };

            /* ========= Flags / Scheduling ========= */
            this._lastSendAt = 0;                 // throttle PM sending

            /* ========= Observers & Listeners (refs only) ========= */
            this._onDocClick = null;
            this._onResize = null;

            /* ========= Network Taps (originals) ========= */
            this._origFetch = null;
            this._xhrOpen = null;
            this._xhrSend = null;

            this.isInitialLoad = true;

            /* ========= Small Helpers (bound) =========
               (If you later move these to class methods, remove these lambdas.) */
            this.qs = (sel, rootEl) => (rootEl || document).querySelector(sel);
            this.qsa = (sel, rootEl) => Array.from((rootEl || document).querySelectorAll(sel));

            /* ========= Audio Autoplay Gate (policy-safe) ========= */
            this._audioGate = {
                userInteracted: false,
                pending: null,
                origPlay: null,
                onInteract: null,
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

            // Dynamic verbose method (more detailed than debug)
            this.verbose = (...args) => {
                if (this.verboseMode) {
                    console.log(this.LOG, '[VERBOSE]', ...args);
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
                        ca_log_entry: '.ca-log-entry',
                        ca_log_box: '.ca-log-box',
                        ca_expand_indicator: '.ca-expand-indicator',
                        ca_user_link: '.ca-user-link',
                        ca_dm_link: '.ca-dm-link',
                        ca_log_text: '.ca-log-text',
                        ca_sent_chip: '.ca-sent-chip',
                        ca_unread_messages: '.ca-unread-messages',
                        ca_replied_messages: '.ca-replied-messages',
                        ca_sent_chip_all_read: '.ca-sent-chip-all-read',
                        ca_sent_chip_unread: '.ca-sent-chip-unread',
                        ca_hidden: '.ca-hidden',
                        user_item: '.user_item',
                        ca_ck_wrap: '.ca-ck-wrap',
                        ca_ck: '.ca-ck',
                    },
                    sent: '#ca-log-box-sent',
                    received: '#ca-log-box-received',
                    replied: '#ca-log-received-replied',
                    unreplied: '#ca-log-received-unreplied',
                    presence: '#ca-log-box-presence',
                    clear: '#ca-log-clear',
                    other: '#ca-log-box-other'
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
                    managed: '#ca-managed-users',  // Our custom container wrapper for female users
                    managedList: '#ca-managed-list',  // The actual list container inside managed
                    managedHeader: '#ca-managed-users .ca-user-list-header',
                    managedCount: '#ca-managed-count',
                    hostWrapper: '#ca-host-users-wrapper',  // Wrapper for host container
                    hostCount: '#ca-host-count',
                    main: '#container_user',
                    online: '.online_user',
                    chatRight: '#chat_right_data',
                    chatRight_elem: '#chat_right',
                    combined: '#container_user, .online_user, #chat_right_data', // still handy if you want a fast query
                },
                // Debug checkboxes
                debug: {
                    checkbox: '#ca-debug-checkbox',
                    verboseCheckbox: '#ca-verbose-checkbox',
                },
            };
        }

        async init(options = {}) {
            this.options = options || {};

            const debug_cookie = this._getCookie(this.DEBUG_COOKIE);
            if (debug_cookie != null) {
                this.debugMode = (debug_cookie === 'true');
            } else {
                const stored = localStorage.getItem(this.DEBUG_MODE_KEY);
                this.debugMode = (stored === 'true');
            }

            const verbose_cookie = this._getCookie(this.VERBOSE_COOKIE);
            if (verbose_cookie != null) {
                this.verboseMode = (verbose_cookie === 'true');
            } else {
                const stored = localStorage.getItem(this.VERBOSE_MODE_KEY);
                this.verboseMode = (stored === 'true');
            }

            this.NO_LS_MODE = this._readStorageMode();           // 'allow' | 'wipe' | 'block'
            if (this.NO_LS_MODE === 'wipe') this._clearOwnLocalStorage();

            // Key/value store used all over the App — now with custom backend
            this.Store = this.Store || new KeyValueStore({storage: this._chooseStorage(this.NO_LS_MODE)});

            // Load debug mode from storage
            const storedDebugMode = localStorage.getItem(this.DEBUG_MODE_KEY);
            this.debugMode = storedDebugMode === 'true';

            // Load verbose mode from storage
            const storedVerboseMode = localStorage.getItem(this.VERBOSE_MODE_KEY);
            this.verboseMode = storedVerboseMode === 'true';

            this.debug('Initializing app with options:', options);

            // Persist message drafts
            this.Drafts = this.Drafts || new DraftsStore({kv: this.Store});

            // Backing store for users (separate namespace so the map stays tidy)
            this.UserStore = this.UserStore || new UsersStore({
                kv: this.Store,
                cacheKey: this.USERS_KEY,
                app: this
            });
            if (!this.UserStore.get('system')) {
                this.UserStore.set({
                    uid: 'system',
                    name: 'System',
                    avatar: '',
                    isFemale: false,
                    isLoggedIn: true,
                });
            }

            // Activity log store (guid-indexed)
            this.ActivityLogStore = this.ActivityLogStore || new ActivityLogStore({
                kv: this.Store,
                cacheKey: this.ACTIVITY_LOG_KEY, // already defined in your App
                max: 200,
                app: this
            });

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

            // build panel + wire refs + handlers
            this.buildPanel();
            this.addSpecificNavButton();
            this._bindStaticRefs();
            this._installStorageToggleButton();
            this._attachLogClickHandlers();  // Attach handlers AFTER refs are bound

            if (this.Drafts) {
                // persist the “send to specific” message + username
                if (this.ui.sMsg) this.Drafts.bindInput(this.ui.sMsg, this.STORAGE_PREFIX + 'draftSpecific');
                if (this.ui.sUser) this.Drafts.bindInput(this.ui.sUser, this.STORAGE_PREFIX + 'specificUsername');
            }

            this.wireSpecificSendButton();   // enable the “Send” button in the panel
            this._wirePanelNav();
            this._wireDebugCheckbox();
            this._wireVerboseCheckbox();
            this._wireLogClear();

            await this.restoreLog?.();

            this.installNetworkTaps();   // <— enable fetch/XHR interception

            this.installPrivateSendInterceptor();  // <— enable intercept for native /private_process.php

            // Create our managed container for female users
            this.createManagedUsersContainer();

            // Re-bind counter references after creating the containers
            this.ui.managedCount = this.qs(this.sel.users.managedCount);
            this.ui.hostCount = this.qs(this.sel.users.hostCount);

            const bar = document.getElementById('right_panel_bar');

            if (bar) {
                const refreshBtn = document.createElement('div');
                refreshBtn.className = 'panel_option';
                refreshBtn.title = 'Refresh users';
                refreshBtn.innerHTML = '<i class="fa fa-sync"></i>';

                // Attach the click handler
                refreshBtn.addEventListener('click', async () => {
                    await this.refreshUserList();
                    refreshBtn.classList.remove('loading');
                });

                // Find the first existing button (e.g., users_option) to insert before
                const firstButton = bar.querySelector('.panel_option');
                bar.insertBefore(refreshBtn, firstButton);
            } else {
                console.error('Bar not found');
            }

            this.initializeGlobalWatermark?.();    // <— if you have this already; otherwise keep the method below
            this.watchChatRightForHostChanges();

            await this.startRefreshUsersLoop({intervalMs: 15000}); // every 60s
            this.startClearEventLogLoop({intervalMs: 5 * 60 * 1000}); // every 5 min

            return this;
        }

        /* ---------- Cookie helpers ---------- */
        _getCookie(name) {
            const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + "=([^;]*)"));
            return m ? decodeURIComponent(m[1]) : null;
        }

        _setCookie(name, value, days = 400) {
            const d = new Date();
            d.setDate(d.getDate() + days);
            document.cookie = `${name}=${encodeURIComponent(value)}; path=/; expires=${d.toUTCString()}; SameSite=Lax`;
        }

        _delCookie(name) {
            document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
        }

        /* ---------- Mode: 'allow' | 'wipe' | 'block' ---------- */
        _readStorageMode() {
            const v = (this._getCookie(this.STORAGE_COOKIE) || 'allow').toLowerCase();
            return (v === 'wipe' || v === 'block') ? v : 'allow';
        }

        _writeStorageMode(mode) {
            this._setCookie(this.STORAGE_COOKIE, mode);
        }

        /* ---------- Pick storage backend ---------- */
        _chooseStorage(mode) {
            if (mode === 'block') return new NullStorage();
            return localStorage;
        }

        /* ---------- Clear only our own keys (for 'wipe' on each load) ---------- */
        _clearOwnLocalStorage() {
            console.warn(`CLEARING LOCALSTORAGE AND NOT PERSISTING ANY SETTINGS BECAUSE WIPE LOCAL STORAGE IS ENABLED`);
            const pref = this.STORAGE_KEY_PREFIX;
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i) || '';
                if (k.startsWith(pref)) localStorage.removeItem(k);
            }
        }

        /* ---------- UI: storage toggle button ---------- */
        _installStorageToggleButton() {
            const nav = this.qs('.ca-nav');
            if (!nav || nav._caStorageBtnWired) return;

            const btn = document.createElement('button');
            btn.id = 'ca-storage-toggle';
            btn.className = 'ca-nav-btn ca-nav-btn-secondary';
            const render = () => {
                btn.textContent = this.NO_LS_MODE === 'allow' ? 'Storage: Allow'
                    : this.NO_LS_MODE === 'wipe' ? 'Storage: Wipe'
                        : 'Storage: Block';
                btn.title = 'Click to cycle between Allow → Wipe on load → Block writes';
            };
            btn.addEventListener('click', () => {
                this.NO_LS_MODE = (this.NO_LS_MODE === 'allow') ? 'wipe'
                    : (this.NO_LS_MODE === 'wipe') ? 'block'
                        : 'allow';
                this._writeStorageMode(this.NO_LS_MODE);
                // If user switches to wipe, clear now too to be consistent
                if (this.NO_LS_MODE === 'wipe') this._clearOwnLocalStorage();
                // Rebind Store to new backend for 'block'/'allow' immediately
                this.Store = new KeyValueStore({storage: this._chooseStorage(this.NO_LS_MODE)});
                render();
                this.logEventLine(`Storage mode set to ${this.NO_LS_MODE} at ${this.timeHHMM()}`);
            });

            render();
            nav.appendChild(btn);
            nav._caStorageBtnWired = true;
        }

        // ===== Refresh Users loop =====
        async startRefreshUsersLoop({
                                        intervalMs = 60000,    // default 60s
                                        runImmediately = true
                                    } = {}) {
            this.stopRefreshUsersLoop?.(); // clear any previous loop

            this._refreshUsersIntervalMs = intervalMs;
            this._refreshUsersRunning = false;

            if (runImmediately) {
                await this.refreshUserList();
            }

            this._refreshUsersTimerId = setInterval(async () => {
                if (this._refreshUsersRunning) return;
                this._refreshUsersRunning = true;
                await this.refreshUserList();
            }, this._refreshUsersIntervalMs);
        }

        stopRefreshUsersLoop() {
            if (this._refreshUsersTimerId) {
                clearInterval(this._refreshUsersTimerId);
                this._refreshUsersTimerId = null;
            }
            this._refreshUsersRunning = false;
        }

        // ===== Clear Event Logs loop =====
        startClearEventLogLoop({
                                   intervalMs = 5 * 60 * 1000, // default: 5 minutes
                                   runImmediately = true
                               } = {}) {
            this.stopClearEventLogLoop?.(); // clear any previous loop

            const clearEvents = () => {
                // clear all "event" entries from localStorage
                const removed = this.ActivityLogStore?.clearByKind?.('event') || 0;

                // clear the UI container
                if (this.ui?.otherBox) this.ui.otherBox.innerHTML = '';

                this.logEventLine(`Event logs cleared automatically (${removed} removed) at ${this.timeHHMM()}`);
                this.verbose?.(`[AutoClear] Cleared ${removed} event log(s).`);
            };

            if (runImmediately) clearEvents();

            this._clearEventsTimerId = setInterval(clearEvents, intervalMs);
        }

        stopClearEventLogLoop() {
            if (this._clearEventsTimerId) {
                clearInterval(this._clearEventsTimerId);
                this._clearEventsTimerId = null;
            }
        }

        clearEventLogUI() {
            if (this.ui?.otherBox) this.ui.otherBox.innerHTML = '';
        }

        async refreshUserList() {
            const formData = new URLSearchParams();
            formData.append('token', utk);

            const res = await fetch('system/panel/user_list.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: formData.toString(),
                credentials: 'same-origin', // include cookies
            });

            const html = await res.text();
            this.processUserListResponse(html);
            this.logEventLine(`Refreshed user list at ${this.timeHHMMSS()}`);
        }

        watchChatRightForHostChanges() {
            const parent = document.querySelector('#ca-host-users-wrapper #chat_right_data');
            if (!parent) {
                console.warn('[Observer] #chat_right_data not found');
                return;
            }

            // Remove all .user_item[data-gender="2"] inside the given container
            const pruneFemales = (container) => {
                if (!container) return;
                const toRemove = container.querySelectorAll('#container_user .user_item[data-gender="2"]');
                toRemove.forEach(el => el.remove());
                console.log('[Observer] Removed', toRemove.length, 'female user_item(s) in #chat_right_data');
            };


            const observer = new MutationObserver(mutations => {
                for (const m of mutations) {
                    if (m.type === 'childList' && m.target === parent) {
                        pruneFemales(m.target);
                        break; // one run is enough per mutation batch
                    }
                }
            });

            observer.observe(parent, {
                childList: true,  // only direct child changes of #chat_right_data
                subtree: false,   // do NOT react to deeper/internal changes
            });

            this.verbose('[Observer] Watching #chat_right_data for direct child changes');
            this._chatRightObserver = observer;
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
            return !!(n && n.nodeType === 1 && typeof n.matches === 'function' && n.matches(sel));
        }

        safeQuery(n, sel) {
            return n && n.querySelector ? n.querySelector(sel) : null;
        }

        decodeHTMLEntities(s) {
            const txt = document.createElement('textarea');
            txt.innerHTML = String(s);
            return txt.value;
        }

        /* =========================
Private send interception
========================= */
        isPrivateProcessUrl(u) {
            if (!u) return false;
            let s = String(u);
            s = new URL(s, location.origin).pathname;
            return s.indexOf('system/action/private_process.php') !== -1;
        }

        processPrivateSendResponse(responseText, requestBody) {

            if (!responseText || typeof responseText !== 'string') return;

            let data;
            data = JSON.parse(String(responseText));

            data = this.toPrivateSendResponse(data);

            if (!data || data.code !== 1) {
                return;
            }

            const logData = data.log || {};
            const content = logData.log_content || '';
            const targetId = new URLSearchParams(requestBody || '').get('target') || '';

            // Look up user - ensure we always have a valid user object
            let dmSentToUser = this.UserStore.get(targetId);

            console.log(this.LOG, 'Intercepted native message send to', dmSentToUser?.name || targetId, '(ID:', targetId, ')');

            this.logLine('dm-out', content, dmSentToUser, logData.log_id);
            // TODO: user this log_id to determine which messages below it can be set to read in stead of using date
            // this.UserStore.setHasRepliedUpToLog(logData.log_id);

            const repliedAt = this.getTimeStampInWebsiteFormat();
            const affectedLogs = this.ActivityLogStore.markReadFromDate(targetId, repliedAt);
            this.processReadStatusForLogs(affectedLogs);
            this.updateProfileChip(dmSentToUser.uid);
        }

        installPrivateSendInterceptor() {

            if (!this._pp_xhrOpen) this._pp_xhrOpen = XMLHttpRequest.prototype.open;
            if (!this._pp_xhrSend) this._pp_xhrSend = XMLHttpRequest.prototype.send;

            const self = this;

            XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                this._ca_pm_isTarget = self.isPrivateProcessUrl(url);
                return self._pp_xhrOpen.apply(this, [method, url, ...rest]);
            };

            XMLHttpRequest.prototype.send = function (...sendArgs) {
                let capturedBody = '';
                if (this._ca_pm_isTarget && sendArgs && sendArgs.length) {
                    capturedBody = self.normalizeBodyToQuery(sendArgs[0]);
                }

                if (this._ca_pm_isTarget && capturedBody) {
                    this.addEventListener('readystatechange', () => {
                        if (this.readyState === 4 && this.status === 200) {
                            self.processPrivateSendResponse(this?.responseText || '', capturedBody);
                        }
                    });
                }

                return self._pp_xhrSend.apply(this, sendArgs);
            };
        }

        uninstallPrivateSendInterceptor() {
            if (this._pp_xhrOpen) {
                XMLHttpRequest.prototype.open = this._pp_xhrOpen;
                this._pp_xhrOpen = null;
            }
            if (this._pp_xhrSend) {
                XMLHttpRequest.prototype.send = this._pp_xhrSend;
                this._pp_xhrSend = null;
            }
        }

        /* ======================================
       Private notifications & conversations
       ====================================== */
        caParsePrivateNotify(html) {
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
            // Clean up temporary DOM element
            tmp.innerHTML = '';
            this.verbose(this.LOG, 'Parsed', out.length, 'private conversation' + (out.length !== 1 ? 's' : ''));
            return out;
        }

        async searchUserRemote(uid) {
            const token = this.getToken();
            if (!token || !uid) return null;

            console.log(`Starting remote search for profile with uid ${uid}`);

            const body = new URLSearchParams({
                token,
                get_profile: uid,
                cp: "chat"
            }).toString();

            const response = await fetch('/system/box/profile.php', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': '*/*',
                    'X-CA-OWN': '1'
                },
                body
            });

            const html = await response.text();
            let user = this.caParseProfile(html);

            // If we successfully parsed the profile, save and return it
            if (user.name && user.avatar) {
                if (this.UserStore?.set) {
                    user = this.UserStore.set({
                        ...user,
                        uid
                    });
                }

                // Return the parsed user object
                return user;
            }

            // No valid profile found
            return null;
        }

        caParseProfile(html) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // --- Extract username ---
            const name =
                doc.querySelector('.pro_name')?.textContent?.trim() ||
                null;

            // --- Extract avatar URL ---
            const avatar =
                doc.querySelector('.profile_avatar img')?.getAttribute('src') ||
                null;

            // --- Extract gender ---
            const genderText = (
                doc.querySelector('.proicon.fa-venus-mars')
                    ?.closest('.proitem')
                    ?.querySelector('.prodata')
                    ?.textContent || ''
            ).trim();

            // --- Determine gender flag ---
            const isFemale = genderText.toLowerCase() === 'female';

            // --- Detect online state ---
            const stateImg = doc.querySelector('img.state_profile');
            const isLoggedIn =
                !!stateImg && stateImg.src.toLowerCase().includes('active');

            return {name, avatar, isFemale, isLoggedIn};
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
                    return null;
                });
        }

        caUpdatePrivateConversationsList() {
            return this.caFetchPrivateNotify().then((privateConversations) => {
                privateConversations = privateConversations || [];
                this.verbose(this.LOG, 'Private conversations:', privateConversations.length);
                // sort: unread desc, then name asc
                privateConversations.sort((a, b) => {
                    const au = a.unread || 0, bu = b.unread || 0;
                    if (bu !== au) return bu - au;
                    const an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
                    return an < bn ? -1 : an > bn ? 1 : 0;
                });
                return privateConversations;
            });
        }

        /* Carry over site chat context and fetch private chat_log for uid */
        caFetchChatLogFor(uid, params) {
            const token = this.getToken();
            if (!token || !uid) {
                console.error(`.caFetchChatLogFor() called with invalid arguments:`, uid, params);
                return Promise.resolve('');
            }

            const bodyObj = {
                token,
                cp: 'chat',
                fload: '1',
                preload: '0',
                priv: String(uid),
                pcount: params.get('pcount'),
                last: params.get('last'),
                lastp: this.UserStore.getParsedDmInUpToLog(uid),
                caction: String(this.state.CHAT_CTX.caction),
                room: String(this.state.CHAT_CTX.room),
                notify: String(this.state.CHAT_CTX.notify),
                curset: String(this.state.CHAT_CTX.curset)
            };

            this.verbose(`Fetch chatlog body: `, bodyObj);

            // Debug log (sanitized)
            const bodyLog = new URLSearchParams(bodyObj).toString().replace(/token=[^&]*/, 'token=[redacted]');
            this.verbose(this.LOG, 'caFetchChatLogFor uid=', uid, ' body:', bodyLog);

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
                    this.verbose(this.LOG, 'caFetchChatLogFor: Response status:', res.status, res.statusText);
                    return res.text();
                })
                .then((txt) => {
                    this.verbose(this.LOG, 'caFetchChatLogFor received a response successfully');
                    return txt;
                })
                .catch((err) => {
                    this.verbose(this.LOG, 'Fetch chat log error:', err);
                    return null;
                });
        }

        /* Parse & render the private chat log for a given user */
        async caProcessPrivateLogResponse(uid, response) {
            this.debug('Processing private log response for user:', uid);

            if (!response || typeof response !== 'string' || response.trim() === '') {
                console.warn(this.LOG, 'Empty response for conversation', uid);
                return;
            }

            let conversationChatLog = this.toPrivateChatLogResponse(JSON.parse(String(response)));

            // update CHAT_CTX.last from private response
            if (conversationChatLog && conversationChatLog.last) {
                this.state.CHAT_CTX.last = String(conversationChatLog.last);
            }

            let privateChatLogs = Array.isArray(conversationChatLog?.pload) && conversationChatLog?.pload.length ? conversationChatLog.pload
                : (Array.isArray(conversationChatLog?.plogs) ? conversationChatLog.plogs : []);

            if (!privateChatLogs.length) {
                console.log(`No new private chat logs for user ${uid}`);
                return;
            }

            let newMessages = 0;
            const skipped = {fromMe: 0, alreadyShown: 0, tooOld: 0};

            const user = await this.UserStore.getOrFetch(uid);
            if (!user) {
                console.error(`[DM] Could not resolve user ${uid} for getting private messages.`);
                return
            }

            let parsedDmInUpToLog = user.parsedDmInUpToLog

            console.log(`Parsing new messages`, privateChatLogs);
            for (const item of privateChatLogs) {
                // Always skip messages sent by myself
                if (item.user_id === user_id) {
                    skipped.fromMe++;
                    continue;
                }

                // Only on initial fetch: skip too-old messages
                if (!this.UserStore.hasParsedDmAlready(uid) && !this.isMessageNewer(item.log_date)) {
                    skipped.tooOld++;
                    console.log(`Is initial fetch, watermark date from page load is ${this.getGlobalWatermark()} and current message is older, skipping too old message ${item.log_id} from user ${uid}`);
                    continue;
                }

                // Skip anything we've already shown (compare numerically)
                if (item.log_id <= parsedDmInUpToLog) {
                    skipped.alreadyShown++;
                    console.log(`Already shown message ${item.log_id} from user ${uid}`);
                    continue;
                }

                this.logLine('dm-in', this.decodeHTMLEntities(item.log_content), user, item.log_id);
                this.updateProfileChip(user.uid);
                newMessages++;

                // Track max
                if (item.log_id > parsedDmInUpToLog) {
                    user.parsedDmInUpToLog = item.log_id;
                }
            }

            this.UserStore.setParsedDmInUpToLog(uid, parsedDmInUpToLog);

            if (skipped.fromMe || skipped.alreadyShown || skipped.tooOld) {
                console.log(this.LOG, 'Processed messages from user with uid', uid, 'Skipped — from me:', skipped.fromMe, 'already shown:', skipped.alreadyShown, 'too old:', skipped.tooOld);
            }
        }

        // Converts "D/M HH:MM" (or with seconds) to "DD/MM HH:MM:SS"
        normalizeApiDate(ts) {
            if (!ts) return this.getTimeStampInWebsiteFormat?.() || '';
            const m = String(ts).match(/^\s*(\d{1,2})\/(\d{1,2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*$/);
            if (!m) return String(ts);
            const DD = String(m[1]).padStart(2, '0');
            const MM = String(m[2]).padStart(2, '0');
            const hh = m[3], mm = m[4], ss = m[5] ?? '00';
            return `${DD}/${MM} ${hh}:${mm}:${ss}`;
        }

        async handleChatLogPlogs(payload) {
            const plogs = Array.isArray(payload?.plogs) ? payload.plogs : [];
            if (!plogs.length) return;

            for (const p of plogs) {
                const uid = String(p.user_id);

                const myUserId = (typeof user_id !== 'undefined') ? String(user_id) : null;
                if (myUserId && String(uid) === myUserId) {
                    this.verbose(`Skipping message from myself: ${uid}`);
                    return false;
                }

                const user = await this.UserStore.getOrFetch(uid);
                if (!user) continue;

                // Normalize timestamp like "3/11 19:30" → "03/11 19:30:00"
                const ts = this.normalizeApiDate
                    ? this.normalizeApiDate(p.log_date)
                    : String(p.log_date || '');

                // Log as inbound private DM
                this.logLine('dm-in', String(p.log_content || ''), user, String(p.log_id), ts);

                // Update user’s chip status
                this.updateProfileChip?.(uid);
            }
        }

        /* ============ Chat payload processing ============ */
        caProcessChatPayload(txt, params) {
            if (!txt || typeof txt !== 'string' || txt.trim() === '') {
                console.warn(this.LOG, 'Empty or invalid chat payload response');
                return;
            }

            // tolerant parse & shape
            const data = this.toChatLogResponse(JSON.parse(String(txt)));

            if (Array.isArray(data.plogs) && data.plogs.length > 0) {
                this.handleChatLogPlogs(data);
                return;
            }

            const pico = Number(data && data.pico);
            if (pico === 0) return;

            // No private messages or they are already in this payload
            if (!Number.isFinite(pico) || pico < 1 || (data.pload?.length > 0) || (data.plogs?.length > 0)) return;

            console.log(this.LOG, 'Private messages count (pico):', pico, '— checking for new messages');

            this.caUpdatePrivateConversationsList(false).then((privateConversations) => {
                privateConversations = Array.isArray(privateConversations) ? privateConversations : [];
                this.verbose(this.LOG, 'Private conversations returned:', privateConversations.length, privateConversations);

                const toFetch = privateConversations
                    .filter(pc => pc.unread > 0)
                    .map(it => ({uid: String(it.uid), unread: Number(it.unread) || 0}));

                if (!toFetch.length) {
                    console.log(this.LOG, 'None of the conversations has new messages');
                    return;
                }

                this.verbose(this.LOG, 'Fetching', toFetch.length, 'conversation' + (toFetch.length !== 1 ? 's' : ''), 'with new messages');

                (async () => {
                    for (let i = 0; i < toFetch.length; i++) {
                        const conversation = toFetch[i];
                        console.log(this.LOG, 'Fetch chat_log for conversation', conversation.uid, '— unread:', conversation.unread);
                        await this.caProcessPrivateLogResponse(conversation.uid, await this.caFetchChatLogFor(conversation.uid, params));
                    }
                })();
            });
        }

        /* ============ Fetch/XHR interceptors ============ */
        installNetworkTaps() {
            this.debug('Installing network taps (fetch/XHR interceptors)');

            // XHR
            if (!this._xhrOpen) this._xhrOpen = XMLHttpRequest.prototype.open;
            if (!this._xhrSend) this._xhrSend = XMLHttpRequest.prototype.send;

            const self = this;

            XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                this._ca_url = String(url || '');
                return self._xhrOpen.apply(this, [method, url, ...rest]);
            };

            XMLHttpRequest.prototype.send = function (...sendArgs) {
                let qs = null;

                const targetUrl = this._ca_url || '';

                if (self.isChatLogUrl(targetUrl) && sendArgs && sendArgs[0].length) {
                    if (sendArgs[0].indexOf('priv=1') !== -1) return;

                    qs = new URLSearchParams(sendArgs[0]);
                    self.caUpdateChatCtxFromBody(qs);
                }

                this.addEventListener('readystatechange', function () {
                    const responseUrl = this.responseURL || this._ca_url || '';
                    if (this.readyState === 4 && this.status === 200 && this.responseText) {
                        if (self.isChatLogUrl(responseUrl)) {
                            // ✅ Now you can access the right params for this XHR instance
                            self.caProcessChatPayload(this.responseText, qs);
                        }
                        if (self.isUserListUrl(responseUrl)) {
                            self.processUserListResponse(this.responseText);
                        }
                    }
                });

                return self._xhrSend.apply(this, sendArgs);
            };
        }

        uninstallNetworkTaps() {
            if (this._xhrOpen) {
                XMLHttpRequest.prototype.open = this._xhrOpen;
                this._xhrOpen = null;
            }
            if (this._xhrSend) {
                XMLHttpRequest.prototype.send = this._xhrSend;
                this._xhrSend = null;
            }
        }

        buildLogHTML(kind, content) {
            const text = content;
            const status = typeof content === 'object' ? content?.status : null;
            this.verbose(`Building log HTML with kind=${kind},content=${text}`);

            switch (kind) {
                case 'dm-in':
                    return `${text}`;
                case 'dm-out':
                    return `${text}`;
                case 'send-fail': // keep if you still log failures
                    return `failed (${String(status || 0)}) — ${text}`;
                case 'login':
                    return `logged on`;
                case 'logout':
                    return `logged off`;
                case 'event':
                    return `<span class="ca-log-text">${text || 'Event'}</span>`;
                default:
                    return `${text}`;
            }
        }

        buildProfileUrlForId(uid) {
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
        }

        _attachLogClickHandlers() {
            const boxes = [
                this.ui.sentBox,
                this.ui.receivedMessagesBox,
                this.ui.presenceBox,
                this.ui.unrepliedMessageBox,
                this.ui.repliedMessageBox,
                this.ui.otherBox
            ];
            boxes.forEach(box => {
                if (!box || box._caGenericWired) return;
                box.addEventListener('click', (e) => this._onLogClickGeneric(e));
                box._caGenericWired = true;
            });
        }

        async _onLogClickGeneric(e) {
            // Find the clicked log entry
            const entry = e.target.closest?.(this.sel.log.classes.ca_log_entry);
            if (!entry) return;

            // Route by data-action, if present
            const actionEl = e.target.closest?.('[data-action]');
            if (actionEl) {
                const action = String(actionEl.getAttribute('data-action') || '').toLowerCase();

                if (action === 'toggle-expand') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    const expanded = entry.classList.toggle('ca-expanded');

                    // keep the chevron + ARIA in sync
                    const ind = entry.querySelector(this.sel.log.classes.ca_expand_indicator);
                    if (ind) {
                        ind.textContent = expanded ? '▴' : '▾';
                        ind.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                    }
                    return;
                }

                if (action === 'open-profile') {
                    e.preventDefault();
                    this.openProfileOnHost(entry.getAttribute('data-uid') || '');
                    return;
                }

                if (action === 'open-dm') {
                    e.preventDefault();
                    const uid = entry.getAttribute('data-uid') || '';
                    this.applyLegacyAndOpenDm(this.UserStore?.get?.(uid));
                    return;
                }

                if (action === 'delete-log') {
                    e.preventDefault();
                    const guid = entry.getAttribute('data-guid');
                    if (guid) this.ActivityLogStore?.remove?.(guid);
                    entry.remove();
                    return;
                }

                // Unknown action → do nothing
                return;
            }

            // No data-action: background click falls back to open profile
            e.preventDefault();
            this.openProfileOnHost(entry.getAttribute('data-uid') || '');
        }

        resolveHostFn(name) {
            const fromSelf = (typeof window[name] === 'function') ? window[name] : null;
            const fromParent = (window.parent && typeof window.parent[name] === 'function') ? window.parent[name] : null;
            return fromSelf || fromParent || null;
        }

        applyLegacyAndOpenDm({uid, name, avatar}) {
            this.debug('applyLegacyAndOpenDm called with:', {uid, name, avatar});

            // Legacy toggles
            this.debug('applyLegacyAndOpenDm: Setting legacy toggles');
            if (!this.safeSet(window, 'morePriv', 0)) return false;
            if (!this.safeSet(window, 'privReload', 1)) return false;
            if (!this.safeSet(window, 'lastPriv', 0)) return false;

            // Legacy UI calls
            this.debug('applyLegacyAndOpenDm: Calling legacy UI functions');
            if (!this.safeCall(window, 'closeList')) return false;
            if (!this.safeCall(window, 'hideModal')) return false;
            if (!this.safeCall(window, 'hideOver')) return false;

            // Host hook
            const openDm = this.resolveHostFn('openPrivate');
            this.debug('applyLegacyAndOpenDm: openPrivate function found:', !!openDm);
            if (!openDm) {
                console.warn('[321ChatAddons] openPrivate() not available on host');
                return false;
            }

            // Call openPrivate via safeCall by wrapping it in an object
            this.debug('applyLegacyAndOpenDm: Calling openPrivate with:', uid, name, avatar);
            const result = this.safeCall({openPrivate: openDm}, 'openPrivate', uid, name, avatar);
            this.debug('applyLegacyAndOpenDm: openPrivate call result:', result);

            return result;
        }

        safeSet(obj, key, value) {
            if (typeof obj?.[key] === 'undefined') return true; // nothing to do
            obj[key] = value;
            return true;
        }

        safeCall(obj, key, ...args) {
            if (typeof obj?.[key] !== 'function') return true; // nothing to do
            obj[key](...args);
            return true;
        }

        openProfileOnHost(uid) {
            this.debug('openProfileOnHost called with uid:', uid);

            const getProfile = (typeof window.getProfile === 'function')
                ? window.getProfile
                : (window.parent && typeof window.parent.getProfile === 'function')
                    ? window.parent.getProfile
                    : null;

            this.debug('openProfileOnHost: getProfile function found:', !!getProfile);
            console.log(`Open profile on host for uid=${uid}`);

            if (getProfile) {
                const uidNum = /^\d+$/.test(uid) ? parseInt(uid, 10) : uid;
                this.debug('openProfileOnHost: Calling getProfile with:', uidNum);
                getProfile(uidNum);
                this.debug('openProfileOnHost: getProfile call completed');
            } else {
                console.warn(`Host profile method not found; falling back to URL (uid: ${uid})`);
                const url = this.buildProfileUrlForId(uid);
                this.debug('openProfileOnHost: Fallback URL:', url);
                if (url) window.open(url, '_blank');
            }
        }

        buildBroadcastList() {
            const list = this.collectFemaleIds();
            const out = [];
            for (let i = 0; i < list.length; i++) {
                const el = list[i].el, uid = list[i].uid;
                if (!this._isAllowedRank?.(el)) continue;
                if (this.UserStore.hasSentMessageToUser(uid)) {
                    console.log(`Skipping message to ${el.name} (already replied)`);
                    continue;
                }
                const cb = el ? el.querySelector('.ca-ck') : null;

                if (cb ? cb.checked : !this.UserStore.isIncludedForBroadcast(uid)) {
                    out.push(list[i]);
                }
            }
            return out;
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
                if (this.UserStore?.getOrFetchByName) {
                    candidates = await this.UserStore.getOrFetchByName(nameQ);
                }

                if (!Array.isArray(candidates) || candidates.length === 0) {
                    if (stat) stat.textContent = 'User not found (female).';
                    return;
                }

                const target = candidates[0]; // first exact match

                this.ui.sSend.disabled = true;
                const r = await this.sendWithThrottle(target.uid, text);
                if (stat) stat.textContent = r && r.ok
                    ? `Sent to ${target.name || target.uid}.`
                    : `Failed (HTTP ${r ? r.status : 0}).`;

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
                const to = [];
                for (let i = 0; i < list.length; i++) to.push(list[i]);

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

                        const item = batch[idx++];
                        this.sendWithThrottle(item.id, text).then((r) => {
                            if (r && r.ok) {
                                ok++;
                            } else {
                                fail++;
                                // this.logSendFail?.(uname, item.id, av, r ? r.status : 0, text);
                            }
                            $bStat && ($bStat.textContent = `Batch ${bi + 1}/${T} — ${idx}/${batch.length} sent (OK:${ok} Fail:${fail})`);
                            const delay = 2000 + Math.floor(Math.random() * 3000);
                            return new Promise(r => setTimeout(r, delay));
                        }).then(one).catch(() => {
                            fail++;
                            //this.logSendFail?.(uname, item.id, av, 'ERR', text);
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
            const c = this.getContainer();
            if (!c) return;
            if (c.getAttribute('data-ca-wired') === '1') return;

            c.addEventListener('click', (e) => {
                const ignore = e.target.closest('a, button, input, label, .ca-ck-wrap, .ca-ck, .ca-sent-chip');
                if (ignore) return;

                let n = e.target;
                const userItemClass = this.sel.log.classes.user_item.substring(1);
                while (n && n !== c && !(n.classList && n.classList.contains(userItemClass))) n = n.parentNode;
                if (!n || n === c) return;

                const nm = this.extractUsername(n);
                if (!nm) return;
                const inp = this.qs(this.sel.specificPop.username);
                if (inp) {
                    inp.value = nm;
                    const ev = new Event('input', {bubbles: true, cancelable: true});
                    inp.dispatchEvent(ev);
                }
            }, false);

            c.setAttribute('data-ca-wired', '1');
        }

        /* Update or create user element in managed container */
        _updateOrCreateUserElement(managedList, newEl, user) {
            const existingEl = this.qs(`.user_item[data-id="${user.uid}"]`, managedList);
            if (existingEl) {
                // Update existing element
                existingEl.innerHTML = newEl.innerHTML;
                // Copy all attributes
                Array.from(newEl.attributes).forEach(attr => {
                    existingEl.setAttribute(attr.name, attr.value);
                });
                this.verbose('[_updateOrCreateUserElement] Updated existing user element for', user.uid, user.name);
                return existingEl;
            } else {
                const clonedEl = newEl.cloneNode(true);
                managedList.appendChild(clonedEl);
                this.verbose('[_updateOrCreateUserElement] Created new user element for', user.uid, user.name);
                return clonedEl;
            }
        }


        /* Check if URL is user_list.php */
        isUserListUrl(u) {
            if (!u) return false;
            let s = String(u);
            s = new URL(s, location.origin).pathname;
            return s.indexOf('system/panel/user_list.php') !== -1;
        }

        /* Parse user_list.php HTML response and process users */
        processUserListResponse(html) {
            if (!html || typeof html !== 'string') return;
            console.log("\n========== START PARSING NEW USER LIST ==========");
            if (html.includes('ca-hidden')) {
                console.error(`RESPONSE CONTAINS HIDDEN USER ITEMS!!`);
            }

            const context = this.isInitialLoad ? '[INITIAL]' : '[USER_LIST]';
            this.verbose(this.LOG, context, 'Processing user list response, length:', html.length);

            // Get managed container (created once in init, never removed)
            const managedList = this.getContainer();
            if (!managedList) {
                console.error(this.LOG, '[USER_LIST] Managed container not found - should have been created in init()');
                return;
            }

            // Parse the HTML into a proper DOM structure
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            // Find all female users using proper DOM queries
            const users = this.qsa('.online_user .user_item', tempDiv);
            console.log(this.LOG, '[USER_LIST] Total users found:', users.length);

            if (users.length === 0) {
                console.error(`Something went wrong processing the user list. Skipping this round.`);
                return;
            }

            // Move/update female users to managed container immediately
            let loggedInCount = 0;
            let updatedProfileCount = 0;
            let loggedOffCount = 0;
            let newProfileCount = 0;

            const seenLoggedIn = new Set();

            users.forEach(userEl => {
                // Extract user data from DOM
                const uid = this.getUserId(userEl);
                const name = this.extractUsername(userEl) || uid;
                const avatar = this.extractAvatar(userEl);
                const isFemale = userEl.getAttribute('data-gender') === this.FEMALE_CODE;
                const isAllowedRank = this._isAllowedRank(userEl);

                let user = this.UserStore.get(uid);
                let IsNewOrUpdatedProfile = false;
                seenLoggedIn.add(uid)

                if (!user) {
                    this.debug(this.LOG, `[USER_LIST] Adding non existing user ${uid}`);
                    newProfileCount++;
                    IsNewOrUpdatedProfile = true;
                } else if (user.name !== name ||
                    user.avatar !== avatar ||
                    user.isFemale !== isFemale ||
                    user.isLoggedIn !== true) {
                    this.debug(this.LOG, `[USER_LIST] Updating metadata of existing user ${uid}`, user);
                    updatedProfileCount++;
                    IsNewOrUpdatedProfile = true;
                }

                if (IsNewOrUpdatedProfile) {
                    const newLogin = user?.isLoggedIn !== true || !user;

                    user = this.UserStore.set({
                        uid,
                        name,
                        avatar,
                        isFemale,
                        isLoggedIn: true,
                    });

                    if (newLogin && !this.isInitialLoad) {
                        loggedInCount++;
                        console.log(this.LOG, `[LOGIN] ✅ ${name} (${uid}) logging in`);
                        if (isFemale) {
                            this.logLine('login', null, user);
                        }
                    }
                }

                if (isFemale && (this.isInitialLoad || IsNewOrUpdatedProfile)) {
                    const el = this._updateOrCreateUserElement(managedList, userEl, user);

                    // Ensure UI elements for female users if rank allows
                    if (isAllowedRank) {
                        this.ensureBroadcastCheckbox(el);
                    }

                    this.updateProfileChip?.(user.uid);
                    userEl.remove();
                    this.qs(`.user_item[data-id="${uid}"]`, this.ui.hostContainer)?.remove();
                }
            });

            // Only try to remove nodes if it wasn't the initial load (after page reload, all nodes are readded)
            const currentlyLoggedIn = this.UserStore.getAllLoggedIn();
            for (const user of currentlyLoggedIn) {
                const id = String(user.uid);
                if (seenLoggedIn.has(id)) continue;

                this.UserStore.setLoggedIn(id, false);

                if (!this.isInitialLoad) {
                    console.log(this.LOG, `[LOGOUT] ❌ ${user.name} (${user.uid}) logging out`);
                } else {
                    this.verbose(`[INIT] User ${user.name} (${user.uid}) initially logged out - no log entry`);
                }

                if (user.isFemale) {
                    if (!this.isInitialLoad) {
                        this.logLine('logout', null, user);
                        const elementToRemove = this.qs(`.user_item[data-id="${id}"]`, managedList);
                        this.debug(`Removing element from managed females container ${user.uid} (${user.name}) to logoff`);
                        if (elementToRemove) elementToRemove.remove();
                        else {
                            console.warn(`Couldn't remove user ${id} from managed container because the user is probably offline already.`);
                        }
                    }
                }

                loggedOffCount++;
            }

            console.log(
                `%c\n [USER_LIST]%c Summary: %c${loggedInCount} logged in%c, %c${newProfileCount} new users added%c, %c${updatedProfileCount} updated%c, %c${loggedOffCount} users logged off%c, %c${this.UserStore.getFemalesLoggedInCount()} women online%c, %c${this.UserStore.getMalesLoggedInCount()} men online`,
                'color: #7ea9d1; font-weight: 600;',
                'color: inherit;',
                'color: #6bbf73; font-weight: 500;',
                'color: inherit;',
                'color: #d8b35a; font-weight: 500;',
                'color: inherit;',
                'color: #d66b6b; font-weight: 500;',
                'color: inherit;',
                'color: #ba68c8; font-weight: 500;',
                'color: inherit;',
                'color: #64b5f6; font-weight: 500;'
            );

            // Clean up temporary DOM element
            tempDiv.innerHTML = '';

            // Update counters AFTER all processing is complete using requestAnimationFrame
            // This ensures all DOM mutations have completed
            requestAnimationFrame(() => {
                if (!this.ui.managedCount) {
                    this.ui.managedCount = this.qs(this.sel.users.managedCount);
                }
                if (!this.ui.hostCount) {
                    this.ui.hostCount = this.qs(this.sel.users.hostCount);
                }

                if (this.ui.managedCount) {
                    this.ui.managedCount.textContent = String(this.qsa('.user_item', managedList).length);
                }

                // Update host users count - count actual DOM elements in
                if (this.ui.hostContainer) {
                    // Count ALL users in host (should be only males now)
                    const hostUsers = this.qsa('.user_item', this.ui.hostContainer);
                    const hostCount = hostUsers.length;
                    if (this.ui.hostCount) {
                        this.ui.hostCount.textContent = String(hostCount);
                        console.log(this.LOG, '[USER_LIST] Updated host counter to:', hostCount, 'users');
                    } else {
                        console.warn(this.LOG, '[USER_LIST] hostCount element not found - selector:', this.sel.users.hostCount);
                    }
                }
            });
            this.isInitialLoad = false;
        }

        /* ===================== CHAT TAP (partial) ===================== */
        isChatLogUrl(u) {
            if (!u) return false;
            let s = String(u);
            s = new URL(s, location.origin).pathname;
            return s.indexOf('system/action/chat_log.php') !== -1;
        }

        caUpdateChatCtxFromBody(searchParams) {
            if (this.caUpdateChatCtxFromBody._initialized) {
                this.verbose(`CHAT_CTX already initialized`);
                return;
            }

            const ca = searchParams.get('caction'),
                rm = searchParams.get('room'),
                nf = searchParams.get('notify'),
                cs = searchParams.get('curset');

            if (ca) this.state.CHAT_CTX.caction = String(ca);
            if (rm) this.state.CHAT_CTX.room = String(rm);
            if (nf) this.state.CHAT_CTX.notify = String(nf);
            if (cs) this.state.CHAT_CTX.curset = String(cs);

            this.verbose(`CHAT_CTX is initialized`, this.state.CHAT_CTX);
            this.caUpdateChatCtxFromBody._initialized = true;
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

            if (pload.length || plogs.length) {
                this.verbose(`pload:`, pload, `plogs:`, plogs);
            }
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
                log: o?.log
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

        ToHourMinuteSecondFormat(ts) {
            const s = String(ts || '').trim();
            if (!s) return '';
            // already has seconds?
            if (/\b\d{1,2}\/\d{1,2}\s+\d{2}:\d{2}:\d{2}\b/.test(s)) return s;
            // has only HH:MM → append :00
            if (/\b\d{1,2}\/\d{1,2}\s+\d{2}:\d{2}\b/.test(s)) return s + ':00';
            // unknown format → return as-is (parser will return 0)
            return s;
        };

        /* ---------- Time & watermark comparison ---------- */
        isMessageNewer(logDateStr) {
            const watermark = this.getGlobalWatermark();
            if (!watermark) {
                console.warn(`.isMessageNewer() - watermark not found`);
                return true;
            }

            const msgNum = this.parseLogDateToNumber(this.ToHourMinuteSecondFormat(logDateStr));
            const wmNum = this.parseLogDateToNumber(this.ToHourMinuteSecondFormat(watermark));
            console.log(this.LOG, 'Date comparison:', {
                logDate: logDateStr, logDateNum: msgNum,
                watermark, watermarkNum: wmNum
            });
            if (!msgNum) {
                throw new Error(`Invalid MsgNum: ${msgNum}`);
            }

            const isNewer = msgNum >= wmNum; // include equal → not missed at same second
            console.log(this.LOG, 'Date comparison:', {
                logDate: logDateStr, logDateNum: msgNum,
                watermark, watermarkNum: wmNum, isNewer
            });
            return isNewer;
        }

        /* ---------- Body normalization ---------- */
        normalizeBodyToQuery(body) {
            if (!body) return '';
            if (typeof body === 'string') return body;
            if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
            if (typeof FormData !== 'undefined' && body instanceof FormData) {
                const usp = new URLSearchParams();
                body.forEach((v, k) => usp.append(k, typeof v === 'string' ? v : ''));
                return usp.toString();
            }
            if (typeof body === 'object') {
                return new URLSearchParams(body).toString();
            }
            return '';
        }

        /* ---------- ID/Name/Avatar extraction ---------- */
        getUserId(el) {
            if (!el) return null;
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
        }

        extractUsername(el) {
            if (!el) return '';
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
        }

        extractAvatar(el) {
            if (!el) return '';
            const img = this.safeQuery(el, 'img[src*="avatar"]') || this.safeQuery(el, '.avatar img') || this.safeQuery(el, 'img');
            const src = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
            return src ? src.trim() : '';
        }

        /* ---------- Collect female IDs ---------- */
        collectFemaleIds() {
            // Only collect from managed container, never from host container
            const c = this.getContainer();
            if (!c) {
                console.warn(this.LOG, 'Managed container not found for collecting female IDs');
                return [];
            }
            const els = this.qsa(`.user_item[data-gender="${this.FEMALE_CODE}"]`, c);
            console.log('Collecting female IDs from managed container:', els.length);
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
            if (typeof utk !== 'undefined' && utk) return utk;
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
                    parsed = JSON.parse(txt);
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
            // Clean up temporary DOM element
            tmp.innerHTML = '';
            return out;
        }

        /* ---------- DOM find helper ---------- */
        findUserElementById(uid, root = document) {
            if (!uid) {
                console.error(`.findUserElementById: id is empty`);
                return null;
            }
            return root.querySelector(`.user_item[data-id="${uid}"]`);
        }

        /* ---------- Sent chip & badges ---------- */
        updateProfileChip(uid) {
            const unreadReceivedMessagesCount = this.ActivityLogStore.getUnreadReceivedMessageCountByUserUid(uid);
            const sentMessagesCount = this.ActivityLogStore.getAllSentMessagesCountByUserId(uid);
            const userEl = this.findUserElementById(uid);
            if (!userEl) {
                console.warn('updateProfileChip: user element not found for uid:', uid);
                console.warn('This is probably because the user is not online anymore.');
                return;
            }

            const container = userEl.parentElement;
            if (!container) return;

            // Unread messages → move to top
            if (unreadReceivedMessagesCount > 0) {
                this.verbose('Adding unread sent chip to user:', uid, ', unread received messages count: ', unreadReceivedMessagesCount, ', sent messages count: ', sentMessagesCount);
                const chip = this._createChipForUserItem(userEl);

                userEl.classList.remove(this.getCleanSelector(this.sel.log.classes.ca_replied_messages));
                userEl.classList.add(this.getCleanSelector(this.sel.log.classes.ca_unread_messages));

                chip.classList.add(this.getCleanSelector(this.sel.log.classes.ca_sent_chip_unread));
                chip.classList.remove(this.getCleanSelector(this.sel.log.classes.ca_sent_chip_all_read));
                chip.textContent = `${unreadReceivedMessagesCount}`;

                // --- Move user to top of container ---
                if (container.firstElementChild !== userEl) {
                    container.insertBefore(userEl, container.firstElementChild);
                }

                // All read (✓) → move to bottom
            } else if (unreadReceivedMessagesCount === 0 && sentMessagesCount > 0) {
                this.verbose('Adding all read chip to user:', uid, ', unread received messages count: ', unreadReceivedMessagesCount, ', sent messages count: ', sentMessagesCount);
                const chip = this._createChipForUserItem(userEl);

                userEl.classList.add(this.getCleanSelector(this.sel.log.classes.ca_replied_messages));
                userEl.classList.remove(this.getCleanSelector(this.sel.log.classes.ca_unread_messages));

                chip.classList.add(this.getCleanSelector(this.sel.log.classes.ca_sent_chip_all_read));
                chip.classList.remove(this.getCleanSelector(this.sel.log.classes.ca_sent_chip_unread));
                chip.textContent = '✓';

                // --- Move user to bottom of container ---
                container.appendChild(userEl);

                // No sent messages → remove chip
            } else {
                this.verbose('Removing sent chip from user:', uid, ', unread received messages count: ', unreadReceivedMessagesCount, ', sent messages count: ', sentMessagesCount);
                if (userEl.classList.contains('chataddons-sent')) {
                    userEl.classList.remove('chataddons-sent');
                    userEl.style.removeProperty('outline');
                    userEl.style.removeProperty('border-radius');
                }
                userEl.querySelector(this.sel.log.classes.ca_sent_chip)?.remove();
            }
        }

        _createChipForUserItem(userEl) {
            let chip = userEl.querySelector(this.sel.log.classes.ca_sent_chip);

            if (!userEl.classList.contains('chataddons-sent')) {
                userEl.classList.add('chataddons-sent');
            }

            if (!chip) {
                chip = document.createElement('span');
                chip.classList.add(this.getCleanSelector(this.sel.log.classes.ca_sent_chip));
                userEl.appendChild(chip);
            }
            return chip;
        }

        /* ---------- Rank filter & selection checkbox ---------- */
        _isAllowedRank(el) {
            const rankAttr = el ? (el.getAttribute('data-rank') || '') : '';
            const roomRankIcon = this.safeQuery(el, '.list_rank');
            const roomRank = roomRankIcon ? (roomRankIcon.getAttribute('data-r') || '') : '';
            return (rankAttr === '1' || rankAttr === '50') && (roomRank !== '4');
        }

        // more descriptive and self-contained
        ensureBroadcastCheckbox(el) {
            if (!el || el.nodeType !== 1) return;      // skip invalid
            if (el.getAttribute('data-gender') !== this.FEMALE_CODE) return;
            if (this.qs('.ca-ck-wrap', el)) return;    // already has one
            if (!this._isAllowedRank?.(el)) return;

            const uid = this.getUserId?.(el);
            if (!uid) return;

            this._isMakingOwnChanges = true;

            const wrap = document.createElement('label');
            wrap.className = 'ca-ck-wrap';
            wrap.title = 'Include in broadcast';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'ca-ck';

            cb.checked = this.UserStore.isIncludedForBroadcast(uid);

            wrap.appendChild(cb);
            el.appendChild(wrap);

            // (optional) event hookup here if you don’t already wire at container level
            cb.addEventListener('change', (e) => this.handleCheckboxChange?.(e, uid, el));
        }

        handleCheckboxChange(e, uid /*, el */) {
            const include = !!e?.target?.checked;
            this.UserStore?.includeUserForBroadcast?.(uid, include);
            this.debug?.(`[BC] isIncludedForBroadcast → uid=${uid}, include=${include}`);
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
                  <label class="ca-debug-toggle" title="Enable verbose logging (very detailed)">
                    <input type="checkbox" id="ca-verbose-checkbox">
                    <span>Verbose</span>
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
                 <div class="ca-section ca-log-section">
              <hr class="ca-divider">
              <div class="ca-section-title"><span>Other Logs</span></div>
              <div id="${this.getCleanSelector(this.sel.log.other)}"
                   class="ca-log-box ${this.getCleanSelector(this.sel.log.classes.ca_box_scrollable)}"
                   aria-live="polite"></div>
            </div>
              </div>`;


            this.appendAfterMain(h);
            // Don't attach handlers here - UI refs aren't bound yet
        }

        createManagedUsersContainer() {
            // Check if already exists
            const existing = this.qs('#ca-managed-wrapper');
            if (existing) {
                console.log(this.LOG, 'Managed users container already exists');
                return;
            }

            // Find chat_right_data as the anchor point
            const chatRightData = this.qs(this.sel.users.chatRight);
            if (!chatRightData) {
                console.warn(this.LOG, 'chat_right_data not found, cannot create managed container');
                return;
            }

            // Wrap chat_right_data in collapsible container if not already wrapped
            let hostWrapper = this.qs(this.sel.users.hostWrapper);
            if (!hostWrapper) {
                hostWrapper = document.createElement('div');
                hostWrapper.id = this.getCleanSelector(this.sel.users.hostWrapper);
                hostWrapper.className = 'ca-user-list-container ca-collapsed'; // Start collapsed

                // Create header for host container
                const hostHeader = document.createElement('div');
                hostHeader.className = 'ca-user-list-header';
                hostHeader.innerHTML = `
                    <div class="ca-user-list-title">
                        <span>💥 Online Users (Male)</span>
                        <span class="ca-user-list-count" id="${this.getCleanSelector(this.sel.users.hostCount)}">0</span>
                    </div>
                    <div class="ca-user-list-toggle">▼</div>
                `;

                // Wrap chat_right_data
                chatRightData.parentNode.insertBefore(hostWrapper, chatRightData);
                hostWrapper.appendChild(hostHeader);

                const hostContent = document.createElement('div');
                hostContent.className = 'ca-user-list-content';

                hostContent.appendChild(chatRightData);
                hostWrapper.appendChild(hostContent);
                this.qs('.user_count', hostWrapper)?.remove();

                // Find and cache the .online_user container inside chat_right_data
                this.ui.hostContainer = hostWrapper;

                // Wire collapse/expand
                hostHeader.addEventListener('click', () => {
                    hostWrapper.classList.toggle('ca-collapsed');
                    hostWrapper.classList.toggle('ca-expanded');
                });
            }

            // Clone the entire host wrapper
            const managedWrapper = hostWrapper.cloneNode(true);

            // Update wrapper ID and make it expanded by default
            managedWrapper.id = 'ca-managed-wrapper';
            managedWrapper.className = 'ca-user-list-container ca-expanded';

            // Update the header title and make it female-styled
            const header = this.qs('.ca-user-list-header', managedWrapper);
            if (header) {
                header.className = 'ca-user-list-header ca-female-header';
                const titleSpan = this.qs('.ca-user-list-title span:first-child', header);
                if (titleSpan) {
                    titleSpan.textContent = '💎 Managed Female Users';
                }
            }

            // Update the counter ID in the header
            const headerCounter = this.qs('.ca-user-list-count', managedWrapper);
            if (headerCounter) {
                headerCounter.id = this.getCleanSelector(this.sel.users.managedCount);
                headerCounter.textContent = '0';
            }

            // Find chat_right_data inside the clone
            const clonedChatRight = this.qs('[id$="chat_right_data"]', managedWrapper);
            if (clonedChatRight) {
                clonedChatRight.id = 'ca-managed-chat-right-data';

                // Find container_user inside and update its ID
                const clonedContainerUser = this.qs('[id$="container_user"]', clonedChatRight);
                if (clonedContainerUser) {
                    clonedContainerUser.id = 'ca-managed-container-user';

                    // Update the "Online" text to "Female" in the user_count section
                    const bcell = this.qs('.bcell', clonedContainerUser);
                    if (bcell) {
                        // Get the first text node
                        for (let i = 0; i < bcell.childNodes.length; i++) {
                            if (bcell.childNodes[i].nodeType === 3) { // Text node
                                bcell.childNodes[i].textContent = 'Female ';
                                break;
                            }
                        }
                    }

                    // Update the counter in user_count section
                    const countSpan = this.qs('.ucount', clonedContainerUser);
                    if (countSpan) {
                        countSpan.id = this.getCleanSelector(this.sel.users.managedCount);
                        countSpan.textContent = '0';
                    }

                    // Find the .online_user div and clear it
                    const onlineUserDiv = this.qs('.online_user', clonedContainerUser);
                    if (onlineUserDiv) {
                        onlineUserDiv.innerHTML = '';
                        onlineUserDiv.id = this.getCleanSelector(this.sel.users.managedList);
                        this.verbose(this.LOG, '[createManagedUsersContainer] Cleared and updated .online_user div');
                    } else {
                        console.error(this.LOG, '[createManagedUsersContainer] .online_user not found in clone');
                    }
                }
            }

            // Insert BEFORE host wrapper
            hostWrapper.parentElement.insertBefore(managedWrapper, hostWrapper);

            // Wire collapse/expand for the managed wrapper
            const managedHeader = this.qs('.ca-user-list-header', managedWrapper);
            if (managedHeader) {
                managedHeader.addEventListener('click', () => {
                    managedWrapper.classList.toggle('ca-collapsed');
                    managedWrapper.classList.toggle('ca-expanded');
                });
            }

            this.verbose(this.LOG, 'Created managed users container by cloning host wrapper');

            // Wire click selection for the managed container
            this.wireUserClickSelection();

            // Update host users count initially
            this.updateHostUsersCount();
        }

        updateHostUsersCount() {
            if (!this.ui.hostContainer) return;

            const maleUsers = this.qsa(`.user_item:not([data-gender="${this.FEMALE_CODE}"])`, this.ui.hostContainer);
            if (this.ui.hostCount) {
                this.ui.hostCount.textContent = String(maleUsers.length);
            }
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
            const pop = this.createSpecificPopup();
            this.verbose(this.LOG, 'Specific popup element:', pop);
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
            this.ui.bStat = this.qs('#ca-bc-status');

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
                    const to = [];
                    for (let i = 0; i < list.length; i++) {
                        to.push(list[i]);
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
            // Find the Broadcast button and append the Specific button next to it
            const bcBtn = this.qs(this.sel.nav.bc);
            this.verbose(this.LOG, 'Broadcast button found:', bcBtn);
            if (!bcBtn) return;

            // The ID should be 'ca-nav-specific' not 'a-nav-specific'
            let specBtn = document.getElementById('ca-nav-specific');
            this.verbose(this.LOG, 'Looking for specific button, found:', specBtn);

            if (!specBtn) {
                specBtn = document.createElement('button');
                specBtn.id = 'ca-nav-specific';
                specBtn.className = 'ca-nav-btn-secondary';
                specBtn.type = 'button';
                specBtn.textContent = 'Specific';
                // insert after Broadcast
                bcBtn.insertAdjacentElement('afterend', specBtn);
                this.verbose(this.LOG, 'Created specific button:', specBtn);
            }
            this.ui.navSpec = specBtn;
            if (!specBtn._wired) {
                specBtn._wired = true;
                specBtn.addEventListener('click', () => {
                    this.verbose(this.LOG, 'Specific button clicked');
                    this.openSpecific();
                });
                this.verbose(this.LOG, 'Wired specific button');
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
            this.ui.debugCheckbox = this.qs(this.sel.debug.checkbox);
            this.ui.verboseCheckbox = this.qs(this.sel.debug.verboseCheckbox);

            // user list containers - will be bound after createManagedUsersContainer()
            this.ui.managedContainer = this.qs(this.sel.users.managed);
            this.ui.managedList = this.qs(this.sel.users.managedList);
            this.ui.managedCount = this.qs(this.sel.users.managedCount);
            this.ui.hostWrapper = this.qs(this.sel.users.hostWrapper);
            this.ui.hostCount = this.qs(this.sel.users.hostCount);

            this.ui.otherBox = this.qs(this.sel.log.other);
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
            this.ui.debugCheckbox.checked = this.debugMode;

            this.ui.debugCheckbox.addEventListener('change', (e) => {
                this.debugMode = e.target.checked;

                // Persist everywhere
                this._setCookie(this.DEBUG_COOKIE, String(this.debugMode));
                localStorage.setItem(this.DEBUG_MODE_KEY, String(this.debugMode));
                if (this.Store) this.Store.set(this.DEBUG_MODE_KEY, this.debugMode);

                console.log(this.LOG, this.debugMode ? '[DEBUG] Debug mode enabled' : 'Debug mode disabled');
            });
        }

        _wireVerboseCheckbox() {
            if (!this.ui.verboseCheckbox) return;
            this.ui.verboseCheckbox.checked = this.verboseMode;

            this.ui.verboseCheckbox.addEventListener('change', (e) => {
                this.verboseMode = e.target.checked;

                // Persist everywhere
                this._setCookie(this.VERBOSE_COOKIE, String(this.verboseMode));
                localStorage.setItem(this.VERBOSE_MODE_KEY, String(this.verboseMode));
                if (this.Store) this.Store.set(this.VERBOSE_MODE_KEY, this.verboseMode);

                console.log(this.LOG, this.verboseMode ? '[VERBOSE] Verbose mode enabled' : 'Verbose mode disabled');
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
                this.ActivityLogStore?.clear();
                this.UserStore?.clear();
                const timestamp = this.getTimeStampInWebsiteFormat();
                this.verbose('Resetting watermark to:', timestamp);
                this.setGlobalWatermark(timestamp);

                // Re-attach event handlers since we replaced the HTML
                this._attachLogClickHandlers?.();
            });
        }

        renderLogEntry(activityLog, user) {
            if (!activityLog || !user || !user.uid) {
                console.error(this.LOG, 'renderLogEntry: Invalid args', {entry: activityLog, user});
                return;
            }

            const {ts, kind, content, guid} = activityLog;

            // pick target
            let targetContainer = null;
            switch (kind) {
                case 'dm-out':
                    targetContainer = this.ui.sentBox;
                    break;

                case 'dm-in': {
                    // ensure subsection refs are bound (in case the box was rebuilt)
                    this.ui.unrepliedMessageBox = this.ui.unrepliedMessageBox || this.qs(this.sel.log.unreplied);
                    this.ui.repliedMessageBox = this.ui.repliedMessageBox || this.qs(this.sel.log.replied);

                    // unread → Not Replied, else → Replied
                    targetContainer =
                        activityLog.unread !== false
                            ? this.ui.unrepliedMessageBox
                            : this.ui.repliedMessageBox;
                    break;
                }

                case 'login':
                case 'logout':
                    targetContainer = this.ui.presenceBox;
                    break;

                case 'event':
                    targetContainer = this.ui.otherBox;
                    break;

                default:
                    targetContainer = this.ui.receivedMessagesBox;
            }

            if (!targetContainer) return;

            this.verbose(
                `Start rendering entry with timestamp ${ts}, type/kind ${kind} and content ${content} from user ${user.uid}`,
                user,
                'in target container',
                targetContainer
            );

            // entry root
            const el = document.createElement('div');
            const mappedKind = kind === 'dm-out' ? 'send-ok' : kind; // keep collapse mapping
            el.className = 'ca-log-entry ' + ('ca-log-' + mappedKind);
            el.setAttribute('data-uid', String(user.uid));
            if (guid != null) el.setAttribute('data-guid', String(guid));

            // timestamp
            const tsEl = document.createElement('span');
            tsEl.className = 'ca-log-ts';
            tsEl.textContent = String(ts).split(' ')[1] || String(ts);
            el.appendChild(tsEl);

            const dot = document.createElement('span');
            dot.className = 'ca-log-dot';
            el.appendChild(dot);

            if (kind === 'dm-out') {
                const exp = document.createElement('span');
                exp.className = 'ca-expand-indicator';
                exp.title = 'Click to expand/collapse';
                exp.textContent = '▾';
                exp.setAttribute('data-action', 'toggle-expand'); // <-- add this line
                exp.setAttribute('role', 'button');
                exp.setAttribute('tabindex', '0');
                exp.setAttribute('aria-expanded', 'false');

                el.appendChild(exp);
            }

            const userSpan = document.createElement('span');
            userSpan.className = 'ca-log-user';
            userSpan.innerHTML = this.userLinkHTML(user);
            el.appendChild(userSpan);

            const html = this.buildLogHTML(kind, activityLog.content);
            const detailsHTML = this.decodeHTMLEntities
                ? this.decodeHTMLEntities(html)
                : html;
            const text = document.createElement('span');
            text.className = 'ca-log-text';
            text.innerHTML = detailsHTML;
            el.appendChild(text);

            const dm = document.createElement('a');
            dm.className = 'ca-dm-link ca-dm-right';
            dm.href = '#';
            dm.setAttribute('data-action', 'open-dm');
            dm.textContent = 'dm';
            el.appendChild(dm);

            const del = document.createElement('a');
            del.className = 'ca-del-link';
            del.href = '#';
            del.setAttribute('data-action', 'delete-log');
            del.title = 'Delete this log entry';
            del.textContent = '✖';
            el.appendChild(del);

            // Unread go to the top of "Not Replied"; replied can append.
            if (kind === 'dm-in' && activityLog.unread !== false) {
                targetContainer.insertBefore(el, targetContainer.firstChild || null);
            } else {
                targetContainer.appendChild(el);
            }

            requestAnimationFrame(() => {
                targetContainer.scrollTop = targetContainer.scrollHeight;
            });
        }

        saveLogEntry(ts, kind, content, uid, guid) {
            if (kind === 'login' || kind === 'logout') return;
            const entry = {
                ts, kind, content, uid, guid,
                unread: (kind === 'dm-in') ? true : undefined
            };
            this.ActivityLogStore.set(entry);
        }

        async restoreLog() {
            if (!this.ui.sentBox || !this.ui.receivedMessagesBox || !this.ui.presenceBox) return;

            const logs = this.ActivityLogStore.list({order: 'asc'}) || [];

            for (const log of logs) {  // ✅ 'of' iterates the actual log objects
                this.verbose('Restoring log', log);
                const user = await this.UserStore.getOrFetch(log.uid);
                this.renderLogEntry(log, user);
            }
        }

        logEventLine(content) {
            const user = {uid: 'system', name: 'System'};
            this.logLine('event', content, user);
        }

        logLine(kind, content, user, guid) {
            const ts = this.getTimeStampInWebsiteFormat();
            const entry = {
                ts,
                kind,
                content,
                uid: user.uid,
                guid: guid ? guid : crypto.randomUUID(),
                unread: (kind === 'dm-in') ? true : undefined
            };

            this.renderLogEntry(entry, user);
            // keep existing persistence call but ensure it stores unread too (see next step)
            this.saveLogEntry(entry.ts, entry.kind, entry.content, entry.uid, entry.guid);
        }

        userLinkHTML(user) {
            return `<a href="#"
            class="ca-user-link"
            title="Open profile"
            data-uid="${user.uid}"
            data-name="${user.name}"
            data-action="open-profile"
            data-avatar="${user.avatar}">
            <strong>${user.name || "??"}</strong>
          </a>`;
        }

        /** Patch HTMLAudioElement.prototype.play so calls are queued until a user gesture occurs */
        _installAudioAutoplayGate() {
            if (this._audioGate.installed) return;

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
                    const res = gate.origPlay.call(audioEl);
                    if (res && typeof res.catch === 'function') {
                        res.catch(() => { /* swallow */
                        });
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
            };

            gate.installed = true;
        }

        /** Restore original behavior and remove listeners */
        _uninstallAudioAutoplayGate() {
            const gate = this._audioGate;
            if (!gate.installed) return;

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
        }

        /* ---------- 321ChatAddons: bottom log helpers ---------- */
        caGetLogBox() {
            const panel = this.qs(this.sel.panel) || document;
            return panel.querySelector(this.sel.log.classes.ca_log_box);
        }

        caAppendLog(type, text) {
            const box = this.caGetLogBox();
            if (!box) return;

            const entry = document.createElement('div');
            entry.className = 'ca-log-entry ' + (type === 'broadcast' ? 'ca-log-broadcast' : (type === 'reset' ? 'ca-log-reset' : ''));

            const ts = document.createElement('div');
            ts.className = 'ca-log-ts';
            ts.textContent = this.getTimeStampInWebsiteFormat();
            const dot = document.createElement('div');
            dot.className = 'ca-log-dot';
            const msg = document.createElement('div');
            msg.className = 'ca-log-text';

            if (type === 'broadcast') {
                msg.innerHTML = text + ' <span class="ca-badge-bc">BROADCAST</span>';
            } else {
                msg.innerHTML = text;
            }

            entry.appendChild(ts);
            entry.appendChild(dot);
            entry.appendChild(msg);

            // Prepend so newest appears at top with column-reverse
            box.insertBefore(entry, box.firstChild || null);
        }

        /* ---------- Click wiring for reset/broadcast logging ---------- */
        _handleDocumentClick(e) {
            const resetA = e.target && (e.target.closest && e.target.closest('.ca-pop .ca-reset-link, .ca-reset-link, .ca-reset'));
            if (resetA) this.caAppendLog('reset', 'Tracking has been reset');

            const bcBtn = e.target && (e.target.closest && e.target.closest('#ca-bc-send'));
            if (bcBtn) this.caAppendLog('broadcast', 'Message sent');
        }

        _wireLogClicks() {
            // bind once so we can remove later if needed
            this._onDocClick = this._onDocClick || this._handleDocumentClick.bind(this);
            document.addEventListener('click', this._onDocClick);
        }

        /* ---------- Keep original page sizing ---------- */
        applyInline() {
            const a = this.qsa('.pboxed');
            for (let i = 0; i < a.length; i++) a[i].style.setProperty('height', '800px', 'important');

            const b = this.qsa('.pboxed .pcontent');
            for (let j = 0; j < b.length; j++) b[j].style.setProperty('height', '610px', 'important');
        }

        removeAds(root) {
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
        }

        adjustForFooter() {
            const panel = this.qs(this.sel.panel);
            if (!panel) return;

            const chatRight = this.qs(this.sel.users.chatRight_elem);
            if (!chatRight) return;

            const rect = chatRight.getBoundingClientRect();
            let h = rect?.height - 45;

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
            // Always return ONLY our managed container for female users
            // This ensures we never accidentally query or modify male users in the host container
            if (!this.ui.managedList) {
                // Try to bind if not already cached
                this.ui.managedList = this.qs(this.sel.users.managedList);
            }
            if (!this.ui.managedList) {
                console.warn(this.LOG, 'Managed container not found - female user operations will not work');
            }
            return this.ui.managedList;
        }

        /* ---------- Global watermark helpers (uses this.Store) ---------- */
        getGlobalWatermark() {
            // expects this.Store with get(key)
            return this.Store?.get(this.GLOBAL_WATERMARK_KEY) || '';
        }

        setGlobalWatermark(dateStr) {
            if (dateStr) this.Store?.set(this.GLOBAL_WATERMARK_KEY, String(dateStr));
        }

        initializeGlobalWatermark() {
            const current = this.getGlobalWatermark();
            this.verbose('Checking watermark... current value:', current || '(not set)');

            if (current && current.length > 0) {
                this.verbose('Watermark already set:', current);
                return;
            }

            const timestamp = this.getTimeStampInWebsiteFormat();
            this.verbose('Setting initial watermark to:', timestamp);
            this.setGlobalWatermark(timestamp);

            const verify = this.getGlobalWatermark();
            if (verify === timestamp) {
                this.verbose('Watermark successfully initialized:', timestamp);
            } else {
                console.warn(this.LOG, 'Watermark set but verification failed. Expected:', timestamp, 'Got:', verify);
            }
        }

        parseLogDateToNumber(logDateStr) {
            return this.ActivityLogStore?.parseLogDateToNumber?.(logDateStr) ?? 0;
        }

        timeHHMM() {
            const d = new Date();
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return `${hh}:${mm}`;
        }

        timeHHMMSS() {
            const d = new Date();
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            return `${hh}:${mm}:${ss}`;
        }

        getTimeStampInWebsiteFormat() {
            const d = new Date();
            const DD = String(d.getDate()).padStart(2, '0');
            const MM = String(d.getMonth() + 1).padStart(2, '0');
            return `${DD}/${MM} ${this.timeHHMM()}`;
        }

        processReadStatusForLogs(logs) {
            if (!Array.isArray(logs) || !logs.length) {
                console.warn(`There are no logs to process the read status for.`);
                return;
            }

            const src = this.ui.unrepliedMessageBox;
            const dst = this.ui.repliedMessageBox || this.ui.receivedMessagesBox;
            if (!src || !dst) return;

            for (const log of logs) {
                this.debug(`Processing read status for log ${log.guid}`);
                const el = this.qs(`.ca-log-entry[data-guid="${log.guid}"]`, src);
                dst.appendChild(el);
            }
        }

        getLogEntryByUid(uid) {
            // find the log entry
            if (!uid) return;
            const el = document.querySelector(`${this.sel.log.classes.ca_log_entry}[data-uid="${uid}"]`);
            if (!el) {
                console.error(`${this.sel.log.classes.ca_log_entry}[data-uid="${uid}"] not found`);
            }
            return el;
        }

        destroy() {
            this._uninstallAudioAutoplayGate();
            this.uninstallNetworkTaps();
            this.uninstallPrivateSendInterceptor();
            this.stopRefreshUsersLoop();
            this.stopClearEventLogLoop();
        }
    }

// Expose the single App instance
    root.CA.App = new App();
    await root.CA.App.init();
})();
