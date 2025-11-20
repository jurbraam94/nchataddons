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

    class ActivityLogStore {
        constructor({kv, cacheKey, max = 200, app} = {}) {
            if (!kv) throw new Error('ActivityLogStore requires a KeyValueStore');
            this.kv = kv;
            this.cacheKey = cacheKey;
            this.max = max;
            this.app = app;
        }

        getAllOnlineWomen() {
            return this.list().filter(user => user.isFemale && user.online);
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

        MarkReadUntilChatLogId(uid, parsedDmInUpToLog) {
            if (!uid || parsedDmInUpToLog === undefined) {
                console.error(`Uid ${uid} or parsedDmInUpToLog ${parsedDmInUpToLog} is invalid`);
                return [];
            } else if (parsedDmInUpToLog === 0) {
                console.log(`parsedDmInUpToLog is 0 (this means there are no logs for user ${uid} , nothing to do`);
                return [];
            }

            const allUnreadMessagesForUid = this.getAllByUserUid(uid, true)
                .filter(log => log.guid <= parsedDmInUpToLog)
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

        set(user) {
            if (!user || user.uid == null) {
                console.error('set() requires user.uid');
                return null;
            }
            const merged = this._mergeUser(user);
            this.app.verbose(`Saving merged user`, user);
            return this._save(merged);
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

        getAllLoggedInFemales() {
            return this.getAllLoggedIn().filter(u => u.isFemale);
        }

        getMalesLoggedIn() {
            return this.getAllLoggedIn().filter(u => !u.isFemale);
        }

        getFemalesLoggedInCount() {
            return this.getAllLoggedInFemales().length;
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

            const user = this.getOrFetch(uid);
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

            this.STORAGE_KEY_PREFIX = '321chataddons';
            this.PERSIST_STORAGE_KEY_PREFIX = `persist_${this.STORAGE_KEY_PREFIX}`;
            this.STORAGE_COOKIE = `${this.STORAGE_KEY_PREFIX}.storageMode`;
            this.DEBUG_COOKIE = `${this.STORAGE_KEY_PREFIX}.debug`;
            this.VERBOSE_COOKIE = `${this.STORAGE_KEY_PREFIX}.verbose`;
            this.DEBUG_MODE_KEY = `${this.STORAGE_KEY_PREFIX}.debugMode`;
            this.VERBOSE_MODE_KEY = `${this.STORAGE_KEY_PREFIX}.verboseMode`;
            this.GLOBAL_WATERMARK_KEY = `${this.STORAGE_KEY_PREFIX}.global.watermark`;
            this.ACTIVITY_LOG_KEY = `${this.STORAGE_KEY_PREFIX}.activityLog`;
            this.HIDE_REPLIED_USERS_KEY = `${this.STORAGE_KEY_PREFIX}.hideRepliedUsers`;
            this.LAST_DM_UID_KEY = `${this.STORAGE_KEY_PREFIX}.lastDmUid`;
            this.PREDEFINED_MESSAGES_KEY = `${this.PERSIST_STORAGE_KEY_PREFIX}.predefined_messages`;
            this.USERS_KEY = `${this.PERSIST_STORAGE_KEY_PREFIX}.users`;

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
                panel: null,
                panelNav: null,
                sendPrivateMessageUser: null,
                sendPrivateMessageText: null,
                sendPrivateMessageButton: null,
                broadcastMessage: null,
                broadcastSendButton: null,
                sentMessagesBox: null,
                receivedMessagesBox: null,
                presenceBox: null,
                logClear: null,
                repliedMessageBox: null,
                unrepliedMessageBox: null,
                debugCheckbox: null,
                verboseCheckbox: null,
                loggingBox: null,
                maleUsersContainer: null,
                femaleUsersContainer: null,
                femaleUSersCount: null,
                maleUsersWrapper: null,
                maleUsersCount: null
            };

            this._lastSendAt = 0;

            this._xhrOpen = null;
            this._xhrSend = null;

            this.isInitialLoad = true;

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
            });

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
                rightPanel: '#right-panel',
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
                        ca_log_cell: '.ca-log-cell',
                        ca_log_dot: '.ca-log-dot',
                        ca_log_dot_green: '.ca-log-dot-green',
                        ca_log_dot_red: '.ca-log-dot-red',
                        ca_log_dot_gray: '.ca-log-dot-gray',
                        ca_log_user: '.ca-log-user',
                        ca_log_box: '.ca-log-box',
                        ca_expand_indicator: '.ca-expand-indicator',
                        ca_expanded_indicator: '.ca-expanded',
                        ca_user_link: '.ca-user-link',
                        ca_dm_link: '.ca-dm-link',
                        ca_dm_right: '.ca-dm-right',
                        ca_del_link: '.ca-del-link',
                        ca_log_actions: '.ca-log-actions',
                        ca_log_action: '.ca-log-action',
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
                    general: '#ca-logs-box'
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
                privateChat: {
                    privateCenter: '#private_center',
                    privateInputBox: '#private_input_box',
                    privateTop: '#private_top',
                    privInput: '#message_content'
                },
                users: {
                    femaleUsers: '#ca-female-users',
                    femaleUserCount: '#ca-female-users-count',
                    maleUsersWrapper: '#ca-male-users-wrapper',
                    femaleUsersWrapper: '#ca-female-users-wrapper',
                    maleUserCount: '#ca-male-users-count',
                    containerUser: '#container_user',
                    online: '.online_user',
                    chatRightData: '#chat_right_data',
                    chatRight: '#chat_right',
                    combined: '#container_user, .online_user, #chat_right_data',
                    globalChat: '#global_chat',
                    chatHead: '#chat_head',
                    wrapFooter: '#wrap_footer',
                    topChatContainer: '#top_chat_container',
                    caUserListHeader: '.ca-user-list-header'
                },
                // Debug checkboxes
                debug: {
                    checkbox: '#ca-debug-checkbox',
                    verboseCheckbox: '#ca-verbose-checkbox',
                },
            };
            this.sel.raw = {};
        }

        buildRawTree() {
            if (!this.sel || typeof this.sel !== "object") {
                console.error("initRawSelectors: this.sel is not an object");
                return;
            }

            const seen = new WeakSet();

            const strip = (s) => {
                if (typeof s !== "string") return s;
                return (s.startsWith("#") || s.startsWith(".")) ? s.slice(1) : s;
            };

            const walk = (src) => {
                if (!src || typeof src !== "object") return undefined;
                if (seen.has(src)) return undefined; // prevent cycles
                seen.add(src);

                const out = Array.isArray(src) ? [] : {};

                for (const [key, val] of Object.entries(src)) {
                    // Avoid recursing into the target mirror itself
                    if (key === "raw") continue;

                    if (typeof val === "string") {
                        out[key] = strip(val);
                    } else if (val && typeof val === "object") {
                        const child = walk(val);
                        if (child && (Array.isArray(child) ? child.length : Object.keys(child).length)) {
                            out[key] = child;
                        } else {
                            out[key] = {}; // keep structure even if empty
                        }
                    }
                }
                return out;
            };

            this.sel.raw = walk(this.sel) || {};
        }


        async init(options = {}) {
            this.options = options || {};
            this._removeSuperBotMethods();
            this.buildRawTree(this.sel, this.sel.raw);

            this.debugMode = this._getCookie(this.DEBUG_COOKIE) === 'true' ||
                localStorage.getItem(this.DEBUG_MODE_KEY) === 'true';
            this.verboseMode = this._getCookie(this.VERBOSE_COOKIE) === 'true' ||
                localStorage.getItem(this.VERBOSE_MODE_KEY) === 'true';

            const storedHide = localStorage.getItem(this.HIDE_REPLIED_USERS_KEY) || false;
            this.hideRepliedUsers = storedHide === true || storedHide === 'true';

            this.NO_LS_MODE = this._readStorageMode(); // 'allow' | 'wipe' | 'block'
            if (this.NO_LS_MODE === 'wipe') this._clearOwnLocalStorage();
            // Let layout settle, then remove ads
            this.removeAds(document);
            // --- CORE UI SETUP (keep synchronous) ---
            this.buildPanel();

            const main_wrapper = document.createElement('div');
            main_wrapper.id = 'main_wrapper';

            const globalChatEl = this.qs('#global_chat');
            const chatHeadEl = this.qs('#chat_head');
            const wrapFooterEl = this.qs('#wrap_footer');
            const privateMenuEl = this.qs('#private_menu');
            const privateCenterEl = this.qs('#private_center');

            this.qs(this.sel.privateChat.privateInputBox).innerHTML =
                '<textarea data-paste="1" id="message_content" rows="4" class="inputbox" placeholder="Type a message..."></textarea>';
            this.qs('#message_form').prepend(this.qs('#private_input_box'));

            const dmTextarea = document.getElementById("message_content");
            const dmSendBtn = document.querySelector('#private_send, #send_button, #message_form button[type="submit"]');

            if (!dmTextarea) {
                console.error("DM textarea #message_content not found");
            }
            if (!dmSendBtn) {
                console.error("DM send button not found — update selector if needed");
            }

            if (dmTextarea && dmSendBtn) {
                dmTextarea.addEventListener("keydown", (event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();

                        const text = dmTextarea.value.trim();
                        if (text.length === 0) {
                            console.warn("Empty private message — not sending");
                            return;
                        }

                        dmSendBtn.click();
                        dmTextarea.value = "";
                    }
                });
            }

            if (privateCenterEl && privateMenuEl) {
                privateCenterEl.after(privateMenuEl);
            }

            if (chatHeadEl) main_wrapper.appendChild(chatHeadEl);
            if (globalChatEl) main_wrapper.appendChild(globalChatEl);
            if (wrapFooterEl) main_wrapper.appendChild(wrapFooterEl);
            document.body.prepend(main_wrapper);

            // Store + dependent stores
            this.Store = this.Store || new KeyValueStore({storage: this._chooseStorage(this.NO_LS_MODE)});
            this.debug('Initializing app with options:', options);

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
                    rank: 100
                });
            }

            this.ActivityLogStore = this.ActivityLogStore || new ActivityLogStore({
                kv: this.Store,
                cacheKey: this.ACTIVITY_LOG_KEY,
                max: 200,
                app: this
            });

            this._installAudioAutoplayGate();
            this.initializeGlobalWatermark();
            this._updateStorageToggleUi();

            // Panel + user containers are visible early
            this.buildMenuLogPanel();
            this.createMaleUsersContainer();
            this.createFemaleUsersContainer();
            this.createPredefinedMessagesSection();
            this._bindStaticRefs();
            this._attachLogClickHandlers();


            this.installLogImageHoverPreview();

            // Restore last DM (cheap) before wiring DM stuff
            await this.restoreLastDmFromStore();

            const privateCloseButton = document.querySelector('#private_close');
            if (privateCloseButton) {
                privateCloseButton.addEventListener('click', () => {
                    this.clearLastDmUid();
                });
            }

            this._wireDebugCheckbox();
            this._wireVerboseCheckbox();
            this._wireLogClear();

            // Network taps should be ready, but heavy work will happen later
            this.installNetworkTaps();
            this.installPrivateSendInterceptor();

            // Re-bind counters + add refresh button
            this.ui.femaleUSersCount = this.qs(this.sel.users.femaleUserCount);
            this.ui.maleUsersCount = this.qs(this.sel.users.maleUserCount);
            this.appendCustomActionsToBar();

            // --- HEAVY STUFF: defer to idle so UI appears fast ---
            this.scheduleIdle(async () => {
                // restoreLog can be heavy if many entries
                await this.restoreLog();

                // Start loops; first user refresh happens here
                await this.startRefreshUsersLoop({intervalMs: 15000, runImmediately: true});
                this.startClearEventLogLoop({intervalMs: 5 * 60 * 1000});

                // scroll after logs have been restored
                this.scrollToBottom(this.ui.repliedMessageBox);
                this.scrollToBottom(this.ui.unrepliedMessageBox);
                this.scrollToBottom(this.ui.sentMessagesBox);
            });

            return this;
        }

        scheduleIdle(fn, timeout = 1500) {
            if (typeof fn !== 'function') {
                console.error('[CA] scheduleIdle: fn must be a function');
                return;
            }

            if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                window.requestIdleCallback(() => fn(), {timeout});
            } else {
                setTimeout(() => fn(), 0);
            }
        }

        _removeSuperBotMethods() {
            window.sendSuperbotMain = () => {
                const message = `!!! Prevented a call to superbot main method.`;
                console.error(message);
                this.logEventLine(message);
            };
            window.sendSuperbotPrivate = () => {
                const message = `!!! Prevented a call to superbot private method.!`;
                console.error(message);
                this.logEventLine(message);
            };
        }

        /* Fill the list inside the pop */
        _renderPredefinedList() {
            const pop = document.getElementById('ca-predefined-messages-pop');
            if (!pop) return;

            const listEl = pop.querySelector('#ca-predefined-messages-list');
            const subjectInput = pop.querySelector('#ca-predefined-messages-subject');
            const textInput = pop.querySelector('#ca-predefined-messages-text');
            const indexInput = pop.querySelector('#ca-predefined-messages-index');

            if (!listEl || !subjectInput || !textInput || !indexInput) {
                console.error('[CA] _renderPredefinedList: missing elements');
                return;
            }

            const list = this._getPredefinedMessages();
            listEl.innerHTML = '';

            list.forEach((item, index) => {
                const li = document.createElement('li');
                li.className = 'ca-predefined-messages-item';

                const titleRow = document.createElement('div');
                titleRow.className = 'ca-predefined-messages-title-row';

                const title = document.createElement('strong');
                title.textContent = item.subject || `Template ${index + 1}`;

                const actions = document.createElement('div');
                actions.className = 'ca-predefined-messages-actions';

                // EDIT (pencil)
                const editLink = document.createElement('a');
                editLink.href = "#";
                editLink.className = 'ca-log-action ca-edit-link';
                editLink.title = "Edit template";
                editLink.appendChild(this.renderSvgIconWithClass("lucide lucide-lucide-pencil",
                    `<path d="M17 3a2.828 2.828 0 0 1 4 4l-12 12-4 1 1-4 12-12z"></path>`));

                editLink.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    this.predefinedEditIndex = index;
                    indexInput.value = String(index);
                    subjectInput.value = item.subject || '';
                    textInput.value = item.text || '';
                });

                const deleteLink = document.createElement('a');
                deleteLink.href = "#";
                deleteLink.className = 'ca-log-action ca-del-link';
                deleteLink.title = "Delete template";
                deleteLink.appendChild(this.renderSvgIconWithClass("lucide lucide-x",
                    ` <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>`));

                deleteLink.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    const current = this._getPredefinedMessages().slice();
                    current.splice(index, 1);
                    this._savePredefinedMessages(current);
                    this._renderPredefinedList();
                    this._refreshAllPredefinedSelects();
                });

                actions.appendChild(editLink);
                actions.appendChild(deleteLink);

                titleRow.appendChild(title);
                titleRow.appendChild(actions);

                const preview = document.createElement('div');
                preview.className = 'ca-predefined-messages-preview';
                preview.textContent = (item.text || '').slice(0, 80);

                li.appendChild(titleRow);
                li.appendChild(preview);
                listEl.appendChild(li);
            });

        }

        _fillPredefinedSelect(selectEl) {
            if (!selectEl) return;

            const list = this._getPredefinedMessages();

            selectEl.innerHTML = '';

            const def = document.createElement('option');
            def.value = '';
            def.textContent = 'Select predefined message…';
            selectEl.appendChild(def);

            list.forEach((tpl, index) => {
                const opt = document.createElement('option');
                opt.value = String(index);
                opt.textContent = tpl.subject || `Template ${index + 1}`;
                selectEl.appendChild(opt);
            });
        }

// Call this whenever templates change, so ALL dropdowns stay in sync
        _refreshAllPredefinedSelects() {
            const selects = document.querySelectorAll('.ca-predefined-messages-select');
            selects.forEach((sel) => this._fillPredefinedSelect(sel));
        }

        // Append to any textarea-like input
        _appendPredefinedToBox(template, box) {
            if (!template || !template.text) {
                console.warn('[CA] _appendPredefinedToBox: empty template');
                return;
            }

            if (!box) {
                console.error('[CA] _appendPredefinedToBox: target box not found');
                return;
            }

            const current = box.value || '';
            let next = current;

            if (current && !current.endsWith('\n')) {
                next += '\n\n';
            }

            next += template.text;

            box.value = next;

            try {
                const evt = new Event('input', {bubbles: true});
                box.dispatchEvent(evt);
            } catch (err) {
                console.warn('[CA] _appendPredefinedToBox: failed to dispatch input event', err);
            }

            box.focus();
        }

        createPredefinedMessagesSection() {
            const privateBoxEl =
                document.getElementById('priv_input');

            if (!privateBoxEl) {
                console.warn('[CA] createPredefinedMessagesSection: private area not found');
                return;
            }

            this.createPredefinedMessagesBar({
                container: privateBoxEl,
                messageBarName: 'ca-predefined-messages-select-private-chat',
                targetTextBoxSelector: '#private_input_box #message_content'
            });
        }

        _applyPredefinedFromSelect(selectEl) {
            if (!selectEl) {
                console.error('[CA] _applyPredefinedFromSelect: selectEl is missing');
                return false;
            }

            const idxStr = selectEl.value;
            if (!idxStr) {
                console.warn('[CA] _applyPredefinedFromSelect: nothing selected');
                return false;
            }

            const idx = Number(idxStr);
            const list = this._getPredefinedMessages();
            if (Number.isNaN(idx) || idx < 0 || idx >= list.length) {
                console.warn('[CA] _applyPredefinedFromSelect: invalid index', idxStr);
                return false;
            }

            const template = list[idx];
            const targetSelector = selectEl.dataset.predefinedMessagesTarget; // <-- changed
            if (!targetSelector) {
                console.error('[CA] _applyPredefinedFromSelect: missing data-predefined-messages-target');
                return false;
            }

            const box = this.qs(targetSelector) || document.querySelector(targetSelector);
            if (!box) {
                console.error('[CA] _applyPredefinedFromSelect: target not found for selector:', targetSelector);
                return false;
            }

            this._appendPredefinedToBox(template, box);
            return true;
        }

        createPredefinedMessagesBar({container, messageBarName, targetTextBoxSelector, appendAtStart}) {
            if (!container) {
                console.error('[CA] createPredefinedMessagesBar: container is missing');
                return;
            }

            if (!messageBarName || !targetTextBoxSelector || !appendAtStart === undefined) {
                console.error('[CA] createPredefinedMessagesBar: invalid options', {
                    container,
                    messageBarName,
                    targetTextBoxSelector,
                    appendAtStart
                });
                return;
            }

            // Avoid duplicating if bar already exists here
            if (container.querySelector(`#${messageBarName}`)) {
                return;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'ca-predefined-messages-bar';

            wrapper.innerHTML = `
            <div class="ca-predefined-messages-bar-inner">
                <label class="ca-predefined-messages-label">
                    <select id="${messageBarName}"
                            class="ca-predefined-messages-select"
                            data-predefined-messages-target="${targetTextBoxSelector}">
                        <option value="">Select pre-defined message…</option>
                    </select>
                </label>
            
                <div class="ca-predefined-messages-bar-actions">
            
                    <!-- SEND AGAIN -->
                    <a href="#"
                       id="${messageBarName}-resend"
                       class="ca-log-action ca-log-action-filled ca-predefined-messages-resend"
                       title="Insert again">
                       ${this.buildSvgIconString("lucide lucide-triangle-right",
                `<path d="M8 4l12 8-12 8V4z"></path>`)}
                    </a>
            
                    <!-- ADD NEW FROM CURRENT TEXT -->
                    <a href="#"
                       id="${messageBarName}-add"
                       class="ca-log-action ca-predefined-messages-add"
                       title="Save current text as template">
                       ${this.buildSvgIconString("lucide lucide-lucide-plus",
                `<line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>`)}
                    </a>
            
                    <!-- MANAGE -->
                    <a href="#"
                       id="${messageBarName}-manage"
                       class="ca-log-action ca-predefined-messages-manage"
                       title="Manage templates">
                       ${this.buildSvgIconString("lucide lucide-pencil",
                `<path d="M17 3a2.828 2.828 0 0 1 4 4L9 19l-4 1 1-4L17 3z"></path>`)}
                    </a>
            
                </div>
            </div>
            `;

            if (appendAtStart) {
                container.prepend(wrapper);
            } else {
                container.appendChild(wrapper);
            }

            // ⬇️ Separate wiring step
            this.wirePredefinedMessagesBar(wrapper);
        }

        wirePredefinedMessagesBar(barEl) {
            if (!barEl) {
                console.error('[CA] wirePredefinedMessagesBar: barEl missing');
                return;
            }

            const selectEl = barEl.querySelector('.ca-predefined-messages-select');
            const resendEl = barEl.querySelector('.ca-predefined-messages-resend');
            const addEl = barEl.querySelector('.ca-predefined-messages-add');
            const manageEl = barEl.querySelector('.ca-predefined-messages-manage');

            if (!selectEl) {
                console.error('[CA] wirePredefinedMessagesBar: select not found');
                return;
            }

            // Fill options for this select only
            this._fillPredefinedSelect(selectEl);

            // --- change on THIS select ---
            selectEl.addEventListener('change', (e) => {
                this._applyPredefinedFromSelect(e.target);
            });

            // --- resend on THIS bar ---
            if (resendEl) {
                resendEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    const ok = this._applyPredefinedFromSelect(selectEl);
                    if (!ok) {
                        console.warn('[CA] Predefined resend: nothing to resend (no selection?)');
                    }
                });
            }

            // --- add-from-chat on THIS bar ---
            if (addEl) {
                addEl.addEventListener('click', (e) => {
                    e.preventDefault();

                    const targetSel = selectEl.dataset.predefinedMessagesTarget;
                    if (!targetSel) {
                        console.error('[CA] add-from-chat: missing data-predefined-messages-target');
                        return;
                    }

                    const box = this.qs(targetSel) || document.querySelector(targetSel);
                    if (!box) {
                        console.error('[CA] add-from-chat: target input not found for selector:', targetSel);
                        return;
                    }

                    const currentText = (box.value || '').trim();
                    if (!currentText) {
                        console.warn('[CA] No text in chatbox to save as template');
                        return;
                    }

                    if (typeof this.openPredefinedPopup === 'function') {
                        this.openPredefinedPopup();
                    } else if (typeof this.createPredefinedPopup === 'function') {
                        const pop = this.createPredefinedPopup();
                        if (pop) pop.style.display = 'block';
                    }

                    const modal =
                        document.getElementById('ca-predefined-messages-pop') ||
                        document.getElementById('ca-predefined-modal');

                    if (!modal) {
                        console.error('[CA] Predefined modal not found after opening');
                        return;
                    }

                    const subjectInput = modal.querySelector('#ca-predefined-messages-subject');
                    const textInput = modal.querySelector('#ca-predefined-messages-text');
                    const indexInput = modal.querySelector('#ca-predefined-messages-index');

                    if (indexInput) {
                        indexInput.value = '-1'; // new template
                    }
                    if (subjectInput) {
                        subjectInput.value = subjectInput.value || '';
                    }
                    if (textInput) {
                        textInput.value = currentText;
                    }
                });
            }

            // --- manage on THIS bar ---
            if (manageEl) {
                manageEl.addEventListener('click', (e) => {
                    e.preventDefault();

                    console.log('[CA] Predefined Manage clicked:', manageEl.id || '(no id)');

                    if (typeof this.openPredefinedPopup === 'function') {
                        this.openPredefinedPopup();
                    } else if (typeof this.createPredefinedPopup === 'function') {
                        const pop = this.createPredefinedPopup();
                        if (pop) pop.style.display = 'block';
                    } else {
                        console.error('[CA] No predefined popup open method defined');
                    }
                });
            }
        }


        // ---- Predefined messages storage helpers ----
        _getPredefinedMessages() {
            if (!this.Store) {
                console.error('[CA] _getPredefinedMessages: Store is not initialized');
                return [];
            }
            if (Array.isArray(this.predefinedMessages) && this.predefinedMessages.length > 0) {
                return this.predefinedMessages;
            }
            const raw = this.Store.get(this.PREDEFINED_MESSAGES_KEY);
            this.predefinedMessages = Array.isArray(raw) ? raw : [];
            return this.predefinedMessages;
        }

        _savePredefinedMessages(list) {
            if (!this.Store) {
                console.error('[CA] _savePredefinedMessages: Store is not initialized');
                return;
            }
            const arr = Array.isArray(list) ? list : [];
            this.predefinedMessages = arr;
            this.Store.set(this.PREDEFINED_MESSAGES_KEY, arr);
        }

        /* ---------- Predefined messages popup (ca-pop) ---------- */
        createPredefinedPopup() {
            let pop = document.getElementById('ca-predefined-messages-pop');
            if (pop) return pop;

            pop = document.createElement('div');
            pop.id = 'ca-predefined-messages-pop';
            pop.className = 'ca-pop';
            pop.style.display = 'none';

            pop.innerHTML =
                '<div id="ca-predefined-messages-pop-header" class="ca-pop-header">' +
                '  <span>Predefined messages</span>' +
                '  <button id="ca-predefined-messages-pop-close" class="ca-pop-close" type="button">✕</button>' +
                '</div>' +
                '<div class="ca-pop-body">' +
                '  <form id="ca-predefined-messages-form" class="ca-predefined-messages-form" style="display:flex; flex-direction:column; gap:4px; margin-bottom:6px;">' +
                '    <label>Subject<br>' +
                '      <input type="text" id="ca-predefined-messages-subject" class="ca-8" />' +
                '    </label>' +
                '    <label>Text<br>' +
                '      <textarea id="ca-predefined-messages-text" class="ca-8" rows="4"></textarea>' +
                '    </label>' +
                '    <input type="hidden" id="ca-predefined-messages-index" value="-1" />' +
                '    <div style="display:flex; gap:4px; justify-content:flex-end; margin-top:4px;">' +
                '      <button type="button" id="ca-predefined-messages-reset" class="ca-btn ca-btn-slim">Clear</button>' +
                '      <button type="submit" id="ca-predefined-messages-save" class="ca-btn ca-btn-slim">Save</button>' +
                '    </div>' +
                '  </form>' +
                '  <hr>' +
                '  <ul id="ca-predefined-messages-list"></ul>' +
                '</div>';

            document.body.appendChild(pop);

            const closeBtn = pop.querySelector('#ca-predefined-messages-pop-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    pop.style.display = 'none';
                });
            }

            const form = pop.querySelector('#ca-predefined-messages-form');
            const subjectInput = pop.querySelector('#ca-predefined-messages-subject');
            const textInput = pop.querySelector('#ca-predefined-messages-text');
            const indexInput = pop.querySelector('#ca-predefined-messages-index');
            const resetBtn = pop.querySelector('#ca-predefined-messages-reset');

            if (!form || !subjectInput || !textInput || !indexInput || !resetBtn) {
                console.error('[CA] createPredefinedPopup: missing form controls');
                return pop;
            }

            resetBtn.addEventListener('click', () => {
                this.predefinedEditIndex = null;
                indexInput.value = '-1';
                subjectInput.value = '';
                textInput.value = '';
            });

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const subject = subjectInput.value.trim();
                const text = textInput.value.trim();

                if (!subject && !text) {
                    console.warn('[CA] Cannot save empty predefined message');
                    return;
                }

                const list = this._getPredefinedMessages().slice();
                const idx = Number(indexInput.value);

                if (!Number.isNaN(idx) && idx >= 0 && idx < list.length) {
                    list[idx] = {subject, text};
                } else {
                    list.push({subject, text});
                }

                this._savePredefinedMessages(list);
                this._renderPredefinedList();
                this._refreshAllPredefinedSelects();


                this.predefinedEditIndex = null;
                indexInput.value = '-1';
                subjectInput.value = '';
                textInput.value = '';
            });

            const hdr = pop.querySelector('#ca-predefined-messages-pop-header');
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
            if (hdr) {
                hdr.addEventListener('mousedown', (e) => {
                    sx = e.clientX;
                    sy = e.clientY;
                    const r = pop.getBoundingClientRect();
                    ox = r.left;
                    oy = r.top;
                    document.addEventListener('mousemove', mm);
                    document.addEventListener('mouseup', mu);
                });
            }

            this._renderPredefinedList();

            return pop;
        }

        openPredefinedPopup() {
            const pop = this.createPredefinedPopup();
            if (!pop) return;
            this._renderPredefinedList();
            pop.style.display = 'block';
        }

        appendCustomActionsToBar() {
            const bar = document.getElementById('right_panel_bar');

            if (bar) {
                const refreshBtn = document.createElement('div');
                refreshBtn.classList.add('panel_option');
                refreshBtn.classList.add('panel_option_refresh');
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

        _clearOwnLocalStorage() {
            console.warn(
                'CLEARING LOCALSTORAGE AND NOT PERSISTING ANY SETTINGS BECAUSE WIPE LOCAL STORAGE IS ENABLED'
            );

            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(this.STORAGE_KEY_PREFIX)) {
                    localStorage.removeItem(key);
                }
            });
        }

        // ===== Refresh Users loop =====
        async startRefreshUsersLoop({
                                        intervalMs = 15000,    // default 60s
                                        runImmediately = true
                                    } = {}) {
            this.stopRefreshUsersLoop(); // clear any previous loop

            this._refreshUsersIntervalMs = intervalMs;

            if (runImmediately) {
                await this.refreshUserList();
            }

            this._refreshUsersTimerId = setInterval(async () => {
                await this.refreshUserList();
            }, this._refreshUsersIntervalMs);
        }

        stopRefreshUsersLoop() {
            if (this._refreshUsersTimerId) {
                clearInterval(this._refreshUsersTimerId);
                this._refreshUsersTimerId = null;
            }
        }

        // ===== Clear Event Logs loop =====
        startClearEventLogLoop({
                                   intervalMs = 5 * 60 * 1000,
                                   runImmediately = true
                               } = {}) {
            this.stopClearEventLogLoop?.();

            const clearEvents = () => {
                const removed = this.ActivityLogStore?.clearByKind?.('event') || 0;
                this.ui.loggingBox.innerHTML = '';

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

        async refreshUserList() {
            console.log('========== START REFRESHING AND PARSING NEW USER LIST ==========t');
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

        processPrivateSendResponse(data, targetUid) {
            const logData = data.log || {};
            const content = logData.log_content || '';

            // Look up user - ensure we always have a valid user object
            let dmSentToUser = this.UserStore.get(targetUid);

            if (!dmSentToUser) {
                console.error(`[PrivateSend] Could not find user with ID ${targetUid}. Could not process outgoing private message`);
                return;
            }

            console.log(this.LOG, 'Intercepted native message send to', dmSentToUser.name || targetUid, '(ID:', targetUid, ')');

            this.logLine('dm-out', content, dmSentToUser, logData.log_id);
            const affectedLogs = this.ActivityLogStore.MarkReadUntilChatLogId(targetUid, dmSentToUser.parsedDmInUpToLog);
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
                            let data = self.toPrivateSendResponse(JSON.parse(String(this?.responseText)));

                            if (!data) {
                                console.error(`[PrivateSend] Could not parse response from native message send:`, data);
                                return;
                            }
                            const targetId = new URLSearchParams(capturedBody).get('target');
                            self.processPrivateSendResponse(data, targetId);
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
                    'Accept': '*/*'
                },
                body
            });

            const html = await response.text();
            let user = this.caParseProfile(html);

            // If we successfully parsed the profile, save and return it
            if (user.name && user.avatar) {
                user = this.UserStore.set({
                    ...user,
                    uid
                });

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
                    'Accept': '*/*'
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
        fetchPrivateMessagesForUid(uid, params) {
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
                    'X-Requested-With': 'XMLHttpRequest'
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

        processSinglePrivateChatLog(privateChatLog, user, initialFetch, currentHighestLogId) {
            if (privateChatLog.user_id === String(user_id)) {
                return {accepted: false, logId: privateChatLog.log_id, reason: 'from myself'};
            }

            if (initialFetch && !this.isMessageNewer(privateChatLog.log_date)) {
                this.debug(`Initial fetch: skipping old message ${privateChatLog.log_id} for uid ${user.uid}; watermark=${this.getGlobalWatermark()}`);
                return {accepted: false, logId: privateChatLog.log_id, reason: 'too old'};
            }

            if (privateChatLog.log_id <= currentHighestLogId) {
                return {accepted: false, logId: privateChatLog.log_id, reason: 'already shown'};
            }

            this.logLine('dm-in', this.decodeHTMLEntities(privateChatLog?.log_content), user, privateChatLog.log_id);
            this.updateProfileChip(user.uid);
            return {accepted: true, logId: privateChatLog.log_id, reason: 'ok'};
        }

        installLogImageHoverPreview() {
            const containers = [
                this.ui.repliedMessageBox,
                this.ui.unrepliedMessageBox,
                this.ui.sentMessagesBox
            ].filter(Boolean);

            if (!containers.length) {
                console.warn('[CA] installLogImageHoverPreview: no log containers found');
                return;
            }

            // Create a single shared preview bubble
            const preview = document.createElement('div');
            preview.id = 'ca-log-image-preview';
            preview.style.position = 'fixed';
            preview.style.zIndex = '9999';
            preview.style.pointerEvents = 'none';
            preview.style.display = 'none';
            preview.style.border = '1px solid rgba(0,0,0,0.5)';
            preview.style.background = 'rgba(0,0,0,0.9)';
            preview.style.padding = '4px';
            preview.style.borderRadius = '4px';
            preview.style.maxWidth = '260px';
            preview.style.maxHeight = '260px';
            preview.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';

            const img = document.createElement('img');
            img.style.display = 'block';
            img.style.maxWidth = '100%';
            img.style.maxHeight = '250px';

            preview.appendChild(img);
            document.body.appendChild(preview);

            const hidePreview = () => {
                preview.style.display = 'none';
            };

            const positionPreview = (evt) => {
                const offset = 18;
                let x = evt.clientX + offset;
                let y = evt.clientY + offset;

                const vw = window.innerWidth;
                const vh = window.innerHeight;

                const estWidth = 260;
                const estHeight = 260;

                if (x + estWidth > vw) {
                    x = evt.clientX - estWidth - offset;
                }
                if (y + estHeight > vh) {
                    y = evt.clientY - estHeight - offset;
                }

                preview.style.left = `${x}px`;
                preview.style.top = `${y}px`;
            };

            const showPreview = (evt, src) => {
                if (!src) {
                    console.warn('[CA] installLogImageHoverPreview: no src found for image');
                    return;
                }
                img.src = src;
                positionPreview(evt);
                preview.style.display = 'block';
            };

            containers.forEach((container) => {
                // SHOW on hovering the thumbnail image
                container.addEventListener('mouseover', (evt) => {
                    const target = evt.target;
                    if (!target || !(target instanceof Element)) {
                        return;
                    }

                    const imgEl = target.closest('img.chat_image');
                    if (!imgEl) {
                        return;
                    }

                    showPreview(evt, imgEl.src);
                });

                // MOVE while hovering
                container.addEventListener('mousemove', (evt) => {
                    if (preview.style.display === 'none') {
                        return;
                    }
                    positionPreview(evt);
                });

                // HIDE when leaving the image
                container.addEventListener('mouseout', (evt) => {
                    const target = evt.target;
                    if (!target || !(target instanceof Element)) {
                        return;
                    }

                    // Only care when leaving the image itself
                    if (!target.closest('img.chat_image')) {
                        return;
                    }

                    // If we left the image -> hide
                    const related = evt.relatedTarget;
                    if (!related || !(related instanceof Element) || !related.closest('img.chat_image')) {
                        hidePreview();
                    }
                });
            });

            console.log('[CA] Log image hover preview installed');
        }


        /* Parse & render the private chat log for a given user */
        async caProcessPrivateLogResponse(uid, privateChatLogs) {
            if (!privateChatLogs.length) {
                console.log(`No new private chat logs for user ${uid}`);
                return;
            }

            const user = await this.UserStore.getOrFetch(String(uid));
            if (!user) {
                console.error('[caProcessPrivateLogResponse] Could not resolve user for uid:', uid);
                return;
            }

            let parsedDmInUpToLog = user.parsedDmInUpToLog;
            const initialFetch = parsedDmInUpToLog === 0;
            let newMessages = 0;
            let skipped = '';

            for (const privateChatLog of privateChatLogs) {
                const res = this.processSinglePrivateChatLog(privateChatLog, user, initialFetch, parsedDmInUpToLog);
                if (!res.accepted) {
                    skipped += `Skipped ${res.logId}: ${res.reason}\n`;
                    continue;
                } else {
                    console.log(`New message ${res.logId} for user ${uid}`, privateChatLog);
                }

                if (res.logId > parsedDmInUpToLog) {
                    parsedDmInUpToLog = res.logId;
                }

                newMessages++;
            }

            if (parsedDmInUpToLog > user.parsedDmInUpToLog) {
                this.UserStore.setParsedDmInUpToLog(uid, parsedDmInUpToLog);
                this.debug(`Set last read for user ${uid} to ${parsedDmInUpToLog}`);
            }

            if (skipped.length > 0) {
                console.log(skipped);
            }
        }

        async handleChatLogPlogs(plogs) {
            for (const privateChatLog of plogs) {
                const user = await this.UserStore.getOrFetch(privateChatLog.user_id);
                if (!user) {
                    console.error('[handleChatLogPlogs] Could not resolve user for uid:', privateChatLog.user_id);
                    continue;
                }

                const initialFetch = user.parsedDmInUpToLog === 0;
                this.verbose(`Processing new plog for user ${user.uid} (initial fetch: ${initialFetch})`);
                this.verbose(privateChatLog);
                const res = this.processSinglePrivateChatLog(privateChatLog, user, initialFetch, user.parsedDmInUpToLog);
                if (res.accepted) {
                    console.log(`New message ${res.logId} for user ${user.uid}`, privateChatLog);
                    this.UserStore.setParsedDmInUpToLog(user.uid, res.logId);
                } else {
                    console.log(`Private chat log ${privateChatLog.log_id} for user ${user.uid} was skipped. Reason: ${res.reason}`);
                }
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
                this.handleChatLogPlogs(data.plogs);
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

                const privateChatsToFetch = privateConversations
                    .filter(pc => pc.unread > 0)
                    .map(it => ({uid: String(it.uid), unread: Number(it.unread) || 0}));

                if (!privateChatsToFetch.length) {
                    console.log(this.LOG, 'None of the conversations has new messages');
                    return;
                }

                this.verbose(this.LOG, 'Fetching', privateChatsToFetch.length, 'conversation' + (privateChatsToFetch.length !== 1 ? 's' : ''), 'with new messages');

                (async () => {
                    for (const privateChat of privateChatsToFetch) {
                        console.log(this.LOG, 'Fetch private message for conversation', privateChat.uid, '— unread:', privateChat.unread);
                        const rawPrivateChatLogResponse = await this.fetchPrivateMessagesForUid(privateChat.uid, params);

                        if (!rawPrivateChatLogResponse || typeof rawPrivateChatLogResponse !== 'string' || rawPrivateChatLogResponse.trim() === '') {
                            console.warn(this.LOG, 'Empty response for conversation', privateChat.uid);
                            return;
                        }

                        const privateChatLogResponse = this.toPrivateChatLogResponse(JSON.parse(String(rawPrivateChatLogResponse)));

                        const privateChatLogs =
                            (Array.isArray(privateChatLogResponse?.pload) && privateChatLogResponse.pload.length ? privateChatLogResponse.pload :
                                (Array.isArray(privateChatLogResponse?.plogs) ? privateChatLogResponse.plogs : []));

                        await this.caProcessPrivateLogResponse(privateChat.uid, privateChatLogs);
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

                if (self.isChatLogUrl(this._ca_url) && sendArgs && sendArgs[0].length) {
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
                    } else if (this.status === 403) {
                        console.error(
                            `[PrivateSend] 403 error while fetching chat log. This is probably because of Cloudflare.\n
                            Uninstalling the network taps to prevent any more calls being done until the browser is manually refreshed.`,
                            responseUrl
                        );
                        self.openCloudflarePopup(responseUrl);
                        self.destroy();
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
                    return `<span class="${this.sel.log.classes.ca_log_text}">${text || 'Event'}</span>`;
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
                this.ui.sentMessagesBox,
                this.ui.receivedMessagesBox,
                this.ui.presenceBox,
                this.ui.unrepliedMessageBox,
                this.ui.repliedMessageBox,
                this.ui.loggingBox
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

            this.verbose('Log entry clicked:', entry);

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
                    const user = await this.UserStore.getOrFetch(uid);
                    console.log('Opening private with: ', uid, user.name, user.avatar);
                    this.applyLegacyAndOpenDm(user);
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

            if (!uid || !name || !avatar) {
                console.error('[applyLegacyAndOpenDm] Invalid arguments:', {uid, name, avatar});
                return;
            }

            if (uid) {
                this.setLastDmUid(uid);
            }

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
            const out = [];
            const loggedInFemaleUsers = this.UserStore.getAllLoggedInFemales();

            loggedInFemaleUsers.forEach((femaleUser) => {
                const uid = femaleUser.uid;

                // Rank filter
                if (!this._isAllowedRank(femaleUser.rank)) {
                    this.verbose('Skipping user:', uid, 'due to rank:', femaleUser.rank);
                    return;
                }

                // Skip if already replied
                if (this.ActivityLogStore.hasSentMessageToUser(uid)) {
                    console.log(`Skipping message to ${femaleUser.name} (already replied)`);
                    return;
                }

                let shouldInclude = !this.UserStore.isIncludedForBroadcast(uid);

                if (shouldInclude) {
                    out.push(femaleUser);
                }
            });

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

        /* ===================== BROADCAST (unified) ===================== */
        wireBroadcastButton() {
            // Rebind refs for popup controls
            this.ui.broadcastMessage = this.qs('#ca-bc-msg');
            this.ui.broadcastSendButton = this.qs('#ca-bc-send');

            if (!this.ui.broadcastSendButton) {
                console.error('[BROADCAST] Send button not found');
                return;
            }
            if (this.ui.broadcastSendButton._wired) {
                return;
            }
            this.ui.broadcastSendButton._wired = true;

            this.ui.broadcastSendButton.addEventListener('click', () => {
                const broadcastSendEl = this.ui.broadcastSendButton;
                const broadcastMsgEl = this.ui.broadcastMessage;

                const raw = (broadcastMsgEl && 'value' in broadcastMsgEl) ? broadcastMsgEl.value : '';
                const text = this.trim ? this.trim(raw) : String(raw || '').trim();

                if (!text) {
                    console.warn('[BROADCAST] Empty message, nothing to send');
                    return;
                }

                const broadcastReceiveList = this.buildBroadcastList();

                if (!broadcastReceiveList.length) {
                    this.logEventLine('[BROADCAST] No new recipients for this message (after exclusions/rank filter).');
                    return;
                }

                broadcastSendEl.disabled = true;

                this._runBroadcast(broadcastReceiveList, text)
                    .then(({ok, fail}) => {
                        this.logEventLine(`[BROADCAST] Done. Success: ${ok}, Failed: ${fail}.`);
                    })
                    .finally(() => {
                        broadcastSendEl.disabled = false;
                    });
            });
        }

        /**
         * Send a broadcast in batches with throttling.
         * Uses this.sendWithThrottle(uid, text).
         */
        async _runBroadcast(to, text) {
            const batchSize = 10;

            // ranges for random waits (ms)
            const secondsBetweenSends = [2000, 5000];
            const secondsBetweenBatches = [10000, 20000];

            const sleep = this.sleep
                ? (ms) => this.sleep(ms)
                : (ms) => new Promise(r => setTimeout(r, ms));

            let ok = 0, fail = 0;
            const numberOfBatches = Math.ceil(to.length / batchSize);
            for (let bi = 0; bi < numberOfBatches; bi++) {
                const start = bi * batchSize;
                const batch = to.slice(start, start + batchSize);
                this.logEventLine(`[BROADCAST] Batch ${bi + 1}/${numberOfBatches} — sending ${batch.length}... (OK:${ok} Fail:${fail})`);

                for (let idx = 0; idx < batch.length; idx++) {
                    const item = batch[idx];
                    const uid = item.uid;

                    // sendWithThrottle already handles per-send spacing (min gap)
                    const res = await this.sendWithThrottle(uid, text).catch((err) => {
                        console.error('[BROADCAST] sendWithThrottle error for uid', uid, err);
                        return {ok: false, status: 0};
                    });

                    if (res && res.ok) {
                        ok++;
                    } else {
                        fail++;
                    }

                    this.logEventLine(`[BROADCAST] Batch ${bi + 1}/${numberOfBatches} — ${idx + 1}/${batch.length} sent (OK:${ok} Fail:${fail})`);

                    // extra jitter between sends (on top of sendWithThrottle)
                    const perSendDelay = this.randBetween(secondsBetweenSends[0], secondsBetweenSends[1]);
                    await sleep(perSendDelay);
                }

                if (bi < numberOfBatches - 1) {
                    const wait = this.randBetween(secondsBetweenBatches[0], secondsBetweenBatches[1]);
                    this.logEventLine(`[BROADCAST] Batch ${bi + 1}/${numberOfBatches} done — waiting ${Math.round(wait / 1000)}s...`);
                    await sleep(wait);
                }
            }

            return {ok, fail};
        }

        /* ===================== USER CLICK SELECTION ===================== */
        wireUserClickSelection() {
            const c = this.getFemaleUsersContainer();
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

        _updateOrCreateUserElement(userEl, user) {
            const femaleUsersContainer = this.getFemaleUsersContainer();
            const existingUser = this.qs(`.user_item[data-id="${user.uid}"]`, femaleUsersContainer);

            if (existingUser) {
                existingUser.innerHTML = userEl.innerHTML;
                Array.from(userEl.attributes).forEach(attr => {
                    existingUser.setAttribute(attr.name, attr.value);
                });
                this.verbose('[_updateOrCreateUserElement] Updated existing user element for', user.uid, user.name);
                return existingUser
            }

            const userIemEl = userEl.cloneNode(true);
            femaleUsersContainer.appendChild(userIemEl);

            this.verbose('[_updateOrCreateUserElement] Created new user element for', user.uid, user.name);

            this.ensureDmLink(userIemEl, user);

            return userIemEl;
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
            if (html.includes('ca-hidden')) {
                console.error(`RESPONSE CONTAINS HIDDEN USER ITEMS!!`);
            }

            const context = this.isInitialLoad ? '[INITIAL]' : '[USER_LIST]';
            this.verbose(this.LOG, context, 'Processing user list response, length:', html.length);

            // Parse the HTML into a proper DOM structure
            const tempUserListReponseDiv = document.createElement('div');
            tempUserListReponseDiv.innerHTML = html;

            // Find all female users using proper DOM queries
            const users = this.qsa('.online_user .user_item', tempUserListReponseDiv);
            console.log(this.LOG, '[USER_LIST] Total users found:', users.length);

            if (users.length === 0) {
                console.error(`Something went wrong processing the user list. Skipping this round.`);
                return;
            }

            // Move/update female users to Female users container immediately
            let loggedInCount = 0;
            let updatedProfileCount = 0;
            let loggedOffCount = 0;
            let newMaleProfileCount = 0;
            let newFemaleProfileCount = 0;
            let totalMaleProfileCount = 0;
            let totalFemaleProfileCount = 0;

            const seenLoggedIn = new Set();

            const femaleUsersContainer = this.getFemaleUsersContainer();

            users.forEach(userEl => {
                // Extract user data from DOM
                const uid = this.getUserId(userEl);
                const name = this.extractUsername(userEl) || uid;
                const avatar = this.extractAvatar(userEl);
                const isFemale = userEl.getAttribute('data-gender') === this.FEMALE_CODE;
                const rank = this.extractRank(userEl);
                const isAllowedRank = this._isAllowedRank(rank);

                let user = this.UserStore.get(uid);
                let IsNewOrUpdatedProfile = false;
                seenLoggedIn.add(uid)

                if (!user) {
                    this.debug(this.LOG, `[USER_LIST] Adding non existing user ${uid}`);
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
                        rank
                    });

                    user.isFemale ? newFemaleProfileCount++ : newMaleProfileCount++;

                    if (newLogin && !this.isInitialLoad) {
                        loggedInCount++;
                        this.debug(this.LOG, `[LOGIN] ✅ ${user.name} (${user.uid}) logging in`);
                        if (isFemale) {
                            this.logLine('login', null, user);
                        }

                    }
                }

                if (user.isLoggedIn) {
                    user.isFemale ? totalFemaleProfileCount++ : totalMaleProfileCount++;
                }

                this.setLogDotsLoggedInStatusForUid(user.uid, user.isLoggedIn);

                if (isFemale && (this.isInitialLoad || IsNewOrUpdatedProfile)) {
                    const el = this._updateOrCreateUserElement(userEl, user);
                    if (!el || el.nodeType !== 1) {
                        console.error(`.user_item element not found for user ${uid}`);
                        return;
                    }

                    // Ensure UI elements for female users if rank allows
                    if (isAllowedRank) {
                        this.ensureBroadcastCheckbox(el, user.uid);
                    }

                    this.updateProfileChip(user.uid);
                    userEl.remove();
                    this.qs(`.user_item[data-id="${uid}"]`, this.ui.maleUsersContainer)?.remove();
                }
            });

            // Only try to remove nodes if it wasn't the initial load (after page reload, all nodes are readded)
            const currentlyLoggedIn = this.UserStore.getAllLoggedIn();
            for (let user of currentlyLoggedIn) {
                const uid = String(user.uid);
                if (seenLoggedIn.has(uid)) {
                    continue;
                }

                user = this.UserStore.setLoggedIn(uid, false);

                if (!this.isInitialLoad) {
                    this.debug(this.LOG, `[LOGOUT] ❌ ${user.name} (${user.uid}) logging out`);
                } else {
                    this.verbose(`[INIT] User ${user.name} (${user.uid}) initially logged out - no log entry`);
                }

                if (user.isFemale) {
                    if (!this.isInitialLoad) {
                        this.logLine('logout', null, user);
                        const elementToRemove = this.qs(`.user_item[data-id="${uid}"]`, femaleUsersContainer);
                        this.debug(`Removing element from female users container ${user.uid} (${user.name}) to logoff`);
                        if (elementToRemove) elementToRemove.remove();
                        else {
                            console.warn(`Couldn't remove user ${uid} from Female users container because the user is probably offline already.`);
                        }
                        this.setLogDotsLoggedInStatusForUid(uid, false);
                    }
                }

                loggedOffCount++;
            }

            console.log(
                `%c\n [USER_LIST]%c Summary: %c${loggedInCount} logged in%c, %c${newFemaleProfileCount} new female users added%c, ${newMaleProfileCount} male users added, %c${updatedProfileCount} updated%c, %c${loggedOffCount} users logged off%c, %c${this.UserStore.getFemalesLoggedInCount()} women online%c, %c${this.UserStore.getMalesLoggedInCount()} men online%c`,

                "color:#9cf",                   // 1
                "color:white",                 // 2
                "color:yellow",                // 3
                "color:white",                 // 4
                "color:#f99",                  // 5
                "color:white",                 // 6
                "color:#9f9",                  // 7
                "color:white",                 // 8
                "color:#aaa",                  // 9
                "color:white",                 // 10
                "color:#ff55ff",               // 11 (women count)
                "color:white",                 // 12
                "color:#55aaff",               // 13 (men count)
                "color:white"
            );


            this.updateMaleUsersCount(totalMaleProfileCount);
            this.updateFemaleUserCount(totalFemaleProfileCount);

            tempUserListReponseDiv.innerHTML = '';
            this.isInitialLoad = false;
        }

        setLogDotsLoggedInStatusForUid(uid, isLoggedIn) {
            // Select all log dots for this UID
            const selector = `.ca-log-entry[data-uid="${uid}"] ${this.sel.log.classes.ca_log_dot}`;
            const logDots = this.qsa(selector, this.ui.panel);

            // Apply correct class based on login state
            logDots.forEach(dot => {
                if (isLoggedIn) {
                    dot.classList.remove(this.sel.raw.log.classes.ca_log_dot_red);
                    dot.classList.add(this.sel.raw.log.classes.ca_log_dot_green);
                    dot.title = "Online";
                } else {
                    dot.classList.remove(this.sel.raw.log.classes.ca_log_dot_green);
                    dot.classList.add(this.sel.raw.log.classes.ca_log_dot_red);
                    dot.title = "Offline";
                }
            });
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
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body
                }).then(res => res.text().then(response => {
                    let jsonResponse = JSON.parse(String(response));
                    let data = this.toPrivateSendResponse(jsonResponse);

                    if (!data || data.code !== 1) {
                        console.error(`[PrivateSend] Could not parse response from native message send:`, data);
                        return {ok: false, status: res.status, body: jsonResponse || response};
                    }

                    this.processPrivateSendResponse(data, String(target));
                    return {ok: res.ok, status: res.status, body: jsonResponse || response};
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
                    'X-Requested-With': 'XMLHttpRequest'
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

        findFemaleUserById(uid) {
            if (!uid) {
                console.error(`.findUserElementById: id is empty`);
                return null;
            }

            const el = this.qs(`.user_item[data-id="${uid}"]`, this.getFemaleUsersContainer());
            if (el) {
                return el;
            }
        }

        /* ---------- Sent chip & badges ---------- */
        updateProfileChip(uid) {
            const unreadReceivedMessagesCount = this.ActivityLogStore.getUnreadReceivedMessageCountByUserUid(uid);
            const sentMessagesCount = this.ActivityLogStore.getAllSentMessagesCountByUserId(uid);
            const userEl = this.findFemaleUserById(uid);
            this.verbose('Updating profile chip for:', userEl, unreadReceivedMessagesCount, sentMessagesCount);

            if (!userEl) {
                console.warn('updateProfileChip: user element not found for uid:', uid);
                console.warn('This is probably because the user is not online anymore.');
                return;
            }

            const container = userEl.parentElement;
            if (!container) {
                console.error('updateProfileChip: container not found for uid:', uid);
                return;
            }

            // Unread messages → move to top
            if (unreadReceivedMessagesCount > 0) {
                this.verbose('Adding unread sent chip to user:', uid, ', unread received messages count: ', unreadReceivedMessagesCount, ', sent messages count: ', sentMessagesCount);
                const chip = this._createChipForUserItem(userEl);

                userEl.classList.remove(this.sel.raw.log.classes.ca_replied_messages);
                userEl.classList.add(this.sel.raw.log.classes.ca_unread_messages);

                chip.classList.add(this.sel.raw.log.classes.ca_sent_chip_unread);
                chip.classList.remove(this.sel.raw.log.classes.ca_sent_chip_all_read);
                chip.textContent = `${unreadReceivedMessagesCount}`;

                // Unread must always be visible
                userEl.style.display = '';

                if (container.firstElementChild !== userEl) {
                    container.insertBefore(userEl, container.firstElementChild);
                }

                // All read (✓) → move to bottom
            } else if (unreadReceivedMessagesCount === 0 && sentMessagesCount > 0) {
                this.verbose(
                    'Adding all read chip to user:',
                    uid,
                    ', unread received messages count: ',
                    unreadReceivedMessagesCount,
                    ', sent messages count: ',
                    sentMessagesCount
                );

                const chip = this._createChipForUserItem(userEl);

                userEl.classList.add(this.sel.raw.log.classes.ca_replied_messages);
                userEl.classList.remove(this.sel.raw.log.classes.ca_unread_messages);

                chip.classList.add(this.sel.raw.log.classes.ca_sent_chip_all_read);
                chip.classList.remove(this.sel.raw.log.classes.ca_sent_chip_unread);
                chip.textContent = '✓';// 🔑 Respect the “Hide replied users” checkbox every time
                // Respect "hide replied" state
                userEl.style.display = this.hideRepliedUsers ? 'none' : '';

                // --- Move user to bottom of container ---
                this.debug('Moving user to bottom of container:', uid);
                container.insertBefore(userEl, this.qs('.user_item[data-rank="0"]', container) || container.lastElementChild);

            } else {
                userEl.classList.remove(this.sel.raw.log.classes.ca_unread_messages);
                this.qs(this.sel.raw.log.classes.ca_sent_chip, userEl)?.remove();
                this.debug('Removing sent chip from user:', uid);
            }

        }

        _createChipForUserItem(userEl) {
            let chip = userEl.querySelector(this.sel.log.classes.ca_sent_chip);

            if (!userEl.classList.contains('chataddons-sent')) {
                userEl.classList.add('chataddons-sent');
                this.verbose('Adding sent chip to user:', userEl.getAttribute('data-id'));
            }

            if (!chip) {
                chip = document.createElement('span');
                chip.classList.add(this.sel.raw.log.classes.ca_sent_chip);
                userEl.appendChild(chip);
                this.verbose('Created sent chip for user:', userEl);
            }
            return chip;
        }

        ensurePopup({id, title, bodyHtml}) {
            if (!id) {
                console.error('[321ChatAddons] ensurePopup called without id');
                return null;
            }

            let pop = document.getElementById(id);
            if (pop) {
                return pop;
            }

            pop = document.createElement('div');
            pop.id = id;
            pop.className = 'ca-pop';
            pop.style.display = 'none';

            pop.innerHTML =
                '<div class="ca-pop-header">' +
                '  <span class="ca-pop-title"></span>' +
                '  <button class="ca-pop-close" type="button">✕</button>' +
                '</div>' +
                '<div class="ca-pop-body"></div>';

            document.body.appendChild(pop);

            const titleEl = pop.querySelector('.ca-pop-title');
            if (titleEl && typeof title === 'string') {
                titleEl.textContent = title;
            }

            const bodyEl = pop.querySelector('.ca-pop-body');
            if (bodyEl && typeof bodyHtml === 'string') {
                bodyEl.innerHTML = bodyHtml;
            }

            return pop;
        }

        showPopup(id) {
            const pop = document.getElementById(id);
            if (!pop) {
                console.error('[321ChatAddons] showPopup: popup not found:', id);
                return;
            }

            pop.style.display = 'block';
            pop.style.position = 'fixed';
            pop.style.zIndex = '2147483647';
        }

        openCloudflarePopup() {
            const bodyHtml =
                '<p style="margin-bottom:8px;">' +
                '  Cloudflare is blocking the chat requests (HTTP 403).<br>' +
                '  Please refresh the page to continue.' +
                '</p>' +
                '<div id="ca-cloudflare-url" class="ca-status" style="margin-bottom:8px;"></div>' +
                '<button id="ca-cloudflare-refresh" class="ca-btn ca-btn-slim" type="button">Refresh page</button>';

            const pop = this.ensurePopup({
                id: 'ca-cloudflare-pop',
                title: 'Connection issue',
                bodyHtml
            });

            // Wire refresh button once
            const refreshBtn = pop.querySelector('#ca-cloudflare-refresh');
            refreshBtn.addEventListener('click', () => {
                window.location.reload();
            });

            this.showPopup('ca-cloudflare-pop');
        }

        /* ---------- Rank filter & selection checkbox ---------- */
        extractRank(el) {
            if (!el) {
                console.error('[321ChatAddons] extractRank: element not found');
                return null;
            }
            return el.getAttribute('data-rank') || '';
        }

        /* ---------- Rank filter & selection checkbox ---------- */
        _isAllowedRank(rank) {
            return (rank === '1' || rank === '50') && (roomRank !== '4');
        }

        // more descriptive and self-contained
        ensureBroadcastCheckbox(el, uid) {
            if (this.qs('.ca-ck-wrap', el)) {
                return;    // already has one
            }
            if (!this._isAllowedRank?.(el)) {
                return;
            }

            this._isMakingOwnChanges = true;

            const wrap = document.createElement('label');
            wrap.className = 'ca-ck-wrap';
            wrap.title = 'Include in broadcast';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'ca-ck';

            cb.checked = this.UserStore.isIncludedForBroadcast(uid);

            wrap.appendChild(cb);

            this.qs('.user_item_data', el).prepend(wrap);

            // (optional) event hookup here if you don’t already wire at container level
            cb.addEventListener('change', (e) => this.handleCheckboxChange?.(e, uid, el));
        }

        ensureDmLink(el, user) {
            const target = this.qs('.user_item_data', el) || el;

            const dmLink = document.createElement('a');
            dmLink.href = '#';
            dmLink.className = 'ca-dm-from-userlist ca-log-action';
            dmLink.title = 'Open direct message';
            dmLink.setAttribute('data-action', 'open-dm');

            dmLink.appendChild(this.renderSvgIconWithClass(
                'lucide lucide-mail',
                `<rect x="3" y="5" width="18" height="14" rx="2" ry="2"></rect>
         <polyline points="3 7,12 13,21 7"></polyline>`
            ));

            dmLink.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.applyLegacyAndOpenDm(user);
            });

            target.appendChild(dmLink);
        }

        handleCheckboxChange(e, uid /*, el */) {
            const include = !!e?.target?.checked;
            this.UserStore?.includeUserForBroadcast?.(uid, include);
            this.debug?.(`[BC] isIncludedForBroadcast → uid=${uid}, include=${include}`);
        }

        /* ---------- Panel UI ---------- */
        appendAfterMain(el) {
            const main = document.querySelector(this.sel.users.chatRight) || document.querySelector(this.sel.users.containerUser) || document.body;
            if (main && main.parentElement) main.parentElement.appendChild(el); else document.body.appendChild(el);
        }

        buildMenuLogPanel() {
            const mount = document.querySelector('#my_menu .bcell_mid');
            mount.innerHTML = "";
            if (!mount) {
                console.error('[CA] #my_menu .bcell_mid not found — cannot create menu panel');
                return;
            }

            // avoid duplicating if we already built it
            const menuPanelEl = document.getElementById('ca-menu-panel');

            if (menuPanelEl) {
                return;
            }

            // build a compact panel shell that reuses .ca-panel styling
            const panel = document.createElement('section');
            panel.id = 'ca-menu-panel';
            panel.className = 'ca-panel ca-mini';

            panel.innerHTML = `
    <div class="ca-body">
      <div class="ca-section ca-section-compact">
        <div class="ca-log-dual">
          <div class="ca-section ca-log-section">
                  <div class="ca-section-title">
                    <span>Logon/Logoff</span>
                     <span class="clear-logs"
                            data-kinds="login,logout"
                            role="button" tabindex="0">Clear</span>
                      
                  </div>
                  <div id="${this.sel.raw.log.presence}"
                       class="ca-log-box ${this.sel.raw.log.classes.ca_box_scrollable}"
                       aria-live="polite"></div>
                </div>
                 <div class="ca-section ca-log-section">
              <div class="ca-section-title">
                <span>Logs</span>
                  <span class="clear-logs"
                    data-kinds="event"
                    role="button" tabindex="0">Clear</span>
              </div>
              <div id="${this.sel.raw.log.general}"
                   class="ca-log-box ${this.sel.raw.log.classes.ca_box_scrollable}"
                   aria-live="polite"></div>
            </div>
        </div>
      </div>
    </div>
  `;

            mount.appendChild(panel);

            const rListEl = this.qs('#rlist_open');
            const logDualEl = this.qs('.ca-log-dual');
            logDualEl.appendChild(rListEl);

            // Re-attach any element-level handlers in case the site rewired after a DOM move
            if (typeof this._attachLogClickHandlers === 'function') {
                this._attachLogClickHandlers();
            }
        }

        buildSvgIconString(className, svgInnerHTML, small = true) {
            return `<svg class="${className} ${small ? 'svg-small' : 'svg-large'}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            ${svgInnerHTML}
        </svg>`;
        }

        renderSvgIconWithClass(className, svgInnerHTML, small = true) {
            const wrapper = document.createElement('div');

            wrapper.innerHTML = this.buildSvgIconString(className, svgInnerHTML, small);

            // return the <svg> element itself instead of the wrapper
            return wrapper.firstElementChild;
        }

        buildPanel() {
            const h = document.createElement('section');
            h.id = this.sel.raw.rightPanel;
            h.classList.add('ca-panel');
            h.id = this.sel.raw.rightPanel;
            h.classList.add('ca-panel');
            h.innerHTML = `
             <div class="ca-body">
              <div class="ca-nav">
            
                <!-- BROADCAST: megafoon -->
                <a id="ca-nav-bc"
                   data-action="broadcast"
                   href="#"
                   class="ca-dm-link ca-dm-right ca-log-action"
                   title="Broadcast message">
                  ${this.buildSvgIconString("lucide lucide-triangle-right",
                `<path d="M3 10v4c0 .55.45 1 1 1h1l4 5v-16l-4 5h-1c-.55 0-1 .45-1 1zm13-5l-8 5v4l8 5v-14zm2 4h3v6h-3v-6z"/>`, false)}
                </a>
            
                <!-- SEND SPECIFIC: pijltje -->
                <a id="ca-nav-specific"
                   href="#"
                   data-action="send-message"
                   class="ca-dm-link ca-dm-right ca-log-action ca-log-action-filled"
                   title="Send specific message">
                  ${this.buildSvgIconString("lucide lucide-triangle-right",
                `<path d="M8 4l12 8-12 8V4z"></path>`, false)}
                </a>
            
                <!-- CLEAR LOGS: prullenbak -->
                <a id="${this.sel.raw.log.clear}"
                   href="#"
                   data-action="clear-all-logs"
                   class="ca-dm-link ca-dm-right ca-log-action"
                   title="Clear logs">
                    ${this.buildSvgIconString("lucide lucide-triangle-right",
                `<g transform="translate(0,-1)">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
        </g>`, false)}
                </a>
            
                <!-- STORAGE TOGGLE: LS aan/uit -->
                <a id="ca-nav-storage-toggle"
                   href="#"
                   class="ca-dm-link ca-dm-right ca-log-action"
                   data-action="storage-toggle"
                   title="">
                </a>
            
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
                  <div class="ca-section-title">
                      <span>Sent Messages</span>
                      <span class="clear-logs" data-kinds="dm-out" role="button" tabindex="0">Clear</span>
                  </div>
                  <div id="${this.sel.raw.log.sent}"
                       class="ca-log-box ca-log-box-compact ${this.sel.raw.log.classes.ca_box_scrollable}"
                       aria-live="polite"></div>
                </div>
            
                <hr class="ca-divider">
            
                <div class="ca-section ca-section-expand">
                  <div class="ca-section-title">
                    <span>Received Messages</span>
                      <span class="clear-logs"
                            data-kinds="dm-in"
                            data-rebuild="received"
                            role="button" tabindex="0">Clear</span>
                  </div>
                  <div id="${this.sel.raw.log.received}" 
                       class="ca-log-box ca-log-box-expand"
                       aria-live="polite">
                    <div class="ca-log-subsection-unreplied-wrapper">
                      <div class="ca-log-subsection-header">Not Replied</div>
                      <div id="${this.sel.raw.log.unreplied}"
                            class="${this.sel.raw.log.classes.ca_box_scrollable}">
                           </div>
                    </div>
                    <div class="ca-log-subsection-replied-wrapper">
                      <div class="ca-log-subsection-header">Replied</div>
                      <div id="${this.sel.raw.log.replied}"
                            class="${this.sel.raw.log.classes.ca_box_scrollable}">
                      </div>
                    </div>
                  </div>
                </div>
              </div>`;


            this.appendAfterMain(h);
            this.ui.panel = h;
            this.ui.panelNav = h.querySelector('.ca-nav');
            this._wirePanelNav();
        }

        _updateStorageToggleUi() {
            const el = document.getElementById('ca-nav-storage-toggle');
            if (!el) {
                console.error('[CA] _updateStorageToggleUi: #ca-nav-storage-toggle not found');
                return;
            }

            const mode = this.NO_LS_MODE || 'allow';
            el.dataset.storageMode = mode;

            let title;
            let svgEl;

            if (mode === 'block') {
                // disabled: database with cross
                title = 'Storage disabled (click to cycle: allow / wipe)';
                svgEl = this.renderSvgIconWithClass("lucide lucide-database",
                    `<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"></path>
            <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"></path>
            <path d="M6 7l12 12"></path>
            <path d="M18 7L6 19"></path>`, false);

            } else if (mode === 'wipe') {
                // wipe-on-load: database with trash
                title = 'Storage wipe on load (click to cycle: block / allow)';
                svgEl = this.renderSvgIconWithClass("lucide lucide-database-trash",
                    `<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"></path>
            <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"></path>
            <!-- trash can inside -->
            <rect x="8" y="10" width="8" height="9" rx="1"></rect>
            <line x1="10" y1="10" x2="10" y2="8"></line>
            <line x1="14" y1="10" x2="14" y2="8"></line>
            <line x1="9"  y1="13" x2="9"  y2="17"></line>
            <line x1="12" y1="13" x2="12" y2="17"></line>
            <line x1="15" y1="13" x2="15" y2="17"></line>`, false);
            } else {
                // allow = normal storage icon
                title = 'Storage enabled (click to cycle: wipe / block)';
                svgEl = this.renderSvgIconWithClass("lucide lucide-database",
                    `<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"></path>
            <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"></path>`, false);
            }

            el.title = title;
            el.replaceChild(svgEl, el.firstChild);
        }

        handleStorageToggleClick() {
            const prevMode = this.NO_LS_MODE || 'allow';
            let nextMode;

            if (prevMode === 'allow') {
                nextMode = 'wipe';
            } else if (prevMode === 'wipe') {
                nextMode = 'block';
            } else {
                nextMode = 'allow';
            }

            this.NO_LS_MODE = nextMode;
            this._writeStorageMode(this.NO_LS_MODE);

            // Rebind Store to new backend for 'block'/'allow' immediately
            this.Store = new KeyValueStore({
                storage: this._chooseStorage(this.NO_LS_MODE)
            });

            this._updateStorageToggleUi();
            this.logEventLine(`Storage mode set to ${this.NO_LS_MODE} at ${this.timeHHMM()}`);
        }


        _wirePanelNav() {
            this.ui.panelNav.addEventListener('click', (e) => {
                const link = e.target.closest('.ca-dm-link[data-action]');
                if (!link) {
                    return;
                }

                const action = String(link.dataset.action || '').toLowerCase();

                // Only prevent default for our own actions
                e.preventDefault();

                switch (action) {
                    case 'broadcast':
                        this.verbose(this.LOG, 'Nav: broadcast clicked');
                        this.openBroadcastModal();
                        break;

                    case 'send-message':
                        this.verbose(this.LOG, 'Nav: send-specific clicked');
                        this.openSendMessageModal();
                        break;

                    case 'clear-all-logs':
                        this.verbose(this.LOG, 'Nav: clear-all-logs clicked');
                        this.handleLogClear();
                        break;

                    case 'storage-toggle':
                        this.verbose(this.LOG, 'Nav: storage-toggle clicked');
                        this.handleStorageToggleClick();
                        break;

                    default:
                        console.warn('[CA] _wirePanelNav: unhandled data-action:', action);
                        break;
                }
            });
        }

        handleLogClear() {
            this.ui.sentMessagesBox.innerHTML = '';
            this.ui.unrepliedMessageBox.innerHTML = '';
            this.ui.repliedMessageBox.innerHTML = '';
            this.ui.loggingBox.innerHTML = '';

            const removedIn = this.ActivityLogStore.clearByKind('dm-in') || 0;
            const removedOut = this.ActivityLogStore.clearByKind('dm-out') || 0;
            const removedFail = this.ActivityLogStore.clearByKind('send-fail') || 0;
            const removedEvents = this.ActivityLogStore.clearByKind('event') || 0;
            const removedLogin = this.ActivityLogStore.clearByKind('login') || 0;
            const removedLogout = this.ActivityLogStore.clearByKind('logout') || 0;

            console.log(`[LOG] Global clear removed: in=${removedIn}, out=${removedOut}, fail=${removedFail}, event=${removedEvents}, login=${removedLogin}, logout=${removedLogout}`);
            this.logEventLine(`Logs cleared at ${this.timeHHMMSS()}`);
        }

        createMaleUsersContainer() {
            const wrapper = document.createElement('div');
            wrapper.id = this.sel.raw.users.maleUsersWrapper;
            wrapper.className = 'ca-user-list-container ca-expanded';

            const header = document.createElement('div');
            header.className = 'ca-user-list-header';

            header.innerHTML = `
        <div class="ca-user-list-title">
            <span class="ca-user-list-count" id="${this.sel.raw.users.maleUserCount}">0</span>
            <span>Male Users</span>
            <div class="ca-user-list-toggle">▼</div>
        </div>
    `;

            wrapper.appendChild(header);

            // CONTENT
            const content = document.createElement('div');
            content.className = 'ca-user-list-content';

            const chatRight = document.createElement('div');
            chatRight.id = 'ca-male-managed-chat-right';
            chatRight.className = 'crheight';

            const container = document.createElement('div');
            container.id = 'ca-male-managed-user-container';
            container.className = 'pad10';

            const onlineWrapper = document.createElement('div');
            onlineWrapper.className = 'online_user vpad5';

            container.appendChild(onlineWrapper);
            chatRight.appendChild(container);
            chatRight.appendChild(Object.assign(document.createElement("div"), {className: "clear"}));
            content.appendChild(chatRight);

            wrapper.appendChild(content);

            this.qs('#chat_right')?.appendChild(wrapper)

            this.ui.maleManagedContainer = wrapper;
            this.ui.maleManagedUserContainer = onlineWrapper;

            console.log('[CA] Created managed male users container');
        }


        createFemaleUsersContainer() {
            let femaleUsersWrapper = this.qs(`${this.sel.users.femaleUsersWrapper}`);
            const chatRight = this.qs('#chat_right');

            femaleUsersWrapper = document.createElement('div');
            femaleUsersWrapper.id = this.sel.raw.users.femaleUsersWrapper;
            femaleUsersWrapper.className = 'ca-user-list-container ca-expanded';

            // ----- HEADER -----
            const header = document.createElement('div');
            header.className = 'ca-user-list-header ca-female-users-header';

            const title = document.createElement('div');
            title.className = 'ca-user-list-title';

            const countSpan = document.createElement('span');
            countSpan.className = 'ca-user-list-count';
            countSpan.id = this.sel.raw.users.femaleUserCount;
            countSpan.textContent = '0';

            const labelSpan = document.createElement('span');
            labelSpan.textContent = 'Female Users';

            const toggle = document.createElement('div');
            toggle.className = 'ca-user-list-toggle';
            toggle.textContent = '▼';

            title.appendChild(countSpan);
            title.appendChild(labelSpan);
            title.appendChild(toggle);

            const sub = document.createElement('div');
            sub.className = 'ca-subrow';
            sub.innerHTML = `
        <label>
            <input id="ca-female-ck-toggle" type="checkbox" />
            <span>Show selection boxes</span>
        </label>
        <label style="margin-left: 8px;">
            <input id="ca-female-hide-replied" type="checkbox" />
            <span>Hide replied users</span>
        </label>
    `;

            header.appendChild(title);
            header.appendChild(sub);

            // ----- CONTENT -----
            const femaleUsersContent = document.createElement('div');
            femaleUsersContent.className = 'ca-user-list-content';

            const clonedChatRight = document.createElement('div');
            clonedChatRight.id = 'ca-female-uses-chat-right-data'; // keep your original id
            clonedChatRight.className = 'crheight';

            const clonedContainerUser = document.createElement('div');
            clonedContainerUser.id = 'ca-female-user-container';
            clonedContainerUser.className = 'pad10';

            const onlineWrapper = document.createElement('div');
            onlineWrapper.className = 'online_user vpad5';
            clonedContainerUser.appendChild(onlineWrapper);

            const clearDiv = document.createElement('div');
            clearDiv.className = 'clear';

            clonedChatRight.appendChild(clonedContainerUser);
            clonedChatRight.appendChild(clearDiv);
            femaleUsersContent.appendChild(clonedChatRight);

            femaleUsersWrapper.appendChild(header);
            femaleUsersWrapper.appendChild(femaleUsersContent);

            chatRight.appendChild(femaleUsersWrapper);

            this.ui.femaleUsersContainer = femaleUsersWrapper;

            const ckToggle = sub.querySelector('#ca-female-ck-toggle');
            if (ckToggle) {
                ckToggle.checked = false;
                femaleUsersWrapper.classList.remove('ca-show-ck');

                ckToggle.addEventListener('change', (e) => {
                    const checked = !!e.target.checked;
                    femaleUsersWrapper.classList.toggle('ca-show-ck', checked);
                    console.log('[CA] Female user checkbox visibility:', checked ? 'shown' : 'hidden');
                });
            }

            const hideRepliedToggle = sub.querySelector('#ca-female-hide-replied');
            if (hideRepliedToggle) {
                const hide = !!this.hideRepliedUsers;
                hideRepliedToggle.checked = hide;
                this.applyHideRepliedUsers(hide);

                hideRepliedToggle.addEventListener('change', (e) => {
                    const hide = !!e.target.checked;
                    console.log('[CA] Hide replied users:', hide);

                    this.hideRepliedUsers = hide;
                    localStorage.setItem(this.HIDE_REPLIED_USERS_KEY, String(hide));
                    if (this.Store) {
                        this.Store.set(this.HIDE_REPLIED_USERS_KEY, hide);
                    }

                    this.applyHideRepliedUsers(hide);
                });
            } else {
                console.error('.ca-female-hide-replied not found');
            }

            this.verbose(this.LOG, 'Created female users container without cloning male users wrapper');

            this.wireUserClickSelection();
            this.wireListOptionClicks();
            this.updateMaleUsersCount();
        }

        applyHideRepliedUsers(hide) {
            const repliedEls = this.qsa(`${this.sel.log.classes.user_item}${this.sel.log.classes.ca_replied_messages}`, this.getFemaleUsersContainer());

            repliedEls.forEach((el) => {
                el.style.display = hide ? 'none' : '';
            });
        }

        _setExpanded(wrapper, expanded) {
            if (!wrapper) {
                console.error('[CA] _setExpanded: wrapper missing');
                return;
            }
            wrapper.classList.toggle('ca-expanded', !!expanded);
            wrapper.classList.toggle('ca-collapsed', !expanded);
        }

        _isStaffListView() {
            // Try a few likely title holders; fallback to document.title
            const titleEl =
                document.querySelector('#menu_title, .menu_title, .title, .btitle, #page_title, .page_title') ||
                null;
            const txt = String((titleEl && titleEl.textContent) || document.title || '').trim().toLowerCase();
            return txt.includes('staff list');
        }

        _setHeadersVisible(visible) {
            const headers = document.querySelectorAll('.ca-user-list-header');
            headers.forEach(h => {
                h.style.display = visible ? '' : 'none';
            });
        }

        wireListOptionClicks() {
            const friendsBtn = document.querySelector('#friends_option');
            const usersBtn = document.querySelector('#users_option');
            const searchBtn = document.querySelector('#search_option');

            const defer = (fn) => requestAnimationFrame(() => setTimeout(fn, 0));

            const expandMaleUsersCollapsed = () => {
                this._setExpanded(document.querySelector(this.sel.raw.users.maleUsersWrapper), true);
                this._setExpanded(document.querySelector(this.sel.raw.users.femaleUsersWrapper), false);
            };

            const expandMFemaleUsersCollapse = () => {
                this._setExpanded(document.querySelector(this.sel.raw.users.femaleUsersWrapper), true);
                this._setExpanded(document.querySelector(this.sel.raw.users.maleUsersWrapper), false);
            };

            [friendsBtn, searchBtn].forEach(btn => {
                if (!btn || btn._caWired) return;
                btn._caWired = true;
                btn.addEventListener('click', () => {
                    defer(() => {
                        expandMaleUsersCollapsed();
                        this._setHeadersVisible(false);
                    });
                });
            });

            if (usersBtn && !usersBtn._caWired) {
                usersBtn._caWired = true;
                usersBtn.addEventListener('click', () => {
                    defer(() => {
                        if (this._isStaffListView()) {
                            expandMaleUsersCollapsed();
                            this._setHeadersVisible(false);
                        } else {
                            expandMFemaleUsersCollapse();
                            this._setHeadersVisible(true);
                        }
                    });
                });
            }
        }


        wireExclusiveCollapse(maleUsersWrapper, femaleUsersWrapper) {
            if (!maleUsersWrapper || !femaleUsersWrapper) {
                console.error('[CA] wireExclusiveCollapse: wrappers missing');
                return;
            }

            const pairs = [
                {wrapper: maleUsersWrapper, other: femaleUsersWrapper},
                {wrapper: femaleUsersWrapper, other: maleUsersWrapper}
            ];

            const setExpanded = (el, expanded) => {
                el.classList.toggle('ca-expanded', !!expanded);
                el.classList.toggle('ca-collapsed', !expanded);
            };

            const onHeaderClick = (clicked, other) => () => {
                const willExpand = !clicked.classList.contains('ca-expanded');
                setExpanded(clicked, willExpand);
                if (willExpand && other) setExpanded(other, false);
            };

            for (const {wrapper, otherWrapperEl} of pairs) {
                const header = wrapper.querySelector('.ca-user-list-header .ca-user-list-title');
                if (!header || header._caWired) continue;
                header._caWired = true;
                header.addEventListener('click', onHeaderClick(wrapper, otherWrapperEl));
            }

            if (!maleUsersWrapper.classList.contains('ca-expanded') &&
                !femaleUsersWrapper.classList.contains('ca-expanded')) {
                setExpanded(maleUsersWrapper, true);
                setExpanded(femaleUsersWrapper, false);
            }
        }


        updateFemaleUserCount(count) {
            console.log('Updating female user count:', count);
            const headerCounter = this.qs(this.sel.users.femaleUserCount);
            headerCounter.textContent = `${count}`;
        }

        updateMaleUsersCount(count) {
            const headerCounter = this.qs(this.sel.users.maleUserCount);
            headerCounter.textContent = `${count}`;
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

            const popBodyEl = pop.querySelector('.ca-pop-body');
            if (popBodyEl) {
                this.createPredefinedMessagesBar({
                    container: popBodyEl,
                    messageBarName: 'ca-predefined-messages-select-broadcast',
                    targetSelector: '#ca-bc-msg',
                    appendAtStart: true
                });
            } else {
                console.error('[CA] createBroadcastPopup: .ca-pop-body not found');
            }

            const closeBtn = pop.querySelector('#ca-bc-pop-close');
            if (closeBtn) closeBtn.addEventListener('click', () => {
                pop.style.display = 'none';
            });

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

        openSendMessageModal() {
            const pop = this.createSpecificPopup();
            this.verbose(this.LOG, 'Specific popup element:', pop);
            if (pop) {
                // Ensure it's visible and styled as modal
                pop.style.display = 'block';
                pop.style.position = 'fixed';
                pop.style.zIndex = '2147483647';
                console.log(this.LOG, 'Set popup display to block, current display:', pop.style.display);
                if (!this.openSendMessageModal._wired) {
                    this.wireSpecificControls();
                    this.openSendMessageModal._wired = true;
                }
            } else {
                console.error(this.LOG, 'Failed to create specific popup');
            }
        }

        wireSpecificControls() {
            // Rebind specific refs to popup controls
            this.ui.sendPrivateMessageUser = this.qs(this.sel.specificPop.username);
            this.ui.sendPrivateMessageText = this.qs(this.sel.specificPop.msg);
            this.ui.sendPrivateMessageButton = this.qs(this.sel.specificPop.send);
        }

        openBroadcastModal() {
            console.log(this.LOG, 'openBroadcast() called');
            const pop = this.createBroadcastPopup();
            console.log(this.LOG, 'Broadcast popup element:', pop);
            if (pop) {
                // Ensure it's visible and styled as modal
                pop.style.display = 'block';
                pop.style.position = 'fixed';
                pop.style.zIndex = '2147483647';
                console.log(this.LOG, 'Set popup display to block, current display:', pop.style.display);
                if (!this.openBroadcastModal._wired) {
                    this.wireBroadcastButton();
                    this.openBroadcastModal._wired = true;
                }
            } else {
                console.error(this.LOG, 'Failed to create broadcast popup');
            }
        }

        _bindStaticRefs() {
            // specific send controls are now only in the modal popup, not in the panel
            // They will be bound when the modal is opened via wireSpecificControls()

            // logs
            this.ui.sentMessagesBox = this.qs(this.sel.log.sent);
            this.ui.receivedMessagesBox = this.qs(this.sel.log.received);
            this.ui.repliedMessageBox = this.qs(this.sel.log.replied);
            this.ui.unrepliedMessageBox = this.qs(this.sel.log.unreplied);
            this.ui.presenceBox = this.qs(this.sel.log.presence);
            this.ui.logClear = this.qs(this.sel.log.clear);

            // debug checkbox
            this.ui.debugCheckbox = this.qs(this.sel.debug.checkbox);
            this.ui.verboseCheckbox = this.qs(this.sel.debug.verboseCheckbox);

            this.ui.femaleUsersContainer = this.qs(this.sel.users.femaleUsers);
            this.ui.femaleUSersCount = this.qs(this.sel.users.femaleUserCount);
            this.ui.maleUsersWrapper = this.qs(this.sel.users.maleUsersWrapper);
            this.ui.maleUsersCount = this.qs(this.sel.users.maleUserCount);

            this.ui.loggingBox = this.qs(this.sel.log.general);
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

// Maps log kinds to the UI boxes that should be emptied.
        _boxesForKinds(kinds) {
            const boxes = new Set();

            const hasOut = kinds.includes('dm-out');
            const hasIn = kinds.includes('dm-in');
            const hasEvt = kinds.includes('event');
            const hasPresence = kinds.includes('login') || kinds.includes('logout');

            if (hasOut) {
                boxes.add(this.ui.sentMessagesBox);
            }

            if (hasIn) {
                // Received: just clear the inner sub-boxes; do NOT rebuild the outer structure.
                boxes.add(this.ui.unrepliedMessageBox);
                boxes.add(this.ui.repliedMessageBox);
            }

            if (hasPresence) {
                boxes.add(this.ui.presenceBox);
            }

            if (hasEvt) {
                boxes.add(this.ui.loggingBox);
            }

            return Array.from(boxes);
        }

        _wireLogClear() {
            // --- Per-section Clear (kind-driven; no rebuilds, no selectors) ---
            const buttons = this.qsa('.ca-section-title .clear-logs', document);

            if (!buttons || buttons.length === 0) {
                console.warn('[LOG] No per-section clear buttons found (.clear-logs)');
                return;
            }

            buttons.forEach((btn) => {
                if (btn._caClearWired) return;
                btn._caClearWired = true;

                const handle = (e) => {
                    if (e && typeof e.preventDefault === 'function') e.preventDefault();
                    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();

                    const kindsAttr = (btn.dataset?.kinds || '').trim();
                    if (!kindsAttr) {
                        console.warn('[LOG] Clear clicked but data-kinds is missing');
                        return;
                    }

                    const kinds = Array.from(new Set(
                        kindsAttr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
                    ));

                    if (!this.ActivityLogStore || typeof this.ActivityLogStore.clearByKind !== 'function') {
                        console.error('[LOG] ActivityLogStore.clearByKind unavailable for section clear');
                        return;
                    }

                    let totalRemoved = 0;
                    for (let i = 0; i < kinds.length; i++) {
                        const k = kinds[i];
                        const removed = this.ActivityLogStore.clearByKind(k) || 0;
                        totalRemoved += removed;
                    }

                    const boxes = this._boxesForKinds(kinds);
                    if (boxes.length === 0) {
                        console.warn('[LOG] No UI boxes resolved for kinds:', kinds);
                    } else {
                        for (let i = 0; i < boxes.length; i++) {
                            boxes[i].innerHTML = '';
                        }
                    }

                    console.log(`[LOG] Section cleared: kinds=[${kinds.join(', ')}], removed=${totalRemoved}`);
                };

                btn.addEventListener('click', handle);
                btn.addEventListener('keydown', (ev) => {
                    if (!ev) return;
                    if (ev.key === 'Enter' || ev.key === ' ') handle(ev);
                });
            });
        }

        // Detects visual truncation from CSS (works for single-line and multi-line clamps)
        isVisuallyTruncated_(el) {
            if (!el) {
                console.error("isVisuallyTruncated_: missing element");
                return false;
            }

            const style = window.getComputedStyle(el);

            // Heuristic: if line clamping is used, treat as multiline
            const clampVal =
                style.getPropertyValue("-webkit-line-clamp") ||
                style.getPropertyValue("line-clamp");

            const isClamped =
                clampVal && clampVal !== "none" && Number.parseInt(clampVal, 10) > 0;

            // If multiline (line-clamp / display:-webkit-box / normal wrapping), compare heights
            const multiline =
                isClamped ||
                style.display === "-webkit-box" ||
                (style.whiteSpace !== "nowrap" && style.whiteSpace !== "pre");

            if (multiline) {
                // Some browsers are off-by-1px; allow a tiny epsilon
                return el.scrollHeight > el.clientHeight + 1;
            }

            // Single-line (text-overflow: ellipsis; white-space: nowrap)
            return el.scrollWidth > el.clientWidth + 1;
        }

        createExpandIndicator_() {
            const exp = document.createElement("span");
            exp.className = "ca-expand-indicator";
            exp.title = "Click to expand/collapse";
            exp.textContent = "▾";
            exp.setAttribute("data-action", "toggle-expand");
            exp.setAttribute("role", "button");
            exp.setAttribute("tabindex", "0");
            exp.setAttribute("aria-expanded", "false");
            return exp;
        }

        ensureExpandButtonFor_(containerEl, textEl, kind) {
            if (!containerEl || !textEl) {
                console.error("ensureExpandButtonFor_: missing container/text element", {
                    containerEl,
                    textEl,
                    kind
                });
                return;
            }

            const expandEl = containerEl.querySelector(this.sel.log.classes.ca_expand_indicator);
            const actionsEl = containerEl.querySelector(this.sel.log.classes.ca_log_actions);

            if (!actionsEl) {
                console.error("[CA] ensureExpandButtonFor_: .ca-log-actions not found on log entry", {
                    containerEl,
                    kind
                });
                return;
            }

            // Only manage the chevron + collapse for sent messages
            if (kind !== "dm-out") {
                // Clean up any leftover indicator + inline styles
                if (expandEl) expandEl.remove();
                containerEl.classList.remove("ca-expanded");

                textEl.style.removeProperty("display");
                textEl.style.removeProperty("overflow");
                textEl.style.removeProperty("-webkit-box-orient");
                textEl.style.removeProperty("-webkit-line-clamp");
                textEl.style.removeProperty("line-clamp");

                return;
            }

            // Expanded state is driven by the wrapper class
            const expanded = containerEl.classList.contains("ca-expanded");

            // Apply a *forced* collapsed style when not expanded
            if (!expanded) {
                // 3-line clamp, collapsed by default
                textEl.style.display = "-webkit-box";
                textEl.style.overflow = "hidden";
                textEl.style.setProperty("-webkit-box-orient", "vertical");
                textEl.style.setProperty("-webkit-line-clamp", "3");
                textEl.style.setProperty("line-clamp", "3");
            } else {
                // Show full text when expanded
                textEl.style.removeProperty("display");
                textEl.style.removeProperty("overflow");
                textEl.style.removeProperty("-webkit-box-orient");
                textEl.style.removeProperty("-webkit-line-clamp");
                textEl.style.removeProperty("line-clamp");
            }

            // Ensure a chevron exists and is placed BEFORE the DM button
            let ind = expandEl;
            if (!ind) {
                ind = this.createExpandIndicator_();
                actionsEl.insertBefore(ind, actionsEl.firstChild);
            }

            ind.textContent = expanded ? "▴" : "▾";
            ind.setAttribute("aria-expanded", expanded ? "true" : "false");
        }


        renderLogEntry(activityLog, user) {
            if (!activityLog || !user || !user.uid) {
                console.error(this.LOG, 'renderLogEntry: Invalid args', {entry: activityLog, user});
                return;
            }

            const {ts, kind, content, guid} = activityLog;

            // pick target
            let targetContainer;
            switch (kind) {
                case 'dm-out':
                    targetContainer = this.ui.sentMessagesBox;
                    break;

                case 'dm-in': {
                    // ensure subsection refs are bound (in case the box was rebuilt)
                    this.ui.unrepliedMessageBox = this.ui.unrepliedMessageBox || this.qs(this.sel.log.unreplied);
                    this.ui.repliedMessageBox = this.ui.repliedMessageBox || this.qs(this.sel.log.replied);

                    // unread → Not Replied, else → Replied
                    if (activityLog.unread !== false) {
                        targetContainer = this.ui.unrepliedMessageBox;
                    } else {
                        targetContainer = this.ui.repliedMessageBox;
                    }
                    break;
                }

                case 'login':
                case 'logout':
                    targetContainer = this.ui.presenceBox;
                    break;

                case 'event':
                    targetContainer = this.ui.loggingBox;
                    break;

                default:
                    targetContainer = this.ui.receivedMessagesBox;
            }

            if (!targetContainer) {
                console.error(this.LOG, 'renderLogEntry: No target container for kind', {kind, activityLog, user});
                return;
            }

            this.verbose(
                `Start rendering entry with timestamp ${ts}, type/kind ${kind} and content ${content} from user ${user.uid}`,
                user,
                'in target container',
                targetContainer
            );

            const mappedKind = kind === 'dm-out' ? 'send-ok' : kind; // keep collapse mapping

            // timestamp string (keep existing behavior)
            const tsStr = String(ts);
            const displayTs = tsStr.split(' ')[1] || tsStr;

            // shorthand for classes
            const C = this.sel.raw.log.classes;

            // dot color / title
            let dotExtraClass;
            let dotTitle;

            if (kind === 'event') {
                dotExtraClass = C.ca_log_dot_gray;
            } else if (user.isLoggedIn) {
                dotExtraClass = C.ca_log_dot_green;
                dotTitle = 'Online';

            } else {
                dotExtraClass = C.ca_log_dot_red;
                dotTitle = 'Offline';
            }

            const html = this.buildLogHTML(kind, activityLog.content);
            const detailsHTML = this.decodeHTMLEntities(html);

            const userHTML = kind !== 'event'
                ? `
            <div class="${C.ca_log_cell}">
                <span class="${C.ca_log_user}">
                    ${this.userLinkHTML(user)}
                </span>
            </div>
          `
                : '';

            const dmIconHTML = kind !== 'event'
                ? `
            <a href="#"
               class="${C.ca_dm_link} ${C.ca_dm_right} ${C.ca_log_action}"
               data-action="open-dm"
               title="Direct message">
               ${this.buildSvgIconString(
                    'lucide lucide-mail',
                    `
                        <rect x="3" y="5" width="18" height="14" rx="2" ry="2"></rect>
                        <polyline points="3 7,12 13,21 7"></polyline>
                    `
                )}
            </a>
          `
                : '';

            const deleteIconHTML = `
        <a href="#"
           class="${C.ca_del_link} ${C.ca_log_action}"
           data-action="delete-log"
           title="Delete this log entry">
           ${this.buildSvgIconString(
                'lucide lucide-x',
                `
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                `
            )}
        </a>
    `;

            const guidAttr = guid != null ? ` data-guid="${String(guid)}"` : '';

            const entryHTML = `
        <div class="ca-log-entry ca-log-${mappedKind}"
             data-uid="${String(user.uid)}"${guidAttr}>
            <span class="ca-log-ts">${displayTs}</span>

            <div class="${C.ca_log_cell}">
                <span class="${C.ca_log_dot} ${dotExtraClass}"${dotTitle ? ` title="${dotTitle}"` : ''}>
                    ●
                </span>
            </div>

            ${userHTML}

            <span class="${C.ca_log_text}"
                  data-action="${kind === 'dm-out' ? 'toggle-expand' : 'open-dm'}">
                ${detailsHTML}
            </span>

            <div class="${C.ca_log_actions}">
                ${dmIconHTML}
                ${deleteIconHTML}
            </div>
        </div>
    `;

            // Turn HTML string into a real element, then append
            const wrapper = document.createElement('div');
            wrapper.innerHTML = entryHTML.trim();
            const el = wrapper.firstElementChild;

            if (!el) {
                console.error(this.LOG, 'renderLogEntry: Failed to build log entry element', {activityLog, user});
                return;
            }

            targetContainer.appendChild(el);

            // Keep expand button logic
            if (kind !== 'event') {
                const textEl = el.querySelector(`.${C.ca_log_text}`);
                if (textEl) {
                    requestAnimationFrame(() => {
                        this.ensureExpandButtonFor_(el, textEl, kind);
                    });

                    const ro = new ResizeObserver(() => {
                        this.ensureExpandButtonFor_(el, textEl, kind);
                    });
                    ro.observe(textEl);
                } else {
                    console.warn(this.LOG, 'renderLogEntry: text element not found for expand logic', {
                        activityLog,
                        user
                    });
                }
            }

            this.scrollToBottom(targetContainer);
        }


        scrollToBottom(targetContainer) {
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
            this.saveLogEntry(entry.ts, entry.kind, entry.content, entry.uid, entry.guid);
        }

        userLinkHTML(user) {
            return `<a href="#"
            class="${this.sel.raw.log.classes.ca_user_link}"
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

        removeAds(root) {
            const scope = root && root.querySelectorAll ? root : document;

            // Remove known widget containers
            document.querySelectorAll('.coo-widget').forEach(e => e.remove());

            // Remove bit.ly anchors (but not those inside our panel)
            const links = scope.querySelectorAll('a[href*="bit.ly"]');
            if (!links || !links.length) return;
            links.forEach(a => {
                if (a && !a.closest(this.sel.rightPanel) && a.parentNode) {
                    a.parentNode.removeChild(a);
                }
            });
        }

        d

        getFemaleUsersContainer() {
            if (!this.ui.femaleUsersContainer) {
                this.ui.femaleUsersContainer = this.qs(`${this.sel.users.femaleUsersWrapper} .ca-user-list-content`);
            }

            return this.ui.femaleUsersContainer;
        }

        getGlobalWatermark() {
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

        getLastDmUid() {
            if (!this.Store) return '';
            const raw = this.Store.get(this.LAST_DM_UID_KEY);
            if (!raw) return '';
            return String(raw);
        }

        setLastDmUid(uid) {
            if (!this.Store) return;
            if (!uid) {
                this.Store.set(this.LAST_DM_UID_KEY, '');
                return;
            }
            this.Store.set(this.LAST_DM_UID_KEY, String(uid));
        }

        clearLastDmUid() {
            if (!this.Store) return;
            this.Store.set(this.LAST_DM_UID_KEY, '');
        }

        /**
         * Restore the last DM using the stored uid (if any)
         */
        async restoreLastDmFromStore() {
            const uid = this.getLastDmUid();
            if (!uid) {
                this.debug('There was no uid for a last dm');
                return;
            }

            this.applyLegacyAndOpenDm(await this.UserStore.getOrFetch(uid));
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

            for (const log of logs) {
                this.debug(`Processing read status for log ${log.guid}`);
                const el = this.qs(`.ca-log-entry[data-guid="${log.guid}"]`, this.ui.unrepliedMessageBox);
                this.ui.repliedMessageBox.appendChild(el);
            }

            this.scrollToBottom(this.ui.repliedMessageBox);
        }

        destroy() {
            this._uninstallAudioAutoplayGate();
            this.uninstallNetworkTaps();
            this.uninstallPrivateSendInterceptor();
            this.stopRefreshUsersLoop();
            this.stopClearEventLogLoop();
        }
    }

    const text = document.body.innerText || "";
    if (text.includes("Verifieer dat u een mens bent")) {
        console.warn("Human verification page detected — not initializing.");
        return;
    }
    const app = new App();
    await app.init();
})();
