class HostServices {
    constructor({app, util, userStore, activityLogStore, settingStore, api, popups}) {
        this.app = app;
        this.util = util;
        this.userStore = userStore;
        this.activityLogStore = activityLogStore;
        this.settingsStore = settingStore;
        this.api = api;
        this.popups = popups;

        this.FEMALE_CODE = '2';

        this._audioGate = {
            userInteracted: false,
            pending: null,
            origPlay: null,
            onInteract: null,
            installed: false
        };

        this.colors = {
            SOFT_GREEN: 'color:#8bdf8b',
            SOFT_RED: 'color:#d88989',
            GREY: 'color:#9ca3af',
            GREY_NUM: 'color:#6b7280',
            SOFT_PINK: 'color:#e0a2ff',
            SOFT_BLUE: 'color:#82aaff'
        }

        this.isInitialLoad = true;

        this.userParsingInProgress = false;

        this._lastSendAt = 0;
        this.userRefreshInterval = 30000;

        this.shouldIncludeFemaleUsers = true;
        this.shouldIncludeOtherUsers = true;

        this.watermark = null;

        this._xhrOpen = null;
        this._xhrSend = null;

        this.state = {
            CHAT_CTX: {
                caction: '', room: '', notify: '', curset: ''
            }
        };
    }

    init = async () => {
        this.restoreAllLogs();
        await this.syncUsersFromDom();

        this.installNetworkTaps();
        this.installPrivateSendInterceptor();
        this._removeSuperBotMethods();
        this._installAudioAutoplayGate();
        await this.startRefreshUsersLoop({intervalMs: 30000, runImmediately: true});

        this.watermark = this.settingsStore.getGlobalWatermark();
        await this.restoreLastDmFromStore();

        if (this.isInitialLoad) {
            this.isInitialLoad = false;
        }

        this.app.scrollAllBoxesToBottom();
    }

    _removeSuperBotMethods = () => {
        window.sendSuperbotMain = () => {
            const message = `!!! Prevented a call to superbot main method.`;
            console.error(message);
            this.logEvent(message);
        };
        window.sendSuperbotPrivate = () => {
            const message = `!!! Prevented a call to superbot private method.!`;
            console.error(message);
            this.logEvent(message);
        };
    }

    syncUsersFromDom = async () => {
        let currentOnlineUserEls;
        let loggedInUsers;
        let targetContainer;
        const totalUsersCount = this.util.qsa('.user_item', this.app.ui.hostUsersContainer).length;
        let totalOthersLoggedInCount;
        let totalFemaleLoggedInCount;
        if (this.app.expandedState.femaleUsers) {
            targetContainer = this.app.ui.femaleUsersContainer;
            loggedInUsers = this.userStore.getAllLoggedInFemales();
            currentOnlineUserEls = this.util.qsa(`.user_item[data-gender="${this.FEMALE_CODE}"]`, this.app.ui.hostUsersContainer);
            totalFemaleLoggedInCount = currentOnlineUserEls.length;
            totalOthersLoggedInCount = totalUsersCount - totalFemaleLoggedInCount;
        } else if (this.app.expandedState.otherUsers) {
            targetContainer = this.app.ui.otherUsersContainer;
            loggedInUsers = this.userStore.getAllLoggedInOthers();
            currentOnlineUserEls = this.util.qsa(`.user_item[data-gender]:not([data-gender="${this.FEMALE_CODE}"])`, this.app.ui.hostUsersContainer);
            totalOthersLoggedInCount = currentOnlineUserEls.length;
            totalFemaleLoggedInCount = totalUsersCount - totalOthersLoggedInCount;
        }

        const maybeLoggedOutMap = new Map();
        for (let i = 0; i < loggedInUsers.length; i++) {
            const user = loggedInUsers[i];
            maybeLoggedOutMap.set(String(user.uid), user);
        }

        const resultPatches = [];
        let femaleLoggedOutCount = 0;
        let othersLoggedOutCount = 0;
        let femaleLoggedInCount = 0;
        let othersLoggedInCount = 0;
        let updatedProfileCount = 0;

        for (let i = 0; i < currentOnlineUserEls.length; i++) {
            const parsedUserItemEl = currentOnlineUserEls[i];
            const parsedUserJson = this.util.extractUserInfoFromEl(parsedUserItemEl);

            // Find the existing DOM element for this user (if any)
            let existingUserEl = null;

            const newUserJson = {
                ...parsedUserJson,
                isLoggedIn: true
            };

            let updatedUserJson;

            const existingUserJsonFromStore = this.userStore.get(parsedUserJson.uid);
            if (existingUserJsonFromStore) {
                if (!this.isInitialLoad) {
                    existingUserEl = this.util.qs(`.ca-user-item.user_item[data-id="${parsedUserJson.uid}"]`, {
                        root: this.app.ui.userContainersWrapper,
                        ignoreWarning: true
                    });
                }

                const {
                    updatedExistingUserJson,
                    updatedExistingUserEl,
                    hasUpdatedUser,
                    loggedInChanged
                } = this.updateExistingUserMetadata(
                    existingUserJsonFromStore,
                    newUserJson,
                    existingUserEl
                );

                updatedUserJson = updatedExistingUserJson;

                if (loggedInChanged) {
                    this.handleLoggedInStatus(updatedUserJson);
                }

                if (hasUpdatedUser) {
                    updatedProfileCount++;
                    resultPatches.push(updatedUserJson);
                }

                existingUserEl = updatedExistingUserEl;
            } else {
                this.util.logStyled('[USER_UPDATE] ', [
                    {
                        text: `New user ${newUserJson.name} has logged in.`,
                        style: this.colors.SOFT_GREEN
                    }
                ]);
                resultPatches.push(newUserJson);
                updatedUserJson = newUserJson;

                this.handleLoggedInStatus(updatedUserJson);
                if (updatedUserJson.isFemale) {
                    femaleLoggedInCount++;
                } else {
                    othersLoggedInCount++;
                }
            }

            // If there's still no DOM element for this user, clone + render a new one
            if (!existingUserEl) {
                this.app.cloneAndRenderNewUserElement(parsedUserItemEl, updatedUserJson, targetContainer);
            }

            if (this.isInitialLoad) {
                // Track login status changes (same logic as before)
                this.app.setLogDotsLoggedInStatusForUid(updatedUserJson.uid, updatedUserJson.isLoggedIn);
            }

            // User is no longer a candidate for "logged out"
            if (maybeLoggedOutMap.has(parsedUserJson.uid)) {
                maybeLoggedOutMap.delete(parsedUserJson.uid);
            }
        }

        // Any users left in maybeLoggedOutMap have gone offline
        for (const [, user] of maybeLoggedOutMap.entries()) {
            const loggedOutPatch = {
                ...user,
                isLoggedIn: false
            };

            resultPatches.push(loggedOutPatch);
            this.handleLoggedInStatus(loggedOutPatch, false);

            this.util.logStyled('[USER_UPDATE] ', [
                {
                    text: `${user.name} has logged off.`,
                    style: this.colors.SOFT_RED
                }
            ]);

            if (loggedOutPatch.isFemale) {
                femaleLoggedOutCount++;
            } else {
                othersLoggedOutCount++;
            }
        }

        this.userStore._saveAll(resultPatches);

        this.util.qsId(this.app.sel.otherUserCount).textContent = `${totalOthersLoggedInCount}`;
        this.util.qsId(this.app.sel.femaleUserCount).textContent = `${totalFemaleLoggedInCount}`;

        // Logging (unchanged)
        console.log('\n');
        this.util.logSummaryDouble('Female online status changed:', femaleLoggedInCount, femaleLoggedOutCount);
        this.util.logSummaryDouble('Others online status changed:', othersLoggedInCount, othersLoggedOutCount);
        console.log('\n');

        if (updatedProfileCount > 0) {
            this.util.logStyled('', [
                {
                    text: `Profiles updated: ${updatedProfileCount}`,
                    style: 'color:#ffff55;font-weight:bold'
                }
            ]);
        }

    }

    processUserListResponse = async (html) => {
        if (typeof html !== "string" || html.trim() === "") {
            console.error("[processUserListResponse] HTML response is empty or not a string");
            return;
        }

        if (this.userParsingInProgress) {
            console.warn(`An earlier job is already parsing results. to prevent corrupt data this one is cancelled.`);
            return;
        }
        this.userParsingInProgress = true;

        const newHostContainer = this.util.createElementFromString(html);
        this.app.ui.hostUsersContainer.replaceWith(newHostContainer);
        this.app.ui.hostUsersContainer = newHostContainer;

        await this.syncUsersFromDom();

        this.userParsingInProgress = false;
    }

    updateExistingUserMetadata = (existingUserJsonFromStore, parsedUserJson, existingUserEl) => {
        const uid = existingUserJsonFromStore.uid || parsedUserJson.uid;
        let hasUpdatedUser = false;
        const updatedExistingUserJson = {
            ...existingUserJsonFromStore,
            ...parsedUserJson
        };
        let updatedExistingUserEl = existingUserEl;
        const changedKeys = [];
        const segments = [];
        let loggedInChanged = false;

        const addSegment = (text, style) => {
            segments.push({text, style});
        };

        const checkChange = (key, label, color, overrideText = null) => {
            if (existingUserJsonFromStore[key] !== updatedExistingUserJson[key]) {
                changedKeys.push(key);
                const text = overrideText ? overrideText : `${updatedExistingUserJson.name} has changed ${updatedExistingUserJson.isFemale ? `her` : `his`} ${label} (${existingUserJsonFromStore[key]} → ${updatedExistingUserJson[key]}), `;
                addSegment(
                    text,
                    color
                );

                if (key.includes('avatar')) {
                    const oldAvatar = existingUserJsonFromStore.avatar || '';
                    const newAvatar = updatedExistingUserJson.avatar || '';
                    const pronoun = updatedExistingUserJson.isFemale ? 'her' : 'his';
                    const text = `has changed ${pronoun} Avatar.`;

                    if (!this.isInitialLoad) {
                        this.logEvent(text, updatedExistingUserJson, [oldAvatar, newAvatar]);
                    }
                } else if (key !== "isLoggedIn") {
                    this.logEvent(text, updatedExistingUserJson);
                } else if (key === "isLoggedIn") {
                    loggedInChanged = true;
                }
            }
        };

        checkChange("name", "Username", "color:#ff55ff");
        checkChange("avatar", "Avatar", "color:#55aaff");
        checkChange("age", "Age", "color:#ffff55");
        checkChange("country", "Country", "color:#55ff55");
        checkChange("rank", "Rank", "color:#ffcc55");
        checkChange("gender", "Gender", "color:#ff88aa");
        checkChange("isLoggedIn", "", this.colors.SOFT_GREEN, `${updatedExistingUserJson.name} has logged in.`);

        if (changedKeys.length > 0) {
            this.util.logStyled('[USER_UPDATE] ', segments);

            this.util.verbose('[USER_UPDATE] JSON changes for user', uid, changedKeys);
            hasUpdatedUser = true;

            if (existingUserEl) {
                this.app.applyUserDomChanges(existingUserEl, updatedExistingUserJson, changedKeys);
            } else {
                this.util.verbose('[USER_UPDATE] No DOM element found — only JSON updated for uid:', uid);
            }
        }

        return {
            updatedExistingUserJson,
            updatedExistingUserEl,
            hasUpdatedUser,
            loggedInChanged
        };
    }


    fetchPrivateMessagesForUid = async (uid) => {
        let bodyObj = {};
        if (!uid) {
            console.error('[CA] fetchPrivateMessagesForUid called without uid');
            return [];
        }

        try {
            bodyObj = {
                cp: 'chat',
                fload: '1',
                preload: '1',
                caction: String(this.state.CHAT_CTX.caction),
                last: 99999999999999, //prevents regular chat messages to be fetched too.
                priv: uid,
                lastp: this.userStore.getlastPrivateHandledId(uid),
                pcount: this.userStore.getLastPCountProcessed(uid),
                room: String(this.state.CHAT_CTX.room),
                notify: String(this.state.CHAT_CTX.notify),
                curset: String(this.state.CHAT_CTX.curset)
            };

            console.log('[CA] fetchPrivateMessagesForUid body -> ', bodyObj);
            const result = await this.api.fetchChatLog(bodyObj);
            console.log(result);
            return result;
        } catch (e) {
            // Attach a readable label for the error handler
            e._ca_loopLabel = 'FETCH_PRIVATE_MESSAGES_FOR_UID';

            // Attach rich context for stopOnError to print
            e._ca_context = {
                function: 'f etchPrivateMessagesForUid',
                user: {
                    lastPrivateHandledId: this.userStore.getlastPrivateHandledId(uid),
                    pcount: this.userStore.getLastPCountProcessed(uid)
                },
                chatCtx: {
                    caction: this.state?.CHAT_CTX?.caction,
                    room: this.state?.CHAT_CTX?.room,
                    notify: this.state?.CHAT_CTX?.notify,
                    curset: this.state?.CHAT_CTX?.curset
                },
                bodyObj,
            };

            this.stopOnError(e);
            return '';
        }
    }

    processNewIncomingPrivateMessage = (newPrivateConversationMessage, user) => {
        console.log(`New incoming private message ${newPrivateConversationMessage.logId} for user ${user.uid}`, newPrivateConversationMessage);
        this.logDmInUnread(this.app.decodeHTMLEntities(newPrivateConversationMessage?.log_content), user);
        if (user.isLoggedIn) {
            this.app.updateProfileChipByUid(user.uid);
        } else {
            this.util.verbose('[CA] Skipping profile chip update for uid', user.uid, 'because user is not logged in');
        }
    }

    processFetchedPrivateConversationMessages = async (privateConversationMessages, fromUid, lastPCountProcessed) => {
        let newMessages = 0;
        let skippedMessages = 0;
        let skippedReasons = '';
        let user = await this.userStore.getOrFetch(fromUid);
        let lastPrivateHandledId = user.lastPrivateHandledId;

        if (privateConversationMessages.length > 0) {
            for (const privateConversationMessage of privateConversationMessages) {
                const validationResult = this.validatePrivateChatLog(
                    privateConversationMessage,
                    lastPrivateHandledId
                );

                if (!validationResult.accepted) {
                    skippedReasons += `Skipped ${validationResult.logId}: ${validationResult.reason}\n`;
                    skippedMessages++;
                    continue;
                }

                this.processNewIncomingPrivateMessage(privateConversationMessage, user);

                if (validationResult.logId > lastPrivateHandledId) {
                    lastPrivateHandledId = validationResult.logId;
                }

                newMessages++;
            }

            this.util.scrollToBottom(this.app.ui.caPrivateMessagesSlot);
        } else {
            console.log(`No new private chat logs for user ${user.uid}`);
        }

        const updatedUser = {
            ...user,
            lastPCountProcessed: lastPCountProcessed
        };

        if (newMessages > 0) {
            if (lastPrivateHandledId > (user.lastPrivateHandledId)) {
                updatedUser.lastPrivateHandledId = lastPrivateHandledId;
                this.util.verbose(
                    `[PrivateChat] Setting lastPrivateHandledId for user ${user.uid} to ${lastPrivateHandledId}`
                );
            }

            if (updatedUser.privateDmFetchRetries) {
                updatedUser.privateDmFetchRetries = 0;
            }

        } else if (skippedMessages === 0) { // There were no messages at all
            const prevTries = Number(user.privateDmFetchRetries) || 0;
            const tries = prevTries + 1;
            updatedUser.privateDmFetchRetries = tries;

            console.warn(
                `[PrivateChat] No messages accepted for uid ${user.uid} (attempt ${tries})`
            );

            if (tries >= 3) {
                const hadNonZeroParsedBefore = (user.lastPrivateHandledId || 0) > 0;

                if (hadNonZeroParsedBefore) {
                    updatedUser.lastPrivateHandledId = 0;
                    console.warn(
                        `[PrivateChat] ${tries}x nothing parsed for uid ${user.uid}; ` +
                        `resetting complete chat history (setting lastPrivateHandledId to 0)`
                    );
                } else {
                    // // Stage 2: we are ALREADY at lastPrivateHandledId === 0 and still
                    // // getting nothing accepted after multiple tries -> hard abort.
                    // console.error(
                    //     `[PrivateChat] ${tries}x nothing parsed for uid ${user.uid} with lastPrivateHandledId already 0. ` +
                    //     `Aborting private DM polling via killswitch.`
                    // );
                    //
                    // const err = new Error(
                    //     `[PrivateChat] Repeatedly failed to parse any private DM logs for uid ${user.uid} ` +
                    //     `even from lastPrivateHandledId=0 (attempts=${tries}).`
                    // );
                    //
                    // // Label for our global error handler
                    // err._ca_loopLabel = 'PRIVATE_DM_POLL_LOOP';
                    //
                    // // Attach rich context for stopOnError()
                    // err._ca_context = {
                    //     function: 'ca ProcessPrivateLogResponse',
                    //     uid: user.uid,
                    //     initialFetch,
                    //     attemptsWithoutMessages: tries,
                    //     lastPrivateHandledIdBefore: user.lastPrivateHandledId || 0,
                    //     lastPrivateHandledIdAfter: updatedUser.lastPrivateHandledId || 0,
                    //     hasLogs,
                    //     privateChatLogsLength: hasLogs ? privateChatLogs.length : 0,
                    //     // Keep this small – we don't want to flood logs with full history
                    //     sampleLogs: hasLogs ? privateChatLogs.slice(0, 3) : []
                    // };
                    //
                    // this.stopOnError(err);
                    // // Hard abort: don't continue processing this user any further
                    return;
                }
            }
        }

        this.userStore.set(updatedUser);

        if (skippedReasons.length > 0) {
            this.util.verbose(skippedReasons);
        }
    }

    processPrivateConversationMessages = async (privateConversation, lastPCountProcessed) => {
        console.log('Fetch private messages for conversation', privateConversation.uid);

        const fetchedConversationPrivateMessages = await this.fetchPrivateMessagesForUid(privateConversation.uid);

        if (!fetchedConversationPrivateMessages) {
            console.warn('Empty response for conversation', privateConversation.uid);
        }

        const privateConversationMessages =
            (Array.isArray(fetchedConversationPrivateMessages?.pload) && fetchedConversationPrivateMessages?.pload?.length ? fetchedConversationPrivateMessages.pload :
                (Array.isArray(fetchedConversationPrivateMessages?.plogs) ? fetchedConversationPrivateMessages.plogs : []));

        await this.processFetchedPrivateConversationMessages(
            privateConversationMessages, privateConversation.uid, lastPCountProcessed,
        );
    }

    handleLoggedInStatus = (user) => {
        if (!user) {
            console.error('[USER_LIST] Could not find user in store for uid', user.uid);
        }

        this.util.verbose('Handling logged in status for user: ', user);

        if (!user.isLoggedIn) {
            this.util.qs(`.user_item[data-id="${user.uid}"]`, {
                root: this.app.ui.userContainersWrapper,
                ignoreWarning: this.isInitialLoad
            })?.remove();
        }

        if (user.isFemale) {
            this.app.setLogDotsLoggedInStatusForUid(user.uid, user.isLoggedIn);
            if (user.isLoggedIn) {
                this.logLogin(user)
            } else {
                this.logLogout(user)
            }
        }
        this.util.verbose(`${user.isLoggedIn ? '[LOGIN]' : '[LOGOUT]'} ${user.name} (${user.uid}) logging ${user.isLoggedIn ? 'in' : 'out'}`);
    }

    restoreLastDmFromStore = async () => {
        const uid = this.settingsStore.getLastDmUid();
        if (!uid) {
            this.util.debug('There was no uid for a last dm');
            return;
        }

        this.popups.openAndRememberPrivateChat(await this.userStore.getOrFetch(uid));
    }

    parsePrivateConversationsHtmlResponse = (html) => {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const nodes = tmp.querySelectorAll('.fmenu_item.fmuser.priv_mess');
        const out = [];
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            const info = el.querySelector('.fmenu_name.gprivate');
            if (!info) continue;
            const id = (info.getAttribute('data') || '').trim();
            const cntEl = el.querySelector('.ulist_notify .pm_notify');
            let unread = 0;
            if (cntEl) {
                const t = (cntEl.textContent || '').trim();
                unread = parseInt(t.replace(/\D+/g, ''), 10) || 0;
            }
            if (id && id.length) {
                out.push({uid: Number(id)});
            }
        }

        tmp.innerHTML = '';
        this.util.debug('Parsed', out.length, 'private conversation' + (out.length !== 1 ? 's' : ''));
        return out;
    }

    processPrivateConversationsList = async (lastPCountProcessed) => {
        const privateConversationsHtmlResponse = await this.api.fetchPrivateNotify();
        const privateConversationsToProcess = this.parsePrivateConversationsHtmlResponse(privateConversationsHtmlResponse);

        this.util.debug('Sorted private conversations:', privateConversationsToProcess);
        this.util.verbose('Private conversations returned:', privateConversationsToProcess.length, privateConversationsToProcess);

        if (!privateConversationsToProcess.length) {
            console.log('None of the conversations has potential new messages');
            return;
        }

        this.util.debug('Fetching', privateConversationsToProcess.length, 'private conversations' + (privateConversationsToProcess.length !== 1 ? 's' : ''), 'with potential new messages.');

        for (const privateConversation of privateConversationsToProcess) {
            await this.processPrivateConversationMessages(privateConversation, lastPCountProcessed);
        }
    }

    validatePrivateChatLog = (privateConversationMessage, lastPrivateHandledId) => {
        const initialFetch = lastPrivateHandledId === 0;
        if (String(privateConversationMessage.user_id) === String(user_id)) {
            return {accepted: false, logId: privateConversationMessage.log_id, reason: 'from myself'};
        }

        this.util.verbose(
            `Initial fetch: skipping old message ${privateConversationMessage.log_id} for uid ${privateConversationMessage.log_id}; ` +
            `watermark=${this.watermark}`
        );

        if (initialFetch && !this.isMessageNewer(privateConversationMessage.log_date)) {
            return {accepted: false, logId: privateConversationMessage.log_id, reason: 'too old'};
        }

        if (privateConversationMessage.log_id <= lastPrivateHandledId) {
            return {accepted: false, logId: privateConversationMessage.log_id, reason: 'already shown'};
        }

        return {accepted: true, logId: privateConversationMessage.log_id, reason: 'ok'};
    }

    caProcessChatPayload = async (txt, fromUid, lastPCountProcessed) => {
        if (!txt || typeof txt !== 'string' || txt.trim() === '') {
            console.warn('Empty or invalid chat payload response');
            return;
        }

        const data = JSON.parse(String(txt));
        const pico = data?.pico ? Number(data.pico) : 0;

        // If the response already contained new private messages
        if (data.pload?.length > 0) {
            console.log(`Pload count: ${data.pload?.length || 0}, start processing private messages..`);
            await this.processFetchedPrivateConversationMessages(
                data.pload, fromUid, lastPCountProcessed
            );
        } else if (data.plogs?.length > 0) {
            console.log(`Plogs count: ${data.pload?.length || 0}, start processing private messages..`);
            await this.processFetchedPrivateConversationMessages(
                data.plogs, fromUid, lastPCountProcessed
            );
        } else if (pico > 0) {
            console.log(`Unread private messages ("pico") count from the private messages website menu: ${pico}. Start parsing  the users from this menu and then the messages.`);
            // Otherwise start fetching all private messages from the host website
            await this.processPrivateConversationsList(lastPCountProcessed);
        } else {
            this.util.verbose('No pload or plogs (new private messages) in chat payload response, skipping processing..');
        }
    }

    caUpdateChatCtxFromBody = (searchParams) => {
        if (this.caUpdateChatCtxFromBody._initialized) {
            this.util.verbose(`CHAT_CTX already initialized`);
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

        this.util.verbose(`CHAT_CTX is initialized`, this.state.CHAT_CTX);
        this.caUpdateChatCtxFromBody._initialized = true;
    }

    stopOnError = (exception) => {
        if (!exception) {
            console.error('[CA] stopOnError called without an exception object');
            this.destroy();
            return;
        }

        console.error('================ [CRITICAL ERROR] ================');

        // Human label for where it came from (loop / network tap / method)
        if (exception._ca_loopLabel) {
            console.error('[CA] Origin label:', exception._ca_loopLabel);
        }

        // --- NEW: explicitly report whether _ca_context exists ---
        const hasContextProp = Object.prototype.hasOwnProperty.call(exception, '_ca_context');
        console.error('[CA] _ca_context present on exception?', hasContextProp);

        if (hasContextProp) {
            const ctx = exception._ca_context;
            console.error('[CA] Call context (raw object):', ctx);

            try {
                console.error('[CA] Call context (JSON):', JSON.stringify(ctx, null, 2));
            } catch (ctxErr) {
                console.error('[CA] Failed to JSON.stringify _ca_context:', ctxErr);
            }
        }

        // Basic message
        console.error('[CA] A critical exception occurred:', exception.message || exception);

        // Stack / origin line
        if (exception.stack) {
            const stackLines = exception.stack.split('\n').map(l => l.trim());
            console.error('[CA] Exception type:', stackLines[0] || 'Unknown');

            const locationLine = stackLines.find(l => l.match(/:\d+:\d+/));
            if (locationLine) {
                console.error('[CA] Origin:', locationLine);
            } else {
                console.warn('[CA] Could not detect origin location in stack.');
            }
        } else {
            console.warn('[CA] Exception has no stack trace.');
        }

        console.error('[CA] Full exception:', exception);
        console.log('[CA] System halt triggered to prevent log flooding.');
        console.log('[CA] Pending loops, timers, and tasks will be stopped.');

        try {
            this.app.destroy();
            console.log('[CA] Shutdown complete.');
        } catch (destroyErr) {
            console.error('[CA] Error occurred during shutdown:', destroyErr);
        }

        console.error('=================================================');
    }

    isMessageNewer = (logDateStr) => {
        const msgNum = this.parseLogDateToNumber(this.util.toHourMinuteSecondFormat(logDateStr));
        const wmNum = this.parseLogDateToNumber(this.util.toHourMinuteSecondFormat(this.watermark));
        this.util.verbose('Date comparison:', {
            logDate: logDateStr, logDateNum: msgNum,
            watermark: this.watermark, watermarkNum: wmNum
        });
        if (!msgNum) {
            throw new Error(`Invalid MsgNum: ${msgNum}`);
        }

        const isNewer = msgNum >= wmNum;
        this.util.verbose('Date comparison:', {
            logDate: logDateStr, logDateNum: msgNum,
            watermark: this.watermark, watermarkNum: wmNum, isNewer
        });
        return isNewer;
    }

    normalizeBodyToQuery = (body) => {
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

    parseLogDateToNumber = (logDateStr) => {
        return this.activityLogStore.parseLogDateToNumber?.(logDateStr) ?? 0;
    }

    logEvent = (content, user, images) => {
        if (!user) {
            user = this.userStore.get('system') || {
                uid: 'system',
                name: 'System',
                avatar: ''
            };
        }
        const log = this.createLogObject(content, user, images);
        this.activityLogStore.saveEvent(log);
        this.app.renderLogEntry(log, 'event', this.app.ui.eventLogBox, user.isLoggedIn);
    }

    logLogin = (user) => {
        const log = {
            ...this.createLogObject('has logged in.', user),
            action: 'login',
        };
        //this.activityLogStore.saveLoginLogout(log);
        this.app.renderLogEntry(log, 'login', this.app.ui.loginLogoutBox, user.isLoggedIn);
    }

    logLogout = (user) => {
        const log = {
            ...this.createLogObject('has logged out.', user),
            action: 'logout',
        };
        //this.activityLogStore.saveLoginLogout(log);
        this.app.renderLogEntry(log, 'logout', this.app.ui.loginLogoutBox, user.isLoggedIn);
    }

    logDmOut = (content, user) => {
        const log = this.createLogObject(content, user);
        this.activityLogStore.saveDmOut(log);
        this.app.renderLogEntry(log, 'dm-out', this.app.ui.sentMessagesBox, user.isLoggedIn);
    }

    logDmInHandled = (content, user) => {
        const log = this.createLogObject(content, user);
        this.activityLogStore.saveDmInHandled(log);
        this.app.renderLogEntry(log, 'dm-in-handled', this.app.ui.handledMessagesBox, user.isLoggedIn);
    }

    logDmInUnread = (content, user) => {
        const log = this.createLogObject(content, user);
        this.activityLogStore.saveDmInUnread(log);
        this.app.renderLogEntry(log, 'dm-in-unread', this.app.ui.unreadMessagesBox, user.isLoggedIn);
    }

    createLogObject(content, user, images = []) {
        return {
            ts: this.util.getTimeStampInWebsiteFormat(),
            content,
            uid: user.uid,
            title: user.name,
            guid: crypto.randomUUID(),
            images: images
        };
    }

    restoreAllLogs = () => {
        this.restoreEventLogs();
        this.restoreLoginLogoutLogs();
        this.restoreDmInUnreadLogs();
        this.restoreHandledLogs();
        this.restoreDmOutLogs();
    }

    restoreEventLogs = () => {
        this.restoreLogs(this.activityLogStore.listEvents(), 'event', this.app.ui.eventLogBox);
    }

    restoreDmOutLogs = () => {
        this.restoreLogs(this.activityLogStore.listDmOut(), 'dm-out', this.app.ui.sentMessagesBox);
    }

    restoreDmInUnreadLogs = () => {
        this.restoreLogs(this.activityLogStore.listDmInUnread(), 'dm-in-unread', this.app.ui.unreadMessagesBox);
    }

    restoreHandledLogs = () => {
        this.restoreLogs(this.activityLogStore.listDmInHandled(), 'dm-in-handled', this.app.ui.handledMessagesBox);
    }

    restoreLoginLogoutLogs = () => {
        this.restoreLogs(this.activityLogStore.listLoginLogout(), 'login-logout', this.app.ui.loginLogoutBox);
    }

    restoreLogs = (logs, logType, targetContainer) => {
        for (const log of logs) {
            this.util.verbose('Restoring log', log);
            this.app.renderLogEntry(log, logType, targetContainer);
        }
    }

    isChatLogUrl = (u) => {
        if (!u) return false;
        let s = String(u);
        s = new URL(s, location.origin).pathname;
        return s.indexOf('system/action/chat_log.php') !== -1;
    }

    isUserListUrl = (u) => {
        if (!u) return false;
        let s = String(u);
        s = new URL(s, location.origin).pathname;
        return s.indexOf('system/panel/user_list.php') !== -1;
    }

    isPrivateProcessUrl = (u) => {
        if (!u) return false;
        let s = String(u);
        s = new URL(s, location.origin).pathname;
        return s.indexOf('system/action/private_process.php') !== -1;
    }

    buildBroadcastList = () => {
        const out = [];
        const loggedInFemaleUsers = this.userStore.getAllLoggedInFemales();

        loggedInFemaleUsers.forEach((femaleUser) => {
            const uid = femaleUser.uid;

            if (this.activityLogStore.hasSentMessageToUser(uid)) {
                console.log(`Skipping message to ${femaleUser.name} (already replied)`);
                return;
            }

            if (femaleUser.isIncludedForBroadcast) {
                out.push(femaleUser);
            } else {
                console.log('Skipping user:', uid, 'due to exclusion');
            }
        });

        return out;
    }

    startBroadcast = async (to, text) => {
        const batchSize = 10;
        const secondsBetweenSends = [2000, 5000];
        const secondsBetweenBatches = [10000, 20000];
        const sleep = this.util.sleep
            ? (ms) => this.util.sleep(ms)
            : (ms) => new Promise(r => setTimeout(r, ms));

        let ok = 0, fail = 0;
        const numberOfBatches = Math.ceil(to.length / batchSize);
        for (let bi = 0; bi < numberOfBatches; bi++) {
            const start = bi * batchSize;
            const batch = to.slice(start, start + batchSize);
            this.logEvent(`[BROADCAST] Batch ${bi + 1}/${numberOfBatches} — sending ${batch.length}... (OK:${ok} Fail:${fail})`);

            for (let idx = 0; idx < batch.length; idx++) {
                const item = batch[idx];
                const uid = item.uid;

                if (await this.sendWithThrottle(uid, text)) {
                    ok++;
                } else {
                    fail++;
                }

                this.logEvent(`[BROADCAST] Batch ${bi + 1}/${numberOfBatches} — ${idx + 1}/${batch.length} sent (OK:${ok} Fail:${fail})`);
                const perSendDelay = this.util.randBetween(secondsBetweenSends[0], secondsBetweenSends[1]);
                await sleep(perSendDelay);
            }

            if (bi < numberOfBatches - 1) {
                const wait = this.util.randBetween(secondsBetweenBatches[0], secondsBetweenBatches[1]);
                this.logEvent(`[BROADCAST] Batch ${bi + 1}/${numberOfBatches} done — waiting ${Math.round(wait / 1000)}s...`);
                await sleep(wait);
            }
        }
        this.logEvent(`Broadcast finished. Sent ${ok} messages, ${fail} failed.`);
        return {ok, fail};
    }


    processPrivateSendResponse = async (data) => {
        console.log(data);
        if (data?.code !== 1) {
            console.error(`[PrivateSend] Could not parse response from native message send:`, data);
            return null;
        }

        const logData = data.log || {};
        let uid = data?.target;

// Fallback: extract target from the request body
        if (!uid && data?.headers?.body) {
            const qs = this.util.parseQueryStringToObject(data.headers.body);
            if (qs.target) {
                uid = Number(qs.target);
            }
        }

        if (!uid) {
            console.error("[PrivateSend] Could not determine target uid", data);
            return null;
        }


// If the server didn't include "target", fall back to extracting from request body.
        if (!uid && data?.headers?.body) {
            try {
                const params = new URLSearchParams(data.headers.body);
                const p = params.get("priv");
                if (p) uid = Number(p);
            } catch (err) {
                console.error("[PrivateSend] Failed to parse request body for target UID", err);
            }
        }

        if (!uid) {
            console.error("[PrivateSend] Cannot determine target UID for outgoing private message.", data);
            return null;
        }

        const content = logData.log_content || '';
        const dmSentToUser = await this.userStore.getOrFetch(uid);

        if (!dmSentToUser) {
            console.error(
                `[PrivateSend] Could not find user with ID ${uid}. ` +
                `Could not process outgoing private message`
            );
            return null;
        }

        console.log(
            '\nIntercepted native message send to',
            dmSentToUser.name || uid,
            '(ID:',
            uid,
            ')'
        );
        this.logDmOut(content, dmSentToUser);

        this.util.scrollToBottom(this.app.ui.caPrivateMessagesSlot);
        const userEl = this.app.findUserElById(dmSentToUser.uid);
        if (userEl) {
            this.app.updateProfileChip(dmSentToUser.uid, userEl);
        } else {
            this.util.debug(
                '[PrivateSend] Skipping profile chip update; user element not found for uid:',
                dmSentToUser.uid
            );
        }

        const affectedLogs =
            this.activityLogStore.markHandledUntilChatLogId(
                uid,
                dmSentToUser.lastPrivateHandledId
            );

        if (!Array.isArray(affectedLogs) || !affectedLogs.length) {
            this.util.debug('[PrivateSend] No logs to update read status for user:', uid);
            return true;
        }

        this.app.processHandledStatusForLogsEls(affectedLogs);
        return true;
    }

    sendWithThrottle = (id, text, minGapMs = 3500) => {
        const now = Date.now();
        const wait = Math.max(0, minGapMs - (now - this._lastSendAt));
        return new Promise(r => setTimeout(r, wait))
            .then(() => this.api.sendPrivateMessage(id, text))
            .then((response) => this.processPrivateSendResponse(response))
            .then((success) => {
                if (!success) {
                    console.error('[sendWithThrottle] Failed to send message:', id, text);
                    return false;
                }
                this._lastSendAt = Date.now();
                return true;
            }).catch((err) => {
                console.error('[BROADCAST] sendWithThrottle error for uid', id, err);
                return false;
            });
    }

    _installAudioAutoplayGate = () => {
        if (this._audioGate.installed) return;

        const proto = (typeof HTMLAudioElement !== 'undefined' && HTMLAudioElement.prototype) ? HTMLAudioElement.prototype : null;
        if (!proto || typeof proto.play !== 'function') return;

        const gate = this._audioGate;
        gate.pending = new Set();
        gate.origPlay = proto.play.bind(proto);
        gate.userInteracted = false;
        gate.onInteract = (_) => {
            if (gate.userInteracted) return;
            gate.userInteracted = true;
            gate.pending.forEach((audioEl) => {
                const res = gate.origPlay.call(audioEl);
                if (res && typeof res.catch === 'function') {
                    res.catch(() => {
                    });
                }
            });
            gate.pending.clear();
            window.removeEventListener('click', gate.onInteract, true);
            window.removeEventListener('keydown', gate.onInteract, true);
            window.removeEventListener('touchstart', gate.onInteract, true);
        };

        window.addEventListener('click', gate.onInteract, true);
        window.addEventListener('keydown', gate.onInteract, true);
        window.addEventListener('touchstart', gate.onInteract, true);
        proto.play = function patchedPlay() {
            if (!gate.userInteracted) {
                gate.pending.add(this);
                return Promise.resolve();
            }

            const p = gate.origPlay.call(this);
            if (p && typeof p.catch === 'function') {
                p.catch(function (err) {
                    const name = (err && (err.name || err)) ? String(err.name || err).toLowerCase() : '';
                    if (name.includes('notallowed')) gate.pending.add(this);
                }.bind(this));
            }
            return p;
        };

        gate.installed = true;
    }

    _uninstallAudioAutoplayGate = () => {
        const gate = this._audioGate;
        if (!gate.installed) return;

        const proto = (typeof HTMLAudioElement !== 'undefined' && HTMLAudioElement.prototype) ? HTMLAudioElement.prototype : null;
        if (proto && gate.origPlay) {
            proto.play = gate.origPlay;
        }

        if (gate.onInteract) {
            window.removeEventListener('click', gate.onInteract, true);
            window.removeEventListener('keydown', gate.onInteract, true);
            window.removeEventListener('touchstart', gate.onInteract, true);
        }

        if (gate.pending) gate.pending.clear();
    }

    installNetworkTaps = () => {
        this.util.debug('Installing network taps (fetch/XHR interceptors)');

        if (!this._xhrOpen) this._xhrOpen = XMLHttpRequest.prototype.open;
        if (!this._xhrSend) this._xhrSend = XMLHttpRequest.prototype.send;

        // Monotonic counter only for the XHRs we actually process
        if (typeof this._networkTapRequestSeq !== 'number') {
            this._networkTapRequestSeq = 0;
        }

        const self = this;

        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            const originalUrl = String(url || '');
            let modifiedUrl = originalUrl;

            // Be a bit defensive: try both relative and absolute forms
            let isChat;
            let isUserList;
            try {
                const abs = new URL(originalUrl, window.location.href).toString();
                isChat = self.isChatLogUrl(originalUrl) || self.isChatLogUrl(abs);
                isUserList = self.isUserListUrl(originalUrl) || self.isUserListUrl(abs);
            } catch (e) {
                isChat = self.isChatLogUrl(originalUrl);
                isUserList = self.isUserListUrl(originalUrl);
            }

            const shouldTap = isChat || isUserList;

            if (!shouldTap) {
                // Not a URL we process -> no label, no params, just pass through
                this._ca_url = originalUrl;
                this._ca_label = null;
                this._ca_reqId = null;
                return self._xhrOpen.call(this, method, originalUrl, ...rest);
            }

            // Only for URLs we process:
            const requestId = ++self._networkTapRequestSeq;
            const debugLabel = isChat ? 'CHAT_LOG_XHR' : 'USER_LIST_XHR';

            this._ca_reqId = requestId;
            this._ca_label = debugLabel;

            try {
                const u = new URL(originalUrl, window.location.origin);
                u.searchParams.set('_ca_tap', '1');
                u.searchParams.set('_ca_label', debugLabel);
                u.searchParams.set('_ca_req', String(requestId)); // unique ID for this processed call

                modifiedUrl = u.toString();
            } catch (e) {
                console.warn('[CA] Failed to inject debug params into URL:', originalUrl, e);
                // Fall back to the original URL, but still keep label + reqId on the instance
                modifiedUrl = originalUrl;
            }

            this._ca_url = modifiedUrl;

            self.util.verbose(
                `[NetworkTap][${debugLabel}#${requestId}] open ${method} ${modifiedUrl}`
            );

            return self._xhrOpen.call(this, method, modifiedUrl, ...rest);
        };

        XMLHttpRequest.prototype.send = function (...sendArgs) {
            const reqId = this._ca_reqId;
            const label = this._ca_label;
            let params;

            if (label && reqId != null && self.util && typeof self.util.verbose === 'function') {
                self.util.verbose(`[NetworkTap][${label}#${reqId}] send`, sendArgs);
            }

            // If this XHR wasn't "tapped" in open(), just pass through.
            // (No chat/userlist processing, no extra logging.)
            if (!label || reqId == null) {
                return self._xhrSend.apply(this, sendArgs);
            }

            /** @type {URLSearchParams | null} */
            const body = sendArgs[0];

            // Only chat log posts get body modification / context updates
            if (self.isChatLogUrl(this._ca_url) && body != null && typeof body === 'string') {
                try {
                    params = new URLSearchParams(body);

                    // Update chat context from the (now modified) body, but still respect priv=1
                    const isPrivateSend = params.get('priv') === '1';

                    if (!isPrivateSend) {
                        self.caUpdateChatCtxFromBody(params);
                    }

                    // Replace the outgoing body and keep qs for downstream
                    sendArgs[0] = params.toString();

                } catch (e) {
                    e._ca_loopLabel = 'XHR_SEND_INTERCEPT_BODY_PARSE';
                    e._ca_context = {
                        requestId: reqId,
                        label,
                        url: this._ca_url,
                        bodySnippet: String(body).slice(0, 200)
                    };
                    self.stopOnError(e);
                    return;
                }
            } else if (self.isChatLogUrl(this._ca_url) && body != null && typeof body !== 'string') {
                console.warn(
                    `[PrivateSend][${label}#${reqId}] Unexpected body type for chat log request`,
                    body
                );
            }

            this.addEventListener('readystatechange', async function () {
                const responseUrl = this.responseURL || this._ca_url || '';
                const evtReqId = this._ca_reqId;
                const evtLabel = this._ca_label;

                // Should never happen, but guard anyway
                if (!evtLabel || evtReqId == null) {
                    return;
                }

                try {
                    if (this.readyState === 4 && this.status === 200 && this.responseText) {
                        if (self.isChatLogUrl(responseUrl)) {
                            await self.caProcessChatPayload(this.responseText, params?.get('priv'), params?.get('pcount'), {
                                requestId: evtReqId,
                                label: evtLabel
                            });
                        }

                        if (self.isUserListUrl(responseUrl)) {
                            self.util.debug(
                                `[NetworkTap][${evtLabel}#${evtReqId}] Processing user list response`
                            );
                            await self.processUserListResponse(this.responseText, {
                                requestId: evtReqId,
                                label: evtLabel
                            });
                        }
                    } else if (this.readyState === 4 && this.status === 403) {
                        console.error(
                            `[PrivateSend][${evtLabel}#${evtReqId}] 403 error while fetching resource. ` +
                            'Uninstalling the network taps to prevent any more calls until the browser is manually refreshed.',
                            responseUrl
                        );
                        self.popups.openCloudflarePopup(responseUrl);
                        self.destroy();
                    }
                } catch (e) {
                    e._ca_loopLabel = 'XHR_READYSTATE_INTERCEPT';
                    e._ca_context = {
                        requestId: evtReqId,
                        label: evtLabel,
                        url: responseUrl,
                        status: this.status,
                        readyState: this.readyState
                    };
                    self.stopOnError(e);
                }
            });

            return self._xhrSend.apply(this, sendArgs);
        };
    }

    uninstallNetworkTaps = () => {
        if (this._xhrOpen) {
            XMLHttpRequest.prototype.open = this._xhrOpen;
            this._xhrOpen = null;
        }
        if (this._xhrSend) {
            XMLHttpRequest.prototype.send = this._xhrSend;
            this._xhrSend = null;
        }
    }

    installPrivateSendInterceptor = () => {
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
                        const jsonResponse = JSON.parse(String(this?.responseText));
                        await self.processPrivateSendResponse({
                            code: jsonResponse?.code,
                            log: jsonResponse?.log,
                            headers: {
                                body: capturedBody,
                            }
                        });

                    }
                });
            }

            return self._pp_xhrSend.apply(this, sendArgs);
        };
    }

    uninstallPrivateSendInterceptor = () => {
        if (this._pp_xhrOpen) {
            XMLHttpRequest.prototype.open = this._pp_xhrOpen;
            this._pp_xhrOpen = null;
        }
        if (this._pp_xhrSend) {
            XMLHttpRequest.prototype.send = this._pp_xhrSend;
            this._pp_xhrSend = null;
        }
    }

    startClearEventLogLoop = ({
                                  intervalMs = 30 * 60 * 1000,
                                  runImmediately = true
                              } = {}) => {
        this.stopClearEventLogLoop();

        const clearEvents = () => {
            const removed = this.activityLogStore.clearByKind?.('event') || 0;
            this.app.ui.eventLogBox.innerHTML = '';

            this.logEvent(`Event logs cleared automatically (${removed} removed) at ${this.util.timeHHMM()}`);
            this.util.verbose(`[AutoClear] Cleared ${removed} event log(s).`);
        };

        if (runImmediately) clearEvents();

        this._clearEventsTimerId = setInterval(clearEvents, intervalMs);
    }

    startRefreshUsersLoop = async ({
                                       intervalMs = this.userRefreshInterval,
                                       runImmediately = true
                                   } = {}) => {
        this.stopRefreshUsersLoop();

        this._refreshUsersIntervalMs = intervalMs;

        if (runImmediately) {
            await this.refreshUserList();
        }

        this._refreshUsersTimerId = setInterval(async () => {
            await this.refreshUserList();
        }, this._refreshUsersIntervalMs);
    }

    refreshUserList = async () => {
        this.util.verbose('========== START REFRESHING AND PARSING NEW USER LIST ==========t');
        await this.processUserListResponse(await this.api.refreshUserList());
    }

    stopClearEventLogLoop = () => {
        if (this._clearEventsTimerId) {
            clearInterval(this._clearEventsTimerId);
            this._clearEventsTimerId = null;
        }
    }

    stopRefreshUsersLoop = () => {
        if (this._refreshUsersTimerId) {
            clearInterval(this._refreshUsersTimerId);
            this._refreshUsersTimerId = null;
        }
    }

    destroy = () => {
        console.warn(`Destroying ChatApp UI and util.`);
        this.uninstallNetworkTaps();
        this.uninstallPrivateSendInterceptor();
        this.stopRefreshUsersLoop();
        this.stopClearEventLogLoop();
        this.stopRefreshUsersLoop();
        this.stopClearEventLogLoop();
        this._uninstallAudioAutoplayGate();
    }

}