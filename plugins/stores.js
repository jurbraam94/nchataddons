(async function () {
    /** Key/Value store backed by localStorage */
    class KeyValueStore {
        constructor({storage}) {
            this.storage = storage || localStorage;
        }

        _key(k) {
            return String(k ?? "");
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
                noNewPrivateDmTries: 0,
                stalePrivateDmBeforeDate: ''  // empty string means "no stale cutoff"
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

// Expose the classes to the page
    window.CAPlugins = {};
    window.CAPlugins.KeyValueStore = KeyValueStore;
    window.CAPlugins.ActivityLogStore = ActivityLogStore;
    window.CAPlugins.UsersStore = UsersStore;
    window.CAPlugins.NullStorage = NullStorage;
})();