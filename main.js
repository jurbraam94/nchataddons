(async function () {
    const {
        KeyValueStore,
        ActivityLogStore,
        UserStore,
        NullStorage,
        SettingsStore,
        Popups,
        Helpers
    } = window.CAPlugins;

    if (!KeyValueStore || !ActivityLogStore || !UserStore || !NullStorage) {
        console.error('[CA] Store plugin classes missing. Got:', window.CAPlugins);
        return;
    }

    class App {
        constructor() {
            this.FEMALE_CODE = '2';
            this.activeTextInput = null;

            this.SettingsStore = new SettingsStore();

            this.ActivityLogStore = new ActivityLogStore();

            this.UserStore = new UserStore();

            this.popups = new Popups(this);

            this.tester = new ChatAddonTester(this);
            this.helpers = new Helpers(this);

            this.options = {};
            this.state = {
                CHAT_CTX: {
                    caction: '', room: '', notify: '', curset: ''
                }
            };

            this.ui = {
                panel: null,
                panelNav: null,
                sentMessagesBox: null,
                messagesWrapper: null,
                presenceBox: null,
                logClear: null,
                repliedMessageBox: null,
                unrepliedMessageBox: null,
                loggingBox: null,
                userContainersWrapper: null,
                femaleUserContainerGroup: null,
                otherUserContainerGroup: null,
                femaleUsersContainer: null,
                otherUsersContainer: null,
            };

            this._lastSendAt = 0;
            this.userRefreshInterval = 30000;

            this._xhrOpen = null;
            this._xhrSend = null;

            this.isInitialLoad = true;

            this.userParsingInProgress = false;

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
                        ca_replied_messages: '.ca-replied-messages',
                        ca_sent_chip_all_read: '.ca-sent-chip-all-read',
                        ca_sent_chip_unread: '.ca-sent-chip-unread',
                        user_item: '.user_item'
                    },
                    sentMessagesBox: '#ca-log-box-sent',
                    messagesWrapper: '.ca-sections-wrapper',
                    repliedMessagesBox: '#ca-log-received-replied',
                    unrepliedMessagesBox: '#ca-log-received-unreplied',
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


        async init(options = {}) {
            this.options = options || {};
            this._removeSuperBotMethods();
            this.buildRawTree(this.sel, this.sel.raw);

            this.debugMode = this.SettingsStore.getDebugMode();
            this.verboseMode = this.SettingsStore.getVerboseMode();

            const storedHide = this.SettingsStore.getHideReplied() || false;
            this.shouldHideRepliedUsers = storedHide === true || storedHide === 'true';

            const storedShouldIncludeOtherUsers = this.SettingsStore.getShouldIncludeOthers() || false;
            this.shouldIncludeOtherUsers = storedShouldIncludeOtherUsers === true || storedShouldIncludeOtherUsers === 'true';

            const showBroadcastCheckboxes = this.SettingsStore.getShowBroadcastSelectionBoxes() || false;
            this.shouldShowBroadcastCheckboxes = showBroadcastCheckboxes === true || showBroadcastCheckboxes === 'true';

            this.removeAds(document);
            this.buildPanel();

            const main_wrapper = document.createElement('div');
            main_wrapper.id = 'main_wrapper';

            this.helpers.qs(this.sel.privateChat.privateInputBox).innerHTML =
                '<textarea data-paste="1" id="message_content" rows="4" class="inputbox" placeholder="Type a message..."></textarea>';
            this.helpers.qs('#message_form').prepend(this.helpers.qs('#private_input_box'));

            this.helpers.qs('#private_center').after(this.helpers.qs('#private_menu'));

            main_wrapper.appendChild(this.helpers.qs('#chat_head'));
            main_wrapper.appendChild(this.helpers.qs('#global_chat'));
            main_wrapper.appendChild(this.helpers.qs('#wrap_footer'));
            document.body.prepend(main_wrapper);

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

            this._installAudioAutoplayGate();
            this.initializeGlobalWatermark();
            this._updateStorageToggleUi(this.SettingsStore.getWriteStorageMode());
            this.buildMenuLogPanel();
            const userContainersWrapper = document.createElement(`div`);
            userContainersWrapper.id = `ca-user-container`;
            this.helpers.qs(`#chat_right`).appendChild(userContainersWrapper);
            this.ui.userContainersWrapper = userContainersWrapper;
            this.createOtherUsersContainer();
            this.createFemaleUsersContainer();
            this.wireListOptionClicks();
            this.wireUserContainerHeaders();
            this._bindStaticRefs();
            this._attachLogClickHandlers();
            this.helpers.installLogImageHoverPreview([
                this.ui.repliedMessageBox,
                this.ui.unrepliedMessageBox,
                this.ui.sentMessagesBox,
                this.ui.presenceBox,
                this.ui.loggingBox,
                this.ui.userContainersWrapper
            ]);

            if (this.shouldShowBroadcastCheckboxes) {
                this.helpers.qs('#ca-female-users-container').classList.add("ca-show-broadcast-ck");
            }

            await this.restoreLastDmFromStore();

            const privateCloseButton = this.helpers.qs('#private_close');
            if (privateCloseButton) {
                privateCloseButton.addEventListener('click', () => {
                    this.SettingsStore.clearLastDmUid();
                });
            }

            const dmTextarea = this.helpers.qsTextarea("#message_content");
            const dmSendBtn = this.helpers.qs("#private_send");

            if (!dmTextarea || !dmSendBtn) {
                console.error('Dmtextarea or dmsendbtn not found');
                return;
            }

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

            this._wireLogClear();
            this._wireTextboxTrackers();

            this.installNetworkTaps();
            this.installPrivateSendInterceptor();
            this.appendCustomActionsToBar();
            await this.startRefreshUsersLoop({intervalMs: 30000, runImmediately: true});
            this.scrollToBottom(this.ui.repliedMessageBox);
            this.scrollToBottom(this.ui.unrepliedMessageBox);
            this.scrollToBottom(this.ui.sentMessagesBox);

            this.hostGetProfileOriginal = window.getProfile.bind(window);
            window.getProfile = async (uid) => {
                // We don't await here; errors are handled inside openProfileOnHost
                await this.openProfileOnHost(uid);
            };
            this.helpers.debug('[CA] Overridden window.getProfile with CA profile popup');

            return this;
        }

        _wireTextboxTrackers() {
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

            const list = this.SettingsStore.getPredefinedMessages();
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

                const insertLink = document.createElement('a');
                insertLink.href = "#";
                insertLink.className = 'ca-log-action ca-insert-link';
                insertLink.title = "Paste into active text field";

                insertLink.appendChild(
                    this.helpers.renderSvgIconWithClass(
                        "lucide lucide-corner-down-left",
                        `<polyline points="9 10 4 15 9 20"></polyline>
     <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>`
                    )
                );

                insertLink.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    this._appendPredefinedToActiveBox(item);
                });

                const editLink = document.createElement('a');
                editLink.href = "#";
                editLink.className = 'ca-log-action ca-edit-link';
                editLink.title = "Edit template";
                editLink.appendChild(
                    this.helpers.renderSvgIconWithClass(
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

                const deleteLink = document.createElement('a');
                deleteLink.href = "#";
                deleteLink.className = 'ca-log-action ca-del-link';
                deleteLink.title = "Delete template";
                deleteLink.appendChild(
                    this.helpers.renderSvgIconWithClass(
                        "lucide lucide-x",
                        `<line x1="18" y1="6" x2="6" y2="18"></line>
     <line x1="6" y1="6" x2="18" y2="18"></line>`
                    )
                );

                deleteLink.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    const current = this.SettingsStore.getPredefinedMessages().slice();
                    current.splice(index, 1);
                    this.SettingsStore.savePredefinedMessages(current);
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

        _fillPredefinedSelect(selectEl) {
            if (!selectEl) {
                console.error('[CA] _fillPredefinedSelect: missing element');
                return;
            }

            const list = this.SettingsStore.getPredefinedMessages();
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

        _refreshAllPredefinedSelects() {
            const selects = this.helpers.qsa('.ca-predefined-messages-select');
            selects.forEach((sel) => this._fillPredefinedSelect(sel));
        }

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
            const list = this.SettingsStore.getPredefinedMessages();
            if (Number.isNaN(idx) || idx < 0 || idx >= list.length) {
                console.warn('[CA] _applyPredefinedFromSelect: invalid index', idxStr);
                return false;
            }

            const template = list[idx];
            const targetSelector = selectEl.dataset.predefinedMessagesTarget;
            if (!targetSelector) {
                console.error('[CA] _applyPredefinedFromSelect: missing data-predefined-messages-target');
                return false;
            }

            const box = this.helpers.qs(targetSelector);
            if (!box) {
                console.error('[CA] _applyPredefinedFromSelect: target not found for selector:', targetSelector);
                return false;
            }

            this._appendPredefinedToBox(template, box);
            return true;
        }

        appendCustomActionsToBar() {
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
            refreshBtn.addEventListener('click', async () => {
                await this.refreshUserList();
                refreshBtn.classList.remove('loading');
            });

            const templatesBtn = document.createElement('div');
            templatesBtn.classList.add('panel_option', 'panel_option_templates');
            templatesBtn.title = 'Predefined messages';
            templatesBtn.innerHTML = '<i class="fa fa-comment-dots"></i>';

            templatesBtn.addEventListener('click', (event) => {
                event.preventDefault();
                this.popups.openPredefinedPopup(null);
            });

            if (existingOption) {
                bar.insertBefore(refreshBtn, existingOption);
                bar.insertBefore(templatesBtn, existingOption);
            } else {
                bar.appendChild(refreshBtn);
                bar.appendChild(templatesBtn);
            }
        }


        async startRefreshUsersLoop({
                                        intervalMs = this.userRefreshInterval,
                                        runImmediately = true
                                    } = {}) {
            this.stopRefreshUsersLoop();

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

        startClearEventLogLoop({
                                   intervalMs = 30 * 60 * 1000,
                                   runImmediately = true
                               } = {}) {
            this.stopClearEventLogLoop();

            const clearEvents = () => {
                const removed = this.ActivityLogStore?.clearByKind?.('event') || 0;
                this.ui.loggingBox.innerHTML = '';

                this.logEventLine(`Event logs cleared automatically (${removed} removed) at ${this.timeHHMM()}`);
                this.helpers.verbose(`[AutoClear] Cleared ${removed} event log(s).`);
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
            this.helpers.verbose('========== START REFRESHING AND PARSING NEW USER LIST ==========t');
            const formData = new URLSearchParams();
            formData.append('token', utk);

            const res = await fetch('system/panel/user_list.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: formData.toString(),
                credentials: 'same-origin',
            });

            const html = await res.text();

            try {
                await this.processUserListResponse(html);
            } catch (e) {
                console.error(e);
                this.logEventLine(`Refreshed user list failed at ${this.timeHHMMSS()}. Check the console for a more detailed error message.`);
            }
        }


        sleep(ms) {
            return new Promise(r => setTimeout(r, ms));
        }

        randBetween(minMs, maxMs) {
            return Math.floor(minMs + Math.random() * (maxMs - minMs));
        }

        decodeHTMLEntities(s) {
            const txt = document.createElement('textarea');
            txt.innerHTML = String(s);
            return txt.value;
        }

        isPrivateProcessUrl(u) {
            if (!u) return false;
            let s = String(u);
            s = new URL(s, location.origin).pathname;
            return s.indexOf('system/action/private_process.php') !== -1;
        }

        async processPrivateSendResponse(data, targetUid) {
            if (data?.code !== 1) {
                console.error(`[PrivateSend] Could not parse response from native message send:`, data);
                return null;
            }

            const logData = data.log || {};
            const content = logData.log_content || '';
            const dmSentToUser = await this.UserStore.getOrFetch(targetUid);

            if (!dmSentToUser) {
                console.error(
                    `[PrivateSend] Could not find user with ID ${targetUid}. ` +
                    `Could not process outgoing private message`
                );
                return null;
            }

            console.log(
                '\nIntercepted native message send to',
                dmSentToUser.name || targetUid,
                '(ID:',
                targetUid,
                ')'
            );

            this.logLine('dm-out', content, dmSentToUser, logData.log_id);

            const userEl = this.findUserById(dmSentToUser.uid);
            if (userEl) {
                this.updateProfileChip(dmSentToUser.uid, userEl);
            } else {
                this.helpers.debug(
                    '[PrivateSend] Skipping profile chip update; user element not found for uid:',
                    dmSentToUser.uid
                );
            }

            const affectedLogs =
                this.ActivityLogStore.MarkReadUntilChatLogId(
                    targetUid,
                    dmSentToUser.parsedDmInUpToLog
                );

            if (!Array.isArray(affectedLogs) || !affectedLogs.length) {
                this.helpers.debug('[PrivateSend] No logs to update read status for user:', targetUid);
                return true;
            }

            this.processReadStatusForLogs(affectedLogs);
            return true;
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
            tmp.innerHTML = '';
            this.helpers.verbose('Parsed', out.length, 'private conversation' + (out.length !== 1 ? 's' : ''));
            return out;
        }


        caFetchPrivateNotify() {
            const token = this.helpers.getToken();
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
                this.helpers.verbose('Private conversations:', privateConversations.length);
                privateConversations.sort((a, b) => {
                    const au = a.unread || 0, bu = b.unread || 0;
                    if (bu !== au) return bu - au;
                    const an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase();
                    return an < bn ? -1 : an > bn ? 1 : 0;
                });
                return privateConversations;
            });
        }

        fetchPrivateMessagesForUid(user, params) {
            const token = this.helpers.getToken();
            if (!token || !user.uid) {
                console.error(`.caFetchChatLogFor() called with invalid arguments:`, user.uid, params);
                return Promise.resolve('');
            }

            const bodyObj = {
                token,
                cp: 'chat',
                fload: '1',
                caction: String(this.state.CHAT_CTX.caction),
                last: params.get('last'),
                preload: '0',
                priv: String(user.uid),
                lastp: user.parsedDmInUpToLog,
                pcount: params.get('pcount'),
                room: String(this.state.CHAT_CTX.room),
                notify: String(this.state.CHAT_CTX.notify),
                curset: String(this.state.CHAT_CTX.curset)
            };

            this.helpers.verbose(`Fetch chatlog body: `, bodyObj);
            const bodyLog = new URLSearchParams(bodyObj).toString().replace(/token=[^&]*/, 'token=[redacted]');
            this.helpers.verbose('caFetchChatLogFor uid=', user.uid, ' body:', bodyLog);

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
                    this.helpers.verbose('caFetchChatLogFor: Response status:', res.status, res.statusText);
                    return res.text();
                })
                .then((txt) => {
                    this.helpers.verbose('caFetchChatLogFor received a response successfully');
                    return txt;
                })
                .catch((err) => {
                    this.helpers.verbose('Fetch chat log error:', err);
                    return null;
                });
        }

        processSinglePrivateChatLog(privateChatLog, user, initialFetch, currentHighestLogId) {
            if (privateChatLog.user_id === String(user_id)) {
                return {accepted: false, logId: privateChatLog.log_id, reason: 'from myself'};
            }

            if (initialFetch && !this.isMessageNewer(privateChatLog.log_date)) {
                this.helpers.debug(
                    `Initial fetch: skipping old message ${privateChatLog.log_id} for uid ${user.uid}; ` +
                    `watermark=${this.SettingsStore.getGlobalWatermark()}`
                );
                return {accepted: false, logId: privateChatLog.log_id, reason: 'too old'};
            }

            if (privateChatLog.log_id <= currentHighestLogId) {
                return {accepted: false, logId: privateChatLog.log_id, reason: 'already shown'};
            }

            this.logLine(
                'dm-in',
                this.decodeHTMLEntities(privateChatLog?.log_content),
                user,
                privateChatLog.log_id
            );
            this.updateProfileChipByUid(user.uid);
            return {accepted: true, logId: privateChatLog.log_id, reason: 'ok'};
        }


        async caProcessPrivateLogResponse(user, privateChatLogs) {
            let parsedDmInUpToLog = Number(user.parsedDmInUpToLog) || 0;
            const initialFetch = parsedDmInUpToLog === 0;
            let newMessages = 0;
            let skipped = '';
            const hasLogs = Array.isArray(privateChatLogs) && privateChatLogs.length > 0;

            if (hasLogs) {
                for (const privateChatLog of privateChatLogs) {
                    const res = this.processSinglePrivateChatLog(
                        privateChatLog,
                        user,
                        initialFetch,
                        parsedDmInUpToLog
                    );

                    if (!res.accepted) {
                        skipped += `Skipped ${res.logId}: ${res.reason}\n`;
                        continue;
                    }

                    console.log(`New message ${res.logId} for user ${user.uid}`, privateChatLog);

                    if (res.logId > parsedDmInUpToLog) {
                        parsedDmInUpToLog = res.logId;
                    }

                    newMessages++;
                }
            } else {
                console.log(`No new private chat logs for user ${user.uid}`);
            }

            const updatedUser = {...user};
            let shouldSave = false;

            if (newMessages > 0) {
                if (parsedDmInUpToLog > (user.parsedDmInUpToLog || 0)) {
                    updatedUser.parsedDmInUpToLog = parsedDmInUpToLog;
                    this.helpers.debug(`Set last read for user ${user.uid} to ${parsedDmInUpToLog}`);
                    shouldSave = true;
                }

                if (updatedUser.noNewPrivateDmTries) {
                    updatedUser.noNewPrivateDmTries = 0;
                    shouldSave = true;
                }
            } else {
                const prevTries = Number(user.noNewPrivateDmTries) || 0;
                const tries = prevTries + 1;
                updatedUser.noNewPrivateDmTries = tries;
                shouldSave = true;

                console.warn(`[PrivateChat] No messages accepted for uid ${user.uid} (attempt ${tries})`);

                if (tries >= 3) {
                    updatedUser.parsedDmInUpToLog = 0;
                    console.warn(
                        `[PrivateChat] 3x nothing parsed for uid ${user.uid}; ` +
                        `reset the complete chat history (setting parsedDmUptoLog to 0)`
                    );
                }
            }

            if (shouldSave) {
                this.UserStore.set(updatedUser);
            }

            if (skipped.length > 0) {
                this.helpers.debug(skipped);
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
                this.helpers.verbose(`Processing new plog for user ${user.uid} (initial fetch: ${initialFetch})`);
                this.helpers.verbose(privateChatLog);
                const res = this.processSinglePrivateChatLog(privateChatLog, user, initialFetch, user.parsedDmInUpToLog);
                if (res.accepted) {
                    this.helpers.debug(`New message ${res.logId} for user ${user.uid}`, privateChatLog);
                    this.UserStore.setParsedDmInUpToLog(user.uid, res.logId);
                } else {
                    this.helpers.debug(`Private chat log ${privateChatLog.log_id} for user ${user.uid} was skipped. Reason: ${res.reason}`);
                }
            }
        }

        async caProcessChatPayload(txt, params) {
            if (!txt || typeof txt !== 'string' || txt.trim() === '') {
                console.warn('Empty or invalid chat payload response');
                return;
            }

            const data = this.toChatLogResponse(JSON.parse(String(txt)));

            if (Array.isArray(data.plogs) && data.plogs.length > 0) {
                await this.handleChatLogPlogs(data.plogs);
                return;
            }

            const pico = Number(data && data.pico);

            if (!Number.isFinite(pico) || pico < 1 || (data.pload?.length > 0) || (data.plogs?.length > 0)) {
                return;
            }

            this.helpers.debug('Private messages count (pico):', pico, '— checking for new messages');
            const privateConversations = await this.caUpdatePrivateConversationsList(false);
            await this.handlePrivateConversationsList(privateConversations, params);
        }

        async handlePrivateConversationsList(privateConversations, params) {
            privateConversations = Array.isArray(privateConversations) ? privateConversations : [];
            this.helpers.verbose('Private conversations returned:', privateConversations.length, privateConversations);
            const privateChatsToFetch = privateConversations
                .filter(pc => pc.unread > 0)
                .map(it => ({uid: String(it.uid), unread: Number(it.unread) || 0}));

            if (!privateChatsToFetch.length) {
                console.log('None of the conversations has new messages');
                return;
            }

            this.helpers.verbose('Fetching', privateChatsToFetch.length, 'conversation' + (privateChatsToFetch.length !== 1 ? 's' : ''), 'with new messages');

            for (const privateChat of privateChatsToFetch) {
                await this.handlePrivateChat(privateChat, params);
            }
        }

        async handlePrivateChat(privateChat, params) {
            console.log('Fetch private message for conversation', privateChat.uid, '— unread:', privateChat.unread);

            const user = await this.UserStore.getOrFetch(privateChat.uid);
            if (!user) {
                console.error('[caProcessChatPayload] Could not resolve user for uid and aborting the fetch or private messages:', privateChat.uid);
                return null;
            }

            const rawPrivateChatLogResponse = await this.fetchPrivateMessagesForUid(user, params);

            if (!rawPrivateChatLogResponse || typeof rawPrivateChatLogResponse !== 'string') {
                console.warn('Empty response for conversation', user.uid);
            }

            const privateChatLogResponse = this.toPrivateChatLogResponse(JSON.parse(String(rawPrivateChatLogResponse)));

            const privateChatLogs =
                (Array.isArray(privateChatLogResponse?.pload) && privateChatLogResponse?.pload?.length ? privateChatLogResponse.pload :
                    (Array.isArray(privateChatLogResponse?.plogs) ? privateChatLogResponse.plogs : []));

            await this.caProcessPrivateLogResponse(
                user,
                privateChatLogs
            );
        }

        installNetworkTaps() {
            this.helpers.debug('Installing network taps (fetch/XHR interceptors)');
            if (!this._xhrOpen) this._xhrOpen = XMLHttpRequest.prototype.open;
            if (!this._xhrSend) this._xhrSend = XMLHttpRequest.prototype.send;

            const self = this;

            XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                this._ca_url = String(url || '');
                return self._xhrOpen.apply(this, [method, url, ...rest]);
            };

            XMLHttpRequest.prototype.send = function (...sendArgs) {
                /** @type {URLSearchParams | null} */
                let qs = null;

                const body = sendArgs[0];

                if (self.isChatLogUrl(this._ca_url) && body != null) {
                    // Only handle string bodies here (x-www-form-urlencoded style)
                    if (typeof body === "string") {

                        if (body.indexOf("priv=1") !== -1) {
                            return;
                        }

                        if (body.length > 0) {
                            qs = new URLSearchParams(body);
                            self.caUpdateChatCtxFromBody(qs);
                        }
                    } else {
                        console.warn("[PrivateSend] Unexpected body type for chat log request", body);
                    }
                }

                this.addEventListener("readystatechange", async function () {
                    const responseUrl = this.responseURL || this._ca_url || "";

                    if (this.readyState === 4 && this.status === 200 && this.responseText) {
                        if (self.isChatLogUrl(responseUrl)) {
                            await self.caProcessChatPayload(this.responseText, qs);
                        }
                        if (self.isUserListUrl(responseUrl)) {
                            await self.processUserListResponse(this.responseText);
                        }
                    } else if (this.status === 403) {
                        console.error(
                            "[PrivateSend] 403 error while fetching chat log. This is probably because of Cloudflare.\n" +
                            "Uninstalling the network taps to prevent any more calls being done until the browser is manually refreshed.",
                            responseUrl
                        );
                        self.popups.openCloudflarePopup(responseUrl);
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


            if (kind === 'event') {
                const m = text.match(/^\[USER_UPDATE]\s+(.+?)\s+has changed (?:his|her) Avatar\s*\(([^)]+)\s*→\s*([^)]+)\)/i);

                if (m) {
                    const userName = m[1] || '';
                    const newAvatar = (m[3] || '').trim();
                    const safeName = this.helpers.escapeHTML(userName);
                    const safeSrc = this.helpers.escapeAttr(newAvatar || '');
                    return `
                <span class="ca-log-text-main">
                    ${safeName} has changed ${user.isFemale ? `her` : `his`} avatar:
                </span>
                <a href="${safeSrc}" target="_blank" rel="noopener noreferrer">
                    <img class="chat_image ca-log-avatar-image" src="${safeSrc}" alt="New avatar of ${safeName}">
                </a>
            `;
                }

                return `<span class="ca-log-text-main">${this.helpers.escapeHTML(text)}</span>`;
            }

            return `<span class="ca-log-text-main">${this.helpers.escapeHTML(text)}</span>`;
        }

        _attachLogClickHandlers() {
            const boxes = [
                this.ui.sentMessagesBox,
                this.ui.messagesWrapper,
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
                return;
            }

            const uid = entry.getAttribute('data-uid') || '';
            const isSystem = (uid === 'system');

            this.helpers.verbose('Log entry clicked:', {entry, uid, isSystem});
            const userLinkEl = target.closest?.(this.sel.raw.log.classes.ca_user_link);
            if (userLinkEl && uid && !isSystem) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                await this.openProfileOnHost(uid);
                return;
            }

            const actionEl = target.closest?.('[data-action]');
            if (actionEl) {
                const action = String(actionEl.getAttribute('data-action') || '').toLowerCase();

                if (action === 'toggle-expand') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    const textEl = this.helpers.qs(`${this.sel.log.classes.ca_log_text}`, entry);

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
                    e.stopImmediatePropagation();

                    if (!uid || isSystem) {
                        this.helpers.verbose('[CA] open-profile: ignoring for system or missing uid', {uid});
                        return;
                    }

                    await this.openProfileOnHost(uid);
                    return;
                }

                if (action === 'open-dm') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    if (!uid || isSystem) {
                        this.helpers.verbose('[CA] open-dm: ignoring for system or missing uid', {uid});
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

                    this.applyLegacyAndOpenDm(user);
                    return;
                }
            }

            const logTextSel = this.sel.raw.log.classes.ca_log_text;
            const dmLinkSel = this.sel.log.classes.ca_dm_link;

            const dmArea =
                target.closest?.(logTextSel) ||
                target.closest?.(dmLinkSel) ||
                target.closest?.('img.chat_image');

            if (dmArea && uid && !isSystem) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

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

            if (uid && !isSystem) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                await this.openProfileOnHost(uid);
            }
        }

        applyLegacyAndOpenDm({uid, name, avatar}) {
            this.helpers.debug('applyLegacyAndOpenDm called with:', {uid, name, avatar});

            if (!uid || !name || !avatar) {
                console.error('[applyLegacyAndOpenDm] Invalid arguments:', {uid, name, avatar});
                return;
            }

            if (uid) {
                this.SettingsStore.setLastDmUid(uid);
            }

            if (!this.safeSet(window, 'morePriv', 0)) return false;
            if (!this.safeSet(window, 'privReload', 1)) return false;
            if (!this.safeSet(window, 'lastPriv', 0)) return false;
            if (!this.safeCall(window, 'closeList')) return false;
            if (!this.safeCall(window, 'hideModal')) return false;
            if (!this.safeCall(window, 'hideOver')) return false;

            openPrivate(uid, name, avatar);
        }

        safeSet(obj, key, value) {
            if (typeof obj?.[key] === 'undefined') {
                console.error(`key ${key} is not defined in object`, obj);
                return false;
            }
            obj[key] = value;
            return true;
        }

        safeCall(obj, key, ...args) {
            if (typeof obj?.[key] !== 'function') {
                console.error(`Function ${key} is not defined in object`, obj);
                return false;
            }
            obj[key](...args);
            return true;
        }

        async openProfileOnHost(uid) {
            this.helpers.debug('openProfileOnHost called with uid:', uid);

            const token = this.helpers.getToken();

            const body = new URLSearchParams({
                token,
                get_profile: String(uid),
                cp: 'chat'
            }).toString();

            const res = await fetch('/system/box/profile.php', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': '*/*'
                },
                body
            });

            const html = await res.text();

            const user = await this.UserStore.getOrFetch(uid);

            this.popups.createAndOpenPopupWithHtml(html, 'ca-profile-popup', user?.name || 'Profile')

        }


        buildBroadcastList() {
            const out = [];
            const loggedInFemaleUsers = this.UserStore.getAllLoggedInFemales();

            loggedInFemaleUsers.forEach((femaleUser) => {
                const uid = femaleUser.uid;

                if (this.ActivityLogStore.hasSentMessageToUser(uid)) {
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

        sendWithThrottle(id, text, minGapMs = 3500) {
            const now = Date.now();
            const wait = Math.max(0, minGapMs - (now - this._lastSendAt));
            return new Promise(r => setTimeout(r, wait))
                .then(() => this.sendPrivateMessage(id, text))
                .then((r) => {
                    if (!r) {
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

        async _runBroadcast(to, text) {
            const batchSize = 10;

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

                    if (await this.sendWithThrottle(uid, text)) {
                        ok++;
                    } else {
                        fail++;
                    }

                    this.logEventLine(`[BROADCAST] Batch ${bi + 1}/${numberOfBatches} — ${idx + 1}/${batch.length} sent (OK:${ok} Fail:${fail})`);
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

        cloneAndRenderNewUserElement(parsedUserItemEl, updatedUserJson) {
            const containerContent = this.helpers.qs(
                `.ca-user-list-content`,
                updatedUserJson.isFemale ? this.ui.femaleUsersContainer : this.ui.otherUsersContainer
            );

            const wrapper = document.createElement('div');
            wrapper.className = 'ca-us';
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

            this.helpers.qs('.user_item_avatar img.avav', parsedUserItemEl).addEventListener(
                'click',
                (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    this.openProfileOnHost(updatedUserJson.uid);
                },
                true
            );

            if (updatedUserJson?.age > 0) {
                const ageSpan = document.createElement('span');
                ageSpan.className = 'ca-age';
                ageSpan.textContent = ` (${updatedUserJson.age})`;
                wrapper.appendChild(ageSpan);
            }

            this.helpers.verbose(
                '[_updateOrCreateUserElement] Created new user element for',
                updatedUserJson.uid,
                updatedUserJson.name
            );

            const iconRow = document.createElement('div');
            iconRow.className = 'ca-user-icon-row';
            this.helpers.qs('.user_item_data', parsedUserItemEl).appendChild(iconRow);
            this.ensureDmLink(iconRow, updatedUserJson);
            this.ensureBroadcastCheckbox(iconRow, updatedUserJson);
            this.updateProfileChip(updatedUserJson.uid, parsedUserItemEl);
            this.helpers.qs('.username', parsedUserItemEl).replaceWith(wrapper);
            containerContent.appendChild(parsedUserItemEl);
        }

        updateUser(fetchedUserJson, existingUserEl) {
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
                this.helpers.verbose('[updateUser] Moved user element to correct container for', fetchedUserJson.uid);
            }

            this.helpers.verbose('[updateUser] Updated user element for', fetchedUserJson.uid, attrMap);
            return existingUserEl;
        }

        isUserListUrl(u) {
            if (!u) return false;
            let s = String(u);
            s = new URL(s, location.origin).pathname;
            return s.indexOf('system/panel/user_list.php') !== -1;
        }


        _updateExistingUserMetadata(existingUserJsonFromStore, parsedUserJson, existingUserEl) {
            const uid = existingUserJsonFromStore.uid || parsedUserJson.uid;
            let hasUpdatedUser = false;
            const updatedExistingUserJson = {
                ...existingUserJsonFromStore,
                ...parsedUserJson
            };
            let updatedExistingUserEl = existingUserEl;
            const changedKeys = [];
            const segments = [];

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

                    if (key !== "isLoggedIn") {
                        this.logEventLine(text, updatedExistingUserJson);
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
                this._logStyled('[USER_UPDATE] ', segments);

                this.helpers.verbose('[USER_UPDATE] JSON changes for user', uid, changedKeys);
                hasUpdatedUser = true;

                if (existingUserEl) {
                    this._applyUserDomChanges(existingUserEl, updatedExistingUserJson, changedKeys);
                } else {
                    this.helpers.verbose('[USER_UPDATE] No DOM element found — only JSON updated for uid:', uid);
                }

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
                        this.helpers.verbose("[updateUser] Moved user element after gender change");
                    }
                }
            }
            return existingUserEl;
        }

        async syncUsersFromDom(currentOnlineUserEls) {
            // Build the "maybe logged out" map without creating an extra array via .map()
            const maybeLoggedOutMap = new Map();
            const loggedInUsers = this.UserStore.getAllLoggedIn();
            for (let i = 0; i < loggedInUsers.length; i++) {
                const user = loggedInUsers[i];
                maybeLoggedOutMap.set(String(user.uid), user);
            }

            const resultPatches = [];
            let femaleLoggedOutCount = 0;
            let othersLoggedOutCount = 0;
            let femaleLoggedInCount = 0;
            let othersLoggedInCount = 0;
            let totalOthersLoggedInCount = 0;
            let totalFemaleLoggedInCount = 0;
            let updatedProfileCount = 0;

            // Main pass over the current online users
            for (let i = 0; i < currentOnlineUserEls.length; i++) {
                const parsedUserItemEl = currentOnlineUserEls[i];
                const parsedUserJson = this.helpers.extractUserInfoFromEl(parsedUserItemEl);

                // Find the existing DOM element for this user (if any)
                let existingUserEl = null;

                const newUserJson = parsedUserJson.isLoggedIn === true
                    ? parsedUserJson
                    : {...parsedUserJson, isLoggedIn: true};

                let updatedUserJson;

                const existingUserJsonFromStore = this.UserStore.get(parsedUserJson.uid);
                if (existingUserJsonFromStore) {
                    if (!this.isInitialLoad) {
                        existingUserEl = this.helpers.qs(`.user_item[data-id="${parsedUserJson.uid}"]`, {
                            root: this.ui.userContainersWrapper,
                            ignoreWarning: true
                        });
                    }

                    const {
                        updatedExistingUserJson,
                        updatedExistingUserEl,
                        hasUpdatedUser
                    } = this._updateExistingUserMetadata(
                        existingUserJsonFromStore,
                        newUserJson,
                        existingUserEl
                    );

                    updatedUserJson = updatedExistingUserJson;

                    if (hasUpdatedUser) {
                        updatedProfileCount++;
                        resultPatches.push(updatedUserJson);
                    }

                    existingUserEl = updatedExistingUserEl;
                } else {
                    this._logStyled('[USER_UPDATE] ', [
                        {
                            text: `New user ${newUserJson.name} has logged in.`,
                            style: this.colors.SOFT_GREEN
                        }
                    ]);
                    resultPatches.push(newUserJson);
                    updatedUserJson = newUserJson;
                }

                // If there's still no DOM element for this user, clone + render a new one
                if (!existingUserEl) {
                    await this.cloneAndRenderNewUserElement(parsedUserItemEl, updatedUserJson);

                    // Track login status changes (same logic as before)
                    if (!this.isInitialLoad) {
                        this.handleLoggedInStatus(updatedUserJson);
                        if (updatedUserJson.isFemale) {
                            femaleLoggedInCount++;
                        } else {
                            othersLoggedInCount++;
                        }
                    }
                } else {
                    parsedUserItemEl.remove();
                }

                // User is no longer a candidate for "logged out"
                if (maybeLoggedOutMap.has(parsedUserJson.uid)) {
                    maybeLoggedOutMap.delete(parsedUserJson.uid);
                }

                if (updatedUserJson.isFemale) {
                    totalFemaleLoggedInCount++;
                } else {
                    totalOthersLoggedInCount++;
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

                this._logStyled('[USER_UPDATE] ', [
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

            this.UserStore._saveAll(resultPatches);

            // Update UI counts
            this.updateFemaleUserCount(totalFemaleLoggedInCount);
            this.updateOtherUsersCount(totalOthersLoggedInCount);

            // Logging (unchanged)
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
            if (!value) return;
            this._logStyled('', [
                {text: `${label}: `, style: 'color:#d1d5db;font-weight:bold'},
                {text: String(value), style: this.colors.SOFT_GREEN}
            ]);
        }

        _logSummaryDouble(label, plus, minus) {
            if (!plus && !minus) return;

            const labelColor = label.toLowerCase().includes('female')
                ? this.colors.SOFT_PINK
                : this.colors.SOFT_BLUE;

            const plusStyle = plus ? this.colors.SOFT_GREEN : this.colors.GREY;
            const minusStyle = minus ? this.colors.SOFT_RED : this.colors.GREY;

            this._logStyled('', [
                {text: `${label} `, style: labelColor},
                {text: '(+', style: this.colors.GREY},
                {text: String(plus), style: plusStyle},
                {text: ' : -', style: this.colors.GREY},
                {text: String(minus), style: minusStyle},
                {text: ')', style: this.colors.GREY}
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
            const tempContainer = document.createElement("div");
            tempContainer.innerHTML = html;

            const currentOnlineUserEls = Array.from(
                this.helpers.qsa(this.shouldIncludeOtherUsers ? `.user_item` : `.user_item[data-gender="${this.FEMALE_CODE}"]`, tempContainer)
            );

            console.log(`\n==== Retrieved ${currentOnlineUserEls.length} users from the online list in this room. Starting to parse, process and render them.`);

            if (currentOnlineUserEls.length === 0) {
                console.warn(
                    "[processUserListResponse] No .user_item elements found in response HTML"
                );
            }

            this.helpers.verbose(
                "[processUserListResponse] Parsed online users from HTML:",
                currentOnlineUserEls.length
            );

            await this.syncUsersFromDom(currentOnlineUserEls);

            if (!this.shouldIncludeOtherUsers) {
                const otherUsersContent = this.helpers.qs(`.ca-user-list-content`, this.ui.otherUsersContainer);
                otherUsersContent.innerHTML = this.helpers.qs(".online_user", tempContainer).innerHTML;
                this.updateOtherUsersCount(otherUsersContent.children.length);
            }

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

            this.helpers.verbose('Handling logged in status for user: ', user);

            if (!user.isLoggedIn) {
                this.helpers.qs(`.user_item[data-id="${user.uid}"]`, {
                    root: this.ui.userContainersWrapper,
                    ignoreWarning: true
                })?.remove();
            }

            if (user.isFemale) {
                this.setLogDotsLoggedInStatusForUid(user.uid, user.isLoggedIn);
                this.logLine(user.isLoggedIn ? 'login' : 'logout', null, user);
            }
            this.helpers.verbose(`${user.isLoggedIn ? '[LOGIN]' : '[LOGOUT]'} ${user.name} (${user.uid}) logging ${user.isLoggedIn ? 'in' : 'out'}`);
        }

        setLogDotsLoggedInStatusForUid(uid, isLoggedIn) {
            const selector = `.ca-log-entry[data-uid="${uid}"] ${this.sel.log.classes.ca_log_dot}`;
            const logDots = this.helpers.qsa(selector);

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

        isChatLogUrl(u) {
            if (!u) return false;
            let s = String(u);
            s = new URL(s, location.origin).pathname;
            return s.indexOf('system/action/chat_log.php') !== -1;
        }

        caUpdateChatCtxFromBody(searchParams) {
            if (this.caUpdateChatCtxFromBody._initialized) {
                this.helpers.verbose(`CHAT_CTX already initialized`);
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

            this.helpers.verbose(`CHAT_CTX is initialized`, this.state.CHAT_CTX);
            this.caUpdateChatCtxFromBody._initialized = true;
        }

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

        toChatLogResponse(x) {
            const o = x && typeof x === 'object' ? x : {};
            const picoNum = Number.isFinite(o.pico) ? o.pico :
                (typeof o.pico === 'string' ? (Number(o.pico) || 0) : 0);
            const pload = Array.isArray(o.pload) ? o.pload.map(this.toPrivLogItem.bind(this)) : [];
            const plogs = Array.isArray(o.plogs) ? o.plogs.map(this.toPrivLogItem.bind(this)) : [];

            if (pload.length || plogs.length) {
                this.helpers.verbose(`pload:`, pload, `plogs:`, plogs);
            }
            return {
                last: typeof o.last === 'string' ? o.last : '',
                pico: picoNum,
                pload,
                plogs
            };
        }

        toPrivateSendResponse(x) {
            const o = x && typeof x === 'object' ? x : {};
            const codeNum = Number.isFinite(o.code) ? o.code :
                (typeof o.code === 'string' ? (Number(o.code) || 0) : 0);
            return {
                code: codeNum,
                log: o?.log
            };
        }

        toPrivateChatLogResponse(jsonResponse) {
            const o = jsonResponse && typeof jsonResponse === 'object' ? jsonResponse : {};
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
            if (/\b\d{1,2}\/\d{1,2}\s+\d{2}:\d{2}:\d{2}\b/.test(s)) return s;
            if (/\b\d{1,2}\/\d{1,2}\s+\d{2}:\d{2}\b/.test(s)) return s + ':00';
            return s;
        }

        isMessageNewer(logDateStr) {
            const watermark = this.SettingsStore.getGlobalWatermark();
            if (!watermark) {
                console.warn(`.isMessageNewer() - watermark not found`);
                return true;
            }

            const msgNum = this.parseLogDateToNumber(this.ToHourMinuteSecondFormat(logDateStr));
            const wmNum = this.parseLogDateToNumber(this.ToHourMinuteSecondFormat(watermark));
            this.helpers.verbose('Date comparison:', {
                logDate: logDateStr, logDateNum: msgNum,
                watermark, watermarkNum: wmNum
            });
            if (!msgNum) {
                throw new Error(`Invalid MsgNum: ${msgNum}`);
            }

            const isNewer = msgNum >= wmNum;
            this.helpers.verbose('Date comparison:', {
                logDate: logDateStr, logDateNum: msgNum,
                watermark, watermarkNum: wmNum, isNewer
            });
            return isNewer;
        }

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

        _withTimeout(startFetchFn, ms = this.userRefreshInterval) {
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), ms);
            return startFetchFn(ac.signal)
                .catch(err => ({ok: false, status: 0, body: String((err && err.message) || 'error')}))
                .finally(() => clearTimeout(t));
        }

        sendPrivateMessage(target, content) {
            const token = this.helpers.getToken();
            if (!token || !target || !content) return Promise.resolve({ok: false, status: 0, body: 'bad args'});

            this.helpers.debug('Sending private message to:', target, 'content length:', content.length);

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

                    return await this.processPrivateSendResponse(this.toPrivateSendResponse(jsonResponse), String(target));
                }));
            }, 10000);
        }

        findUserById(uid) {
            if (!uid) {
                console.error(`.findUserElementById: id is empty`);
                return null;
            }
            return this.helpers.qs(`.user_item[data-id="${uid}"]`, this.ui.userContainersWrapper);
        }

        updateProfileChip(uid, userEl) {
            const unreadReceivedMessagesCount = this.ActivityLogStore.getUnreadReceivedMessageCountByUserUid(uid);
            const sentMessagesCount = this.ActivityLogStore.getAllSentMessagesCountByUserId(uid);
            this.helpers.verbose('Updating profile chip for:', userEl, unreadReceivedMessagesCount, sentMessagesCount);

            if (unreadReceivedMessagesCount > 0) {
                this.helpers.verbose('Adding unread sent chip to user:', uid, ', unread received messages count: ', unreadReceivedMessagesCount, ', sent messages count: ', sentMessagesCount);
                const chip = this._createChipForUserItem(userEl);

                userEl.classList.remove(this.sel.raw.log.classes.ca_replied_messages);
                userEl.classList.add(this.sel.raw.log.classes.ca_unread_messages);
                chip.classList.add(this.sel.raw.log.classes.ca_sent_chip_unread);
                chip.classList.remove(this.sel.raw.log.classes.ca_sent_chip_all_read);
                chip.textContent = `${unreadReceivedMessagesCount}`;
                userEl.style.display = '';
            } else if (unreadReceivedMessagesCount === 0 && sentMessagesCount > 0) {
                this.helpers.verbose(
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
                chip.textContent = '✓';
                userEl.style.display = this.shouldHideRepliedUsers ? 'none' : '';
            } else {
                userEl.classList.remove(this.sel.raw.log.classes.ca_unread_messages);
                this.helpers.qs(this.sel.raw.log.classes.ca_sent_chip, {
                    root: userEl,
                    ignoreWarning: true
                })?.remove();
                this.helpers.verbose('Removing sent chip from user:', uid);
            }
        }

        updateProfileChipByUid(uid) {
            const userEl = this.findUserById(uid);

            if (!userEl) {
                this.helpers.debug?.('updateProfileChipByUid: user element not found for uid (probably offline):', uid);
                return;
            }

            this.updateProfileChip(uid, userEl);
        }


        _createChipForUserItem(userEl) {
            let chip = userEl.querySelector(this.sel.log.classes.ca_sent_chip);

            if (!userEl.classList.contains('chataddons-sent')) {
                userEl.classList.add('chataddons-sent');
                this.helpers.verbose('Adding sent chip to user:', userEl.getAttribute('data-id'));
            }

            if (!chip) {
                chip = document.createElement('span');
                chip.classList.add(this.sel.raw.log.classes.ca_sent_chip);
                userEl.appendChild(chip);
                this.helpers.verbose('Created sent chip for user:', userEl);
            }
            return chip;
        }

        async ensureBroadcastCheckbox(userItemDataEl, user) {
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
            const uncheckedSvg = this.helpers.renderSvgIconWithClass(
                'lucide lucide-square',
                `<rect x="4" y="4" width="16" height="16" rx="3" ry="3"></rect>`
            );
            uncheckedSvg.classList.add('ca-bc-icon-unchecked');

            // Checked SVG (square + check mark)
            const checkedSvg = this.helpers.renderSvgIconWithClass(
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

            toggle.appendChild(uncheckedSvg);
            toggle.appendChild(checkedSvg);
            applyVisualState(include);

            toggle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const currentlyIncluded = toggle.dataset.caIncluded === '1';
                const nextInclude = !currentlyIncluded;

                applyVisualState(nextInclude);
                this.UserStore.includeUserForBroadcast(user.uid, nextInclude);
                this.helpers.debug?.(`[BC] isIncludedForBroadcast → uid=${user.uid}, include=${include}`);
            });

            userItemDataEl.appendChild(toggle);
        }

        ensureDmLink(userItemDataEl, user) {
            const dmLink = document.createElement('a');
            dmLink.href = '#';
            dmLink.className = 'ca-dm-from-userlist ca-log-action';
            dmLink.title = 'Open direct message';
            dmLink.setAttribute('data-action', 'open-dm');

            dmLink.appendChild(this.helpers.renderSvgIconWithClass(
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

            userItemDataEl.appendChild(dmLink);
        }

        buildMenuLogPanel() {
            const mount = this.helpers.qs('#my_menu .bcell_mid');
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
            const rListEl = this.helpers.qs('#rlist_open');
            const logDualEl = this.helpers.qs('.ca-log-dual');
            logDualEl.appendChild(rListEl);

            this._attachLogClickHandlers();
        }


        buildPanel() {
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
            ${this.helpers.buildSvgIconString(
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
            ${this.helpers.buildSvgIconString(
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
            ${this.helpers.buildSvgIconString(
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
              ${this.helpers.buildSvgIconString(
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
            ${this.helpers.buildSvgIconString(
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
            <div class="ca-section ca-section-expand" data-section="unreplied">
              <div class="ca-section-title">
                <span>Unreplied Messages</span>
                <span class="clear-logs"
                      data-kinds="dm-in-unreplied"
                      role="button"
                      tabindex="0">Clear</span>
              </div>
              <div id="${this.sel.raw.log.unrepliedMessagesBox}"
                   class="ca-log-box ca-log-box-expand ${this.sel.raw.log.classes.ca_box_scrollable}"
                   aria-live="polite"></div>
            </div>
            <div class="ca-resizer" data-resizer="received-replied"></div>
            <div class="ca-section ca-section-expand" data-section="replied" id="${this.sel.raw.log.repliedMessageBox}">
              <div class="ca-section-title">
                <span>Replied Messages</span>
                <span class="clear-logs"
                      data-kinds="dm-in-replied"
                      role="button"
                      tabindex="0">Clear</span>
              </div>
              <div id="${this.sel.raw.log.repliedMessagesBox}"
                   class="ca-log-box ca-log-box-expand ${this.sel.raw.log.classes.ca_box_scrollable}"
                   aria-live="polite"></div>
            </div>
            </div>
         </div>
      </div>
    `;
            this.helpers.qs('#global_chat').appendChild(panelEl);
            this.ui.panel = panelEl;
            this.ui.panelNav = panelEl.querySelector('.ca-nav');
            this._wirePanelNav();
            this._setupResizableLogSections();
        }

        _setupResizableLogSections() {
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


        _updateStorageToggleUi(mode = 'allow') {
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
                svgEl = this.helpers.renderSvgIconWithClass("lucide lucide-database",
                    `<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"></path>
            <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"></path>
            <path d="M6 7l12 12"></path>
            <path d="M18 7L6 19"></path>`, false);

            } else if (mode === 'wipe') {
                title = 'Storage wipe on load (click to cycle: block / allow)';
                svgEl = this.helpers.renderSvgIconWithClass("lucide lucide-database-trash",
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
                svgEl = this.helpers.renderSvgIconWithClass("lucide lucide-database",
                    `<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"></path>
            <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"></path>`, false);
            }

            el.title = title;
            el.replaceChild(svgEl, el.firstChild);
        }

        handleStorageToggleClick() {
            const prevMode = this.SettingsStore.getWriteStorageMode() || 'allow';
            let nextMode;

            if (prevMode === 'allow') {
                nextMode = 'wipe';
            } else if (prevMode === 'wipe') {
                nextMode = 'block';
            } else {
                nextMode = 'allow';
            }

            this.SettingsStore.setWriteStorageMode(nextMode);

            this._updateStorageToggleUi(nextMode);
            this.logEventLine(`Storage mode set to ${nextMode} at ${this.timeHHMM()}`);
        }

        _wirePanelNav() {
            this.ui.panelNav.addEventListener('click', (e) => {
                const link = e.target.closest('.ca-dm-link[data-action]');
                if (!link) {
                    return;
                }

                const action = String(link.dataset.action || '').toLowerCase();
                e.preventDefault();

                switch (action) {
                    case 'broadcast':
                        this.helpers.verbose('Nav: broadcast clicked');
                        this.popups.openBroadcastModal();
                        break;

                    case 'send-message':
                        this.helpers.verbose('Nav: send-specific clicked');
                        this.popups.openSendMessageModal();
                        break;

                    case 'clear-all-logs':
                        this.helpers.verbose('Nav: clear-all-logs clicked');
                        this.handleLogClear();
                        break;

                    case 'storage-toggle':
                        this.helpers.verbose('Nav: storage-toggle clicked');
                        this.handleStorageToggleClick();
                        break;

                    case 'open-settings':
                        this.helpers.verbose('Nav: settings clicked');
                        this.popups.openSettingsPopup();
                        break;

                    case 'open-users':
                        this.helpers.verbose('Nav: users clicked');
                        this.popups.open();
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

        _createUserListContainer(options) {
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

        createOtherUsersContainer() {
            if (!this.ui || !this.ui.userContainersWrapper) {
                console.error('[CA] createOtherUsersContainer: userContainersWrapper is not set');
                return;
            }

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

        createFemaleUsersContainer() {
            if (!this.ui || !this.ui.userContainersWrapper) {
                console.error('[CA] createFemaleUsersContainer: userContainersWrapper is not set');
                return;
            }

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
                this.renderAndWireHideRepliedToggle(refs.subrow,);
            } else {
                console.warn('[CA] createFemaleUsersContainer: subrow is missing, cannot render toggles');
            }

            if (typeof this.helpers.verbose === 'function') {
                this.helpers.verbose('Created female users container');
            }
        }

        renderAndWireIncludeOtherUsersInParsing(elToAppendTo) {
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
                (e) => {

                    const target = e.target;

                    if (!(target instanceof HTMLInputElement)) {
                        console.warn(
                            "[CA] renderAndWireIncludeOtherUsersInParsing: event target is not an input",
                            e
                        );
                        return;
                    }

                    const checked = !!target.checked;
                    this.helpers.debug("[CA] Include other users:", checked);
                    this.shouldIncludeOtherUsers = checked;
                    this.SettingsStore.setShouldIncludeOthers(checked);
                    this.applyHideRepliedUsers(checked);
                    this.helpers.qs(`.ca-user-list-content`, this.ui.otherUsersContainer).innerHTML = "";
                    this.refreshUserList();
                }
            );


            elToAppendTo.appendChild(label);
        }

        renderAndWireHideRepliedToggle(elToAppendTo, targetContainer) {
            const label = document.createElement('label');
            label.style.marginLeft = '8px';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = 'ca-hide-replied-ck-toggle';
            checkbox.checked = !!this.shouldHideRepliedUsers;

            const textSpan = document.createElement('span');
            textSpan.textContent = 'Hide replied users';

            label.appendChild(checkbox);
            label.appendChild(textSpan);

            checkbox.addEventListener("change",
                /** @param {Event} e */
                (e) => {

                    const target = e.target;

                    if (!(target instanceof HTMLInputElement)) {
                        console.warn(
                            "[CA] renderAndWireHideRepliedToggle: event target is not an input",
                            e
                        );
                        return;
                    }

                    const checked = !!target.checked;

                    this.helpers.debug("[CA] Hide replied users:", checked);
                    this.shouldHideRepliedUsers = checked;
                    this.SettingsStore.setHideReplied(checked);
                    targetContainer.classList.toggle("ca-hide-replied-ck-toggle", checked);
                    this.applyHideRepliedUsers(checked);
                }
            );


            elToAppendTo.appendChild(label);
        }

        renderAndWireEnableBroadcastCheckbox(elToAppendTo, targetContainer) {
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
                this.SettingsStore.setShowBroadcastSelectionBoxes(checked);
                targetContainer.classList.toggle('ca-show-broadcast-ck', checked);
                this.helpers.debug(
                    '[CA] Female user checkbox visibility:',
                    checked ? 'shown' : 'hidden'
                );
            });

            elToAppendTo.appendChild(label);
        }

        applyHideRepliedUsers(hide) {
            const repliedEls = this.helpers.qsa(`${this.sel.log.classes.user_item}${this.sel.log.classes.ca_replied_messages}`, this.ui.femaleUsersContainer);
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
            const titleEl =
                this.helpers.qs('#menu_title, .menu_title, .title, .btitle, #page_title, .page_title') ||
                null;
            const txt = String((titleEl && titleEl.textContent) || document.title || '').trim().toLowerCase();
            return txt.includes('staff list');
        }

        _setHeadersVisible(visible) {
            const headers = this.helpers.qsa('.ca-user-list-header');
            headers.forEach(h => {
                h["style"].display = visible ? '' : 'none';
            });
        }

        toggleOriginalUserList(visible) {
            this.helpers.qs(`#chat_right_data`).style.display = visible ? 'block' : 'none';
            this.helpers.qs(this.sel.users.otherUsersContainer).style.display = !visible ? 'block' : 'none';
            this.helpers.qs(this.sel.users.femaleUsersContainer).style.display = !visible ? 'block' : 'none';
        }

        wireListOptionClicks() {
            const friendsBtn = this.helpers.qs('#friends_option');
            const usersBtn = this.helpers.qs('#users_option');
            const searchBtn = this.helpers.qs('#search_option');

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
            if (!this.ui || !this.ui.userContainersWrapper) {
                console.error('[CA] wireUserContainerHeaders: userContainersWrapper missing');
                return;
            }

            const containerGroups = this.ui.userContainersWrapper.children;

            if (!containerGroups || containerGroups.length === 0) {
                console.warn('[CA] wireUserContainerHeaders: no container groups found in userContainersWrapper');
                return;
            }

            for (const userListContainerGroup of containerGroups) {
                const headerEl = this.helpers.qs('.ca-user-list-header', userListContainerGroup);
                if (!headerEl) {
                    console.warn('[CA] wireUserContainerHeaders: header not found in group', userListContainerGroup);
                    continue;
                }

                headerEl.addEventListener('click', (event) => {
                    // 🔴 If the click is inside the checkbox subrow, do nothing here.
                    // Let the checkbox / label behave normally.
                    const inSubrow = event.target.closest('.ca-subrow');
                    if (inSubrow) {
                        return;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    const isExpanded = userListContainerGroup.classList.contains('ca-expanded');
                    const nextExpanded = !isExpanded;

                    console.debug('[CA] Header clicked, toggling group', {
                        group: userListContainerGroup,
                        wasExpanded: isExpanded,
                        willBeExpanded: nextExpanded
                    });

                    this._setExpanded(userListContainerGroup, nextExpanded);
                });
            }
        }

        updateFemaleUserCount(count) {
            this.helpers.verbose('Updating female user count:', count);
            const headerCounter = this.helpers.qs(this.sel.users.femaleUserCount);
            headerCounter.textContent = `${count}`;
        }

        updateOtherUsersCount(count) {
            const headerCounter = this.helpers.qs(this.sel.users.otherUserCount);
            headerCounter.textContent = `${count}`;
        }

        _bindStaticRefs() {
            this.ui.sentMessagesBox = this.helpers.qs(this.sel.log.sentMessagesBox);
            this.ui.messagesWrapper = this.helpers.qs(this.sel.log.messagesWrapper);
            this.ui.repliedMessageBox = this.helpers.qs(this.sel.log.repliedMessagesBox);
            this.ui.unrepliedMessageBox = this.helpers.qs(this.sel.log.unrepliedMessagesBox);
            this.ui.presenceBox = this.helpers.qs(this.sel.log.presence);
            this.ui.logClear = this.helpers.qs(this.sel.log.clear);
            this.ui.loggingBox = this.helpers.qs(this.sel.log.general);
        }

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
            const buttons = this.helpers.qsa('.ca-section-title .clear-logs', document);

            if (!buttons || buttons.length === 0) {
                console.warn('[LOG] No per-section clear buttons found (.clear-logs)');
                return;
            }

            buttons.forEach((btn) => {
                if (btn._caClearWired) return;
                btn._caClearWired = true;

                const handle = (e) => {
                    e.preventDefault();
                    e.stopPropagation();

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

        isVisuallyTruncated_(el) {
            if (!el) {
                console.error("isVisuallyTruncated_: missing element");
                return false;
            }

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

        ensureExpandButtonFor_(logEntryEl) {
            const logEntryTextEl = logEntryEl.querySelector(`${this.sel.log.classes.ca_log_text}`);

            const C = this.sel.raw.log.classes;
            const ind = logEntryEl.querySelector(`.${C.ca_expand_indicator}`);
            if (!ind) return;

            // Is expanded?
            const expanded = logEntryTextEl.classList.contains("ca-text-expanded");

            // Apply CSS clamp classes (not in click handler anymore)
            if (expanded) {
                logEntryTextEl.classList.add("ca-text-expanded");
                logEntryTextEl.classList.remove("ca-text-clamped");
            } else {
                logEntryTextEl.classList.remove("ca-text-expanded");
                logEntryTextEl.classList.add("ca-text-clamped");
            }

            // Is content actually truncated?
            const capped = this.isVisuallyTruncated_(logEntryTextEl);

            // Show button if either:
            // - text is truncated (so needs expand button)
            // - text is expanded (so we must show collapse icon)
            const shouldShow = expanded || capped;

            logEntryTextEl.setAttribute("data-action", shouldShow ? 'toggle-expand' : 'open-dm');

            ind.style.display = shouldShow ? "" : "none";

            // Set arrow direction
            ind.textContent = expanded ? "▴" : "▾";
            ind.setAttribute("aria-expanded", expanded ? "true" : "false");
        }

        renderLogEntry(activityLog, user) {
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

                case 'dm-in': {
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
                    targetContainer = this.ui.messagesWrapper;
            }

            if (!targetContainer) {
                console.error('renderLogEntry: No target container for kind', {kind, activityLog, user});
                return;
            }

            this.helpers.verbose(
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

            const dmIconHTML = (kind !== 'event' && !isSystemUser)
                ? `
            <a href="#"
               class="${this.sel.raw.log.classes.ca_dm_link} ${this.sel.raw.log.classes.ca_dm_right} ${this.sel.raw.log.classes.ca_log_action}"
               data-action="open-dm"
               title="Direct message">
               ${this.helpers.buildSvgIconString(
                    'lucide lucide-mail',
                    `
                                <rect x="3" y="5" width="18" height="14" rx="2" ry="2"></rect>
                                <polyline points="3 7,12 13,21 7"></polyline>
                            `)} </a> ` : '';

            const expandIconHTML = (kind !== event && !isSystemUser) ?
                `<span class="ca-expand-indicator" title="Click to expand/collapse" data-action="toggle-expand" role="button" tabindex="0" aria-expanded="true">▴</span>` : ``;

            const deleteIconHTML = `
                <a href="#"
                   class="${this.sel.raw.log.classes.ca_del_link} ${this.sel.raw.log.classes.ca_log_action}"
                   data-action="delete-log"
                   title="Delete this log entry">
                   ${this.helpers.buildSvgIconString(
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
                        <span class="${this.sel.raw.log.classes.ca_log_dot} ${this.sel.raw.log.classes.ca_log_dot_gray}">
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
                        ${deleteIconHTML}
                    </div>
                </div>
            `;

            const logEntryEl = this.helpers.createElementFromString(entryHTML);

            if (kind !== 'event') {
                this.setLogDotLoggedInStatusForElement(this.helpers.qs(`${this.sel.log.classes.ca_log_dot}`, logEntryEl), user.isLoggedIn);
            }

            if (!logEntryEl) {
                console.error('renderLogEntry: Failed to build log entry element', {activityLog, user});
                return;
            }

            targetContainer.appendChild(logEntryEl);
            this.ensureExpandButtonFor_(logEntryEl);
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

            for (const log of logs) {
                this.helpers.verbose('Restoring log', log);
                const user = await this.UserStore.getOrFetch(log.uid);
                this.renderLogEntry(log, user);
            }
        }

        logEventLine(content, user) {
            let finalUser = null;

            if (user && typeof user === 'object') {
                finalUser = user;
            } else if (typeof user === 'string' && user) {
                finalUser = this.UserStore?.get(user) || null;
            }

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

        _installAudioAutoplayGate() {
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

        _uninstallAudioAutoplayGate() {
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

        removeAds(root) {
            const scope = root && root.querySelectorAll ? root : document;
            this.helpers.qsa('.coo-widget').forEach(e => e.remove());
            const links = scope.querySelectorAll('a[href*="bit.ly"]');
            if (!links || !links.length) return;
            links.forEach(a => {
                if (a && !a.closest(this.sel.rightPanel) && a.parentNode) {
                    a.parentNode.removeChild(a);
                }
            });
        }


        initializeGlobalWatermark() {
            const current = this.SettingsStore.getGlobalWatermark();
            this.helpers.verbose('Checking watermark... current value:', current || '(not set)');

            if (current && current.length > 0) {
                this.helpers.verbose('Watermark already set:', current);
                return;
            }

            const timestamp = this.getTimeStampInWebsiteFormat();
            this.helpers.verbose('Setting initial watermark to:', timestamp);
            this.SettingsStore.setGlobalWatermark(timestamp);
        }

        async restoreLastDmFromStore() {
            const uid = this.SettingsStore.getLastDmUid();
            if (!uid) {
                this.helpers.debug('There was no uid for a last dm');
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
                this.helpers.debug(`Processing read status for log ${log.guid}`);
                const el = this.helpers.qs(`.ca-log-entry[data-guid="${log.guid}"]`, this.ui.unrepliedMessageBox);
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
    if (!text.includes("Verifieer dat u een mens bent")) {
        window.app = new App();
    } else {
        console.warn("Human verification page detected — not initializing.");
        return;
    }

    await app.init();
})();
