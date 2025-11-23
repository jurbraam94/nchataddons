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

        getAllByUserUid(uid, onlyUnread = false, alsoFromSelf = false) {
            const result = this._getAll().filter(
                log => String(log.uid) === String(uid)
                    && (!onlyUnread || log.unread)
                    && log.guid !== String(user_id)
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

            if (userToEdit.isLoggedIn === undefined) {
                console.error(`[WARN] User is missing isLoggedIn field, setting it to false.`, userToEdit);
                userToEdit.isLoggedIn = false;
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
                throw new Error('_saveAll expects an array');
            }

            // create a map for fast lookup
            const byUid = new Map(
                usersToEdit
                    .filter(u => u && u.uid != null)
                    .map(u => [String(u.uid), u])
            );

            const updatedUsers = this._getAll().map(existingUser => {
                const patch = byUid.get(String(existingUser.uid));

                return patch
                    ? {...existingUser, ...patch} // patch overwrites fields
                    : existingUser;
            });

            this.kv.set(this.cacheKey, updatedUsers);
            return updatedUsers;
        }

        markAllLoggedOut() {
            const allUsers = this._getAll();
            const patches = [];

            for (const user of allUsers) {
                if (user.isLoggedIn === true) {
                    // user was logged in, we want to log them out
                    patches.push({
                        ...user,
                        isLoggedIn: false
                    });
                } else if (user.isLoggedIn === undefined) {
                    console.error(
                        `[UsersStore.markAllLoggedOut] User ${user.uid} has undefined isLoggedIn; setting it to false.`
                    );
                    patches.push({
                        ...user,
                        isLoggedIn: false
                    });
                }
            }

            if (patches.length === 0) {
                // nothing to change
                return [];
            }

            // this writes to kv/localStorage ONCE
            this._saveAll(patches);

            // Return the logged-out users, so you can still do your loop:
            // for (const user of loggedOutUsers) { handleLoggedInStatus(user, false); }
            return patches;
        }

        // ---- API (array) ----
        list() {
            return [...this._getAll()];
        }

        get(uid) {
            return this._getAll().find(u => String(u.uid) === String(uid)) || null;
        }

        getByName(name) {
            return this._getAll().find(u => String(u.name) === String(name)) || null;
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
                throw new Error('set() requires user.uid')
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
            const isLoggedIn = this.get(uid)?.isLoggedIn;

            if (isLoggedIn === undefined) {
                throw new Error(`User ${uid} isLoggedIn is undefined`);
            }
            return !!(this.get(uid)?.isLoggedIn);
        }

        setLoggedIn(uid, status) {
            const user = this.get(uid);

            if (user.isLoggedIn === undefined) {
                throw new Error(`User ${uid} isLoggedIn is undefined`);
            }

            const loggedInStatusChanged = user.isLoggedIn !== status;

            if (!user) {
                console.log(`User ${uid} not found, cannot set isLoggedIn to ${status}`);
                return null;
            }

            return {
                loggedInStatusChanged: loggedInStatusChanged,
                user: loggedInStatusChanged ? this.set({...user, isLoggedIn: status}) : user
            }
        }

        getAllLoggedIn() {
            return this.list().filter(u => {
                if (u.isLoggedIn === true) {
                    return true;
                } else if (u.isLoggedIn === undefined) {
                    throw new Error(`User ${u.uid} isLoggedIn is undefined`);
                }
            });
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
            let user = this.get(id);
            if (!user) {
                const fetched = await this.app.searchUserRemote(String(id));
                if (fetched) {
                    user = this.set({...fetched, uid: String(fetched.uid ?? id)});
                } else {
                    console.error(`User ${id} not found, cannot fetch`);
                }
            }

            return user || null;
        }

        async getOrFetchByName(name) {
            let user = this.getByName(name);
            let users = [];

            if (!user) {
                users = await this.app.searchUserRemoteByUsername(String(name));
            } else {
                users.push(user);
            }
            return users || null;
        }

        includeUserForBroadcast(uid, include) {
            if (uid == null) return null;
            const u = this.get(uid) || {uid: String(uid)};
            return this.set({...u, isIncludedForBroadcast: !!include});
        }

        async isIncludedForBroadcast(uid) {
            if (uid == null || uid === '') {
                console.error(`isIncludedForBroadcast requires uid`);
                return null;
            }

            const user = await this.getOrFetch(uid);

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
            this.SHOW_BROADCAST_SELECTION_BOXES_KEY = `${this.STORAGE_KEY_PREFIX}.showBroadcastSelectionBoxes`;
            this.LAST_DM_UID_KEY = `${this.STORAGE_KEY_PREFIX}.lastDmUid`;
            this.PREDEFINED_MESSAGES_KEY = `${this.PERSIST_STORAGE_KEY_PREFIX}.predefined_messages`;
            this.USERS_KEY = `${this.PERSIST_STORAGE_KEY_PREFIX}.users`;
            this.activeTextInput = null;

            /* ========= App State ========= */
            this.options = {};
            this.state = {
                CHAT_CTX: {
                    caction: '', room: '', notify: '', curset: ''
                }
            };

            /* ========= UI Refs ========= */
            this.ui = {
                panel: null,
                panelNav: null,
                sentMessagesBox: null,
                receivedMessagesBox: null,
                presenceBox: null,
                logClear: null,
                repliedMessageBox: null,
                unrepliedMessageBox: null,
                debugCheckbox: null,
                verboseCheckbox: null,
                loggingBox: null,
                userContainersWrapper: null,
                femaleUsersContainer: null,
                otherUsersContainer: null,
            };

            this._lastSendAt = 0;
            this.userRefreshInterval = 30000;

            this._xhrOpen = null;
            this._xhrSend = null;

            this.isInitialLoad = true;

            this.userParsingInProgress = false;

            /* ========= Audio Autoplay Gate (policy-safe) ========= */
            this._audioGate = {
                userInteracted: false,
                pending: null,
                origPlay: null,
                onInteract: null,
                installed: false
            };

            // Dynamic debug method
            this.debug = (...args) => {
                if (this.debugMode) {
                    console.log('[DEBUG]', ...args);
                }
            };

            // Dynamic verbose method (more detailed than debug)
            this.verbose = (...args) => {
                if (this.verboseMode) {
                    console.log('[VERBOSE]', ...args);
                }
            };

            this.colors = {
                SOFT_GREEN: 'color:#8bdf8b',  // friendly green
                SOFT_RED: 'color:#d88989',  // warm red
                GREY: 'color:#9ca3af',  // punctuation/parentheses
                GREY_NUM: 'color:#6b7280'  // muted 0 numbe
            }

            this.sel = {
                rightPanel: '#right-panel',
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
                        ca_expand_indicator: '.ca-expand-indicator',
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
                        user_item: '.user_item'
                    },
                    sent: '#ca-log-box-sent',
                    received: '#ca-log-box-received',
                    replied: '#ca-log-received-replied',
                    unreplied: '#ca-log-received-unreplied',
                    presence: '#ca-log-box-presence',
                    clear: '#ca-log-clear',
                    general: '#ca-logs-box'
                },
                privateChat: {
                    privateInputBox: '#private_input_box'
                },
                users: {
                    femaleUserCount: '#ca-female-users-count',
                    otherUsersContainer: '#ca-other-users-container',
                    femaleUsersContainer: '#ca-female-users-container',
                    otherUserCount: '#ca-other-users-count',
                    online: '.online_user'
                }
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
            this.shouldHideRepliedUsers = storedHide === true || storedHide === 'true';

            const showBroadcastCheckboxes = localStorage.getItem(this.SHOW_BROADCAST_SELECTION_BOXES_KEY) || false;
            this.shouldShowBroadcastCheckboxes = showBroadcastCheckboxes === true || showBroadcastCheckboxes === 'true';

            this.NO_LS_MODE = this._readStorageMode(); // 'allow' | 'wipe' | 'block'
            if (this.NO_LS_MODE === 'wipe') this._clearOwnLocalStorage();
            // Let layout settle, then remove ads
            this.removeAds(document);
            // --- CORE UI SETUP (keep synchronous) ---
            this.buildPanel();

            const main_wrapper = document.createElement('div');
            main_wrapper.id = 'main_wrapper';

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

            this.qs('#private_center').after(this.qs('#private_menu'));

            main_wrapper.appendChild(this.qs('#chat_head'));
            main_wrapper.appendChild(this.qs('#global_chat'));
            main_wrapper.appendChild(this.qs('#wrap_footer'));
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
                    rank: 100,
                    age: 30,
                    country: "NL"
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
            const userContainersWrapper = document.createElement(`div`);
            userContainersWrapper.id = `ca-user-container`;
            this.qs(`#chat_right`).appendChild(userContainersWrapper);
            this.ui.userContainersWrapper = userContainersWrapper;
            this.createOtherUsersContainer();
            this.createFemaleUsersContainer();
            this.wireListOptionClicks();
            this.wireUserContainerHeaders();
            this._bindStaticRefs();
            this._attachLogClickHandlers();

            this.installLogImageHoverPreview();

            if (this.shouldShowBroadcastCheckboxes) {
                document.querySelector('#ca-female-users-container').classList.add("ca-show-ck");
            }

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
            this._wireTextboxTrackers();

            // Network taps should be ready, but heavy work will happen later
            this.installNetworkTaps();
            this.installPrivateSendInterceptor();
            this.appendCustomActionsToBar();

            // Start loops; first user refresh happens here
            await this.startRefreshUsersLoop({intervalMs: 30000, runImmediately: true});
            ///this.startClearEventLogLoop({intervalMs: 5 * 60 * 1000});

            // scroll after logs have been restored
            this.scrollToBottom(this.ui.repliedMessageBox);
            this.scrollToBottom(this.ui.unrepliedMessageBox);
            this.scrollToBottom(this.ui.sentMessagesBox);

            return this;
        }

        _wireTextboxTrackers() {
            // Track last-focused input/textarea globally
            document.addEventListener('focusin', (event) => {
                const target = event.target;

                if (!target) {
                    console.warn('[CA] focusin event without target');
                    return;
                }

                if (
                    (target.tagName === 'TEXTAREA') ||
                    (target.tagName === 'INPUT' && target.type === 'text')
                ) {
                    this.activeTextInput = target;
                }
            });

// ❌ Remove this whole block:
// document.addEventListener('focusout', (event) => {
//     const target = event.target;
//
//     if (!target) {
//         console.warn('[CA] focusout event without target');
//         return;
//     }
//
//     if (this.activeTextInput === target) {
//         this.activeTextInput = null;
//     }
// });

        }

        _getActiveTextBox() {
            if (!this.activeTextInput) {
                console.warn('[CA] No active text box to insert template into');
                return null;
            }

            if (!document.body.contains(this.activeTextInput)) {
                console.warn('[CA] Active text box is no longer in the DOM');
                this.activeTextInput = null;
                return null;
            }

            return this.activeTextInput;
        }

        _appendPredefinedToActiveBox(template) {
            const box = this._getActiveTextBox();

            if (!box) {
                console.warn('[CA] No active textbox found when trying to insert template');
                return;
            }

            this._appendPredefinedToBox(template, box);
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

        _renderPredefinedList(popup) {
            const listEl = popup.querySelector('#ca-predefined-messages-list');
            const subjectInput = popup.querySelector('#ca-predefined-messages-subject');
            const textInput = popup.querySelector('#ca-predefined-messages-text');
            const indexInput = popup.querySelector('#ca-predefined-messages-index');

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

// INSERT into active text field
                const insertLink = document.createElement('a');
                insertLink.href = "#";
                insertLink.className = 'ca-log-action ca-insert-link';
                insertLink.title = "Insert into active text field";

// icon similar style, using your SVG helper
                insertLink.appendChild(
                    this.renderSvgIconWithClass(
                        "lucide lucide-corner-down-left",
                        `<polyline points="9 10 4 15 9 20"></polyline>
         <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>`
                    )
                );

                insertLink.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    this._appendPredefinedToActiveBox(item); // uses your existing helper
                });

// EDIT (pencil)
                const editLink = document.createElement('a');
                editLink.href = "#";
                editLink.className = 'ca-log-action ca-edit-link';
                editLink.title = "Edit template";
                editLink.appendChild(
                    this.renderSvgIconWithClass(
                        "lucide lucide-lucide-pencil",
                        `<path d="M17 3a2.828 2.828 0 0 1 4 4l-12 12-4 1 1-4 12-12z"></path>`
                    )
                );
                editLink.addEventListener('click', (ev) => {
                    ev.preventDefault();

                    this.predefinedEditIndex = index;
                    indexInput.value = String(index);
                    subjectInput.value = item.subject || '';
                    textInput.value = item.text || '';

                    // Make sure editor is visible when editing
                    const editorRoot = popup.querySelector('.ca-predefined-messages-editor');
                    const toggleBtn = popup.querySelector('#ca-predefined-messages-toggle');

                    if (editorRoot && editorRoot.classList.contains('ca-predefined-editor-collapsed')) {
                        editorRoot.classList.remove('ca-predefined-editor-collapsed');
                        if (toggleBtn) {
                            toggleBtn.textContent = 'Hide editor';
                        }
                    }

                    subjectInput.focus();
                });


// DELETE (x)
                const deleteLink = document.createElement('a');
                deleteLink.href = "#";
                deleteLink.className = 'ca-log-action ca-del-link';
                deleteLink.title = "Delete template";
                deleteLink.appendChild(
                    this.renderSvgIconWithClass(
                        "lucide lucide-x",
                        `<line x1="18" y1="6" x2="6" y2="18"></line>
         <line x1="6" y1="6" x2="18" y2="18"></line>`
                    )
                );

                deleteLink.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    const current = this._getPredefinedMessages().slice();
                    current.splice(index, 1);
                    this._savePredefinedMessages(current);
                    this._renderPredefinedList(popup);
                    this._refreshAllPredefinedSelects();
                });


                actions.appendChild(insertLink);
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

        openGlobalPredefinedTemplatesPopup() {
            // Reuse the same logic as the bar “Manage” button
            this.openPredefinedPopup(null);
        }

        _fillPredefinedSelect(selectEl) {
            if (!selectEl) {
                console.error('[CA] _fillPredefinedSelect: missing element');
                return;
            }

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

        wirePredefinedMessagesBar(barEl) {
            if (!barEl) {
                console.error('[CA] wirePredefinedMessagesBar: barEl missing');
                return;
            }

            const predefinedMessagesDropdown = barEl.querySelector('.ca-predefined-messages-select');
            const resendEl = barEl.querySelector('.ca-predefined-messages-resend');
            const addPredefinedMessageEl = barEl.querySelector('.ca-predefined-messages-add');
            const manageEl = barEl.querySelector('.ca-predefined-messages-manage');

            if (!predefinedMessagesDropdown) {
                console.error('[CA] wirePredefinedMessagesBar: select not found');
                return;
            }

            // Fill options for this select only
            this._fillPredefinedSelect(predefinedMessagesDropdown);

            // --- change on THIS select ---
            predefinedMessagesDropdown.addEventListener('change', (e) => {
                this._applyPredefinedFromSelect(e.target);
            });

            // --- resend on THIS bar ---
            if (resendEl) {
                resendEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    const ok = this._applyPredefinedFromSelect(predefinedMessagesDropdown);
                    if (!ok) {
                        console.warn('[CA] Predefined resend: nothing to resend (no selection?)');
                    }
                });
            }

            // --- add-from-chat on THIS bar ---
            if (addPredefinedMessageEl) {
                addPredefinedMessageEl.addEventListener('click', (e) => {
                    e.preventDefault();

                    const targetSel = predefinedMessagesDropdown.dataset.predefinedMessagesTarget;
                    if (!targetSel) {
                        console.error('[CA] add-from-chat: missing data-predefined-messages-target');
                        return;
                    }

                    const box = this.qs(targetSel);

                    if (!box) {
                        console.error('[CA] add-from-chat: target input not found for selector:', targetSel);
                        return;
                    }

                    const currentText = (box.value || '').trim();
                    if (!currentText) {
                        console.warn('[CA] No text in chatbox to save as template');
                        return;
                    }

                    this.openPredefinedPopup(barEl, currentText);
                });
            }

            // --- manage on THIS bar ---
            if (manageEl) {
                manageEl.addEventListener('click', (e) => {
                    e.preventDefault();

                    console.log('[CA] Predefined Manage clicked:', manageEl.id || '(no id)');
                    this.openPredefinedPopup(barEl);
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

        createPredefinedMessagesPopup() {
            const bodyHtml = `
              <div class="ca-predefined-messages-editor">
                <div class="ca-predefined-messages-editor-header">
                  <span>Template editor</span>
                  <button 
                    type="button" 
                    id="ca-predefined-messages-toggle" 
                    class="ca-predefined-messages-toggle"
                  >
                    Hide editor
                  </button>
                </div>
        
                <div class="ca-predefined-messages-editor-body">
                  <form 
                    id="ca-predefined-messages-form" 
                    class="ca-predefined-messages-form"
                  >
                    <label>
                      Subject<br>
                      <input 
                        type="text" 
                        id="ca-predefined-messages-subject" 
                        class="ca-8" 
                      >
                    </label>
        
                    <label>
                      Text<br>
                      <textarea 
                        id="ca-predefined-messages-text" 
                        class="ca-8" 
                        rows="3"
                      ></textarea>
                    </label>
        
                    <input 
                      type="hidden" 
                      id="ca-predefined-messages-index" 
                      value="-1"
                    >
        
                    <div class="ca-predefined-messages-buttons">
                      <button 
                        type="button" 
                        id="ca-predefined-messages-reset" 
                        class="ca-btn ca-btn-slim"
                      >
                        Clear
                      </button>
        
                      <button 
                        type="submit" 
                        id="ca-predefined-messages-save" 
                        class="ca-btn ca-btn-slim"
                      >
                        Save
                      </button>
                    </div>
                  </form>
                </div>
              </div>
        
              <ul id="ca-predefined-messages-list"></ul>
            `;

            return this.ensurePopup({
                id: 'ca-predefined-messages-popup',
                title: 'Manage predefined messages',
                bodyHtml
            });
        }

        /* ---------- Predefined messages popup (ca-popup) ---------- */
        openPredefinedPopup(wrapper, prefilledText = null) {
            const popup = this.createPredefinedMessagesPopup();
            this._renderPredefinedList(popup);

            const form = popup.querySelector('#ca-predefined-messages-form');
            const subjectInput = popup.querySelector('#ca-predefined-messages-subject');
            const textInput = popup.querySelector('#ca-predefined-messages-text');
            const indexInput = popup.querySelector('#ca-predefined-messages-index');
            const resetBtn = popup.querySelector('#ca-predefined-messages-reset');
            const editorRoot = popup.querySelector('.ca-predefined-messages-editor');
            const toggleBtn = popup.querySelector('#ca-predefined-messages-toggle');
            const editorBody = popup.querySelector('.ca-predefined-messages-editor-body');

            if (prefilledText) {
                // Reset form and fill with prefilled text
                if (indexInput) {
                    indexInput.value = '-1'; // new template
                }
                if (subjectInput) {
                    subjectInput.value = subjectInput.value || '';
                }

                textInput.value = prefilledText;
            }

            if (!form || !subjectInput || !textInput || !indexInput || !resetBtn) {
                console.error('[CA] createPredefinedPopup: missing form controls');
                return null;
            }

            // Setup toggle only once per popup
            if (toggleBtn && editorRoot && editorBody && !editorRoot.dataset.caToggleInitialized) {
                editorRoot.dataset.caToggleInitialized = '1';

                // collapsed by default
                editorRoot.classList.add('ca-predefined-editor-collapsed');
                toggleBtn.textContent = 'Show editor';

                toggleBtn.addEventListener('click', () => {
                    const collapsed = editorRoot.classList.toggle('ca-predefined-editor-collapsed');
                    toggleBtn.textContent = collapsed ? 'Show editor' : 'Hide editor';
                });
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
                this._renderPredefinedList(popup);
                this._refreshAllPredefinedSelects();


                this.predefinedEditIndex = null;
                indexInput.value = '-1';
                subjectInput.value = '';
                textInput.value = '';
            });

            this.togglePopup('ca-predefined-messages-popup')
        }

        appendCustomActionsToBar() {
            // Use the existing toolbar by ID, not class
            const bar = document.getElementById('right_panel_bar');

            if (!bar) {
                console.warn('[CA] appendCustomActionsToBar: #right_panel_bar not found');
                return;
            }

            this.sel.raw.rightPanelBar = 'right_panel_bar';
            this.sel.raw.rightPanelBarPanelOption = 'panel_option';

            const existingOption = bar.getElementsByClassName('panel_option')[0];
            if (!existingOption) {
                console.warn('[CA] appendCustomActionsToBar: no existing .panel_option found');
            }

            // --- Refresh button ---
            const refreshBtn = document.createElement('div');
            refreshBtn.classList.add('panel_option', 'panel_option_refresh');
            refreshBtn.innerHTML = '<i class="fa fa-sync" aria-hidden="true"></i>';
            refreshBtn.title = 'Reload users and logs';

            refreshBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.reloadUsersAndLogs();
            });

            // --- Templates button ---
            const templatesBtn = document.createElement('div');
            templatesBtn.classList.add('panel_option', 'panel_option_templates');
            templatesBtn.innerHTML = '<i class="fa fa-comment-dots" aria-hidden="true"></i>';
            templatesBtn.title = 'Predefined messages';

            templatesBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openPredefinedBar(bar);
            });

            // --- Settings button (cog, SVG, same style/color) ---
            const settingsBtn = document.createElement('div');
            settingsBtn.classList.add('panel_option', 'panel_option_settings');
            settingsBtn.title = 'Settings (debug & verbose)';

            const settingsIconHtml = `
        <span class="ca-log-action">
            ${this.buildSvgIconString(
                'lucide lucide-settings',
                `
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l-.5.87a1.65 1.65 0 0 1-2.27.6l-.9-.52a1.65 1.65 0 0 0-1.6 0l-.9.52a1.65 1.65 0 0 1-2.27-.6l-.5-.87a1.65 1.65 0 0 0 .33-1.82l-.5-.87a1.65 1.65 0 0 0-1.27-.8l-1-.1a1.65 1.65 0 0 1-1.48-1.65v-1a1.65 1.65 0 0 1 1.48-1.65l1-.1a1.65 1.65 0 0 0 1.27-.8l.5-.87a1.65 1.65 0 0 1 2.27-.6l.9.52a1.65 1.65 0 0 0 1.6 0l.9-.52a1.65 1.65 0 0 1 2.27.6l.5.87a1.65 1.65 0 0 0 .33 1.82l.5.87a1.65 1.65 0 0 1 0 1.8z"></path>
                `,
                true
            )}
        </span>
    `;
            settingsBtn.innerHTML = settingsIconHtml;

            settingsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openSettingsPopup();
            });

            // Insert in front so they appear together with the existing buttons
            if (existingOption) {
                bar.insertBefore(refreshBtn, existingOption);
                bar.insertBefore(templatesBtn, existingOption);
                bar.insertBefore(settingsBtn, existingOption);
            } else {
                bar.appendChild(refreshBtn);
                bar.appendChild(templatesBtn);
                bar.appendChild(settingsBtn);
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
                                        intervalMs = this.userRefreshInterval,    // default 60s
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
                                   intervalMs = 30 * 60 * 1000,
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
            this.verbose('========== START REFRESHING AND PARSING NEW USER LIST ==========t');
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

            try {
                await this.processUserListResponse(html);
            } catch (e) {
                console.error(e);
                this.logEventLine(`Refreshed user list failed at ${this.timeHHMMSS()}. Check the console for a more detailed error message.`);
            }
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

        async processPrivateSendResponse(data, targetUid) {
            const logData = data.log || {};
            const content = logData.log_content || '';

            // Look up user - ensure we always have a valid user object
            const dmSentToUser = await this.UserStore.get(targetUid);

            if (!dmSentToUser) {
                console.error(
                    `[PrivateSend] Could not find user with ID ${targetUid}. ` +
                    `Could not process outgoing private message`
                );
                return;
            }

            console.log(
                '\nIntercepted native message send to',
                dmSentToUser.name || targetUid,
                '(ID:',
                targetUid,
                ')'
            );

            // Always log the outgoing message
            this.logLine('dm-out', content, dmSentToUser, logData.log_id);

            // Mark old incoming messages as read, if any
            const affectedLogs =
                this.ActivityLogStore.MarkReadUntilChatLogId(
                    targetUid,
                    dmSentToUser.parsedDmInUpToLog
                );

            // Only touch the UI if there are logs to update
            if (!Array.isArray(affectedLogs) || !affectedLogs.length) {
                this.debug('[PrivateSend] No logs to update read status for user:', targetUid);
                return;
            }

            // Only update chips if user is actually visible in the DOM
            const userEl = this.findUserById(dmSentToUser.uid);
            if (userEl) {
                this.updateProfileChip(dmSentToUser.uid, userEl);
            } else {
                this.debug(
                    '[PrivateSend] Skipping profile chip update; user element not found for uid:',
                    dmSentToUser.uid
                );
            }

            this.processReadStatusForLogs(affectedLogs);
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
                    this.addEventListener('readystatechange', async () => {
                        if (this.readyState === 4 && this.status === 200) {
                            let data = self.toPrivateSendResponse(JSON.parse(String(this?.responseText)));

                            if (!data) {
                                return;
                            }
                            const targetId = new URLSearchParams(capturedBody).get('target');
                            await self.processPrivateSendResponse(data, targetId);
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
            this.verbose('Parsed', out.length, 'private conversation' + (out.length !== 1 ? 's' : ''));
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
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const name = doc?.querySelector('.pro_name')?.textContent?.trim();
            // now fetch using the search function because it has more convenient fields for the userprofile.
            const foundUsers = await this.UserStore.getOrFetchByName(name);

            if (foundUsers.length !== 1) {
                console.error(`[CA] searchUserRemote: Could not find user with name ${name}, there wasn't exactly one match (found ${foundUsers.length})`);
                return null;
            }
            return foundUsers[0];
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
                    console.error('Fetch private notifications error:', err);
                    return null;
                });
        }

        caUpdatePrivateConversationsList() {
            return this.caFetchPrivateNotify().then((privateConversations) => {
                privateConversations = privateConversations || [];
                this.verbose('Private conversations:', privateConversations.length);
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
            this.verbose('caFetchChatLogFor uid=', uid, ' body:', bodyLog);

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
                    this.verbose('caFetchChatLogFor: Response status:', res.status, res.statusText);
                    return res.text();
                })
                .then((txt) => {
                    this.verbose('caFetchChatLogFor received a response successfully');
                    return txt;
                })
                .catch((err) => {
                    this.verbose('Fetch chat log error:', err);
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
            this.updateProfileChipByUid(user.uid);
            return {accepted: true, logId: privateChatLog.log_id, reason: 'ok'};
        }

        installLogImageHoverPreview() {
            const containersLogs = [
                this.ui.repliedMessageBox,
                this.ui.unrepliedMessageBox,
                this.ui.sentMessagesBox,
                this.ui.presenceBox,
                this.ui.loggingBox,
                this.ui.userContainersWrapper
            ];


            const publicChatContainer = document.getElementById('chat_logs_container');

            if (!containersLogs.length && !publicChatContainer) {
                console.error('[CA] installLogImageHoverPreview: no containers found');
                return;
            }

            // Create a single shared preview bubble
            const preview = document.createElement('div');
            preview.id = 'ca-log-image-preview';

            const img = document.createElement('img');
            preview.appendChild(img);

            document.body.appendChild(preview);

            const hidePreview = () => {
                preview.classList.remove('ca-visible');
            };

            const positionPreview = (evt, mode) => {
                if (!evt) {
                    return;
                }

                const vw = window.innerWidth;
                const vh = window.innerHeight;

                const rect = preview.getBoundingClientRect();
                const w = rect.width || 260;
                const h = rect.height || 260;

                let x;
                let y;

                if (mode === 'public') {
                    // PUBLIC CHAT:
                    // bottom-LEFT corner at cursor => preview appears top-right of mouse
                    x = evt.clientX;
                    y = evt.clientY - h;
                } else {
                    // LOGS / USER LIST:
                    // bottom-RIGHT corner at cursor => preview appears top-left of mouse
                    x = evt.clientX - w;
                    y = evt.clientY - h;
                }

                // Clamp within viewport
                if (x < 0) x = 0;
                if (y < 0) y = 0;
                if (x + w > vw) x = vw - w;
                if (y + h > vh) y = vh - h;

                preview.style.left = `${x}px`;
                preview.style.top = `${y}px`;
            };

            const showPreview = (evt, src, mode) => {
                if (!src) {
                    console.warn('[CA] installLogImageHoverPreview: missing src');
                    return;
                }

                // Size: smaller for logs, bigger for public chat
                if (mode === 'public') {
                    preview.style.maxWidth = '340px';
                    preview.style.maxHeight = '340px';
                } else {
                    preview.style.maxWidth = '260px';
                    preview.style.maxHeight = '260px';
                }

                img.onload = () => {
                    preview.classList.add('ca-visible');
                    positionPreview(evt, mode);
                };

                img.src = src;
            };

            const HOVER_SELECTOR = 'img.chat_image, img.avav';

            const attachHoverHandlers = (container, mode) => {
                if (!container) {
                    console.warn('[CA] installLogImageHoverPreview: container missing for mode', mode);
                    return;
                }

                // SHOW on hovering the thumbnail image
                container.addEventListener('mouseover', (evt) => {
                    const target = evt.target;
                    if (!target || !(target instanceof Element)) {
                        return;
                    }

                    const imgEl = target.closest(HOVER_SELECTOR);
                    if (!imgEl) {
                        return;
                    }

                    const src = imgEl.getAttribute('src');
                    if (!src) {
                        console.warn('[CA] installLogImageHoverPreview: image without src');
                        return;
                    }

                    showPreview(evt, src, mode);
                });

                // MOVE while hovering
                container.addEventListener('mousemove', (evt) => {
                    if (!preview.classList.contains('ca-visible')) {
                        return;
                    }
                    positionPreview(evt, mode);
                });

                // HIDE when leaving the image
                container.addEventListener('mouseout', (evt) => {
                    const target = evt.target;
                    if (!target || !(target instanceof Element)) {
                        return;
                    }

                    if (!target.closest(HOVER_SELECTOR)) {
                        return;
                    }

                    const related = evt.relatedTarget;
                    if (!related || !(related instanceof Element) || !related.closest(HOVER_SELECTOR)) {
                        hidePreview();
                    }
                });
            };

            // Attach for logs + user list (small, top-left-ish)
            containersLogs.forEach((container) => attachHoverHandlers(container, 'logs'));

            // Attach for public main chat (bigger, top-right-ish)
            if (publicChatContainer) {
                attachHoverHandlers(publicChatContainer, 'public');
            }

            console.log('[CA] Log image hover preview installed (logs + user list + public chat)');
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
                    this.debung(`New message ${res.logId} for user ${user.uid}`, privateChatLog);
                    this.UserStore.setParsedDmInUpToLog(user.uid, res.logId);
                } else {
                    this.debug(`Private chat log ${privateChatLog.log_id} for user ${user.uid} was skipped. Reason: ${res.reason}`);
                }
            }
        }

        /* ============ Chat payload processing ============ */
        caProcessChatPayload(txt, params) {
            if (!txt || typeof txt !== 'string' || txt.trim() === '') {
                console.warn('Empty or invalid chat payload response');
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

            console.log('Private messages count (pico):', pico, '— checking for new messages');

            this.caUpdatePrivateConversationsList(false).then((privateConversations) => {
                privateConversations = Array.isArray(privateConversations) ? privateConversations : [];
                this.verbose('Private conversations returned:', privateConversations.length, privateConversations);

                const privateChatsToFetch = privateConversations
                    .filter(pc => pc.unread > 0)
                    .map(it => ({uid: String(it.uid), unread: Number(it.unread) || 0}));

                if (!privateChatsToFetch.length) {
                    console.log('None of the conversations has new messages');
                    return;
                }

                this.verbose('Fetching', privateChatsToFetch.length, 'conversation' + (privateChatsToFetch.length !== 1 ? 's' : ''), 'with new messages');

                (async () => {
                    for (const privateChat of privateChatsToFetch) {
                        console.log('Fetch private message for conversation', privateChat.uid, '— unread:', privateChat.unread);
                        const rawPrivateChatLogResponse = await this.fetchPrivateMessagesForUid(privateChat.uid, params);

                        if (!rawPrivateChatLogResponse || typeof rawPrivateChatLogResponse !== 'string' || rawPrivateChatLogResponse.trim() === '') {
                            console.warn('Empty response for conversation', privateChat.uid);
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

                this.addEventListener('readystatechange', async function () {
                    const responseUrl = this.responseURL || this._ca_url || '';
                    if (this.readyState === 4 && this.status === 200 && this.responseText) {
                        if (self.isChatLogUrl(responseUrl)) {
                            // ✅ Now you can access the right params for this XHR instance
                            self.caProcessChatPayload(this.responseText, qs);
                        }
                        if (self.isUserListUrl(responseUrl)) {
                            await self.processUserListResponse(this.responseText);
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

        buildLogHTML(kind, content, user) {
            const text = String(content || '');

            const escapeHTML = (s) => String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');

            const escapeAttr = (s) => String(s)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            // Special handling for avatar-change events coming from [USER_UPDATE]
            if (kind === 'event') {
                const m = text.match(/^\[USER_UPDATE\]\s+(.+?)\s+has changed (?:his|her) Avatar\s*\(([^)]+)\s*→\s*([^)]+)\)/i);

                if (m) {
                    const userName = m[1] || '';
                    const newAvatar = (m[3] || '').trim();
                    const safeName = escapeHTML(userName);
                    const safeSrc = escapeAttr(newAvatar || '');

                    // Show a clean message + bigger image, no visible raw URL
                    return `
                <span class="ca-log-text-main">
                    ${safeName} has changed ${user.isFemale ? `her` : `his`} avatar:
                </span>
                <a href="${safeSrc}" target="_blank" rel="noopener noreferrer">
                    <img class="chat_image ca-log-avatar-image" src="${safeSrc}" alt="New avatar of ${safeName}">
                </a>
            `;
                }

                // Fallback for other event logs
                return `<span class="ca-log-text-main">${escapeHTML(text)}</span>`;
            }

            // Other kinds (dm-in, dm-out, etc.) – keep as text, but avoid nesting .ca-log-text
            return `<span class="ca-log-text-main">${escapeHTML(text)}</span>`;
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
            if (!e || !e.target) {
                console.error('[CA] _onLogClickGeneric: invalid event/target', e);
                return;
            }

            const target = e.target;
            const entry = target.closest?.(this.sel.log.classes.ca_log_entry);
            if (!entry) {
                // Click outside of a log entry
                return;
            }

            const uid = entry.getAttribute('data-uid') || '';
            const isSystem = (uid === 'system');

            this.verbose('Log entry clicked:', {entry, uid, isSystem});

            // --- 1) Username: always profile ---
            const userLinkEl = target.closest?.(this.sel.raw.log.classes.ca_user_link);
            if (userLinkEl && uid && !isSystem) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();

                this.openProfileOnHost(uid);
                return;
            }

            // --- 2) data-action based buttons (expand/delete/profile/explicit DM) ---
            const actionEl = target.closest?.('[data-action]');
            if (actionEl) {
                const action = String(actionEl.getAttribute('data-action') || '').toLowerCase();

                if (action === 'toggle-expand') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation?.();

                    const expanded = entry.classList.toggle('ca-expanded');

                    // keep the chevron + ARIA in sync
                    const ind = entry.querySelector(this.sel.log.classes.ca_expand_indicator);
                    if (ind) {
                        ind.textContent = expanded ? '▴' : '▾';
                        ind.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                    }
                    return;
                }

                if (action === 'delete-log') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation?.();

                    const guid = entry.getAttribute('data-guid');
                    if (guid && this.ActivityLogStore?.remove) {
                        this.ActivityLogStore.remove(guid);
                    } else {
                        console.warn('[CA] delete-log: no guid or ActivityLogStore.remove missing', {guid});
                    }
                    entry.remove();
                    return;
                }

                if (action === 'open-profile') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation?.();

                    if (!uid || isSystem) {
                        this.verbose('[CA] open-profile: ignoring for system or missing uid', {uid});
                        return;
                    }

                    this.openProfileOnHost(uid);
                    return;
                }

                if (action === 'open-dm') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation?.();

                    if (!uid || isSystem) {
                        this.verbose('[CA] open-dm: ignoring for system or missing uid', {uid});
                        return;
                    }

                    if (!this.UserStore?.getOrFetch) {
                        console.error('[CA] open-dm: UserStore.getOrFetch is not available');
                        return;
                    }

                    const user = await this.UserStore.getOrFetch(uid);
                    if (!user || !user.uid) {
                        console.error('[CA] open-dm: could not fetch user for uid', uid, user);
                        return;
                    }

                    console.log('[CA] Opening private (open-dm) with:', uid, user.name, user.avatar);
                    this.applyLegacyAndOpenDm(user);
                    return;
                }

                // Unknown data-action: fall through to generic handling below
            }

            // --- 3) Generic DM click areas: text + envelope + images ---
            const logTextSel = this.sel.raw.log.classes.ca_log_text;
            const dmLinkSel = this.sel.raw.log.classes.ca_dm_link;

            const dmArea =
                target.closest?.(logTextSel) ||
                target.closest?.(dmLinkSel) ||
                target.closest?.('img.chat_image');

            if (dmArea && uid && !isSystem) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();

                if (!this.UserStore?.getOrFetch) {
                    console.error('[CA] Generic DM click: UserStore.getOrFetch not available');
                    return;
                }

                const user = await this.UserStore.getOrFetch(uid);
                if (!user || !user.uid) {
                    console.error('[CA] Generic DM click: could not fetch user for uid', uid, user);
                    return;
                }

                console.log('[CA] Opening private (generic) with:', uid, user.name, user.avatar);
                this.applyLegacyAndOpenDm(user);
                return;
            }

            // --- 4) Fallback: click on row background → profile (non-system only) ---
            if (uid && !isSystem) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation?.();

                this.openProfileOnHost(uid);
            }
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
            this.verbose(`Open profile on host for uid=${uid}`);

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

                if (this.UserStore.isIncludedForBroadcast(uid)) {
                    out.push(femaleUser);
                } else {
                    console.log('Skipping user:', uid, 'due to exclusion');
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

        cloneAndRenderNewUserElement(parseUserEl, updatedUserJson) {
            const containerContent = this.qs(`.ca-user-list-content`, updatedUserJson.isFemale ? this.ui.femaleUsersContainer : this.ui.otherUsersContainer);
            const newUserEl = parseUserEl.cloneNode(true);

            const wrapper = document.createElement('div');
            wrapper.className = 'ca-username-row';

            // Username
            const nameSpan = document.createElement('span');
            nameSpan.className = 'ca-username';
            nameSpan.textContent = updatedUserJson.name || '<unknown>';

            wrapper.appendChild(nameSpan);

            wrapper.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.openProfileOnHost(updatedUserJson.uid);
            });

            // Age (only if exists)
            if (updatedUserJson?.age > 0) {
                const ageSpan = document.createElement('span');
                ageSpan.className = 'ca-age';
                ageSpan.textContent = ` (${updatedUserJson.age})`;
                wrapper.appendChild(ageSpan);
            }

            this.verbose('[_updateOrCreateUserElement] Created new user element for', updatedUserJson.uid, updatedUserJson.name);

            this.ensureDmLink(newUserEl, updatedUserJson);

            if (updatedUserJson.isFemale && this._isAllowedRank(updatedUserJson.rank)) {
                this.ensureBroadcastCheckbox(newUserEl, updatedUserJson.uid);
            }

            this.updateProfileChip(updatedUserJson.uid, newUserEl);

            // Replace old <p class="username">...</p>
            this.qs('.username', newUserEl).replaceWith(wrapper)
            containerContent.appendChild(newUserEl);
        }

        updateUser(fetchedUserJson, existingUserEl) {
            // Update in store first

            if (!existingUserEl) {
                console.error('[updateUser] No .user_item found for uid:', fetchedUserJson.uid);
                return null;
            }

            // 1. data-* attributes on root
            const attrMap = {
                'data-id': fetchedUserJson.uid,
                'data-name': fetchedUserJson.name,
                'data-avatar': fetchedUserJson.avatar,
                'data-age': fetchedUserJson.age,
                'data-country': fetchedUserJson.country,
                'data-rank': fetchedUserJson.rank,
                'data-gender': fetchedUserJson.gender
            };

            Object.entries(attrMap).forEach(([attr, value]) => {
                existingUserEl.setAttribute(attr, value != null ? String(value) : '');
            });

            const avatarImg = existingUserEl.querySelector('.user_item_avatar img.avav');
            if (avatarImg) {
                avatarImg.src = fetchedUserJson.avatar;
            }

            const usernameEl = existingUserEl.querySelector('.ca-username-row .ca-username');
            usernameEl.textContent = fetchedUserJson.name;

            const ageEl = existingUserEl.querySelector('.ca-username-row .ca-age');
            ageEl.textContent = fetchedUserJson.age;

            // 4. Mood
            const moodEl = existingUserEl.querySelector('.user_item_data .list_mood');
            moodEl.textContent = fetchedUserJson.mood;

            // 6. Country flag
            const flagImg = existingUserEl.querySelector('.user_item_icon.icflag img.list_flag');
            if (flagImg && fetchedUserJson.country) {
                flagImg.src = `system/location/flag/${fetchedUserJson.country}.png`;
            }

            const targetUserContainer = fetchedUserJson.isFemale ? this.ui.femaleUsersContainer : this.ui.otherUsersContainer;
            if (!targetUserContainer.contains(existingUserEl)) {
                console.log(`User ${fetchedUserJson.name} with uid ${fetchedUserJson.uid} switched gender and was in the other user container. Now moving it`);
                targetUserContainer.appendChild(existingUserEl);
                this.verbose('[updateUser] Moved user element to correct container for', fetchedUserJson.uid);
            }

            this.verbose('[updateUser] Updated user element for', fetchedUserJson.uid, attrMap);
            return existingUserEl;
        }


        /* Check if URL is user_list.php */
        isUserListUrl(u) {
            if (!u) return false;
            let s = String(u);
            s = new URL(s, location.origin).pathname;
            return s.indexOf('system/panel/user_list.php') !== -1;
        }

        extractUserInfoFromEl(userEl) {
            if (!userEl) {
                throw new Error(`no element is passed`);
            }
            return {
                uid: this.extractUserId(userEl),
                name: this.extractUsername(userEl),
                avatar: this.extractAvatar(userEl),
                gender: this.extractGender(userEl),
                isFemale: this.extractIsFemale(userEl),
                rank: this.extractRank(userEl),
                age: this.extractAge(userEl),
                country: this.extractCountry(userEl),
                mood: this.extractMood(userEl),
                isLoggedIn: !!(userEl && !userEl.classList.contains('offline'))
            }
        }

        _updateExistingUserMetadata(existingUserJsonFromStore, parsedUserJson, existingUserEl) {
            const uid = existingUserJsonFromStore.uid || parsedUserJson.uid;
            let hasUpdatedUser = false;

            // Always update store first
            const updatedExistingUserJson = this.UserStore.set(parsedUserJson);
            let updatedExistingUserEl = existingUserEl;

            const changedKeys = [];
            const segments = [];

            if (changedKeys.length > 0) {
                // pretty console line
                this._logStyled('[USER_UPDATE] ', segments);

                this.verbose('[USER_UPDATE] JSON changes for user', uid, changedKeys);
                hasUpdatedUser = true;

                if (existingUserEl) {
                    this._applyUserDomChanges(existingUserEl, updatedExistingUserJson, changedKeys);
                } else {
                    this.verbose('[USER_UPDATE] No DOM element found — only JSON updated for uid:', uid);
                }
            }

            const addSegment = (text, style) => {
                segments.push({text, style});
            };

            const checkChange = (key, label, color) => {
                if (existingUserJsonFromStore[key] !== updatedExistingUserJson[key]) {
                    changedKeys.push(key);
                    addSegment(
                        `${updatedExistingUserJson.name} has changed ${updatedExistingUserJson.isFemale ? `her` : `his`} ${label} (${existingUserJsonFromStore[key]} → ${updatedExistingUserJson[key]}), `,
                        color
                    );
                }
            };

            checkChange("name", "Username", "color:#ff55ff");
            checkChange("avatar", "Avatar", "color:#55aaff");
            checkChange("age", "Age", "color:#ffff55");
            checkChange("country", "Country", "color:#55ff55");
            checkChange("rank", "Rank", "color:#ffcc55");
            checkChange("gender", "Gender", "color:#ff88aa"); // or "isFemale"

            if (changedKeys.length > 0) {
                // pretty console line
                this._logStyled('[USER_UPDATE] ', segments);

                this.verbose('[USER_UPDATE] JSON changes for user', uid, changedKeys);
                hasUpdatedUser = true;

                if (existingUserEl) {
                    this._applyUserDomChanges(existingUserEl, updatedExistingUserJson, changedKeys);
                } else {
                    this.verbose('[USER_UPDATE] No DOM element found — only JSON updated for uid:', uid);
                }

                // --- NEW: log avatar changes into the event log with this user ---
                if (changedKeys.includes('avatar')) {
                    const oldAvatar = existingUserJsonFromStore.avatar || '';
                    const newAvatar = updatedExistingUserJson.avatar || '';
                    const pronoun = updatedExistingUserJson.isFemale ? 'her' : 'his';

                    const avatarImgHtml = newAvatar
                        ? `<br><a href="${newAvatar}" target="_blank" rel="noopener noreferrer">
                    <img src="${newAvatar}" class="avav ca-log-avatar-preview" alt="Avatar of ${updatedExistingUserJson.name}">
               </a>`
                        : '';

                    const text = `[USER_UPDATE] ${updatedExistingUserJson.name} has changed ${pronoun} Avatar (${oldAvatar} → ${newAvatar})${avatarImgHtml}`;

                    // pass the user so the log entry is attributed to them (not System)
                    this.logEventLine(text, updatedExistingUserJson);
                }
            }

            return {
                updatedExistingUserJson,
                updatedExistingUserEl,
                hasUpdatedUser
            };
        }

        _applyUserDomChanges(existingUserEl, updatedUserJson, changedKeys) {

            for (const key of changedKeys) {

                if (key === "name") {
                    const el = existingUserEl.querySelector(".ca-username-row .ca-username");
                    if (el) el.textContent = updatedUserJson.name;
                }

                if (key === "avatar") {
                    const img = existingUserEl.querySelector(".user_item_avatar img.avav");
                    if (img) img.src = updatedUserJson.avatar;
                }

                if (key === "age") {
                    const el = existingUserEl.querySelector(".ca-username-row .ca-age");
                    if (el) el.textContent = updatedUserJson.age;
                }

                if (key === "country") {
                    const img = existingUserEl.querySelector(".user_item_icon.icflag img.list_flag");
                    if (img) img.src = `system/location/flag/${updatedUserJson.country}.png`;
                }

                if (key === "rank") {
                    existingUserEl.setAttribute("data-rank", updatedUserJson.rank ?? "");
                }

                if (key === "gender" || key === "isFemale") {
                    const targetContainer = updatedUserJson.isFemale
                        ? this.ui.femaleUsersContainer
                        : this.ui.otherUsersContainer;

                    if (!targetContainer.contains(existingUserEl)) {
                        console.log(
                            `User ${updatedUserJson.name} (${updatedUserJson.uid}) switched gender → moving element.`
                        );
                        targetContainer.appendChild(existingUserEl);
                        this.verbose("[updateUser] Moved user element after gender change");
                    }
                }
            }
            return existingUserEl;
        }

        async syncUsersFromDom(currentOnlineUserEls) {
            // Use a map to track who *might* be logged out after this cycle
            const maybeLoggedOutMap = new Map(
                this.UserStore.getAllLoggedIn().map(user => [String(user.uid), user])
            );

            const resultPatches = [];

            let femaleLoggedOutCount = 0;
            let othersLoggedOutCount = 0;
            let femaleLoggedInCount = 0;
            let othersLoggedInCount = 0;
            let totalOthersLoggedInCount = 0;
            let totalFemaleLoggedInCount = 0;
            let updatedProfileCount = 0;

            for (const parsedUserEl of currentOnlineUserEls) {
                const parsedUserJson = this.extractUserInfoFromEl(parsedUserEl);
                const uid = String(parsedUserJson.uid);

                // Try the map first (fast)
                let existingUserFromStore = maybeLoggedOutMap.get(uid);

                if (!existingUserFromStore) {
                    // Only fall back to store lookup if needed
                    existingUserFromStore = this.UserStore.get(uid);
                }

                const wasLoggedInBefore = !!(existingUserFromStore?.isLoggedIn);

                let existingUserEl = this.qs(
                    `.user_item[data-id="${uid}"]`,
                    this.ui.userContainersWrapper
                );

                let updatedUserJson = null;

                const newUserJson = {
                    ...parsedUserJson,
                    isLoggedIn: true
                };

                if (existingUserFromStore) {
                    const {
                        updatedExistingUserJson,
                        hasUpdatedUser,
                        updatedExistingUserEl
                    } = this._updateExistingUserMetadata(existingUserFromStore, newUserJson, existingUserEl);
                    if (hasUpdatedUser) {
                        updatedProfileCount++;
                    }
                    updatedUserJson = updatedExistingUserJson;
                    existingUserEl = updatedExistingUserEl;
                } else {
                    updatedUserJson = this.UserStore.set(newUserJson);
                    // In case there is no Store json available about this element (glitched element) its better to delete and rebuild it.
                    existingUserEl?.remove();
                }

                // If the user has NO DOM element yet, we must create one
                if (!existingUserEl) {
                    await this.cloneAndRenderNewUserElement(parsedUserEl, updatedUserJson);
                }

                resultPatches.push(updatedUserJson);

                if (maybeLoggedOutMap.has(uid)) {
                    maybeLoggedOutMap.delete(uid);
                }

                if (!wasLoggedInBefore && !this.isInitialLoad) {
                    this.handleLoggedInStatus(updatedUserJson);
                    updatedUserJson.isFemale ? femaleLoggedInCount++ : othersLoggedInCount++;
                }
                updatedUserJson.isFemale ? totalFemaleLoggedInCount++ : totalOthersLoggedInCount++;
            }

            // 3) Whatever is still in maybeLoggedOutMap is now logged out
            for (const [_, user] of maybeLoggedOutMap.entries()) {
                const loggedOutPatch = {
                    ...user,
                    isLoggedIn: false
                };

                resultPatches.push(loggedOutPatch);

                this.handleLoggedInStatus(loggedOutPatch, false);
                loggedOutPatch.isFemale ? femaleLoggedOutCount++ : othersLoggedOutCount++;
            }

            this.UserStore._saveAll(resultPatches);

            this.updateFemaleUserCount(totalFemaleLoggedInCount);
            this.updateOtherUsersCount(totalOthersLoggedInCount);

            console.log('\n');
            this._logSummaryDouble('Female online status changed:', femaleLoggedInCount, femaleLoggedOutCount);
            this._logSummaryDouble('Others online status changed:', othersLoggedInCount, othersLoggedOutCount);
            this._logSummarySingle('Total female online:', totalFemaleLoggedInCount);
            this._logSummarySingle('Others online:', totalOthersLoggedInCount);
            this._logSummarySingle('Total users online: ', currentOnlineUserEls.length);
            console.log('\n');

            if (updatedProfileCount > 0) {
                this._logStyled('', [
                    {
                        text: `Profiles updated: ${updatedProfileCount}`,
                        style: 'color:#ffff55;font-weight:bold'
                    }
                ]);
            }
        }

        _logSummarySingle(label, value) {
            if (!value) return; // hide zero always

            this._logStyled('', [
                {text: `${label}: `, style: 'color:#d1d5db;font-weight:bold'},
                {text: String(value), style: this.colors.SOFT_GREEN}
            ]);
        }

        _logSummaryDouble(label, plus, minus) {
            if (!plus && !minus) return; // hide if both zero

            const labelColor = label.toLowerCase().includes('female')
                ? this.colors.FEMALE_LABEL
                : this.colors.MALE_LABEL;

            const plusStyle = plus ? this.colors.SOFT_GREEN : this.colors.ZERO_GREY;
            const minusStyle = minus ? this.colors.SOFT_RED : this.colors.ZERO_GREY;

            this._logStyled('', [
                {text: `${label} `, style: labelColor},
                {text: '(+', style: this.colors.LIGHT_GREY},
                {text: String(plus), style: plusStyle},
                {text: ' : -', style: this.colors.LIGHT_GREY},
                {text: String(minus), style: minusStyle},
                {text: ')', style: this.colors.LIGHT_GREY}
            ]);
        }


        async processUserListResponse(html) {
            if (typeof html !== "string" || html.trim() === "") {
                console.error("[processUserListResponse] HTML response is empty or not a string");
                return;
            }


            if (this.userParsingInProgress) {
                console.warn(`An earlier job is already parsing results. to prevent corrupt data this one is cancelled.`);
                return;
            }
            this.userParsingInProgress = true;

            // Create a detached container to parse the HTML
            const tempContainer = document.createElement("div");
            tempContainer.innerHTML = html;

            // All users that are *currently online* according to the server response
            const currentOnlineUserEls = Array.from(
                tempContainer.querySelectorAll(".user_item")
            );


            console.log(`\n==== Retrieved ${currentOnlineUserEls.length} users from the online list in this room. Starting to parse, process and render them.`);

            if (currentOnlineUserEls.length === 0) {
                console.warn(
                    "[processUserListResponse] No .user_item elements found in response HTML"
                );
            }

            this.verbose(
                "[processUserListResponse] Parsed online users from HTML:",
                currentOnlineUserEls.length
            );

            // Delegate all heavy lifting (store + DOM + login/offline handling)
            await this.syncUsersFromDom(currentOnlineUserEls);

            if (this.isInitialLoad) {
                await this.restoreLog();
                this.isInitialLoad = false;
            }
            this.userParsingInProgress = false;
        }

        _logStyled(label, segments, labelStyle = 'color:#9cf; font-weight:bold') {
            if (!Array.isArray(segments) || segments.length === 0) {
                return;
            }

            const parts = [];
            const styles = [];

            if (label) {
                parts.push('%c' + label);
                styles.push(labelStyle);
            }

            for (const seg of segments) {
                if (!seg || !seg.text) {
                    continue;
                }

                parts.push('%c' + seg.text);
                styles.push(seg.style || 'color:#ffffff');
            }

            console.log(parts.join(''), ...styles);
        }

        handleLoggedInStatus(user) {
            if (!user) {
                console.error('[USER_LIST] Could not find user in store for uid', user.uid);
            }

            this.debug('Handling logged in status for user: ', user);

            if (!user.isLoggedIn) {
                this.qs(`.user_item[data-id="${user.uid}"]`, this.ui.userContainersWrapper)?.remove();
            }

            if (user.isFemale) {
                this.setLogDotsLoggedInStatusForUid(user.uid, user.isLoggedIn);
                this.logLine(user.isLoggedIn ? 'login' : 'logout', null, user);
            }
            this.debug(`${user.isLoggedIn ? '[LOGIN]' : '[LOGOUT]'} ${user.name} (${user.uid}) logging ${user.isLoggedIn ? 'in' : 'out'}`);
        }

        setLogDotsLoggedInStatusForUid(uid, isLoggedIn) {
            // Select all log dots for this UID
            const selector = `.ca-log-entry[data-uid="${uid}"] ${this.sel.log.classes.ca_log_dot}`;
            const logDots = this.qsa(selector);

            // Apply correct class based on login state
            logDots.forEach(dotEL => {
                this.setLogDotLoggedInStatusForElement(dotEL, isLoggedIn);
            });
        }

        setLogDotLoggedInStatusForElement(dotEl, isLoggedIn) {
            dotEl.classList.remove(this.sel.raw.log.classes.ca_log_dot_green);
            dotEl.classList.remove(this.sel.raw.log.classes.ca_log_dot_red);
            dotEl.classList.remove(this.sel.raw.log.classes.ca_log_dot_gray);

            if (isLoggedIn) {
                dotEl.classList.add(this.sel.raw.log.classes.ca_log_dot_green);
                dotEl.title = "Online";
            } else if (!isLoggedIn) {
                dotEl.classList.add(this.sel.raw.log.classes.ca_log_dot_red);
                dotEl.title = "Offline";
            } else if (typeof isLoggedIn !== 'boolean') {
                throw Error(`Invalid value for isLoggedIn: ${isLoggedIn}`);
            }
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
            this.verbose('Date comparison:', {
                logDate: logDateStr, logDateNum: msgNum,
                watermark, watermarkNum: wmNum
            });
            if (!msgNum) {
                throw new Error(`Invalid MsgNum: ${msgNum}`);
            }

            const isNewer = msgNum >= wmNum; // include equal → not missed at same second
            this.verbose('Date comparison:', {
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

        extractUserId(el) {
            return el.getAttribute('data-id') || null;
        }

        extractUsername(el) {
            const v = el.getAttribute('data-name');
            if (v) {
                return v.trim();
            }
            let n = this.qs('.user_name,.username,.name', el);
            if (n?.textContent) {
                return n.textContent.trim();
            }
            let t = el.getAttribute('title');
            if (t) {
                return t.trim();
            }
            const text = (el.textContent || '').trim();
            const parts = text.split(/\s+/).filter(Boolean);
            parts.sort((a, b) => a.length - b.length);
            return parts[0];
        }

        extractAvatar(el) {
            const img = this.safeQuery(el, 'img[src*="avatar"]') || this.safeQuery(el, '.avatar img') || this.safeQuery(el, 'img');
            const src = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
            return src ? src.trim() : '';
        }

        extractGender(el) {
            return el.getAttribute('data-gender') || null;
        }

        extractIsFemale(el) {
            return el.getAttribute('data-gender') === this.FEMALE_CODE
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

        _withTimeout(startFetchFn, ms = this.userRefreshInterval) {
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
                }).then(res => res.text().then(async response => {
                    let jsonResponse = JSON.parse(String(response));
                    let data = this.toPrivateSendResponse(jsonResponse);

                    if (!data || data.code !== 1) {
                        console.error(`[PrivateSend] Could not parse response from native message send:`, data);
                        return {ok: false, status: res.status, body: jsonResponse || response};
                    }

                    await this.processPrivateSendResponse(data, String(target));
                    return {ok: res.ok, status: res.status, body: jsonResponse || response};
                }));
            }, 10000);
        }


        async searchUserRemoteByUsername(username) {
            const token = this.getToken();

            if (!username) {
                console.error(`[RemoteSearch] No username provided`);
                return null
            }

            console.log(`Starting remote search for profile with username ${username}`);

            const body = new URLSearchParams({
                token,
                cp: 'chat',
                query: String(username),
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
            for (const node of nodes) {
                const user = this.extractUserInfoFromEl(node);
                if (user?.uid) {
                    out.push(user);
                }
            }
            return out;
        }

        findUserById(uid) {
            if (!uid) {
                console.error(`.findUserElementById: id is empty`);
                return null;
            }
            return this.qs(`.user_item[data-id="${uid}"]`, this.ui.userContainersWrapper);
        }

        updateProfileChip(uid, userEl) {
            const unreadReceivedMessagesCount = this.ActivityLogStore.getUnreadReceivedMessageCountByUserUid(uid);
            const sentMessagesCount = this.ActivityLogStore.getAllSentMessagesCountByUserId(uid);
            // const container = userEl.parentElement;
            // if (!container) {
            //     console.error('updateProfileChip: container not found for uid:', uid);
            //     return;
            // }
            this.verbose('Updating profile chip for:', userEl, unreadReceivedMessagesCount, sentMessagesCount);

            // Unread messages → move to the top
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

                // if (container.firstElementChild !== userEl) {
                //     container.insertBefore(userEl, container.firstElementChild);
                // }

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
                chip.textContent = '✓';// 🔑
                userEl.style.display = this.shouldHideRepliedUsers ? 'none' : '';

                // // --- Move user to bottom of container ---
                // this.debug('Moving user to bottom of container:', uid);
                // container.insertBefore(userEl, this.qs('.user_item[data-rank="0"]', container) || container.lastElementChild);

            } else {
                userEl.classList.remove(this.sel.raw.log.classes.ca_unread_messages);
                this.qs(this.sel.raw.log.classes.ca_sent_chip, userEl)?.remove();
                this.debug('Removing sent chip from user:', uid);
            }
        }

        updateProfileChipByUid(uid) {
            const userEl = this.findUserById(uid);

            if (!userEl) {
                // User is probably offline or not in the current list; nothing to update.
                this.debug?.('updateProfileChipByUid: user element not found for uid (probably offline):', uid);
                return;
            }

            this.updateProfileChip(uid, userEl);
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
            this.qs(`#${id}`)?.remove();
            let popup = document.createElement('div');
            popup.id = id;
            popup.classList.add('ca-popup');

            popup.innerHTML =
                '<div class="ca-popup-header">' +
                '  <span class="ca-popup-title"></span>' +
                '  <button class="ca-popup-close" type="button">✕</button>' +
                '</div>' +
                '<div class="ca-popup-body"></div>';

            popup.querySelector('.ca-popup-close')?.addEventListener('click', () => {
                const popup = this.qs(`#${id}`);
                popup.classList.add('ca-popup-open');
                popup.remove();
            });

            const hdr = popup.querySelector('.ca-popup-header');
            let ox = 0, oy = 0, sx = 0, sy = 0;
            const mm = (e) => {
                const dx = e.clientX - sx, dy = e.clientY - sy;
                popup.style.left = (ox + dx) + 'px';
                popup.style.top = (oy + dy) + 'px';
                popup.style.transform = 'none';
            };
            const mu = () => {
                document.removeEventListener('mousemove', mm);
                document.removeEventListener('mouseup', mu);
            };
            if (hdr) hdr.addEventListener('mousedown', (e) => {
                sx = e.clientX;
                sy = e.clientY;
                const r = popup.getBoundingClientRect();
                ox = r.left;
                oy = r.top;
                document.addEventListener('mousemove', mm);
                document.addEventListener('mouseup', mu);
            });

            document.body.appendChild(popup);

            const titleEl = popup.querySelector('.ca-popup-title');
            if (titleEl && typeof title === 'string') {
                titleEl.textContent = title;
            }

            const bodyEl = popup.querySelector('.ca-popup-body');
            if (bodyEl && typeof bodyHtml === 'string') {
                bodyEl.innerHTML = bodyHtml;
            }

            return popup;
        }

        togglePopup(id) {
            const pop = document.getElementById(id);

            if (!pop) {
                console.error('[321ChatAddons] togglePopup: popup not found:', id);
                return;
            }

            // OPEN
            pop.classList.add('ca-popup-open');
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
                id: 'ca-cloudflare-popup',
                title: 'Connection issue',
                bodyHtml
            });

            // Wire refresh button once
            const refreshBtn = pop.querySelector('#ca-cloudflare-refresh');
            refreshBtn.addEventListener('click', () => {
                window.location.reload();
            });

            this.togglePopup('ca-cloudflare-popup');
        }

        /* ---------- Rank filter & selection checkbox ---------- */
        extractRank(el) {
            return el.getAttribute('data-rank') || '';
        }

        /* ---------- Rank filter & selection checkbox ---------- */
        extractAge(el) {
            return el.getAttribute('data-age') || '';
        }

        /* ---------- Rank filter & selection checkbox ---------- */
        extractCountry(el) {
            return el.getAttribute('data-country') || '';
        }

        extractMood(el) {
            return this.qs(`.list_mood`, el).innerHTML;
        }

        /* ---------- Rank filter & selection checkbox ---------- */
        _isAllowedRank(rank) {
            return (rank === '1' || rank === '50') && (roomRank !== '4');
        }

        // more descriptive and self-contained
        async ensureBroadcastCheckbox(el, uid) {
            this.verbose('ensureBroadcastCheckbox:', el, uid);

            const wrap = document.createElement('label');
            wrap.className = 'ca-ck-wrap';
            wrap.title = 'Include in broadcast';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'ca-ck';

            cb.checked = await this.UserStore.isIncludedForBroadcast(uid);

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
            const panelEl = document.createElement('section');
            panelEl.id = this.sel.raw.rightPanel;
            panelEl.classList.add('ca-panel');
            panelEl.id = this.sel.raw.rightPanel;
            panelEl.classList.add('ca-panel');
            panelEl.innerHTML = `
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

            this.qs(`#global_chat`).appendChild(panelEl);
            this.ui.panel = panelEl;
            this.ui.panelNav = panelEl.querySelector('.ca-nav');
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
                        this.verbose('Nav: broadcast clicked');
                        this.openBroadcastModal();
                        break;

                    case 'send-message':
                        this.verbose('Nav: send-specific clicked');
                        this.openSendMessageModal();
                        break;

                    case 'clear-all-logs':
                        this.verbose('Nav: clear-all-logs clicked');
                        this.handleLogClear();
                        break;

                    case 'storage-toggle':
                        this.verbose('Nav: storage-toggle clicked');
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

        createOtherUsersContainer() {
            const otherUsersContainer = document.createElement('div');
            otherUsersContainer.id = this.sel.raw.users.otherUsersContainer;
            otherUsersContainer.className = 'ca-user-list-container ca-collapsed';

            // ----- HEADER -----
            const header = document.createElement('div');
            header.className = 'ca-user-list-header ca-male-users-header';

            const title = document.createElement('div');
            title.className = 'ca-user-list-title';

            const countSpan = document.createElement('span');
            countSpan.className = 'ca-user-list-count';
            countSpan.id = this.sel.raw.users.otherUserCount;
            countSpan.textContent = '0';

            const labelSpan = document.createElement('span');
            labelSpan.textContent = 'Other Users';

            const toggle = document.createElement('div');
            toggle.className = 'ca-user-list-toggle';
            toggle.textContent = '▼';

            title.appendChild(countSpan);
            title.appendChild(labelSpan);
            title.appendChild(toggle);

            header.appendChild(title);

            const otherUsersListContent = document.createElement('div');
            otherUsersListContent.className = 'ca-user-list-content';

            otherUsersContainer.appendChild(header);
            otherUsersContainer.appendChild(otherUsersListContent);

            this.ui.userContainersWrapper.appendChild(otherUsersContainer);
            this.ui.otherUsersContainer = otherUsersContainer;
        }

        createFemaleUsersContainer() {
            const femaleUsersContainer = document.createElement('div');
            femaleUsersContainer.id = this.sel.raw.users.femaleUsersContainer;
            femaleUsersContainer.className = 'ca-user-list-container ca-expanded';

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

            const femaleUsersListContent = document.createElement('div');
            femaleUsersListContent.className = 'ca-user-list-content';

            femaleUsersContainer.appendChild(header);
            femaleUsersContainer.appendChild(femaleUsersListContent);

            this.ui.userContainersWrapper.appendChild(femaleUsersContainer);

            const showBroadcastCheckboxesToggle = sub.querySelector('#ca-female-ck-toggle');
            showBroadcastCheckboxesToggle.checked = this.shouldShowBroadcastCheckboxes;

            showBroadcastCheckboxesToggle.addEventListener('change', (e) => {
                const checked = !!e.target.checked;
                this.shouldShowBroadcastCheckboxes = checked;
                this.Store.set(this.SHOW_BROADCAST_SELECTION_BOXES_KEY, checked);
                femaleUsersContainer.classList.toggle('ca-show-ck', checked);
                this.verbose('[CA] Female user checkbox visibility:', checked ? 'shown' : 'hidden');
            });

            const hideRepliedToggle = sub.querySelector('#ca-female-hide-replied');
            hideRepliedToggle.checked = this.shouldHideRepliedUsers;
            if (hideRepliedToggle) {
                hideRepliedToggle.addEventListener('change', (e) => {
                    const checked = !!e.target.checked;
                    this.verbose('[CA] Hide replied users:', checked);

                    this.shouldHideRepliedUsers = checked;
                    this.Store.set(this.HIDE_REPLIED_USERS_KEY, checked);

                    this.applyHideRepliedUsers(checked);
                });
            } else {
                console.error('.ca-female-hide-replied not found');
            }

            this.verbose('Created female users container without cloning male users container');
            this.ui.femaleUsersContainer = femaleUsersContainer;
        }

        applyHideRepliedUsers(hide) {
            const repliedEls = this.qsa(`${this.sel.log.classes.user_item}${this.sel.log.classes.ca_replied_messages}`, this.ui.femaleUsersContainer);

            repliedEls.forEach((el) => {
                el.style.display = hide ? 'none' : '';
            });
        }

        _setExpanded(container, expanded) {
            if (!container) {
                console.error('[CA] _setExpanded: container missing');
                return;
            }
            container.classList.toggle('ca-expanded', !!expanded);
            container.classList.toggle('ca-collapsed', !expanded);
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

        toggleOriginalUserList(visible) {
            document.querySelector(`#chat_right_data`).style.display = visible ? 'block' : 'none';
            document.querySelector(this.sel.users.otherUsersContainer).style.display = !visible ? 'block' : 'none';
            document.querySelector(this.sel.users.femaleUsersContainer).style.display = !visible ? 'block' : 'none';
        }

        wireListOptionClicks() {
            const friendsBtn = document.querySelector('#friends_option');
            const usersBtn = document.querySelector('#users_option');
            const searchBtn = document.querySelector('#search_option');

            [friendsBtn, searchBtn].forEach(btn => {
                btn.addEventListener('click', () => {
                    this.toggleOriginalUserList(true);
                });
            });

            usersBtn.addEventListener('click', () => {
                this.toggleOriginalUserList(false);
            });
        }

        wireUserContainerHeaders() {
            const setExpanded = (el, expanded) => {
                el.classList.toggle('ca-expanded', !!expanded);
                el.classList.toggle('ca-collapsed', !expanded);
            };

            const onHeaderClick = (clicked) => () => {
                setExpanded(clicked, !clicked.classList.contains('ca-expanded'));
            };

            for (const container of this.ui.userContainersWrapper.children) {
                const header = container.querySelector('.ca-user-list-header .ca-user-list-title');
                header.addEventListener('click', onHeaderClick(container));
            }
        }

        updateFemaleUserCount(count) {
            this.verbose('Updating female user count:', count);
            const headerCounter = this.qs(this.sel.users.femaleUserCount);
            headerCounter.textContent = `${count}`;
        }

        updateOtherUsersCount(count) {
            const headerCounter = this.qs(this.sel.users.otherUserCount);
            headerCounter.textContent = `${count}`;
        }

        createBroadcastPopup() {
            const bodyHtml = `

                  <textarea 
                    id="ca-bc-msg" 
                    class="ca-8" 
                    rows="5" 
                    placeholder="Type the broadcast message..."
                  ></textarea>
                
                  <div class="ca-controls" style="margin-top:4px;">
                    <span id="ca-bc-status" class="ca-status"></span>
                    <a 
                      id="ca-bc-reset" 
                      href="#" 
                      class="ca-reset-link" 
                      style="margin-left:auto"
                    >
                      Reset tracking
                    </a>
                  </div>
                
                  <div class="ca-popup-actions">
                    <button 
                      id="ca-bc-send" 
                      class="ca-btn ca-btn-slim" 
                      type="button"
                    >
                      Send
                    </button>
                  </div>
                `;

            return this.ensurePopup({
                id: 'ca-broadcast-popup',
                title: 'Broadcast message',
                bodyHtml
            });
        }


        createSpecificPopup() {
            const bodyHtml = `
              <div class="ca-row">
                <input 
                  id="ca-specific-username" 
                  class="ca-input-slim" 
                  type="text" 
                  placeholder="Enter username (case-insensitive)"
                >
                <button 
                  id="ca-specific-send" 
                  class="ca-btn ca-btn-slim" 
                  type="button"
                >
                  Send
                </button>
              </div>
            
              <div id="ca-specific-status" class="ca-status"></div>
            
              <textarea 
                id="ca-specific-message" 
                class="ca-8" 
                rows="5" 
                placeholder="Type the message..."
              ></textarea>
            
              <div class="ca-popup-actions">
                <a 
                  id="ca-specific-reset" 
                  href="#" 
                  class="ca-reset-link"
                >
                  Reset tracking
                </a>
              </div>
            `;

            return this.ensurePopup({
                id: 'ca-specific-popup',
                title: 'Send message',
                bodyHtml
            });
        }

        printModalStatus(message) {
            const statusEl = this.qs('#ca-specific-status');
            statusEl.textContent = message;
            return statusEl;
        }

        printModalErrorStatus(errorMessage) {
            const el = this.printModalStatus(errorMessage);
            el.classList.add('error');
            el.classList.remove('success');
            console.warn(errorMessage);
        }

        printModalSuccessStatus(successMessage) {
            const el = this.printModalStatus(successMessage);
            el.classList.add('success');
            el.classList.remove('error');
            console.log(successMessage);
        }

        openSendMessageModal() {
            const pop = this.createSpecificPopup();

            this.qs('#ca-specific-status', pop).textContent = '';

            this.qs('#ca-specific-send', pop).addEventListener('click', async () => {
                const sendPrivateMessageUser = this.qs('#ca-specific-username').value;
                const sendPrivateMessageText = this.qs('#ca-specific-message').value;
                console.log(`[CA] Sending private message to ${sendPrivateMessageUser}:`, sendPrivateMessageText);
                const result = await this.UserStore.getOrFetchByName(sendPrivateMessageUser);
                console.log(result)

                if (Array.isArray(result) && result.length > 1) {
                    console.warn(`Invalid result:`, result);
                    return this.printModalErrorStatus(`Multiple users were found. Make a more specific search.`);
                } else if ((Array.isArray(result) && result.length === 0) || !result[0]) {
                    return this.printModalErrorStatus(`User ${sendPrivateMessageUser} not found`);
                }

                const user = result[0];

                if (!user?.uid) {
                    console.warn(`Invalid user: `, user);
                    return this.printModalErrorStatus(`Returned user doesn't have a uid.`);
                }

                const sendPrivateMessageResponse = await this.sendWithThrottle(user.uid, sendPrivateMessageText)
                    .catch(_ => {
                        return this.printModalErrorStatus(`Error sending private message to ${sendPrivateMessageUser}`);
                    });

                if (sendPrivateMessageResponse.ok) {
                    this.logEventLine(`Sent to ${user.name || user.uid}.`)
                    return this.printModalSuccessStatus(`Private message to ${sendPrivateMessageUser} has been successfully sent`);
                } else {
                    return this.printModalErrorStatus(`Error sending private message to ${sendPrivateMessageUser}`);
                }
            });

            this.togglePopup('ca-specific-popup');
        }

        openBroadcastModal() {
            const broadcastPopupEl = this.createBroadcastPopup();
            const broadcastSendEl = broadcastPopupEl.querySelector('#ca-bc-send');

            broadcastSendEl.addEventListener('click', () => {
                const broadcastMsgEl = this.qs('#ca-bc-msg');
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

            this.togglePopup('ca-broadcast-popup');
        }

        openSettingsPopup() {
            const popup = this.createSettingsPopup();
            if (!popup) {
                console.error('[CA] openSettingsPopup: popup not created');
                return;
            }

            const debugSettingsCheckbox = popup.querySelector('#ca-debug-checkbox-settings');
            const verboseSettingsCheckbox = popup.querySelector('#ca-verbose-checkbox-settings');

            if (!debugSettingsCheckbox || !verboseSettingsCheckbox) {
                console.error('[CA] openSettingsPopup: settings checkboxes not found');
                return;
            }

            debugSettingsCheckbox.checked = !!this.debugMode;
            verboseSettingsCheckbox.checked = !!this.verboseMode;

            // Also keep the nav checkboxes in sync if they exist
            if (this.ui && this.ui.debugCheckbox) {
                this.ui.debugCheckbox.checked = !!this.debugMode;
            }
            if (this.ui && this.ui.verboseCheckbox) {
                this.ui.verboseCheckbox.checked = !!this.verboseMode;
            }

            const applyDebugChange = (enabled) => {
                const safeEnabled = !!enabled;
                this.debugMode = safeEnabled;

                this._setCookie(this.DEBUG_COOKIE, String(safeEnabled));
                localStorage.setItem(this.DEBUG_MODE_KEY, String(safeEnabled));
                if (this.Store) {
                    this.Store.set(this.DEBUG_MODE_KEY, safeEnabled);
                }

                console.log(
                    safeEnabled
                        ? '[DEBUG] Debug mode enabled'
                        : 'Debug mode disabled'
                );

                if (this.ui && this.ui.debugCheckbox) {
                    this.ui.debugCheckbox.checked = safeEnabled;
                }
                if (debugSettingsCheckbox.checked !== safeEnabled) {
                    debugSettingsCheckbox.checked = safeEnabled;
                }
            };

            const applyVerboseChange = (enabled) => {
                const safeEnabled = !!enabled;
                this.verboseMode = safeEnabled;

                this._setCookie(this.VERBOSE_COOKIE, String(safeEnabled));
                localStorage.setItem(this.VERBOSE_MODE_KEY, String(safeEnabled));
                if (this.Store) {
                    this.Store.set(this.VERBOSE_MODE_KEY, safeEnabled);
                }

                console.log(
                    safeEnabled
                        ? '[VERBOSE] Verbose mode enabled'
                        : 'Verbose mode disabled'
                );

                if (this.ui && this.ui.verboseCheckbox) {
                    this.ui.verboseCheckbox.checked = safeEnabled;
                }
                if (verboseSettingsCheckbox.checked !== safeEnabled) {
                    verboseSettingsCheckbox.checked = safeEnabled;
                }
            };

            // Only wire once per popup instance
            if (!debugSettingsCheckbox.dataset.caWired) {
                debugSettingsCheckbox.dataset.caWired = '1';
                debugSettingsCheckbox.addEventListener('change', (e) => {
                    applyDebugChange(!!e.target.checked);
                });
            }

            if (!verboseSettingsCheckbox.dataset.caWired) {
                verboseSettingsCheckbox.dataset.caWired = '1';
                verboseSettingsCheckbox.addEventListener('change', (e) => {
                    applyVerboseChange(!!e.target.checked);
                });
            }

            this.togglePopup('ca-settings-popup');
        }


        createSettingsPopup() {
            const bodyHtml = `
              <div class="ca-section">
                <div class="ca-section-title">
                  <span>Logging</span>
                </div>

                <div class="ca-row">
                  <label class="ca-debug-toggle" title="Enable debug logging">
                    <input type="checkbox" id="ca-debug-checkbox-settings">
                    <span>Debug</span>
                  </label>
                </div>

                <div class="ca-row">
                  <label class="ca-debug-toggle" title="Enable verbose logging (very detailed)">
                    <input type="checkbox" id="ca-verbose-checkbox-settings">
                    <span>Verbose</span>
                  </label>
                </div>
              </div>
            `;

            return this.ensurePopup({
                id: 'ca-settings-popup',
                title: 'Settings',
                bodyHtml
            });
        }


        _bindStaticRefs() {
            this.ui.sentMessagesBox = this.qs(this.sel.log.sent);
            this.ui.receivedMessagesBox = this.qs(this.sel.log.received);
            this.ui.repliedMessageBox = this.qs(this.sel.log.replied);
            this.ui.unrepliedMessageBox = this.qs(this.sel.log.unreplied);
            this.ui.presenceBox = this.qs(this.sel.log.presence);
            this.ui.logClear = this.qs(this.sel.log.clear);
            this.ui.loggingBox = this.qs(this.sel.log.general);

            // Debug / verbose checkboxes in the panel nav
            this.ui.debugCheckbox = this.qs('#ca-debug-checkbox');
            this.ui.verboseCheckbox = this.qs('#ca-verbose-checkbox');

            if (!this.ui.debugCheckbox) {
                console.warn('[CA] _bindStaticRefs: #ca-debug-checkbox not found');
            }

            if (!this.ui.verboseCheckbox) {
                console.warn('[CA] _bindStaticRefs: #ca-verbose-checkbox not found');
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

                console.log(this.debugMode ? '[DEBUG] Debug mode enabled' : 'Debug mode disabled');
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

                console.log(this.verboseMode ? '[VERBOSE] Verbose mode enabled' : 'Verbose mode disabled');
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

            // Expanded state is driven by the container class
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
                console.error('renderLogEntry: Invalid args', {entry: activityLog, user});
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
                console.error('renderLogEntry: No target container for kind', {kind, activityLog, user});
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

            const html = this.buildLogHTML(kind, activityLog.content, user);
            const detailsHTML = this.decodeHTMLEntities(html);

            const isSystemUser = String(user.uid) === 'system';

            const userHTML = `
                <div class="${C.ca_log_cell}">
                    <span class="${C.ca_log_user}">
                        ${
                isSystemUser
                    // System: show label, but not clickable
                    ? `<strong>${user.name || 'System'}</strong>`
                    // Real user: normal clickable profile link
                    : this.userLinkHTML(user)
            }
                    </span>
                </div>
              `;

            // Only show DM icon for real users and non-event logs
            const dmIconHTML = (kind !== 'event' && !isSystemUser)
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
                            `)} </a> ` : '';

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
                        `)}</a> `;

            const guidAttr = guid != null ? ` data-guid="${String(guid)}"` : '';

            const textAction = (kind === 'dm-out')
                ? 'toggle-expand'
                : (kind === 'event' ? '' : 'open-dm');

            const dataActionAttr = textAction
                ? ` data-action="${textAction}"`
                : '';

            const entryHTML = `
                <div class="ca-log-entry ca-log-${mappedKind}"
                     data-uid="${String(user.uid)}"${guidAttr}>
                    <span class="ca-log-ts">${displayTs}</span>
            
                    <div class="${C.ca_log_cell}">
                        <span class="${C.ca_log_dot} ${C.ca_log_dot_gray}">
                            ●
                        </span>
                    </div>
            
                    ${userHTML}
            
                    <span class="${C.ca_log_text}"${dataActionAttr}>
                        ${detailsHTML}
                    </span>
            
                    <div class="${C.ca_log_actions}">
                        ${dmIconHTML}
                        ${deleteIconHTML}
                    </div>
                </div>
            `;

            const parser = new DOMParser();
            const el = parser.parseFromString(entryHTML.trim(), 'text/html').body.firstElementChild;

            if (kind !== 'event') {
                this.setLogDotLoggedInStatusForElement(this.qs(`${this.sel.log.classes.ca_log_dot}`, el), user.isLoggedIn);
            }

            if (!el) {
                console.error('renderLogEntry: Failed to build log entry element', {activityLog, user});
                return;
            }

            targetContainer.appendChild(el);

            // Keep expand button logic
            if (kind !== 'event') {
                const textEl = el.querySelector(`.${C.ca_log_text}`);
                if (textEl) {
                    this.ensureExpandButtonFor_(el, textEl, kind);

                    const ro = new ResizeObserver(() => {
                        this.ensureExpandButtonFor_(el, textEl, kind);
                    });
                    ro.observe(textEl);
                } else {
                    console.warn('renderLogEntry: text element not found for expand logic', {
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

        logEventLine(content, user) {
            let finalUser = null;

            // If a full user object is passed (like updatedExistingUserJson)
            if (user && typeof user === 'object') {
                finalUser = user;
            } else if (typeof user === 'string' && user) {
                // If only a uid string is passed, try to look it up
                finalUser = this.UserStore?.get(user) || null;
            }

            // Fallback: System user if nothing valid was passed
            if (!finalUser) {
                const systemUserFromStore = this.UserStore?.get('system');
                finalUser = systemUserFromStore || {
                    uid: 'system',
                    name: 'System',
                    avatar: ''
                };
            }

            this.logLine('event', content, finalUser);
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
                console.warn('Watermark set but verification failed. Expected:', timestamp, 'Got:', verify);
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
