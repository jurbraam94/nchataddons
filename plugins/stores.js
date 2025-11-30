// (async function () {
/** Key/Value store backed by localStorage */
class SettingsStore {
    constructor({keyValueStore, helpers, logger}) {
        this.DEBUG_COOKIE = `debug`;
        this.VERBOSE_COOKIE = `verbose`;
        this.DEBUG_MODE_KEY = `debugMode`;
        this.VERBOSE_MODE_KEY = `verboseMode`;
        this.PREDEFINED_MESSAGES_KEY = `predefined_messages`;
        this.GLOBAL_WATERMARK_KEY = `global.watermark`;
        this.SHOULD_HIDE_REPLIED_USERS_KEY = `shouldHideRepliedUsers`;
        this.SHOULD_INCLUDE_OTHER_USERS_KEY = `shouldIncludeOtherUsers`;
        this.SHOULD_SHOW_BROADCAST_SELECTION_BOXES_KEY = `shouldShowBroadcastCheckboxes`;
        this.USER_MANAGER_VISIBLE_COLUMNS_PREFS_KEY = `userManagerVisibleColumns`;
        this.LAST_DM_UID_KEY = `lastDmUid`;


        this.store = keyValueStore;
        this.Helpers = helpers;
        this.logger = logger;
    }

    setUserManagerVisibleColumnPrefs(userManagerVisibleColumnPrefs) {
        if (userManagerVisibleColumnPrefs) this.store.set(this.USER_MANAGER_VISIBLE_COLUMNS_PREFS_KEY, String(userManagerVisibleColumnPrefs));
    }

    getUserManagerVisibleColumnPrefs() {
        return this.store.get(this.USER_MANAGER_VISIBLE_COLUMNS_PREFS_KEY) || '';
    }

    getWriteStorageMode(mode) {
        return this.store._writeStorageMode(mode);
    }

    setWriteStorageMode(mode) {
        this.store._writeStorageMode(mode);
    }

    getLastDmUid() {
        return this.store.get(this.LAST_DM_UID_KEY) || '';
    }

    setLastDmUid(lastDmUid) {
        if (lastDmUid) this.store.set(this.LAST_DM_UID_KEY, String(lastDmUid));
    }

    clearLastDmUid() {
        this.store.set(this.LAST_DM_UID_KEY, '');
    }

    getShowBroadcastSelectionBoxes() {
        return this.store.getBool(this.SHOULD_SHOW_BROADCAST_SELECTION_BOXES_KEY, {
            default: false
        });
    }

    setShowBroadcastSelectionBoxes(showBroadcastSelectionBoxes) {
        if (showBroadcastSelectionBoxes) this.store.set(this.SHOULD_SHOW_BROADCAST_SELECTION_BOXES_KEY, String(showBroadcastSelectionBoxes));
    }

    getShouldIncludeOthers() {
        return this.store.getBool(this.SHOULD_INCLUDE_OTHER_USERS_KEY, {
            default: true
        });
    }

    setShouldIncludeOthers(shouldIncludeOthers) {
        if (shouldIncludeOthers) this.store.set(this.SHOULD_INCLUDE_OTHER_USERS_KEY, String(shouldIncludeOthers));
    }

    getHideReplied() {
        return this.store.getBool(this.SHOULD_HIDE_REPLIED_USERS_KEY, {
            default: false
        });
    }

    setHideReplied(hideReplied) {
        if (hideReplied) this.store.set(this.SHOULD_HIDE_REPLIED_USERS_KEY, String(hideReplied));
    }

    getGlobalWatermark() {
        return this.store.get(this.GLOBAL_WATERMARK_KEY, {
            default: this.helpers.getTimeStampInWebsiteFormat()
        });
    }

    getDebugMode() {
        return this.store._getCookie(this.DEBUG_COOKIE) === 'true' ||
            this.store.get(this.DEBUG_MODE_KEY) === 'true';
    }

    getVerboseMode() {
        return this.store._getCookie(this.VERBOSE_COOKIE) === 'true' ||
            this.store.get(this.VERBOSE_MODE_KEY) === 'true';
    }

    setDebugMode(isEnabled) {
        this.store._setCookie(this.DEBUG_COOKIE, String(isEnabled));
        this.store.set(this.DEBUG_MODE_KEY, isEnabled);
    }

    setVerboseMode(isEnabled) {
        this.store._setCookie(this.VERBOSE_COOKIE, String(isEnabled));
        this.store.set(this.VERBOSE_MODE_KEY, isEnabled);
    }

    savePredefinedMessages(list) {
        const arr = Array.isArray(list) ? list : [];
        this.predefinedMessages = arr;
        this.store.setPersisted(this.PREDEFINED_MESSAGES_KEY, arr);
    }

    getPredefinedMessages() {
        if (Array.isArray(this.predefinedMessages) && this.predefinedMessages.length > 0) {
            return this.predefinedMessages;
        }
        const raw = this.store.getPersisted(this.PREDEFINED_MESSAGES_KEY);
        return Array.isArray(raw) ? raw : [];
    }
}

class KeyValueStore {
    constructor() {
        this.STORAGE_KEY_PREFIX = '321chataddons';
        this.PERSIST_STORAGE_KEY_PREFIX = `persist_${this.STORAGE_KEY_PREFIX}`;
        this.STORAGE_COOKIE = `${this.STORAGE_KEY_PREFIX}.storageMode`;

        const StorageMode = this._readStorageMode();
        if (StorageMode === 'wipe') this._clearOwnLocalStorage();
        this.storage = this._chooseStorage(StorageMode) || localStorage;
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

    _writeStorageMode(mode) {
        this._setCookie(this.STORAGE_COOKIE, mode);
        this.storage = this._chooseStorage(mode);
    }

    _chooseStorage(mode) {
        if (mode === 'block') return new NullStorage();
        return localStorage;
    }

    _setCookie(name, value, days = 400) {
        const d = new Date();
        d.setDate(d.getDate() + days);
        document.cookie = `${name}=${encodeURIComponent(value)}; path=/; expires=${d.toUTCString()}; SameSite=Lax`;
    }

    _getCookie(name) {
        const m = document.cookie.match(
            new RegExp(
                "(?:^|; )" +
                name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") +
                "=([^;]*)"
            )
        );
        return m ? decodeURIComponent(m[1]) : null;
    }


    _readStorageMode() {
        const v = (this._getCookie(this.STORAGE_COOKIE) || 'allow').toLowerCase();
        return (v === 'wipe' || v === 'block') ? v : 'allow';
    }

    has(key) {
        return this.storage.getItem(key) !== null;
    }

    getBool(
        key,
        {
            prefix = this.STORAGE_KEY_PREFIX,
            default: defaultIfMissing
        } = {}
    ) {
        const val = this.get(key, {prefix, default: defaultIfMissing});
        return val === true;
    }

    get(
        key,
        {
            prefix = this.STORAGE_KEY_PREFIX,
            default: defaultIfMissing = undefined,
            parseJson = true
        } = {}
    ) {
        const storageKey = `${prefix}.${key}`;
        const raw = this.storage.getItem(storageKey);

        if (raw == null) {
            if (defaultIfMissing !== undefined) {
                this.set(key, defaultIfMissing, prefix);
                return defaultIfMissing;
            }
            return null;
        }

        const trimmed = String(raw).trim();

        if (!parseJson) {
            return trimmed;
        }

        if (
            trimmed === "true" ||
            trimmed === "false" ||
            /^[{\[]/.test(trimmed) ||
            /^-?\d+(\.\d+)?$/.test(trimmed)
        ) {
            try {
                return JSON.parse(trimmed);
            } catch {
                return trimmed;
            }
        }

        return trimmed;
    }


    getPersisted(key) {
        return this.get(key, {prefix: this.PERSIST_STORAGE_KEY_PREFIX});
    }

    set(key, value, prefix = this.STORAGE_KEY_PREFIX) {
        const toStore = (typeof value === "string") ? value : JSON.stringify(value ?? {});
        this.storage.setItem(`${prefix}.${key}`, toStore);
        return true;
    }

    setPersisted(key, value) {
        this.set(key, value, this.PERSIST_STORAGE_KEY_PREFIX);
    }

    delete(key) {
        if (!this.storage) {
            console.error('[KeyValueStore] delete: storage is not available');
            return false;
        }

        if (this.storage.getItem(key) === null) {
            // nothing to delete
            return false;
        }

        this.storage.removeItem(key);
        return true;
    }

}

class ActivityLogStore {
    constructor({keyValueStore, helpers, logger} = {}) {
        this.ACTIVITY_LOG_KEY = `activityLog`;

        this.store = keyValueStore;
        this.Helpers = helpers;
        this.logger = logger;
    }

    getAllOnlineWomen() {
        return this.list().filter(user => user.isFemale && user.online);
    }

    // ---- storage helpers (arrays only) ----
    _getAll() {
        const raw = this.store.get(this.ACTIVITY_LOG_KEY);
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

        this.store.set(this.ACTIVITY_LOG_KEY, next);
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
        this.logger.verbose(`Got all logs for ${uid} with only unread flag set to ${onlyUnread}:`, result);
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
        this.logger.verbose(`Unread messages for Uuid:`, allUnreadMessagesForUid);
        return this.setAll(allUnreadMessagesForUid);
    }

    remove(guid) {
        if (!guid) return false;
        const all = this._getAll();
        const next = all.filter(l => String(l.guid) !== String(guid));
        this.store.set(this.ACTIVITY_LOG_KEY, next);
        return next.length !== all.length;
    }

    clearByKind(kind) {
        if (!kind) return 0;
        const all = this._getAll();
        const next = all.filter(l => l?.kind !== kind);
        this.store.set(this.ACTIVITY_LOG_KEY, next);
        return all.length - next.length;
    }

    clearEvents() {
        return this.clearByKind('event');
    }

    clear() {
        this.store.set(this.ACTIVITY_LOG_KEY, []);
    }
}

/** Users store (array-backed, like ActivityLogStore) */
class UserStore {
    constructor({keyValueStore, api, helpers, logger} = {}) {
        this.USERS_KEY = `users`;

        this.store = keyValueStore;
        this.Api = api;
        this.Helpers = helpers;
        this.logger = logger;
    }

    _deleteUserByUid(uid) {
        if (uid == null) {
            console.error('[UserStore] _deleteUserByUid: uid is null/undefined');
            return false;
        }

        const uidStr = String(uid);
        const all = this._getAll();

        if (!Array.isArray(all) || all.length === 0) {
            return false;
        }

        const next = all.filter(u => String(u.uid) !== uidStr);
        const changed = next.length !== all.length;

        if (!changed) {
            // user not found
            return false;
        }

        this.store.set(this.USERS_KEY, next);
        return true;
    }

    remove(uid) {
        return this._deleteUserByUid(uid);
    }

    // ---- storage helpers (arrays only) ----
    _getAll() {
        const raw = this.store.get(this.USERS_KEY);
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

        this.store.set(this.USERS_KEY, updated);
        return userToEdit;
    }

    _saveAll(usersToEdit) {
        if (!Array.isArray(usersToEdit)) {
            throw new Error('_saveAll expects an array');
        }

        // Build patch map keyed by uid; later entries override earlier ones
        const patchesByUid = new Map();
        for (let i = 0; i < usersToEdit.length; i++) {
            const u = usersToEdit[i];
            if (!u || u.uid == null) {
                continue;
            }
            patchesByUid.set(String(u.uid), u);
        }

        const existingUsers = this._getAll();
        const updatedUsers = new Array(existingUsers.length);

        // 1) Apply patches to existing users (if any)
        for (let i = 0; i < existingUsers.length; i++) {
            const existingUser = existingUsers[i];
            const key = String(existingUser.uid);
            const patch = patchesByUid.get(key);

            if (patch) {
                // patch overwrites fields on existing user
                updatedUsers[i] = {...existingUser, ...patch};
                // remove from map so remaining entries are truly "new" users
                patchesByUid.delete(key);
            } else {
                updatedUsers[i] = existingUser;
            }
        }

        // 2) Any patches left in the map are for *new* users
        if (patchesByUid.size > 0) {
            for (const [, newUser] of patchesByUid.entries()) {
                // defaults for new users
                const userWithDefaults = {
                    ...newUser,
                    parsedDmInUpToLog: 0,
                    isIncludedForBroadcast: true,
                    noNewPrivateDmTries: 0
                };

                updatedUsers.push(userWithDefaults);
            }
        }

        this.store.set(this.USERS_KEY, updatedUsers);
        return updatedUsers;
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

    _mergeUser(newUser) {
        if (!newUser || newUser.uid == null) {
            throw new Error('_mergeUser requires patch.uid');
        }
        const existing = this.get(newUser.uid);
        if (existing) {
            return {
                ...existing,
                ...newUser
            };
        }

        // defaults for new users
        return {
            ...newUser,
            parsedDmInUpToLog: 0,
            isIncludedForBroadcast: true,
            noNewPrivateDmTries: 0
        };
    }


    set(user) {
        if (!user || user.uid == null) {
            throw new Error('set() requires user.uid')
        }
        const merged = this._mergeUser(user);
        this.logger.verbose(`Saving merged user`, user);

        return this._save(merged);
    }

    setParsedDmInUpToLog(uid, parsedDmInUpToLog) {
        const u = this.get(uid);
        if (!u) {
            console.error(`User ${uid} not found, cannot set parsedDmInUpToLog`);
            return null;
        }
        this.logger.debug(`Setting last read for user ${uid} to ${parsedDmInUpToLog}`);
        const updated = {...u, parsedDmInUpToLog};
        return this.set(updated);
    }

    getParsedDmInUpToLog(uid) {
        const u = this.getOrFetch(uid);
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
            const getProfileResponseHtml = await this.Api.searchUserNameRemote(String(id));
            const doc = this.helpers.createElementFromString(getProfileResponseHtml);
            const foundUser = await this.getOrFetchByName(doc?.querySelector('.pro_name')?.textContent?.trim());

            if (foundUser) {
                user = this.set({...foundUser, uid: String(foundUser.uid ?? id)});
            } else {
                console.error(`User ${id} not found, cannot fetch`);
            }
        }

        return user || null;
    }

    async getOrFetchByName(name) {
        let user = this.getByName(name);

        if (!user) {
            const result = this.helpers.parseUserSearchHTML(await this.Api.searchUserRemoteByUsername(String(name)));

            if (Array.isArray(result) && result.length > 1) {
                console.warn(`Invalid result:`, result);
                return null;
            } else if (Array.isArray(result) && result.length === 1) {
                console.log(`Found user ${name} by username, saving to store and returning it:`, result[0]);
                this.set(result[0]);
                return result[0];
            }
            return null;
        }

        return user || null;
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
        if (!this.store || !this.USERS_KEY) {
            console.error('[UserStore] clear: kv or cacheKey missing');
            return;
        }

        if (typeof this.store.delete === 'function') {
            this.store.delete(this.USERS_KEY);
        } else {
            // Fallback: keep old behavior
            this.store.set(this.USERS_KEY, []);
        }
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