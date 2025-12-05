class App {
    constructor() {

        this.util = new Util();
        this.keyValueStore = new KeyValueStore();

        this.settingsStore = new SettingsStore({
            keyValueStore: this.keyValueStore,
            util: this.util
        });

        this.api = new Api({
            settingsStore: this.settingsStore,
            util: this.util
        });

        this.activityLogStore = new ActivityLogStore({
            keyValueStore: this.keyValueStore,
            util: this.util
        });

        this.userStore = new UserStore({
            keyValueStore: this.keyValueStore,
            api: this.api,
            util: this.util
        });

        if (!this.userStore.get('system')) {
            this.userStore.set({
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

        this.hostServices = new HostServices({
            app: this,
            util: this.util,
            userStore: this.userStore,
            activityLogStore: this.activityLogStore,
            settingStore: this.settingsStore,
            api: this.api,
            popups: null
        });

        this.popups = new Popups({
            app: this,
            settingsStore: this.settingsStore,
            util: this.util,
            userStore: this.userStore,
            api: this.api,
            hostServices: this.hostServices
        });

        this.hostServices.popups = this.popups;

        this.options = {};

        this.ui = {
            panel: null,
            panelNav: null,
            sentMessagesBox: null,
            messagesWrapper: null,
            presenceBox: null,
            logClear: null,
            handledMessagesBox: null,
            unreadMessagesBox: null,
            loggingBox: null,
            userContainersWrapper: null,
            femaleUserContainerGroup: null,
            otherUserContainerGroup: null,
            femaleUsersContainer: null,
            otherUsersContainer: null,
            caChatRight: null,
            globalChat: null,
            caPrivateMessagesSlot: null
        };

        this.sel = {
            rightPanel: '#right-panel',
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
                    ca_handled_messages: '.ca-handled-messages',
                    ca_sent_chip_all_handled: '.ca-sent-chip-all-handled',
                    ca_sent_chip_unread: '.ca-sent-chip-unread',
                    user_item: '.user_item'
                },
                sentMessagesBox: '#ca-log-box-sent',
                messagesWrapper: '.ca-sections-wrapper',
                handledMessagesBox: '#ca-log-received-handled',
                unreadMessagesBox: '#ca-log-received-unread',
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

    buildRawTree = () => {
        const seen = new WeakSet();

        const strip = (s) => {
            if (typeof s !== "string") return s;
            return (s.startsWith("#") || s.startsWith(".")) ? s.slice(1) : s;
        };

        const walk = (src) => {
            if (!src || typeof src !== "object") return undefined;
            if (seen.has(src)) return undefined;
            seen.add(src);

            const out = Array.isArray(src) ? [] : {};

            for (const [key, val] of Object.entries(src)) {
                if (key === "raw") continue;

                if (typeof val === "string") {
                    out[key] = strip(val);
                } else if (val && typeof val === "object") {
                    const child = walk(val);
                    if (child && (Array.isArray(child) ? child.length : Object.keys(child).length)) {
                        out[key] = child;
                    } else {
                        out[key] = {};
                    }
                }
            }
            return out;
        };

        this.sel.raw = walk(this.sel) || {};
    }

    init = async (options = {}) => {
        this.options = options || {};

        this.buildRawTree(this.sel, this.sel.raw);
        this.ui.globalChat = this.util.qs(`#global_chat`);
        this.ui.caChatRight = document.createElement('div');
        const hostChatRight = this.util.qs(`#chat_right`);
        this.ui.caChatRight.innerHTML = hostChatRight.innerHTML;
        this.ui.caChatRight.id = 'left-panel';
        this.ui.caChatRight.removeAttribute('style');
        hostChatRight.remove();
        const main_wrapper = document.createElement('div');
        main_wrapper.id = 'main-wrapper';
        document.body.prepend(main_wrapper);
        main_wrapper.appendChild(this.util.qs('#chat_head'));
        main_wrapper.appendChild(this.ui.globalChat);
        main_wrapper.appendChild(this.util.qs('#wrap_footer'));
        this.ui.globalChat.prepend(this.ui.caChatRight);

        const userContainersWrapper = document.createElement(`div`);
        userContainersWrapper.id = `ca-user-container`;
        this.ui.caChatRight.appendChild(userContainersWrapper);
        this.ui.userContainersWrapper = userContainersWrapper;

        this.shouldHideHandledUsers = this.settingsStore.getHideHandled();
        this.shouldIncludeOtherUsers = this.settingsStore.getShouldIncludeOthers();
        this.shouldShowBroadcastCheckboxes = this.settingsStore.getShowBroadcastSelectionBoxes();

        this.createOtherUsersContainer();
        this.createFemaleUsersContainer();

        this.buildPanel();
        this.buildMenuLogPanel();

        this.ui.sentMessagesBox = this.util.qs(this.sel.log.sentMessagesBox);
        this.ui.messagesWrapper = this.util.qs(this.sel.log.messagesWrapper);
        this.ui.handledMessagesBox = this.util.qs(this.sel.log.handledMessagesBox);
        this.ui.unreadMessagesBox = this.util.qs(this.sel.log.unreadMessagesBox);
        this.ui.presenceBox = this.util.qs(this.sel.log.presence);
        this.ui.logClear = this.util.qs(this.sel.log.clear);
        this.ui.loggingBox = this.util.qs(this.sel.log.general);

        await this.hostServices.syncUsersFromDom(document.querySelectorAll('.online_user .user_item'));

        this.util.qs(this.sel.privateChat.privateInputBox).innerHTML =
            '<textarea data-paste="1" id="message_content" rows="4" class="inputbox" placeholder="Type a message..."></textarea>';
        this.util.qs('#message_form').prepend(this.util.qs('#private_input_box'));
        this.util.qs('#private_center').after(this.util.qs('#private_menu'));

        this.util.installLogImageHoverPreview([
            this.ui.handledMessagesBox,
            this.ui.unreadMessagesBox,
            this.ui.sentMessagesBox,
            this.ui.presenceBox,
            this.ui.loggingBox,
            this.ui.userContainersWrapper,
            this.ui.globalChat
        ]);

        this.appendCustomActionsToBar();
        this._updateStorageToggleUi(this.settingsStore.getWriteStorageMode());

        this._wireTextboxTrackers();
        this.util.clickSelE('#chat_logs_container', this.onClickGlobalChatHeaderProfile);
        this.wireListOptionClicks();
        this._attachLogClickHandlers();

        if (this.shouldShowBroadcastCheckboxes) {
            this.util.qs('#ca-female-users-container').classList.add("ca-show-broadcast-ck");
        }

        const dmTextarea = this.util.qsTextarea("#message_content");
        const dmSendBtn = this.util.qs("#private_send");

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

        this.util.init({
            debugMode: this.settingsStore.getDebugMode(),
            verboseMode: this.settingsStore.getVerboseMode()
        });

        await this.hostServices.init();

        this.util.scrollToBottom(this.ui.handledMessagesBox);
        this.util.scrollToBottom(this.ui.unreadMessagesBox);
        this.util.scrollToBottom(this.ui.sentMessagesBox);

        return this;
    }

    setAndPersistDebugMode = (debugMode) => {
        this.settingsStore.setDebugMode(debugMode);
        this.util.setDebugMode(debugMode);
        console.log(
            debugMode
                ? '[DEBUG] Debug mode enabled'
                : 'Debug mode disabled'
        );
        this.util.debug('[DEBUG] Debug logs are now visible');
    }

    setAndPersistVerboseMode = (verboseMode) => {
        this.settingsStore.setVerboseMode(verboseMode);
        this.util.setVerboseMode(verboseMode);
        console.log(
            verboseMode
                ? '[VERBOSE] Verbose mode enabled'
                : 'Verbose mode disabled'
        );
        this.util.verbose('[DEBUG] Debug logs are now visible');
    }

    _wireTextboxTrackers = () => {
        document.addEventListener("focusin", (event) => {
            const target = event.target;

            if (!target) {
                console.warn("[CA] focusin event without target");
                return;
            }

            if (!(target instanceof HTMLElement)) {
                console.warn("[CA] focusin target is not an HTMLElement");
                return;
            }

            if (!target.matches("textarea, input[type='text']")) {
                return;
            }

            this.activeTextInput = target;
        });
    }

    onClickGlobalChatHeaderProfile = async (e) => {
        // Don’t hijack image/lightbox or menu clicks
        if (e.target.closest('a[data-fancybox], .chat_image, .logs_menu')) {
            return;
        }

        // Find the whole chat row
        const logItem = e.target.closest('.chat_log');
        if (!logItem) {
            return;
        }

        // Always resolve UID from the avatar in that row
        const avatarEl = logItem.querySelector('.chat_avatar');
        if (!avatarEl) {
            console.warn('[App] No .chat_avatar found inside .chat_log');
            return;
        }

        const uid = avatarEl.getAttribute('data-id');
        if (!uid) {
            console.warn('[App] .chat_avatar has no data-id');
            return;
        }

        await this.popups.openUserProfilePopupUsingHostEl(uid);
    }

    onClickRefreshButton = async () => {
        await this.hostServices.refreshUserList();
        this.hostServices.logEventLine(`Manually refreshed user list on ${this.util.timeHHMMSS()}`);
    }

    appendCustomActionsToBar = () => {
        const bar = document.getElementById('right_panel_bar');

        if (!bar) {
            console.error('Bar not found');
            return;
        }

        const existingOption = bar.getElementsByClassName('panel_option')[0];
        if (!existingOption) {
            console.warn('[CA] appendCustomActionsToBar: no existing .panel_option found');
        }

        const refreshBtn = document.createElement('div');
        refreshBtn.classList.add('panel_option', 'panel_option_refresh');
        refreshBtn.title = 'Refresh users';
        refreshBtn.innerHTML = '<i class="fa fa-sync"></i>';

        this.util.click(refreshBtn, async () => {
            await this.onClickRefreshButton();
            refreshBtn.classList.remove('loading');
        });

        const templatesBtn = document.createElement('div');
        templatesBtn.classList.add('panel_option', 'panel_option_templates');
        templatesBtn.title = 'Predefined messages';
        templatesBtn.innerHTML = '<i class="fa fa-comment-dots"></i>';

        this.util.click(templatesBtn, this.popups.openPredefinedPopup, null);

        if (existingOption) {
            bar.insertBefore(refreshBtn, existingOption);
            bar.insertBefore(templatesBtn, existingOption);
        } else {
            bar.appendChild(refreshBtn);
            bar.appendChild(templatesBtn);
        }
    }

    buildLogHTML = (kind, content, user) => {
        const text = String(content || '');

        if (kind === 'event') {
            const m = text.match(/(.+?)\s+has changed (?:his|her) Avatar\s*\(([^)]+)\s*→\s*([^)]+)\)/i);

            if (m) {
                const userName = m[1] || '';
                const newAvatar = (m[3] || '').trim();
                const safeName = this.util.escapeHTML(userName);
                const safeSrc = this.util.escapeAttr(newAvatar || '');
                return `
                <span class="ca-log-text-main">
                    ${safeName} has changed ${user.isFemale ? `her` : `his`} avatar:
                </span>
                <a href="${safeSrc}" target="_blank" rel="noopener noreferrer">
                    <img class="chat_image ca-log-avatar-image" src="${safeSrc}" alt="New avatar of ${safeName}">
                </a>
            `;
            }

            return `<span class="ca-log-text-main">${this.util.escapeHTML(text)}</span>`;
        }

        return `<span class="ca-log-text-main">${this.util.escapeHTML(text)}</span>`;
    }

    _attachLogClickHandlers = () => {
        const boxes = [
            this.ui.sentMessagesBox,
            this.ui.messagesWrapper,
            this.ui.presenceBox,
            this.ui.unreadMessagesBox,
            this.ui.handledMessagesBox,
            this.ui.loggingBox
        ];
        boxes.forEach(box => {
            if (!box || box._caGenericWired) return;
            this.util.clickE(box, this._onLogClickGeneric);
            box._caGenericWired = true;
        });
    }

    _onLogClickGeneric = async (e) => {
        const entry = e.target.closest?.(this.sel.log.classes.ca_log_entry);
        if (!entry) {
            console.warn('[CA] _onLogClickGeneric: no entry found');
            return;
        }

        const uid = entry.getAttribute('data-uid') || '';
        const isSystem = (uid === 'system');

        this.util.verbose('Log entry clicked:', {entry, uid, isSystem});

        const actionEl = e.target.closest?.('[data-action]');
        if (actionEl) {
            const action = String(actionEl.getAttribute('data-action') || '').toLowerCase();

            if (action === 'toggle-expand') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const textEl = this.util.qs(`${this.sel.log.classes.ca_log_text}`, entry);

                // Flip "expanded" state only
                textEl.classList.toggle('ca-text-expanded');

                // Re-run sizing logic to clamp/unclamp & update arrow
                this.ensureExpandButtonFor_(entry);

                return;
            }

            if (action === 'delete-log') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const guid = entry.getAttribute('data-guid');
                if (guid && this.activityLogStore.remove) {
                    this.activityLogStore.remove(guid);
                } else {
                    console.warn('[CA] delete-log: no guid or ActivityLogStore.remove missing', {guid});
                }
                entry.remove();
                return;
            }

            if (action === 'mark-handled') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const guid = entry.getAttribute('data-guid');

                const updated = this.activityLogStore.markLogHandled(guid);

                this.processHandledStatusForLogsEls([updated]);

                this.updateProfileChipByUid(uid);

                return;
            }


            if (action === 'open-profile') {
                await this.popups.openUserProfilePopupUsingHostEl(uid);
                return;
            }

            if (action === 'open-dm') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                if (!uid || isSystem) {
                    this.util.verbose('[CA] open-dm: ignoring for system or missing uid', {uid});
                    return;
                }

                const user = await this.userStore.getOrFetch(uid);
                this.popups.openAndRememberPrivateChat(user);
                return;
            }
        }

        const logTextSel = this.sel.raw.log.classes.ca_log_text;
        const dmLinkSel = this.sel.log.classes.ca_dm_link;

        const dmArea =
            e.target.closest?.(logTextSel) ||
            e.target.closest?.(dmLinkSel) ||
            e.target.closest?.('img.chat_image');

        if (dmArea && uid && !isSystem) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const user = await this.userStore.getOrFetch(uid);
            if (!user || !user.uid) {
                console.error('[CA] Generic DM click: could not fetch user for uid', uid, user);
                return;
            }

            console.log('[CA] Opening private (generic) with:', uid, user.name, user.avatar);
            this.popups.openAndRememberPrivateChat(user);
            return;
        }

        if (uid && !isSystem) {
            await this.popups.openUserProfilePopupUsingHostEl(uid);
        }
    }

    onClickDeleteLog = (guid, logEntry) => {
        //const guid = entry.getAttribute('data-guid');
        if (guid && this.activityLogStore.remove) {
            this.activityLogStore.remove(guid);
        } else {
            console.warn('[CA] delete-log: no guid or ActivityLogStore.remove missing', {guid});
        }
        logEntry.remove();
    }

    decodeHTMLEntities = (s) => {
        const txt = document.createElement('textarea');
        txt.innerHTML = String(s);
        return txt.value;
    }

    cloneAndRenderNewUserElement = (parsedUserItemEl, updatedUserJson) => {
        const containerContent = this.util.qs(
            `.ca-user-list-content`,
            updatedUserJson.isFemale ? this.ui.femaleUsersContainer : this.ui.otherUsersContainer
        );

        const wrapper = document.createElement('div');
        wrapper.className = 'ca-us';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'ca-username';
        nameSpan.textContent = updatedUserJson.name || '<unknown>';

        wrapper.appendChild(nameSpan);

        this.util.click(this.util.qs('.user_item_avatar img.avav'), this.popups.openUserProfilePopupUsingHostEl, updatedUserJson.uid);

        if (updatedUserJson?.age > 0) {
            const ageSpan = document.createElement('span');
            ageSpan.className = 'ca-age';
            ageSpan.textContent = ` (${updatedUserJson.age})`;
            wrapper.appendChild(ageSpan);
        }

        this.util.verbose(
            '[_updateOrCreateUserElement] Created new user element for',
            updatedUserJson.uid,
            updatedUserJson.name
        );

        const iconRow = document.createElement('div');
        iconRow.className = 'ca-user-icon-row';
        this.util.qs('.user_item_data', parsedUserItemEl).appendChild(iconRow);
        this.ensureDmLink(iconRow, updatedUserJson);
        this.ensureBroadcastCheckbox(iconRow, updatedUserJson);
        this.updateProfileChip(updatedUserJson.uid, parsedUserItemEl);
        this.util.qs('.username', parsedUserItemEl).replaceWith(wrapper);
        containerContent.appendChild(parsedUserItemEl);
    }

    updateUserItemElement = (fetchedUserJson, existingUserEl) => {
        if (!existingUserEl) {
            console.error('[updateUser] No .user_item found for uid:', fetchedUserJson.uid);
            return null;
        }

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
        const moodEl = existingUserEl.querySelector('.user_item_data .list_mood');
        moodEl.textContent = fetchedUserJson.mood;
        const flagImg = existingUserEl.querySelector('.user_item_icon.icflag img.list_flag');
        if (flagImg && fetchedUserJson.country) {
            flagImg.src = `system/location/flag/${fetchedUserJson.country}.png`;
        }

        const targetUserContainer = fetchedUserJson.isFemale ? this.ui.femaleUsersContainer : this.ui.otherUsersContainer;
        if (!targetUserContainer.contains(existingUserEl)) {
            console.log(`User ${fetchedUserJson.name} with uid ${fetchedUserJson.uid} switched gender and was in the other user container. Now moving it`);
            targetUserContainer.appendChild(existingUserEl);
            this.util.verbose('[updateUser] Moved user element to correct container for', fetchedUserJson.uid);
        }

        this.util.verbose('[updateUser] Updated user element for', fetchedUserJson.uid, attrMap);
        return existingUserEl;
    }

    applyUserDomChanges = (existingUserEl, updatedUserJson, changedKeys) => {
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
                    this.util.verbose("[updateUser] Moved user element after gender change");
                }
            }
        }
        return existingUserEl;
    }

    setLogDotsLoggedInStatusForUid = (uid, isLoggedIn) => {
        const selector = `.ca-log-entry[data-uid="${uid}"] ${this.sel.log.classes.ca_log_dot}`;
        const logDots = this.util.qsa(selector);

        logDots.forEach(dotEL => {
            this.setLogDotLoggedInStatusForElement(dotEL, isLoggedIn);
        });
    }

    setLogDotLoggedInStatusForElement = (dotEl, isLoggedIn) => {
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

    findUserElById = (uid) => {
        if (!uid) {
            console.error(`.findUserElementById: id is empty`);
            return null;
        }
        return this.util.qs(`.user_item[data-id="${uid}"]`, this.ui.userContainersWrapper);
    }

    updateProfileChip = (uid, userEl) => {
        const unreadReceivedMessagesCount = this.activityLogStore.getUnreadReceivedMessageCountByUserUid(uid);
        const sentMessagesCount = this.activityLogStore.getAllSentMessagesCountByUserId(uid);
        this.util.verbose('Updating profile chip for:', userEl, unreadReceivedMessagesCount, sentMessagesCount);

        if (unreadReceivedMessagesCount > 0) {
            this.util.verbose('Adding unread sent chip to user:', uid, ', unread received messages count: ', unreadReceivedMessagesCount, ', sent messages count: ', sentMessagesCount);
            const chip = this._createChipForUserItem(userEl);

            userEl.classList.remove(this.sel.raw.log.classes.ca_handled_messages);
            userEl.classList.add(this.sel.raw.log.classes.ca_unread_messages);
            chip.classList.add(this.sel.raw.log.classes.ca_sent_chip_unread);
            chip.classList.remove(this.sel.raw.log.classes.ca_sent_chip_all_handled);
            chip.textContent = `${unreadReceivedMessagesCount}`;
            userEl.style.display = '';
        } else if (unreadReceivedMessagesCount === 0 && sentMessagesCount > 0) {
            this.util.verbose(
                'Adding all handled chip to user:',
                uid,
                ', unread received messages count: ',
                unreadReceivedMessagesCount,
                ', sent messages count: ',
                sentMessagesCount
            );

            const chip = this._createChipForUserItem(userEl);

            userEl.classList.add(this.sel.raw.log.classes.ca_handled_messages);
            userEl.classList.remove(this.sel.raw.log.classes.ca_unread_messages);

            chip.classList.add(this.sel.raw.log.classes.ca_sent_chip_all_handled);
            chip.classList.remove(this.sel.raw.log.classes.ca_sent_chip_unread);
            chip.textContent = '✓';
            userEl.style.display = this.shouldHideHandledUsers ? 'none' : '';
        } else {
            userEl.classList.remove(this.sel.raw.log.classes.ca_unread_messages);
            this.util.qs(this.sel.raw.log.classes.ca_sent_chip, {
                root: userEl,
                ignoreWarning: true
            })?.remove();
            this.util.verbose('Removing sent chip from user:', uid);
        }
    }

    updateProfileChipByUid = (uid) => {
        const userEl = this.findUserElById(uid);

        if (!userEl) {
            this.util.verbose('updateProfileChipByUid: user element not found for uid (probably offline):', uid);
            return;
        }

        this.updateProfileChip(uid, userEl);
    }

    _createChipForUserItem = (userEl) => {
        let chip = userEl.querySelector(this.sel.log.classes.ca_sent_chip);

        if (!userEl.classList.contains('chataddons-sent')) {
            userEl.classList.add('chataddons-sent');
            this.util.verbose('Adding sent chip to user:', userEl.getAttribute('data-id'));
        }

        if (!chip) {
            chip = document.createElement('span');
            chip.classList.add(this.sel.raw.log.classes.ca_sent_chip);
            userEl.appendChild(chip);
            this.util.verbose('Created sent chip for user:', userEl);
        }
        return chip;
    }

    ensureBroadcastCheckbox = (userItemDataEl, user) => {
        let include = false;
        include = !!(user.isIncludedForBroadcast);

        // Anchor instead of native checkbox, same style as DM icon
        const toggle = document.createElement('a');
        toggle.href = '#';
        toggle.className = 'ca-ck ca-log-action ca-bc-toggle';
        toggle.setAttribute('role', 'button');
        toggle.setAttribute('data-action', 'toggle-broadcast');
        toggle.dataset.caIncluded = include ? '1' : '0';
        toggle.title = include ? 'Exclude from broadcast' : 'Include in broadcast';
        toggle.setAttribute('aria-pressed', include ? 'true' : 'false');

        // Unchecked SVG (square)
        const uncheckedSvg = this.util.renderSvgIconWithClass(
            'lucide lucide-square',
            `<rect x="4" y="4" width="16" height="16" rx="3" ry="3"></rect>`
        );
        uncheckedSvg.classList.add('ca-bc-icon-unchecked');

        // Checked SVG (square + check mark)
        const checkedSvg = this.util.renderSvgIconWithClass(
            'lucide lucide-check-square',
            `<rect x="4" y="4" width="16" height="16" rx="3" ry="3"></rect>
                                <polyline points="7 12 10 15 16 9"></polyline>`
        );
        checkedSvg.classList.add('ca-bc-icon-checked');

        const applyVisualState = (isIncluded) => {
            if (isIncluded) {
                checkedSvg.style.display = '';
                uncheckedSvg.style.display = 'none';
                toggle.dataset.caIncluded = '1';
                toggle.title = 'Exclude from broadcast';
                toggle.setAttribute('aria-pressed', 'true');
            } else {
                checkedSvg.style.display = 'none';
                uncheckedSvg.style.display = '';
                toggle.dataset.caIncluded = '0';
                toggle.title = 'Include in broadcast';
                toggle.setAttribute('aria-pressed', 'false');
            }
        };

        const includeForBroadcast = () => {
            const currentlyIncluded = toggle.dataset.caIncluded === '1';
            const nextInclude = !currentlyIncluded;

            applyVisualState(nextInclude);
            this.userStore.includeUserForBroadcast(user.uid, nextInclude);
            this.util.debug(`[BC] isIncludedForBroadcast → uid=${user.uid}, include=${include}`);
        }

        toggle.appendChild(uncheckedSvg);
        toggle.appendChild(checkedSvg);
        applyVisualState(include);

        this.util.click(toggle, () => includeForBroadcast);

        userItemDataEl.appendChild(toggle);
    }

    ensureDmLink = (userItemDataEl, user) => {
        const dmLink = document.createElement('a');
        dmLink.href = '#';
        dmLink.className = 'ca-dm-from-userlist ca-log-action';
        dmLink.title = 'Open direct message';
        dmLink.setAttribute('data-action', 'open-dm');

        dmLink.appendChild(this.util.renderSvgIconWithClass(
            'lucide lucide-mail',
            `<rect x="3" y="5" width="18" height="14" rx="2" ry="2"></rect>
         <polyline points="3 7,12 13,21 7"></polyline>`
        ));

        this.util.click(dmLink, this.popups.openAndRememberPrivateChat, user);
        userItemDataEl.appendChild(dmLink);
    }

    buildMenuLogPanel = () => {
        const mount = this.util.qs('#my_menu .bcell_mid');
        mount.innerHTML = "";
        if (!mount) {
            console.error('[CA] #my_menu .bcell_mid not found — cannot create menu panel');
            return;
        }

        const menuPanelEl = document.getElementById('ca-menu-panel');

        if (menuPanelEl) {
            return;
        }

        const panel = document.createElement('section');
        panel.id = 'ca-menu-panel';
        panel.className = 'ca-panel ca-mini';

        panel.innerHTML = `
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
  `;

        mount.appendChild(panel);
        this.util.clickAllE(this.util.qsa('.clear-logs', panel), this._onLogClearClick);
        this._attachLogClickHandlers();
    }

    buildPanel = () => {
        const panelEl = document.createElement('section');
        panelEl.id = this.sel.raw.rightPanel;
        panelEl.classList.add('ca-panel');
        panelEl.innerHTML = `
      <div class="ca-sections-wrapper">
        <div class="ca-nav">
          <a id="ca-nav-bc"
             data-action="broadcast"
             href="#"
             class="ca-dm-link ca-dm-right ca-log-action"
             title="Broadcast message">
            ${this.util.buildSvgIconString(
            "lucide lucide-triangle-right",
            `<path d="M3 10v4c0 .55.45 1 1 1h1l4 5v-16l-4 5h-1c-.55 0-1 .45-1 1zm13-5l-8 5v4l8 5v-14zm2 4h3v6h-3v-6z"/>`,
            false
        )}
          </a>

          <a id="ca-nav-specific"
             href="#"
             data-action="send-message"
             class="ca-dm-link ca-dm-right ca-log-action ca-log-action-filled"
             title="Send specific message">
            ${this.util.buildSvgIconString(
            "lucide lucide-triangle-right",
            `<path d="M8 4l12 8-12 8V4z"></path>`,
            false
        )}
          </a>

          <a id="${this.sel.raw.log.clear}"
             href="#"
             data-action="clear-all-logs"
             class="ca-dm-link ca-dm-right ca-log-action"
             title="Clear logs">
            ${this.util.buildSvgIconString(
            "lucide lucide-triangle-right",
            `<g transform="translate(0,-1)">
                 <polyline points="3 6 5 6 21 6"></polyline>
                 <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                 <path d="M10 11v6"></path>
                 <path d="M14 11v6"></path>
               </g>`,
            false
        )}
          </a>

          <a id="ca-nav-storage-toggle"
             href="#"
             class="ca-dm-link ca-dm-right ca-log-action"
             data-action="storage-toggle"
             title="">
          </a>
          
          <a id="ca-nav-users"
               href="#"
               class="ca-dm-link ca-dm-right ca-log-action"
               data-action="open-users"
               title="Show all users">
              ${this.util.buildSvgIconString(
            "lucide lucide-user",
            `
                    <g transform="translate(0,-1)">
                      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4z"></path>
                      <path d="M4 20a8 8 0 0 1 16 0"></path>
                    </g>
                  `,
            false
        )}
            </a>

          <a id="ca-nav-settings"
             href="#"
             class="ca-dm-link ca-dm-right ca-log-action"
             data-action="open-settings"
             title="Settings (debug &amp; verbose)">
            ${this.util.buildSvgIconString(
            "lucide lucide-settings",
            `<circle cx="12" cy="12" r="3"></circle>
               <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09c.7 0 1.31-.4 1.51-1a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.02A1.65 1.65 0 0 0 11 3.09V3a2 2 0 1 1 4 0v.09c0 .7.4 1.31 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.02c.2.6.81 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.7 0-1.31.4-1.51 1z"/>`,
            false
        )}
          </a>
        </div> 
        <div class="ca-sections-wrapper">
            <div class="ca-section ca-section-expand"
                 data-section="sent"
                 id="ca-log-section-sent">
              <div class="ca-section-title">
                <span>Sent Messages</span>
                <span class="clear-logs"
                      data-kinds="dm-out"
                      role="button"
                      tabindex="0">Clear</span>
              </div>
              <div id="${this.sel.raw.log.sentMessagesBox}"
                   class="ca-log-box ca-section-expand ${this.sel.raw.log.classes.ca_box_scrollable}"
                   aria-live="polite"></div>
            </div>
            <div class="ca-resizer" data-resizer="sent-received"></div>
            <div class="ca-section ca-section-expand" data-section="unread">
              <div class="ca-section-title">
                <span>Unread Messages</span>
                <span class="clear-logs"
                      data-kinds="dm-in-unread"
                      role="button"
                      tabindex="0">Clear</span>
              </div>
              <div id="${this.sel.raw.log.unreadMessagesBox}"
                   class="ca-log-box ca-log-box-expand ${this.sel.raw.log.classes.ca_box_scrollable}"
                   aria-live="polite"></div>
            </div>
            <div class="ca-resizer" data-resizer="received-handled"></div>
            <div class="ca-section ca-section-expand" data-section="handled">
              <div class="ca-section-title">
                <span>Handled Messages</span>
                <span class="clear-logs"
                      data-kinds="dm-in-handled"
                      role="button"
                      tabindex="0">Clear</span>
              </div>
              <div id="${this.sel.raw.log.handledMessagesBox}"
                   class="ca-log-box ca-log-box-expand ${this.sel.raw.log.classes.ca_box_scrollable}"
                   aria-live="polite"></div>
            </div>
            </div>
         </div>
      </div>
    `;
        this.util.qs('#global_chat').appendChild(panelEl);
        this.ui.panel = panelEl;
        this.ui.panelNav = panelEl.querySelector('.ca-nav');
        this.util.clickAllE(this.util.qsa('.clear-logs', panelEl), this._onLogClearClick);
        this.util.clickE(this.ui.panelNav, this.onGlobalClickPanelNav);
        this._setupResizableLogSections();
    }

    _setupResizableLogSections = () => {
        const panel = this.ui.panel;

        if (!panel) {
            console.error('[CA] _setupResizableLogSections: panel not initialized');
            return;
        }

        const wrappers = panel.querySelectorAll('.ca-sections-wrapper');
        if (!wrappers.length) {
            console.error('[CA] _setupResizableLogSections: no .ca-sections-wrapper found in panel');
            return;
        }

        const container = wrappers[wrappers.length - 1];
        const sections = container.querySelectorAll('.ca-section-expand');

        if (!sections.length) {
            console.warn('[CA] _setupResizableLogSections: no .ca-section-expand sections found');
        }

        sections.forEach((sec) => {
            const style = window.getComputedStyle(sec);
            const grow = parseFloat(style.flexGrow || '0');

            if (!sec.style.flexGrow || sec.style.flexGrow.trim() === '') {
                sec.style.flexGrow = grow > 0 ? String(grow) : '1';
            }

            if (!sec.style.minHeight || sec.style.minHeight.trim() === '') {
                sec.style.minHeight = '60px';
            }
        });

        const resizers = container.querySelectorAll('.ca-resizer');
        if (!resizers.length) {
            console.warn('[CA] _setupResizableLogSections: no .ca-resizer elements found');
            return;
        }

        const manageResize = (md, resizer) => {
            if (!resizer) {
                console.error('[CA] manageResize called without resizer');
                return;
            }

            const prev = resizer.previousElementSibling;
            const next = resizer.nextElementSibling;

            if (!prev || !next) {
                console.warn('[CA] Resizer without two neighbors (prev/next)', resizer);
                return;
            }

            if (
                !prev.classList.contains('ca-section') &&
                !prev.classList.contains('ca-section-expand')
            ) {
                console.warn('[CA] Resizer prev sibling is not a section', prev);
                return;
            }

            if (
                !next.classList.contains('ca-section') &&
                !next.classList.contains('ca-section-expand')
            ) {
                console.warn('[CA] Resizer next sibling is not a section', next);
                return;
            }

            md.preventDefault();
            const prevRect = prev.getBoundingClientRect();
            const nextRect = next.getBoundingClientRect();
            let prevSize = prevRect.height;
            let nextSize = nextRect.height;
            const sumSize = prevSize + nextSize;

            const getGrow = (el) => {
                const inlineGrow = parseFloat(el.style.flexGrow || '');
                if (!Number.isNaN(inlineGrow) && inlineGrow > 0) {
                    return inlineGrow;
                }
                const computedGrow = parseFloat(window.getComputedStyle(el).flexGrow || '0');
                return computedGrow > 0 ? computedGrow : 1;
            };

            const prevGrow = getGrow(prev);
            const nextGrow = getGrow(next);
            const sumGrow = prevGrow + nextGrow;
            let lastPosY = md.clientY;
            container.classList.add('ca-resizing');

            const onMouseMove = (mm) => {
                const posY = mm.clientY;
                let delta = posY - lastPosY;
                prevSize += delta;
                nextSize -= delta;

                if (prevSize < 0) {
                    nextSize += prevSize;
                    prevSize = 0;
                }

                if (nextSize < 0) {
                    prevSize += nextSize;
                    nextSize = 0;
                }

                const prevGrowNew = sumGrow * (prevSize / sumSize);
                const nextGrowNew = sumGrow * (nextSize / sumSize);
                prev.style.flexGrow = String(prevGrowNew);
                next.style.flexGrow = String(nextGrowNew);
                lastPosY = posY;
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                container.classList.remove('ca-resizing');
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };

        container.addEventListener('mousedown', (md) => {
            const target = md.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }

            const resizer = target.closest('.ca-resizer');
            if (!resizer) {
                return;
            }

            manageResize(md, resizer);
        });
    }

    _updateStorageToggleUi = (mode = 'allow') => {
        const el = document.getElementById('ca-nav-storage-toggle');
        if (!el) {
            console.error('[CA] _updateStorageToggleUi: #ca-nav-storage-toggle not found');
            return;
        }

        el.dataset.storageMode = mode;
        let title;
        let svgEl;

        if (mode === 'block') {
            title = 'Storage disabled (click to cycle: allow / wipe)';
            svgEl = this.util.renderSvgIconWithClass("lucide lucide-database",
                `<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"></path>
            <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"></path>
            <path d="M6 7l12 12"></path>
            <path d="M18 7L6 19"></path>`, false);

        } else if (mode === 'wipe') {
            title = 'Storage wipe on load (click to cycle: block / allow)';
            svgEl = this.util.renderSvgIconWithClass("lucide lucide-database-trash",
                `<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"></path>
            <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"></path>
            <rect x="8" y="10" width="8" height="9" rx="1"></rect>
            <line x1="10" y1="10" x2="10" y2="8"></line>
            <line x1="14" y1="10" x2="14" y2="8"></line>
            <line x1="9"  y1="13" x2="9"  y2="17"></line>
            <line x1="12" y1="13" x2="12" y2="17"></line>
            <line x1="15" y1="13" x2="15" y2="17"></line>`, false);
        } else {
            title = 'Storage enabled (click to cycle: wipe / block)';
            svgEl = this.util.renderSvgIconWithClass("lucide lucide-database",
                `<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"></path>
            <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"></path>`, false);
        }

        el.title = title;
        el.replaceChild(svgEl, el.firstChild);
    }

    handleStorageToggleClick = () => {
        const prevMode = this.settingsStore.getWriteStorageMode() || 'allow';
        let nextMode;

        if (prevMode === 'allow') {
            nextMode = 'wipe';
        } else if (prevMode === 'wipe') {
            nextMode = 'block';
        } else {
            nextMode = 'allow';
        }

        this.settingsStore.setWriteStorageMode(nextMode);

        this._updateStorageToggleUi(nextMode);
        this.hostServices.logEventLine(`Storage mode set to ${nextMode} at ${this.util.timeHHMM()}`);
    }

    onGlobalClickPanelNav = (e) => {
        const link = e.target.closest('.ca-dm-link[data-action]');
        if (!link) {
            return;
        }

        const action = String(link.dataset.action || '').toLowerCase();

        switch (action) {
            case 'broadcast':
                this.util.verbose('Nav: broadcast clicked');
                this.popups.openBroadcastModal();
                break;

            case 'send-message':
                this.util.verbose('Nav: send-specific clicked');
                this.popups.openSendMessageModal();
                break;

            case 'clear-all-logs':
                this.util.verbose('Nav: clear-all-logs clicked');
                this.handleLogContainersElClear();
                break;

            case 'storage-toggle':
                this.util.verbose('Nav: storage-toggle clicked');
                this.handleStorageToggleClick();
                break;

            case 'open-settings':
                this.util.verbose('Nav: settings clicked');
                this.popups.openSettingsPopup();
                break;

            case 'open-users':
                this.util.verbose('Nav: users clicked');
                this.popups.openUserManagementPopup();
                break;

            default:
                console.warn('[CA] _wirePanelNav: unhandled data-action:', action);
                break;
        }
    }

    handleLogContainersElClear = () => {
        this.ui.sentMessagesBox.innerHTML = '';
        this.ui.unreadMessagesBox.innerHTML = '';
        this.ui.handledMessagesBox.innerHTML = '';
        this.ui.loggingBox.innerHTML = '';
        this.ui.presenceBox.innerHTML = '';

        const removedIn = this.activityLogStore.clearByKind('dm-in') || 0;
        const removedOut = this.activityLogStore.clearByKind('dm-out') || 0;
        const removedFail = this.activityLogStore.clearByKind('send-fail') || 0;
        const removedEvents = this.activityLogStore.clearByKind('event') || 0;
        const removedLogin = this.activityLogStore.clearByKind('login') || 0;
        const removedLogout = this.activityLogStore.clearByKind('logout') || 0;
        console.log(`[LOG] Global clear removed: in=${removedIn}, out=${removedOut}, fail=${removedFail}, event=${removedEvents}, login=${removedLogin}, logout=${removedLogout}`);
        this.hostServices.logEventLine(`Logs cleared at ${this.util.timeHHMMSS()}`);
    }

    _createUserListContainer = (options) => {
        const {
            wrapperEl,
            containerId,
            countId,
            labelText,
            headerExtraClass,
            isExpanded,
            includeSubrow
        } = options || {};

        if (!wrapperEl) {
            console.error('[CA] _createUserListContainer: wrapperEl is missing');
            return null;
        }

        if (!containerId || !countId) {
            console.error('[CA] _createUserListContainer: containerId or countId is missing', {
                containerId,
                countId
            });
            return null;
        }

        const group = document.createElement('div');
        group.classList.add('ca-user-list-container-group');
        group.classList.add(isExpanded ? 'ca-expanded' : 'ca-collapsed');
        wrapperEl.appendChild(group);

        const header = document.createElement('div');
        header.className = `ca-user-list-header ${headerExtraClass || ''}`.trim();
        group.appendChild(header);

        const title = document.createElement('div');
        title.className = 'ca-user-list-title';
        header.appendChild(title);

        const countSpan = document.createElement('span');
        countSpan.className = 'ca-user-list-count';
        countSpan.id = countId;
        countSpan.textContent = '0';
        title.appendChild(countSpan);

        const labelSpan = document.createElement('span');
        labelSpan.textContent = labelText || '';
        title.appendChild(labelSpan);

        const toggle = document.createElement('div');
        toggle.className = 'ca-user-list-toggle';
        toggle.textContent = '▼';
        title.appendChild(toggle);

        let subrow = null;
        if (includeSubrow) {
            subrow = document.createElement('div');
            subrow.className = 'ca-subrow';
            header.appendChild(subrow);
        }

        const container = document.createElement('div');
        container.id = containerId;
        container.className = 'ca-user-list-container';
        group.appendChild(container);

        const content = document.createElement('div');
        content.className = 'ca-user-list-content';
        container.appendChild(content);

        header.addEventListener("click", (event) => {
            const target = event.target;

            if (
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target instanceof HTMLSelectElement ||
                target.closest("label")
            ) {
                return;
            }

            this._onUserListHeaderClick(group);
        });

        return {
            group,
            header,
            title,
            countSpan,
            labelSpan,
            toggle,
            subrow,
            container,
            content
        };
    }

    _onUserListHeaderClick = (group) => {
        if (!group) {
            console.error("[CA] _onUserListHeaderClick: group is missing");
            return;
        }

        // Determine the opposite container group
        let otherGroup = null;

        if (group === this.ui.femaleUserContainerGroup) {
            otherGroup = this.ui.otherUserContainerGroup;
        } else if (group === this.ui.otherUserContainerGroup) {
            otherGroup = this.ui.femaleUserContainerGroup;
        } else {
            console.warn("[CA] _onUserListHeaderClick: group is not a known user container group", group);
        }

        if (!otherGroup) {
            // Fallback: just toggle this one, don't enforce "always one open"
            this.util.debug("[CA] Only one group available yet — toggling single group");
            const isExpanded = this._isExpanded(group);

            if (!isExpanded) {
                this._expandContainer(group);
            } else {
                this._collapseContainer(group);
            }
            return;
        }

        this._setExpanded(group, otherGroup);
    };

    createOtherUsersContainer = () => {
        const refs = this._createUserListContainer({
            wrapperEl: this.ui.userContainersWrapper,
            containerId: this.sel.raw.users.otherUsersContainer,
            countId: this.sel.raw.users.otherUserCount,
            labelText: 'Other Users',
            headerExtraClass: 'ca-male-users-header',
            isExpanded: false,
            includeSubrow: true
        });

        if (!refs) {
            console.error('[CA] createOtherUsersContainer: failed to create container refs');
            return;
        }

        if (refs.subrow) {
            this.renderAndWireIncludeOtherUsersInParsing(refs.subrow);
        } else {
            console.warn('[CA] createFemaleUsersContainer: subrow is missing, cannot render toggles');
        }

        this.ui.otherUserContainerGroup = refs.group;
        this.ui.otherUsersContainer = refs.container;
    }

    createFemaleUsersContainer = () => {
        const refs = this._createUserListContainer({
            wrapperEl: this.ui.userContainersWrapper,
            containerId: this.sel.raw.users.femaleUsersContainer,
            countId: this.sel.raw.users.femaleUserCount,
            labelText: 'Female Users',
            headerExtraClass: 'ca-female-users-header',
            isExpanded: true,
            includeSubrow: true
        });

        if (!refs) {
            console.error('[CA] createFemaleUsersContainer: failed to create container refs');
            return;
        }

        this.ui.femaleUserContainerGroup = refs.group;
        this.ui.femaleUsersContainer = refs.container;

        if (refs.subrow) {
            this.renderAndWireEnableBroadcastCheckbox(refs.subrow, this.ui.femaleUsersContainer);
            this.renderAndWireHideHandledToggle(refs.subrow, this.ui.femaleUsersContainer);
        } else {
            console.warn('[CA] createFemaleUsersContainer: subrow is missing, cannot render toggles');
        }

        this.util.verbose('Created female users container');
    }

    renderAndWireIncludeOtherUsersInParsing = (elToAppendTo) => {
        const label = document.createElement('label');
        label.style.marginLeft = '8px';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'ca-include-other-users-ck-toggle';
        checkbox.checked = !!this.shouldIncludeOtherUsers;

        const textSpan = document.createElement('span');
        textSpan.textContent = 'Also parse other users';

        label.appendChild(checkbox);
        label.appendChild(textSpan);

        checkbox.addEventListener("change",
            /** @param {Event} e */
            async (e) => {

                const target = e.target;

                if (!(target instanceof HTMLInputElement)) {
                    console.warn(
                        "[CA] renderAndWireIncludeOtherUsersInParsing: event target is not an input",
                        e
                    );
                    return;
                }

                const checked = !!target.checked;
                this.util.debug("[CA] Include other users:", checked);
                this.shouldIncludeOtherUsers = checked;
                this.settingsStore.setShouldIncludeOthers(checked);
                this.applyHideHandledUseritemEls(checked);
                this.util.qs(`.ca-user-list-content`, this.ui.otherUsersContainer).innerHTML = "";
                await this.hostServices.refreshUserList();
            }
        );

        elToAppendTo.appendChild(label);
    }

    renderAndWireHideHandledToggle = (elToAppendTo, targetContainer) => {
        const label = document.createElement('label');
        label.style.marginLeft = '8px';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'ca-hide-handled-ck-toggle';
        checkbox.checked = !!this.shouldHideHandledUsers;

        const textSpan = document.createElement('span');
        textSpan.textContent = 'Hide handled users';

        label.appendChild(checkbox);
        label.appendChild(textSpan);

        checkbox.addEventListener("change",
            (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.util.debug("[CA] Hide handled users:", checkbox.checked);

                const target = e.target;

                if (!(target instanceof HTMLInputElement)) {
                    console.warn(
                        "[CA] renderAndWireHideHandledToggle: event target is not an input",
                        e
                    );
                    return;
                }

                const checked = !!target.checked;
                this.util.debug("[CA] Hide handled users:", checked);
                this.shouldHideHandledUsers = checked;
                this.settingsStore.setHideHandled(checked);
                targetContainer.classList.toggle("ca-hide-handled-ck-toggle", checked);
                this.applyHideHandledUseritemEls(checked);
            }
        );

        elToAppendTo.appendChild(label);
    }

    renderAndWireEnableBroadcastCheckbox = (elToAppendTo, targetContainer) => {
        const label = document.createElement('label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'ca-broadcast-ck-toggle';
        checkbox.checked = !!this.shouldShowBroadcastCheckboxes;

        const textSpan = document.createElement('span');
        textSpan.textContent = 'Show broadcast boxes';

        label.appendChild(checkbox);
        label.appendChild(textSpan);

        checkbox.addEventListener('change', (e) => {
            const checked = !!e.target.checked;
            this.shouldShowBroadcastCheckboxes = checked;
            this.settingsStore.setShowBroadcastSelectionBoxes(checked);
            targetContainer.classList.toggle('ca-show-broadcast-ck', checked);
            this.util.debug(
                '[CA] Female user checkbox visibility:',
                checked ? 'shown' : 'hidden'
            );
        });

        elToAppendTo.appendChild(label);
    }

    applyHideHandledUseritemEls = (hide) => {
        const handledEls = this.util.qsa(`${this.sel.log.classes.user_item}${this.sel.log.classes.ca_handled_messages}`, this.ui.femaleUsersContainer);
        handledEls.forEach((el) => {
            el.style.display = hide ? 'none' : '';
        });
    }

    _setExpanded = (container, otherContainer) => {
        if (!container || !otherContainer) {
            console.error("_setExpanded: missing container or otherContainer");
            return;
        }

        const isExpanded = this._isExpanded(container);
        const otherExpanded = this._isExpanded(otherContainer);

        // CASE 1: Clicked container is collapsed → expand it
        if (!isExpanded) {
            this._expandContainer(container);
            this._collapseContainer(otherContainer);
            return;
        }

        // CASE 2: Clicked container is expanded → collapse it
        this._collapseContainer(container);

        // Ensure always one container stays open
        if (!otherExpanded) {
            this._expandContainer(otherContainer);
        }
    };

    _expandContainer = (container) => {
        if (!container) {
            console.error("_expandContainer: container is null");
            return;
        }

        container.classList.add("ca-expanded");
        container.classList.remove("ca-collapsed");
    };

    _collapseContainer = (container) => {
        if (!container) {
            console.error("_collapseContainer: container is null");
            return;
        }

        container.classList.remove("ca-expanded");
        container.classList.add("ca-collapsed");
    };

    _isExpanded = (container) => {
        if (!container) {
            console.error("_isExpanded: container is null");
            return false;
        }

        return container.classList.contains("ca-expanded");
    };

    _isStaffListView = () => {
        const titleEl =
            this.util.qs('#menu_title, .menu_title, .title, .btitle, #page_title, .page_title') ||
            null;
        const txt = String((titleEl && titleEl.textContent) || document.title || '').trim().toLowerCase();
        return txt.includes('staff list');
    }

    _setHeadersVisible = (visible) => {
        const headers = this.util.qsa('.ca-user-list-header');
        headers.forEach(h => {
            h["style"].display = visible ? '' : 'none';
        });
    }

    toggleOriginalUserList = (visible) => {
        this.util.qs(`#chat_right_data`).style.display = visible ? 'block' : 'none';
        this.util.qs(this.sel.users.otherUsersContainer).style.display = !visible ? 'block' : 'none';
        this.util.qs(this.sel.users.femaleUsersContainer).style.display = !visible ? 'block' : 'none';
    }

    wireListOptionClicks = () => {
        const friendsBtn = this.util.qs('#friends_option');
        const usersBtn = this.util.qs('#users_option');
        const searchBtn = this.util.qs('#search_option');

        [friendsBtn, searchBtn].forEach(btn => this.util.click(btn, this.toggleOriginalUserList, true));
        this.util.click(usersBtn, this.toggleOriginalUserList, false);
    }

    updateFemaleUserCountEl = (count) => {
        this.util.verbose('Updating female user count:', count);
        const headerCounter = this.util.qs(this.sel.users.femaleUserCount);
        headerCounter.textContent = `${count}`;
    }

    updateOtherUsersCountEl = (count) => {
        const headerCounter = this.util.qs(this.sel.users.otherUserCount);
        headerCounter.textContent = `${count}`;
    }

    _boxesForKinds = (kinds) => {
        const boxes = new Set();
        const hasOut = kinds.includes('dm-out');
        const hasInHandled = kinds.includes('dm-in-handled');
        const hasInUnread = kinds.includes('dm-in-unread');
        const hasEvt = kinds.includes('event');
        const hasPresence = kinds.includes('login') || kinds.includes('logout');

        if (hasOut) {
            boxes.add(this.ui.sentMessagesBox);
        }

        if (hasInHandled) {
            boxes.add(this.ui.handledMessagesBox);
        }

        if (hasInUnread) {
            boxes.add(this.ui.unreadMessagesBox);
        }

        if (hasPresence) {
            boxes.add(this.ui.presenceBox);
        }

        if (hasEvt) {
            boxes.add(this.ui.loggingBox);
        }

        return Array.from(boxes);
    }

    _onLogClearClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const btn = (e.currentTarget instanceof HTMLElement)
            ? e.currentTarget
            : e.target;

        console.log(`On box clear click: ${btn.dataset?.kinds}`);

        const kindsAttr = (btn.dataset?.kinds || '').trim();
        if (!kindsAttr) {
            console.warn('[LOG] Clear clicked but data-kinds is missing');
            return;
        }

        const kinds = Array.from(new Set(
            kindsAttr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        ));

        if (!this.activityLogStore || typeof this.activityLogStore.clearByKind !== 'function') {
            console.error('[LOG] ActivityLogStore.clearByKind unavailable for section clear');
            return;
        }

        let totalRemoved = 0;
        for (let i = 0; i < kinds.length; i++) {
            const k = kinds[i];
            const removed = this.activityLogStore.clearByKind(k) || 0;
            totalRemoved += removed;
        }

        const boxes = this._boxesForKinds(kinds);
        if (boxes.length === 0) {
            console.warn('[LOG] No UI boxes resolved for kinds:', kinds);
        } else {
            for (let i = 0; i < boxes.length; i++) {
                if (!boxes[i]) {
                    console.error('[LOG] UI box not found for kinds', kinds);
                }
                boxes[i].innerHTML = '';
            }
        }

        console.log(`[LOG] Section cleared: kinds=[${kinds.join(', ')}], removed=${totalRemoved}`);
    }

    isVisuallyTruncated_ = (el) => {
        const style = window.getComputedStyle(el);

        const clampVal =
            style.getPropertyValue("-webkit-line-clamp") ||
            style.getPropertyValue("line-clamp");

        const isClamped =
            clampVal && clampVal !== "none" && Number.parseInt(clampVal, 10) > 0;

        const multiline =
            isClamped ||
            style.display === "-webkit-box" ||
            (style.whiteSpace !== "nowrap" && style.whiteSpace !== "pre");

        if (multiline) {
            return el.scrollHeight > el.clientHeight + 1;
        }

        return el.scrollWidth > el.clientWidth + 1;
    }

    ensureExpandButtonFor_ = (logEntryEl) => {
        const logEntryTextEl = logEntryEl.querySelector(`${this.sel.log.classes.ca_log_text}`);
        const ind = logEntryEl.querySelector(`.${this.sel.raw.log.classes.ca_expand_indicator}`);
        const expanded = logEntryTextEl.classList.contains("ca-text-expanded");

        if (!ind) {
            return;
        }

        if (expanded) {
            logEntryTextEl.classList.add("ca-text-expanded");
            logEntryTextEl.classList.remove("ca-text-clamped");
        } else {
            logEntryTextEl.classList.remove("ca-text-expanded");
            logEntryTextEl.classList.add("ca-text-clamped");
        }

        const capped = this.isVisuallyTruncated_(logEntryTextEl);
        const shouldShow = expanded || capped;

        logEntryTextEl.setAttribute("data-action", shouldShow ? 'toggle-expand' : 'open-dm');

        ind.style.display = shouldShow ? "" : "none";
        ind.textContent = expanded ? "▴" : "▾";
        ind.setAttribute("aria-expanded", expanded ? "true" : "false");
    }

    renderLogEntry = (activityLog, user) => {
        if (!activityLog || !user || !user.uid) {
            console.error('renderLogEntry: Invalid args', {entry: activityLog, user});
            return;
        }

        const {ts, kind, content, guid} = activityLog;
        let targetContainer;
        switch (kind) {
            case 'dm-out':
                targetContainer = this.ui.sentMessagesBox;
                break;

            case 'dm-in-handled':
                targetContainer = this.ui.handledMessagesBox;
                break;

            case 'dm-in-unread':
                targetContainer = this.ui.unreadMessagesBox;
                break;

            case 'login':
            case 'logout':
                targetContainer = this.ui.presenceBox;
                break;

            case 'event':
                targetContainer = this.ui.loggingBox;
                break;

            default:
                targetContainer = this.ui.messagesWrapper;
        }

        if (!targetContainer) {
            console.error('renderLogEntry: No target container for kind', {kind, activityLog, user});
            return;
        }

        this.util.verbose(
            `Start rendering entry with timestamp ${ts}, type/kind ${kind} and content ${content} from user ${user.uid}`,
            user,
            'in target container',
            targetContainer
        );

        const mappedKind = kind === 'dm-out' ? 'send-ok' : kind;
        const tsStr = String(ts);
        const displayTs = tsStr.split(' ')[1] || tsStr;
        const html = this.buildLogHTML(kind, activityLog.content, user);
        const detailsHTML = this.decodeHTMLEntities(html);
        const isSystemUser = String(user.uid) === 'system';
        const userHTML = `
                <div class="${this.sel.raw.log.classes.ca_log_cell}">
                    <span class="${this.sel.raw.log.classes.ca_log_user}">
                        ${
            isSystemUser
                ? `<strong>${user.name || 'System'}</strong>`
                : this.userLinkHTML(user)
        }
                    </span>
                </div>
              `;

        const dmIconHTML = `
            <a href="#"
               class="${this.sel.raw.log.classes.ca_dm_link} ${this.sel.raw.log.classes.ca_dm_right} ${this.sel.raw.log.classes.ca_log_action}"
               data-action="open-dm"
               title="Direct message">
               ${this.util.buildSvgIconString(
            'lucide lucide-mail',
            `
                                <rect x="3" y="5" width="18" height="14" rx="2" ry="2"></rect>
                                <polyline points="3 7,12 13,21 7"></polyline>
                            `)} </a> `;

        const expandIconHTML = `<span class="ca-expand-indicator" title="Click to expand/collapse" data-action="toggle-expand" role="button" tabindex="0" aria-expanded="true">▴</span>`;

        const markHandledIconHTML = `
        <a href="#"
           class="${this.sel.raw.log.classes.ca_log_action} ca-log-mark-handled"
           data-action="mark-handled"
           title="Mark this message as handled">
           ${this.util.buildSvgIconString(
            'lucide lucide-check',
            `
                  <polyline points="9 12 11 14 15 10"></polyline>
                `,
            false
        )}
        </a>`;


        const deleteIconHTML = `
                <a href="#"
                   class="${this.sel.raw.log.classes.ca_del_link} ${this.sel.raw.log.classes.ca_log_action}"
                   data-action="delete-log"
                   title="Delete this log entry">
                   ${this.util.buildSvgIconString(
            'lucide lucide-x',
            `
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        `)}</a> `;

        const guidAttr = guid != null ? ` data-guid="${String(guid)}"` : '';

        const entryHTML = `
                <div class="ca-log-entry ca-log-${mappedKind}"
                     data-uid="${String(user.uid)}"${guidAttr}>
                    <span class="ca-log-ts">${displayTs}</span>
                    <div class="${this.sel.raw.log.classes.ca_log_cell}">
                        <span class="${user.uid === 'system' ? 'ca-system-log-dot' : this.sel.raw.log.classes.ca_log_dot} ${this.sel.raw.log.classes.ca_log_dot_gray}">
                            ●
                        </span>
                    </div>
                    ${userHTML}
                    <span class="${this.sel.raw.log.classes.ca_log_text}">
                        ${detailsHTML}
                    </span>
                    <div class="${this.sel.raw.log.classes.ca_log_actions}">
                        ${expandIconHTML}
                        ${dmIconHTML}
                        ${markHandledIconHTML}
                        ${deleteIconHTML}
                    </div>
                </div>
            `;

        const logEntryEl = this.util.createElementFromString(entryHTML);
        logEntryEl.classList.add(kind);

        if (user.uid !== 'system') {
            this.setLogDotLoggedInStatusForElement(this.util.qs(`${this.sel.log.classes.ca_log_dot}`, logEntryEl), user.isLoggedIn);
        } else {
            logEntryEl.classList.add('system-log-entry');
        }

        if (!logEntryEl) {
            console.error('renderLogEntry: Failed to build log entry element', {activityLog, user});
            return;
        }
        targetContainer.appendChild(logEntryEl);
        this.ensureExpandButtonFor_(logEntryEl);
        this.util.scrollToBottom(targetContainer);
    }

    userLinkHTML = (user) => {
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

    processHandledStatusForLogsEls = (logs) => {
        for (const log of logs) {
            this.util.debug(`Processing handled status for log ${log.guid}`);
            const el = this.util.qs(`.ca-log-entry[data-guid="${log.guid}"]`, this.ui.unreadMessagesBox);
            this.ui.handledMessagesBox.appendChild(el);
            el.classList.remove('dm-in-unread');
            el.classList.add('dm-in-handled');
        }

        this.util.scrollToBottom(this.ui.handledMessagesBox);
    }

    destroy = () => {
        console.warn(`Destroying ChatApp UI and util.`);
        this.hostServices.destroy();
    }
}

const text = document.body.innerText || "";
if (!text.includes("Verifieer dat u een mens bent")) {

    window.app = new App();
} else {
    console.warn("Human verification page detected — not initializing.");
}
app.init().then(() => {
    console.log("ChatApp initialized.");
});
