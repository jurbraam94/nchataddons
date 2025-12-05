class SettingsStore {
    constructor({keyValueStore, util}) {
        this.DEBUG_COOKIE = `debug`;
        this.VERBOSE_COOKIE = `verbose`;
        this.DEBUG_MODE_KEY = `debugMode`;
        this.VERBOSE_MODE_KEY = `verboseMode`;
        this.PREDEFINED_MESSAGES_KEY = `predefined_messages`;
        this.GLOBAL_WATERMARK_KEY = `global.watermark`;
        this.SHOULD_HIDE_HANDLED_USERS_KEY = `shouldHideHandledUsers`;
        this.SHOULD_INCLUDE_OTHER_USERS_KEY = `shouldIncludeOtherUsers`;
        this.SHOULD_SHOW_BROADCAST_SELECTION_BOXES_KEY = `shouldShowBroadcastCheckboxes`;
        this.USER_MANAGER_VISIBLE_COLUMNS_PREFS_KEY = `userManagerVisibleColumns`;
        this.LAST_DM_UID_KEY = `lastDmUid`;
        this.LAST_PRIVATE_HANDLED_KEY = `lastPrivateHandledId`;
        this.PCOUNT_PROCESSED_KEY = `pcountProcessed`;

        this.store = keyValueStore;
        this.util = util;
    }

    setUserManagerVisibleColumnPrefs = (userManagerVisibleColumnPrefs) => {
        this.store.set(this.USER_MANAGER_VISIBLE_COLUMNS_PREFS_KEY, userManagerVisibleColumnPrefs);
    }

    getUserManagerVisibleColumnPrefs = () => {
        return this.store.get(this.USER_MANAGER_VISIBLE_COLUMNS_PREFS_KEY, {
            parseJson: true
        });
    }

    getWriteStorageMode = (mode) => {
        return this.store._writeStorageMode(mode);
    }

    setWriteStorageMode = (mode) => {
        this.store._writeStorageMode(mode);
    }

    getLastDmUid = () => {
        return this.store.get(this.LAST_DM_UID_KEY) || '';
    }

    setLastDmUid = (lastDmUid) => {
        this.store.set(this.LAST_DM_UID_KEY, String(lastDmUid));
    }

    getlastPrivateHandledId = () => {
        return Number(this.store.get(this.LAST_PRIVATE_HANDLED_KEY)) || 0;
    }

    setlastPrivateHandledId = (lastPrivateHandledId) => {
        this.store.set(this.LAST_PRIVATE_HANDLED_KEY, String(lastPrivateHandledId));
    }

    getPCountProcessed = () => {
        return this.store.get(this.PCOUNT_PROCESSED_KEY) || 0;
    }

    setPCountProcessed = (pCountProcessed) => {
        this.store.set(this.PCOUNT_PROCESSED_KEY, String(pCountProcessed));
    }

    clearLastDmUid = () => {
        this.store.set(this.LAST_DM_UID_KEY, '');
    }

    getShowBroadcastSelectionBoxes = () => {
        return this.store.getBool(this.SHOULD_SHOW_BROADCAST_SELECTION_BOXES_KEY, {
            defaultIfMissing: false
        });
    }

    setShowBroadcastSelectionBoxes = (showBroadcastSelectionBoxes) => {
        this.store.set(this.SHOULD_SHOW_BROADCAST_SELECTION_BOXES_KEY, String(showBroadcastSelectionBoxes));
    }

    getShouldIncludeOthers = () => {
        return this.store.getBool(this.SHOULD_INCLUDE_OTHER_USERS_KEY, {
            defaultIfMissing: true
        });
    }

    setShouldIncludeOthers = (shouldIncludeOthers) => {
        this.store.set(this.SHOULD_INCLUDE_OTHER_USERS_KEY, String(shouldIncludeOthers));
    }

    getHideHandled = () => {
        return this.store.getBool(this.SHOULD_HIDE_HANDLED_USERS_KEY, {
            defaultIfMissing: false
        });
    }

    setHideHandled = (hideHandled) => {
        this.store.set(this.SHOULD_HIDE_HANDLED_USERS_KEY, String(hideHandled));
    }

    getGlobalWatermark = () => {
        return this.store.get(this.GLOBAL_WATERMARK_KEY, {
            defaultIfMissing: this.util.getTimeStampInWebsiteFormat()
        });
    }

    getDebugMode = () => {
        return this.store.getCookie(this.DEBUG_COOKIE) === 'true' ||
            this.store.get(this.DEBUG_MODE_KEY) === 'true';
    }

    getVerboseMode = () => {
        return this.store.getCookie(this.VERBOSE_COOKIE) === 'true' ||
            this.store.get(this.VERBOSE_MODE_KEY) === 'true' || false;
    }

    setDebugMode = (isEnabled) => {
        this.store.setCookie(this.DEBUG_COOKIE, String(isEnabled));
        this.store.set(this.DEBUG_MODE_KEY, isEnabled);
    }

    setVerboseMode = (isEnabled) => {
        this.store.setCookie(this.VERBOSE_COOKIE, String(isEnabled));
        this.store.set(this.VERBOSE_MODE_KEY, isEnabled);
    }

    savePredefinedMessages = (list) => {
        const arr = Array.isArray(list) ? list : [];
        this.predefinedMessages = arr;
        this.store.setPersisted(this.PREDEFINED_MESSAGES_KEY, arr);
    }

    getPredefinedMessages = () => {
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

    _clearOwnLocalStorage = () => {
        console.warn(
            'CLEARING LOCALSTORAGE AND NOT PERSISTING ANY SETTINGS BECAUSE WIPE LOCAL STORAGE IS ENABLED'
        );

        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(this.STORAGE_KEY_PREFIX)) {
                localStorage.removeItem(key);
            }
        });
    }

    _writeStorageMode = (mode) => {
        this.setCookie(this.STORAGE_COOKIE, mode);
        this.storage = this._chooseStorage(mode);
    }

    _chooseStorage = (mode) => {
        if (mode === 'block') return new NullStorage();
        return localStorage;
    }

    setCookie = (name, value, days = 400) => {
        const d = new Date();
        d.setDate(d.getDate() + days);
        document.cookie = `${name}=${encodeURIComponent(value)}; path=/; expires=${d.toUTCString()}; SameSite=Lax`;
    }

    getCookie = (name) => {
        const m = document.cookie.match(
            new RegExp(
                "(?:^|; )" +
                name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") +
                "=([^;]*)"
            )
        );
        return m ? decodeURIComponent(m[1]) : null;
    }


    _readStorageMode = () => {
        const v = (this.getCookie(this.STORAGE_COOKIE) || 'allow').toLowerCase();
        return (v === 'wipe' || v === 'block') ? v : 'allow';
    }

    has = (key) => {
        return this.storage.getItem(key) !== null;
    }

    getBool = (
        key,
        {
            prefix = this.STORAGE_KEY_PREFIX,
            defaultIfMissing
        } = {}
    ) => {
        const val = this.get(key, {prefix, defaultIfMissing: defaultIfMissing});
        return val === true;
    }

    get = (
        key,
        {
            prefix = this.STORAGE_KEY_PREFIX,
            defaultIfMissing = undefined,
            parseJson = true
        } = {}
    ) => {
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

    getPersisted = (key) => {
        return this.get(key, {prefix: this.PERSIST_STORAGE_KEY_PREFIX});
    }

    set = (key, value, prefix = this.STORAGE_KEY_PREFIX) => {
        const toStore = (typeof value === "string") ? value : JSON.stringify(value ?? {});
        this.storage.setItem(`${prefix}.${key}`, toStore);
        return true;
    }

    setPersisted = (key, value) => {
        this.set(key, value, this.PERSIST_STORAGE_KEY_PREFIX);
    }

    delete = (key) => {
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
    constructor({keyValueStore, util} = {}) {
        this.store = keyValueStore;
        this.util = util;

        this.ACTIVITY_LOG_KEY = 'activityLog';

        this.ACTIVITY_LOG_LOGIN_LOGOUT_KEY = 'activityLog_loginLogout';
        this.ACTIVITY_LOG_DM_IN_UNREAD_KEY = 'activityLog_dmInUnread';
        this.ACTIVITY_LOG_DM_IN_HANDLED_KEY = 'activityLog_dmInHandled';
        this.ACTIVITY_LOG_DM_OUT_KEY = 'activityLog_dmOut';
        this.ACTIVITY_LOG_EVENTS_KEY = 'activityLog_events';

        this.ALL_BUCKET_KEYS = [
            this.ACTIVITY_LOG_LOGIN_LOGOUT_KEY,
            this.ACTIVITY_LOG_DM_IN_UNREAD_KEY,
            this.ACTIVITY_LOG_DM_IN_HANDLED_KEY,
            this.ACTIVITY_LOG_DM_OUT_KEY,
            this.ACTIVITY_LOG_EVENTS_KEY
        ];

        // 🔹 Ensure all keys exist in localStorage
        this.initializeStorageBuckets();
    }

    remove = (guid) => {
        if (guid == null || guid === '') {
            console.error('[ActivityLogStore] remove: guid is required');
            return false;
        }

        const guidStr = String(guid);
        let removedCount = 0;

        for (let i = 0; i < this.ALL_BUCKET_KEYS.length; i++) {
            const bucketKey = this.ALL_BUCKET_KEYS[i];
            const existing = this._getAllFromBucket(bucketKey);

            if (existing.length === 0) {
                continue;
            }

            const filtered = existing.filter(log => String(log.guid) !== guidStr);

            if (filtered.length !== existing.length) {
                removedCount += (existing.length - filtered.length);
                this._setAllForBucket(bucketKey, filtered);
            }
        }

        if (removedCount === 0) {
            this.util?.verbose?.(
                '[ActivityLogStore] remove: no log found for guid',
                guidStr
            );
            return false;
        }

        this.util?.verbose?.(
            '[ActivityLogStore] remove: removed entries for guid',
            guidStr,
            'count =',
            removedCount
        );

        return true;
    };


    initializeStorageBuckets() {
        for (const key of this.ALL_BUCKET_KEYS) {
            const existing = this.store.get(key, {parseJson: true});
            if (!Array.isArray(existing)) {
                this.store.set(key, []);   // create empty bucket
            }
        }
    }

    markLogHandled = (guid) => {
        if (!guid) {
            console.error('[ActivityLogStore] markSingleLogHandled: guid is required');
            return null;
        }

        const log = this.get(guid);
        if (!log) {
            console.error('[ActivityLogStore] markSingleLogHandled: no log found for guid', guid);
            return null;
        }

        const updatedLog = {
            ...log,
        };

        // Reuse the same machinery as the bulk method
        this._saveAll([updatedLog], this.ACTIVITY_LOG_DM_IN_HANDLED_KEY);

        this.util?.verbose?.(
            '[ActivityLogStore] markSingleLogHandled: updated',
            updatedLog
        );

        return updatedLog;
    };


    markHandledUntilChatLogId = (uid, lastPrivateHandledId) => {
        if (!uid || lastPrivateHandledId === undefined) {
            console.error(`Uid ${uid} or lastPrivateHandledId ${lastPrivateHandledId} is invalid`);
            return [];
        } else if (lastPrivateHandledId === 0) {
            console.log(
                `lastPrivateHandledId is 0 (this means there are no logs for user ${uid}, nothing to do`
            );
            return [];
        }

        const allUnreadMessagesForUid = this._getAllDmInUnread(uid, true)
            .filter(log =>
                log.guid <= lastPrivateHandledId
            );

        this.util.verbose(`Unread messages for Uid:`, allUnreadMessagesForUid);
        return this._saveAll(allUnreadMessagesForUid, this.ACTIVITY_LOG_DM_IN_HANDLED_KEY);
    };

    clearByLogType = (logType) => {
        if (!logType) {
            console.warn('[ActivityLogStore] clearByLogType called without kind');
            return 0;
        }

        const bucketKeysToClear = [];

        switch (logType) {
            case 'login':
            case 'logout':
                bucketKeysToClear.push(this.ACTIVITY_LOG_LOGIN_LOGOUT_KEY);
                break;

            case 'dm-in-unread':
                bucketKeysToClear.push(this.ACTIVITY_LOG_DM_IN_UNREAD_KEY);
                break;

            case 'dm-in-handled':
                bucketKeysToClear.push(this.ACTIVITY_LOG_DM_IN_HANDLED_KEY);
                break;

            case 'dm-out':
                bucketKeysToClear.push(this.ACTIVITY_LOG_DM_OUT_KEY);
                break;

            case 'event':
                bucketKeysToClear.push(this.ACTIVITY_LOG_EVENTS_KEY);
                break;

            default:
                console.warn(
                    '[ActivityLogStore] clearByKind: unknown kind, nothing cleared',
                    logType
                );
                return 0;
        }

        let removedCount = 0;

        for (let i = 0; i < bucketKeysToClear.length; i++) {
            const bucketKey = bucketKeysToClear[i];

            const existing = this._getAllFromBucket(bucketKey);
            if (!Array.isArray(existing) || existing.length === 0) {
                continue;
            }

            removedCount += existing.length;

            this._setAllForBucket(bucketKey, []);
        }

        return removedCount;
    };

    getAllOnlineWomen() {
        return this.list().filter(user => user.isFemale && user.online);
    }

    _getAllFromBucket(bucketKey) {
        const raw = this.store.get(bucketKey);
        return Array.isArray(raw) ? raw : [];
    }

    _setAllForBucket(bucketKey, logs) {
        if (!Array.isArray(logs)) {
            console.error('[ActivityLogStore] _setAllForBucket: logs must be an array');
            return;
        }
        this.store.set(bucketKey, logs);
    }

    _getAllDmInUnread() {
        return this._getAllFromBucket(this.ACTIVITY_LOG_DM_IN_UNREAD_KEY);
    }

    _getAllDmInHandled() {
        return this._getAllFromBucket(this.ACTIVITY_LOG_DM_IN_HANDLED_KEY);
    }

    _getAllDmIn() {
        const unread = this._getAllDmInUnread();
        const handled = this._getAllDmInHandled();
        return [...unread, ...handled];
    }

    _getAllDmOut() {
        return this._getAllFromBucket(this.ACTIVITY_LOG_DM_OUT_KEY);
    }

    _getAll() {
        const combined = [];
        for (let i = 0; i < this.ALL_BUCKET_KEYS.length; i++) {
            const bucketKey = this.ALL_BUCKET_KEYS[i];
            const arr = this._getAllFromBucket(bucketKey);
            if (Array.isArray(arr) && arr.length > 0) {
                combined.push(...arr);
            }
        }
        return combined;
    }

    saveEvent(log) {
        this._saveAll([log], this.ACTIVITY_LOG_EVENTS_KEY);
        return log;
    }

    saveLoginLogout(log) {
        this._saveAll([log], this.ACTIVITY_LOG_LOGIN_LOGOUT_KEY);
    }

    saveDmInUnread(log) {
        this._saveAll([log], this.ACTIVITY_LOG_DM_IN_UNREAD_KEY);
    }

    saveDmInHandled(log) {
        this._saveAll([log], this.ACTIVITY_LOG_DM_IN_HANDLED_KEY);
    }

    saveDmOut(log) {
        this._saveAll([log], this.ACTIVITY_LOG_DM_OUT_KEY);
    }

    _saveAll(changedLogs, bucketKey) {
        if (!Array.isArray(changedLogs)) {
            console.error('[ActivityLogStore] _saveAll: changedLogs expects an array, got', typeof changedLogs);
            throw new Error('changedLogs expects an array');
        }

        if (typeof bucketKey !== 'string' || bucketKey.trim() === '') {
            console.error('[ActivityLogStore] _saveAll: bucketKey expects a non-empty string, got', bucketKey);
            throw new Error('bucketKey expects a non-empty string');
        }

        if (changedLogs.length === 0) {
            console.warn('[ActivityLogStore] _saveAll: no logs to save for bucket', bucketKey);
            return [];
        }

        const incomingIds = new Set(changedLogs.map(log => String(log.guid)));

        // 1) Load the existing bucket and remove any logs with matching GUIDs
        const existing = this._getAllFromBucket(bucketKey) || [];

        if (!Array.isArray(existing)) {
            console.error('[ActivityLogStore] _saveAll: _getAllFromBucket did not return an array for bucket', bucketKey);
            throw new Error('_getAllFromBucket must return an array');
        }

        const filteredExisting = existing.filter(
            log => !incomingIds.has(String(log.guid))
        );

        // 2) Append the incoming logs and persist for this bucket only
        const updated = filteredExisting.concat(changedLogs);
        this._setAllForBucket(bucketKey, updated);

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

        if (
            Number.isNaN(day) ||
            Number.isNaN(month) ||
            Number.isNaN(hours) ||
            Number.isNaN(minutes)
        ) {
            console.warn('[ActivityLogStore] parseLogDateToNumber: invalid parts', parts);
            return 0;
        }

        return (month * 1_000_000) + (day * 10_000) + (hours * 100) + minutes;
    }

    listLoginLogout(order) {
        return this.list({order, bucketKey: this.ACTIVITY_LOG_LOGIN_LOGOUT_KEY});
    }

    listDmInUnread(order) {
        return this.list({order, bucketKey: this.ACTIVITY_LOG_DM_IN_UNREAD_KEY});
    }

    listDmInHandled(order) {
        return this.list({order, bucketKey: this.ACTIVITY_LOG_DM_IN_HANDLED_KEY});
    }

    listDmOut(order) {
        return this.list({order, bucketKey: this.ACTIVITY_LOG_DM_OUT_KEY});
    }

    listEvents(order) {
        return this.list({order, bucketKey: this.ACTIVITY_LOG_EVENTS_KEY});
    }

    list({order = 'desc', bucketKey} = {}) {
        if (typeof bucketKey !== 'string' || bucketKey.trim() === '') {
            console.error('[ActivityLogStore] list: bucketKey expects a non-empty string, got', bucketKey);
            throw new Error('bucketKey expects a non-empty string');
        }

        if (order !== 'asc' && order !== 'desc') {
            console.error('[ActivityLogStore] list: order must be "asc" or "desc", got', order);
            throw new Error('Invalid order value');
        }

        const logs = this._getAllFromBucket(bucketKey);

        if (!Array.isArray(logs)) {
            console.error('[ActivityLogStore] list: _getAllFromBucket did not return an array for bucket', bucketKey);
            throw new Error('_getAllFromBucket must return an array');
        }

        const arr = [...logs];

        arr.sort((a, b) => {
            const ta = this.parseLogDateToNumber(a?.ts);
            const tb = this.parseLogDateToNumber(b?.ts);

            if (order === 'asc') {
                return ta - tb;
            }

            return tb - ta;
        });

        return arr;
    }

    get(guid) {
        if (!guid) return null;
        return this._getAll().find(log => String(log.guid) === String(guid)) || null;
    }

    getAllByUserUid(uid, onlyUnread = false, alsoFromSelf = false) {
        if (uid == null || uid === '') {
            console.error('[ActivityLogStore] getAllByUserUid: uid is required');
            return [];
        }

        const uidStr = String(uid);

        // Only DM buckets – no login/logout/events needed here
        const source = [
            ...this._getAllDmInUnread(),
            ...this._getAllDmOut()
        ];

        if (!onlyUnread) {
            source.concat(this._getAllDmInHandled())
        }

        const result = source.filter(log => {
            if (String(log.uid) !== uidStr) {
                return false;
            }

            return !(!alsoFromSelf && log.guid === uidStr);
        });

        this.util.verbose(
            `[ActivityLogStore] getAllByUserUid(${uidStr}, onlyUnread=${onlyUnread}, alsoFromSelf=${alsoFromSelf}) →`,
            result
        );

        return result;
    }

    hasSentMessageToUser(uid) {
        return this.getAllSentMessagesByUserId(uid).length > 0;
    }

    getAllReceivedMessagesByUserId(uid, onlyUnread = false) {
        if (uid == null || uid === '') {
            console.error('[ActivityLogStore] getAllReceivedMessagesByUserId: uid is required');
            return [];
        }

        const uidStr = String(uid);

        let logs;

        if (onlyUnread) {
            // Only unread bucket
            logs = this._getAllDmInUnread();
        } else {
            // Both unread + read
            logs = this._getAllDmIn();
        }

        return logs.filter(log => String(log.uid) === uidStr);
    }

    getAllSentMessagesByUserId(uid) {
        if (uid == null || uid === '') {
            console.error('[ActivityLogStore] getAllSentMessagesByUserId: uid is required');
            return [];
        }

        const uidStr = String(uid);
        const logs = this._getAllDmOut();

        return logs.filter(log => String(log.uid) === uidStr);
    }

    getUnreadReceivedMessageCountByUserUid(uid) {
        return this.getAllReceivedMessagesByUserId(uid, true).length;
    }

    getAllSentMessagesCountByUserId(uid) {
        return this.getAllSentMessagesByUserId(uid).length;
    }

    has({guid} = {}) {
        if (guid == null || guid === '') {
            console.error('[ActivityLogStore] has: guid is required');
            return false;
        }

        return this.get(guid) !== null;
    }
}


/** Users store (array-backed, like ActivityLogStore) */
class UserStore {
    constructor({keyValueStore, api, util} = {}) {
        this.USERS_KEY = `users`;

        this.store = keyValueStore;
        this.api = api;
        this.util = util;
        this.newUserBaseData = {
            lastPrivateHandledId: 0,
            lastPCountProcessed: 0,
            isIncludedForBroadcast: true,
            privateDmFetchRetries: 0
        }
    }

    _deleteUserByUid = (uid) => {
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

    remove = (uid) => {
        return this._deleteUserByUid(uid);
    }

    // ---- storage util (arrays only) ----
    _getAll = () => {
        const raw = this.store.get(this.USERS_KEY);
        return Array.isArray(raw) ? raw : [];
    }

    getlastPrivateHandledId = (uid) => {
        return this.get(uid)?.lastPrivateHandledId;
    }

    setlastPrivateHandledId = (uid, lastPrivateHandledId) => {
        const u = this.get(uid);
        if (!u) {
            console.error(`User ${uid} not found, cannot set lastPrivateHandledId`);
            return null;
        }
        this.util.debug(`Setting last read for user ${uid} to ${lastPrivateHandledId}`);
        const updated = {...u, lastPrivateHandledId};
        return this.set(updated);
    }

    getLastPCountProcessed = (uid) => {
        return this.get(uid)?.lastPCountProcessed;
    }

    setLastPCountProcessed = (uid, lastPCountProcessed) => {
        const u = this.get(uid);
        if (!u) {
            console.error(`User ${uid} not found, cannot set lastPCountProcessed`);
            return null;
        }
        this.util.debug(`Setting last read for user ${uid} to ${lastPCountProcessed}`);
        const updated = {...u, lastPCountProcessed};
        return this.set(updated);
    }

    _save = (userToEdit) => {
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

    _saveAll = (usersToEdit) => {
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
                    ...this.newUserBaseData
                };

                updatedUsers.push(userWithDefaults);
            }
        }

        this.store.set(this.USERS_KEY, updatedUsers);
        return updatedUsers;
    }

    // ---- API (array) ----
    list = () => {
        return [...this._getAll()];
    }

    get = (uid) => {
        return this._getAll().find(u => String(u.uid) === String(uid)) || null;
    }

    getByName = (name) => {
        return this._getAll().find(u => String(u.name) === String(name)) || null;
    }

    has = (uid) => {
        return !!this.get(uid);
    }

    _mergeUser = (newUser) => {
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
            ...this.newUserBaseData
        };
    }

    set = (user) => {
        if (!user || user.uid == null) {
            throw new Error('set() requires user.uid')
        }
        const merged = this._mergeUser(user);
        this.util.verbose(`Saving merged user`, user);

        return this._save(merged);
    }

    isLoggedIn = (uid) => {
        const isLoggedIn = this.get(uid)?.isLoggedIn;

        if (isLoggedIn === undefined) {
            throw new Error(`User ${uid} isLoggedIn is undefined`);
        }
        return !!(this.get(uid)?.isLoggedIn);
    }

    getAllLoggedIn = () => {
        return this.list().filter(u => {
            if (u.isLoggedIn === true) {
                return true;
            } else if (u.isLoggedIn === undefined) {
                throw new Error(`User ${u.uid} isLoggedIn is undefined`);
            }
        });
    }

    getAllLoggedInFemales = () => {
        return this.getAllLoggedIn().filter(u => u.isFemale);
    }

    getMalesLoggedIn = () => {
        return this.getAllLoggedIn().filter(u => !u.isFemale);
    }

    getOrFetch = async (id) => {
        let user = this.get(id);
        if (!user) {
            const getProfileResponseHtml = await this.api.searchUserNameRemote(String(id));
            this.util.createElementFromString(getProfileResponseHtml);
            const foundUser = await this.getOrFetchByName(this.util.qs('.pro_name')?.textContent?.trim());

            if (foundUser) {
                user = this.set({...foundUser, uid: String(foundUser.uid ?? id)});
            } else {
                console.error(`User ${id} not found, cannot fetch`);
            }
        }

        return user || null;
    }

    getOrFetchByName = async (name) => {
        let user = this.getByName(name);

        if (!user) {
            const result = this.util.parseUserSearchHTML(await this.api.searchUserRemoteByUsername(String(name)));

            if (Array.isArray(result) && result.length > 1) {
                const exactMatch = result.find(u => u.name === name);
                if (exactMatch) {
                    return exactMatch;
                }
                console.warn(`Invalid result (too many search results, name is not specific enough):`, result);
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

    includeUserForBroadcast = (uid, include) => {
        if (uid == null) return null;
        const u = this.get(uid) || {uid: String(uid)};
        return this.set({...u, isIncludedForBroadcast: !!include});
    }

    isIncludedForBroadcast = async (uid) => {
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

    clear = () => {
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
    getItem = (_) => {
        return null;
    }

    setItem = (_, __) => {
    }

    removeItem = (_) => {
    }

    clear = () => {
    }

    key = (_) => {
        return null;
    }

    get length() {
        return 0;
    }
}