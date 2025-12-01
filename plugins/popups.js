class Popups {
    constructor({app, settingsStore, helpers, userStore}) {
        this.app = app;
        this.settingsStore = settingsStore;
        this.helpers = helpers;
        this.userStore = userStore;

        this.state = {
            page: 1,
            pageSize: 50,
            query: '',
            onlyFemales: false,
            onlyOnline: false,
            sortKey: 'name',
            sortDir: 'asc',
            visibleColumns: {}
        };

        this._zBase = 10000;
        this._zCounter = this._zBase;
        // Also keep a dedicated z-index base for bringToFront
        this._zIndexBase = this._zBase;

        this._columnPrefsKey = 'ca-column-prefs';
        this._columnPrefs = {
            logs: true,
            presence: true,
            users: true
        };

        this._escWired = false;

        this._loadColumnPrefs();
        this._wireGlobalEsc();   // 👈 add this
    }

    /**
     * Wire a global Escape key handler to close the top-most open CA popup.
     */
    _wireGlobalEsc() {
        if (this._escWired) {
            return;
        }
        this._escWired = true;

        document.addEventListener('keydown', (event) => {
            const key = event.key || event.code;

            if (key !== 'Escape' && key !== 'Esc') {
                return;
            }

            const openPopups = Array.from(
                document.querySelectorAll('.ca-popup.ca-popup-open')
            );

            if (!openPopups.length) {
                return;
            }

            // Prefer the one that is marked active; fallback to "last" one
            let target =
                document.querySelector('.ca-popup.ca-popup-open.ca-popup-active') ||
                openPopups[openPopups.length - 1];

            if (!(target instanceof HTMLElement)) {
                console.error('[CA] _wireGlobalEsc: target popup is not an HTMLElement');
                return;
            }

            const closeBtn = target.querySelector('.ca-popup-close');
            if (!closeBtn) {
                console.warn('[CA] _wireGlobalEsc: could not find .ca-popup-close button on popup');
                return;
            }

            // Trigger through DOM so any attached handlers fire
            closeBtn.dispatchEvent(
                new MouseEvent('click', {bubbles: true})
            );
        });
    }

    openUserManagementPopup() {
        const popup = this.createUserManagementPopup();

        if (!popup) {
            console.error('[UsersPopup] open: popup not created');
            return;
        }

        this.renderUserManagementPopup(popup);
        this.togglePopup('ca-uer-management-popup');
        this.helpers.installLogImageHoverPreview([popup]);
    }

    createUserManagementPopup() {
        const bodyHtml = `
<div class="ca-uer-management-popup-root" id="ca-users-table-root">
  <div class="ca-users-toolbar">
    <div class="ca-users-toolbar-row">
      <div class="ca-users-summary" id="ca-users-summary"></div>
      <div class="ca-users-filters">
        <label class="ca-users-filter-item">
          <input type="checkbox" id="ca-users-only-females">
          Only females
        </label>
        <!-- NEW: only online filter -->
        <label class="ca-users-filter-item">
          <input type="checkbox" id="ca-users-only-online">
          Only online
        </label>
        <input
          type="text"
          id="ca-users-search"
          class="ca-users-search"
          placeholder="Search users…"
        >
      </div>
    </div>
    <div class="ca-users-columns-row">
      <strong>Columns:</strong>
      <div id="ca-users-column-selector" class="ca-users-column-selector"></div>
    </div>
  </div>

  <div class="ca-users-table-wrapper">
    <table id="ca-users-table" class="ca-users-table">
      <thead></thead>
      <tbody></tbody>
    </table>
  </div>

  <div id="ca-users-pagination" class="ca-users-pagination"></div>
</div>
`;

        const popup = this.ensurePopup({
            id: 'ca-uer-management-popup',
            title: 'All users',
            bodyHtml
        });

        if (!(popup instanceof HTMLElement)) {
            console.error('[UsersPopup] _ensurePopup: ensurePopup did not return an HTMLElement');
            return null;
        }

        if (!popup.dataset.caUsersPopupWired) {
            popup.dataset.caUsersPopupWired = '1';
            this._wirePopup(popup);
        }

        return popup;
    }

    _wirePopup(popup) {
        const searchInput = popup.querySelector('#ca-users-search');
        const onlyFemalesCheckbox = popup.querySelector('#ca-users-only-females');
        const onlyOnlineCheckbox = popup.querySelector('#ca-users-only-online'); // NEW
        const pagination = popup.querySelector('#ca-users-pagination');
        const table = popup.querySelector('#ca-users-table');

        if (!table) {
            console.error('[UsersPopup] _wirePopup: table not found');
            return;
        }

        if (onlyFemalesCheckbox) {
            onlyFemalesCheckbox.addEventListener('change', () => {
                this.state.onlyFemales = !!onlyFemalesCheckbox.checked;
                this.state.page = 1;
                this.renderUserManagementPopup(popup);
                this.helpers.installLogImageHoverPreview([popup]);
            });
        }

        // NEW: “only online” wiring
        if (onlyOnlineCheckbox) {
            onlyOnlineCheckbox.addEventListener('change', () => {
                this.state.onlyOnline = !!onlyOnlineCheckbox.checked;
                this.state.page = 1;
                this.renderUserManagementPopup(popup);
                this.helpers.installLogImageHoverPreview([popup]);
            });
        }

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.state.query = String(searchInput.value || '').trim().toLowerCase();
                this.state.page = 1;
                this.renderUserManagementPopup(popup);
                this.helpers.installLogImageHoverPreview([popup]);
            });
        } else {
            console.warn('[UsersPopup] _wirePopup: search input not found');
        }

        if (onlyFemalesCheckbox) {
            onlyFemalesCheckbox.addEventListener('change', () => {
                this.state.onlyFemales = !!onlyFemalesCheckbox.checked;
                this.state.page = 1;
                this.renderUserManagementPopup(popup);
                this.helpers.installLogImageHoverPreview([popup]);
            });
        }

        if (pagination) {
            pagination.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-page]');
                if (!btn) {
                    return;
                }

                e.preventDefault();
                const pageStr = btn.getAttribute('data-page');
                const pageNum = Number(pageStr);

                if (!Number.isFinite(pageNum) || pageNum < 1) {
                    console.warn('[UsersPopup] Invalid page clicked:', pageStr);
                    return;
                }

                this.state.page = pageNum;
                this.renderUserManagementPopup(popup);
                this.helpers.installLogImageHoverPreview([popup]);
            });
        }

        // Sorting + inline editing + actions
        table.addEventListener('click', async (e) => {
            const thSortable = e.target.closest('th[data-sort-key]');
            if (thSortable) {
                e.preventDefault();
                const sortKey = String(thSortable.getAttribute('data-sort-key') || '').trim();
                this._toggleSort(sortKey);
                this.renderUserManagementPopup(popup);
                this.helpers.installLogImageHoverPreview([popup]);
                return;
            }

            const actionEl = e.target.closest('[data-action]');
            if (actionEl) {
                e.preventDefault();
                const action = String(actionEl.getAttribute('data-action') || '').toLowerCase();
                const uid = String(actionEl.getAttribute('data-uid') || '').trim();

                if (!uid) {
                    console.warn('[UsersPopup] data-action element without data-uid', actionEl);
                    return;
                }

                if (action === 'open-profile') {
                    await this.app.openProfileOnHost(uid);
                    return;
                }

                if (action === 'open-dm') {
                    const user = await this.userStore.getOrFetch(uid);
                    if (!user || !user.uid) {
                        console.error('[UsersPopup] open-dm: could not fetch user for uid', uid);
                        return;
                    }
                    this.app.applyLegacyAndOpenDm(user);
                    return;
                }

                if (action === 'user-delete') {
                    this._handleDeleteUser(uid, popup);
                    return;
                }

                if (action === 'user-edit-json') {
                    this._handleEditUserJson(uid, popup);
                    return;
                }

                return;
            }

            // Inline edit on table cells
            const td = e.target.closest('td[data-col-key]');
            if (!td) {
                return;
            }

            const colKey = td.getAttribute('data-col-key');

            if (!colKey) {
                return;
            }

            // Do not inline-edit special cells
            if (colKey === 'avatar' || colKey === '__actions__' || colKey === '__dm__') {
                return;
            }

            const tr = td.parentElement;
            if (!tr) {
                return;
            }

            const uid = tr.getAttribute('data-uid');
            if (!uid) {
                return;
            }

            this._startInlineUserCellEdit(td, uid, colKey, popup);
        });
    }


    // ---------- z-index & focus ----------

    bringToFront(popupEl) {
        if (!(popupEl instanceof HTMLElement)) {
            console.warn('[Popups] bringToFront called without HTMLElement');
            return;
        }

        this._zIndexBase += 1;
        popupEl.style.zIndex = String(this._zIndexBase);

        // optional: visual focus indicator
        document.querySelectorAll('.ca-popup.ca-popup-active').forEach(el => {
            el.classList.remove('ca-popup-active');
        });
        popupEl.classList.add('ca-popup-active');
    }

    _wireFocus(popup) {
        if (!popup || popup.dataset.caFocusWired === '1') {
            return;
        }
        popup.dataset.caFocusWired = '1';

        popup.addEventListener('mousedown', () => {
            this.bringToFront(popup);
        });
    }

    // ---------- base popup skeleton ----------

    /**
     * Create a draggable CA popup with header + body.
     * Returns the popup HTMLElement (or null on error).
     */
    ensurePopup({id, title, bodyHtml}) {
        if (!id) {
            console.error('[Popups] ensurePopup called without id');
            return null;
        }

        // Remove existing popup with same id (fresh instance)
        const existing = document.getElementById(id);
        if (existing) {
            existing.remove();
        }

        const popup = document.createElement('div');
        popup.id = id;
        popup.className = 'ca-popup';

        popup.innerHTML = `
      <div class="ca-popup-header">
        <span class="ca-popup-title"></span>
        <button class="ca-popup-close" type="button">✕</button>
      </div>
      <div class="ca-popup-body"></div>
    `;

        // close button
        const closeBtn = popup.querySelector('.ca-popup-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                popup.remove();
            });
        }

        // dragging
        const hdr = popup.querySelector('.ca-popup-header');
        if (hdr) {
            let startX = 0, startY = 0, origX = 0, origY = 0;

            const onMove = (e) => {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                popup.style.left = (origX + dx) + 'px';
                popup.style.top = (origY + dy) + 'px';
                popup.style.transform = 'none';
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            hdr.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.bringToFront(popup);

                const rect = popup.getBoundingClientRect();
                origX = rect.left;
                origY = rect.top;
                startX = e.clientX;
                startY = e.clientY;

                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }

        document.body.appendChild(popup);

        // title
        const titleEl = popup.querySelector('.ca-popup-title');
        if (titleEl && typeof title === 'string') {
            titleEl.textContent = title;
        }

        // body
        const bodyEl = popup.querySelector('.ca-popup-body');
        if (bodyEl) {
            if (typeof bodyHtml === 'string') {
                bodyEl.innerHTML = bodyHtml;
            } else if (bodyHtml instanceof HTMLElement) {
                bodyEl.innerHTML = '';
                bodyEl.appendChild(bodyHtml);
            }
        }

        // initial focus/z-index
        this._wireFocus(popup);
        this.bringToFront(popup);

        return popup;
    }

    /**
     * Just ensures the popup is “shown”.
     * (You can keep any class-based styling you had.)
     */
    togglePopup(id) {
        const popup = document.getElementById(id);
        if (!popup) {
            console.error('[Popups] togglePopup: popup not found:', id);
            return;
        }

        popup.classList.add('ca-popup-open');
        this.bringToFront(popup);
    }

    openBroadcastModal() {
        const broadcastPopupEl = this.createBroadcastPopup();
        const broadcastSendEl = broadcastPopupEl.querySelector('#ca-bc-send');

        broadcastSendEl.addEventListener('click', () => {
            const broadcastMsgEl = this.helpers.qs('#ca-bc-msg');
            const raw = (broadcastMsgEl && 'value' in broadcastMsgEl) ? broadcastMsgEl.value : '';
            const text = this.helpers.trim(raw);

            if (!text) {
                console.warn('[BROADCAST] Empty message, nothing to send');
                return;
            }

            const broadcastReceiveList = this.app.buildBroadcastList();

            if (!broadcastReceiveList.length) {
                this.app.logEventLine('[BROADCAST] No new recipients for this message (after exclusions/rank filter).');
                return;
            }

            broadcastSendEl.disabled = true;
            this.app._runBroadcast(broadcastReceiveList, text)
                .then(({ok, fail}) => {
                    this.app.logEventLine(`[BROADCAST] Done. Success: ${ok}, Failed: ${fail}.`);
                })
                .finally(() => {
                    broadcastSendEl.disabled = false;
                });
        });

        this.togglePopup('ca-broadcast-popup');
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

    printModalStatus(message) {
        const statusEl = this.helpers.qs('#ca-specific-status');
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
        this.helpers.qs('#ca-specific-status', pop).textContent = '';
        this.helpers.qs('#ca-specific-send', pop).addEventListener('click', async () => {
            const sendPrivateMessageUser = this.helpers.qs('#ca-specific-username').value;
            const sendPrivateMessageText = this.helpers.qs('#ca-specific-message').value;
            console.log(`[CA] Sending private message to ${sendPrivateMessageUser}:`, sendPrivateMessageText);
            const user = await this.userStore.getOrFetchByName(sendPrivateMessageUser);

            if (!user) {
                return this.printModalErrorStatus(`User ${sendPrivateMessageUser} not found`);
            }

            if (!user?.uid) {
                console.warn(`Invalid user: `, user);
                return this.printModalErrorStatus(`Returned user doesn't have a uid.`);
            }

            if (await this.app.sendWithThrottle(user.uid, sendPrivateMessageText)) {
                this.app.logEventLine(`Sent to ${user.name || user.uid}.`)
                return this.printModalSuccessStatus(`Private message to ${sendPrivateMessageUser} has been successfully sent`);
            } else {
                return this.printModalErrorStatus(`Error sending private message to ${sendPrivateMessageUser}`);
            }
        });

        this.togglePopup('ca-specific-popup');
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

        debugSettingsCheckbox.checked = !!this.settingsStore.getDebugMode();
        verboseSettingsCheckbox.checked = !!this.settingsStore.getVerboseMode();

        const applyDebugChange = (enabled) => {
            const safeEnabled = !!enabled;
            this.app.setAndPersistDebugMode(safeEnabled);

            if (debugSettingsCheckbox.checked !== safeEnabled) {
                debugSettingsCheckbox.checked = safeEnabled;
            }
        };

        const applyVerboseChange = (enabled) => {
            const safeEnabled = !!enabled;
            this.app.setAndPersistVerboseMode(safeEnabled);

            if (verboseSettingsCheckbox.checked !== safeEnabled) {
                verboseSettingsCheckbox.checked = safeEnabled;
            }
        };

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

    createAndOpenPopupWithHtml(html, id, title) {
        if (!id) {
            console.error('[Popups] createAndOpenPopupWithHtml called without id');
            return null;
        }

        // Reuse existing popup if present, otherwise create a new one
        let popup = document.getElementById(id);

        if (!popup) {
            popup = this.ensurePopup({
                id,
                title,
                bodyHtml: html
            });
        } else {
            // Update title if needed
            const titleEl = popup.querySelector('.ca-popup-title');
            if (titleEl && typeof title === 'string') {
                titleEl.textContent = title;
            }

            // Update body
            const bodyEl = popup.querySelector('.ca-popup-body');
            if (bodyEl) {
                if (typeof html === 'string') {
                    bodyEl.innerHTML = html;
                } else if (html instanceof HTMLElement) {
                    bodyEl.innerHTML = '';
                    bodyEl.appendChild(html);
                }
            }
        }

        if (!(popup instanceof HTMLElement)) {
            console.error('[Popups] createAndOpenPopupWithHtml: ensurePopup did not return an HTMLElement for id', id);
            return null;
        }

        // Override the default close behaviour (which called popup.remove())
        const closeBtn = popup.querySelector('.ca-popup-close');
        if (closeBtn && !closeBtn.dataset.caCustomClose) {
            const newCloseBtn = closeBtn.cloneNode(true);
            newCloseBtn.dataset.caCustomClose = '1';
            newCloseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                popup.classList.remove('ca-popup-open');
                popup.style.display = 'none';
            });

            closeBtn.replaceWith(newCloseBtn);
        }

        popup.style.display = 'flex';
        popup.classList.add('ca-popup-open');
        this.bringToFront(popup);

        // Image hover preview inside any popup
        this.helpers.installLogImageHoverPreview([popup]);

        return popup;
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

    openCloudflarePopup() {
        const bodyHtml = `
      <p style="margin-bottom:8px;">
        Cloudflare is blocking the chat requests (HTTP 403).<br>
        Please refresh the page to continue.
      </p>
      <div id="ca-cloudflare-url" class="ca-status" style="margin-bottom:8px;"></div>
      <button id="ca-cloudflare-refresh" class="ca-btn ca-btn-slim" type="button">
        Refresh page
      </button>
    `;

        const popup = this.ensurePopup({
            id: 'ca-cloudflare-popup',
            title: 'Connection issue',
            bodyHtml
        });

        if (!popup) {
            console.error('[Popups] openCloudflarePopup: ensurePopup failed');
            return;
        }

        const refreshBtn = popup.querySelector('#ca-cloudflare-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                window.location.reload();
            });
        }

        this.togglePopup('ca-cloudflare-popup');
    }

    /**
     * This is your existing “predefined messages” popup, moved out of App.
     */
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

    /**
     * This is basically your old App.openPredefinedPopup, but here.
     */
    openPredefinedPopup(wrapper, prefilledText = null) {
        const popup = this.createPredefinedMessagesPopup();

        if (!(popup instanceof HTMLElement)) {
            console.error('[Popups] openPredefinedPopup: popup is not an HTMLElement');
            return null;
        }

        const form = this.helpers.qsForm('#ca-predefined-messages-form', popup);
        const subjectInput = this.helpers.qsInput('#ca-predefined-messages-subject', popup);
        const textInput = this.helpers.qsTextarea('#ca-predefined-messages-text', popup);
        const indexInput = this.helpers.qsInput('#ca-predefined-messages-index', popup);
        const resetBtn = this.helpers.qs('#ca-predefined-messages-reset', popup);
        const editorRoot = this.helpers.qs('.ca-predefined-messages-editor', popup);
        const toggleBtn = this.helpers.qs('#ca-predefined-messages-toggle', popup);

        if (!form || !subjectInput || !textInput || !indexInput || !resetBtn) {
            console.error('[Popups] openPredefinedPopup: missing form controls');
            return null;
        }

        if (prefilledText) {
            indexInput.value = '-1';
            subjectInput.value = subjectInput.value || '';
            textInput.value = prefilledText;
        }

        if (toggleBtn && editorRoot && !editorRoot.dataset.caToggleInitialized) {
            editorRoot.dataset.caToggleInitialized = '1';
            editorRoot.classList.add('ca-predefined-editor-collapsed');
            toggleBtn.textContent = 'Show editor';

            toggleBtn.addEventListener('click', () => {
                const collapsed = editorRoot.classList.toggle('ca-predefined-editor-collapsed');
                toggleBtn.textContent = collapsed ? 'Show editor' : 'Hide editor';
            });
        }

        this.app._renderPredefinedList(popup);

        resetBtn.addEventListener('click', () => {
            this.app.predefinedEditIndex = null;
            indexInput.value = '-1';
            subjectInput.value = '';
            textInput.value = '';
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();

            const subject = subjectInput.value.trim();
            const text = textInput.value.trim();

            if (!subject && !text) {
                console.warn('[Popups] Cannot save empty predefined message');
                return;
            }

            const list = this.settingsStore.getPredefinedMessages().slice();
            const idx = Number(indexInput.value);

            if (!Number.isNaN(idx) && idx >= 0 && idx < list.length) {
                list[idx] = {subject, text};
            } else {
                list.push({subject, text});
            }

            this.settingsStore.savePredefinedMessages(list);
            this.app._renderPredefinedList(popup);
            this.app._refreshAllPredefinedSelects();

            this.app.predefinedEditIndex = null;
            indexInput.value = '-1';
            subjectInput.value = '';
            textInput.value = '';
        });

        this.togglePopup('ca-predefined-messages-popup');
        return popup;
    }

    renderUserManagementPopup(popup) {
        if (!popup) {
            console.error('[UsersPopup] _render called without popup');
            return;
        }

        const usersAll = this.userStore.list();
        const filtered = this._filterUsers(usersAll);
        const sorted = this._sortUsers(filtered);
        const columns = this._computeColumns(usersAll);

        const total = sorted.length;
        const totalPages = Math.max(1, Math.ceil(total / this.state.pageSize));

        if (this.state.page > totalPages) {
            this.state.page = totalPages;
        }

        const startIndex = (this.state.page - 1) * this.state.pageSize;
        const pageUsers = sorted.slice(startIndex, startIndex + this.state.pageSize);

        this._renderSummary(popup, usersAll, filtered);
        this._renderColumnSelector(popup, columns);
        this._renderTable(popup, pageUsers, columns);
        this._renderPagination(popup, totalPages);

        const searchInput = popup.querySelector('#ca-users-search');
        if (searchInput && searchInput.value.toLowerCase() !== this.state.query) {
            searchInput.value = this.state.query;
        }

        const onlyFemalesCheckbox = popup.querySelector('#ca-users-only-females');
        if (onlyFemalesCheckbox) {
            onlyFemalesCheckbox.checked = !!this.state.onlyFemales;
        }

        // NEW: keep “only online” checkbox in sync
        const onlyOnlineCheckbox = popup.querySelector('#ca-users-only-online');
        if (onlyOnlineCheckbox) {
            onlyOnlineCheckbox.checked = !!this.state.onlyOnline;
        }
    }

    _renderSummary(popup, allUsers, filteredUsers) {
        const el = popup.querySelector('#ca-users-summary');
        if (!el) {
            console.error('[UsersPopup] _renderSummary: #ca-users-summary not found');
            return;
        }

        const total = Array.isArray(allUsers) ? allUsers.length : 0;
        const totalFiltered = Array.isArray(filteredUsers) ? filteredUsers.length : 0;
        const totalFemales = Array.isArray(allUsers)
            ? allUsers.filter(u => u.isFemale).length
            : 0;
        const totalFemalesOnline = this.userStore.getAllLoggedInFemales().length;

        const hasFilter =
            !!this.state.query ||
            !!this.state.onlyFemales ||
            !!this.state.onlyOnline;

        // Case 1: no users at all
        if (total === 0) {
            el.textContent = 'No users found';
            return;
        }

        // Case 2: no filter active, or filters don’t change the list
        if (!hasFilter || totalFiltered === total) {
            el.textContent =
                `Users: ${total} total — ` +
                `Females: ${totalFemales} (online: ${totalFemalesOnline})`;
            return;
        }

        // Case 3: filters active but nothing matches
        if (totalFiltered === 0) {
            el.textContent =
                `No users match current filters (0/${total}) — ` +
                `Females: ${totalFemales} (online: ${totalFemalesOnline})`;
            return;
        }

        // Case 4: filters active and some subset visible
        el.textContent =
            `Users: ${totalFiltered} of ${total} visible — ` +
            `Females: ${totalFemales} (online: ${totalFemalesOnline})`;
    }

    _renderColumnSelector(popup, columns) {
        const root = popup.querySelector('#ca-users-column-selector');
        if (!root) {
            console.error('[UsersPopup] _renderColumnSelector: selector root not found');
            return;
        }

        root.innerHTML = '';

        columns.forEach(col => {
            if (col.key === '__actions__' || col.key === '__dm__') {
                return;
            }

            if (col.key === 'isLoggedIn') {
                // handled as dot in front of name, no explicit column
                return;
            }

            const visible = this._isColumnVisible(col.key);

            const label = document.createElement('label');
            label.className = 'ca-users-column-checkbox';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = visible;
            cb.dataset.colKey = col.key;

            cb.addEventListener('change', () => {
                const colKey = cb.dataset.colKey;
                if (!colKey) {
                    return;
                }

                const nextVisible = {...this.state.visibleColumns};
                nextVisible[colKey] = !!cb.checked;
                this.state.visibleColumns = nextVisible;
                this.helpers.debug(`Persisting visible columns:`, JSON.stringify(this.state.visibleColumns));
                this.settingsStore.setUserManagerVisibleColumnPrefs(this.state.visibleColumns);
                this.renderUserManagementPopup(popup);
                this.helpers.installLogImageHoverPreview([popup]);
            });

            const span = document.createElement('span');
            span.textContent = col.label;

            label.appendChild(cb);
            label.appendChild(span);
            root.appendChild(label);
        });
    }

    _renderTable(popup, users, columns) {
        const table = popup.querySelector('#ca-users-table');
        if (!table) {
            console.error('[UsersPopup] _renderTable: table not found');
            return;
        }

        const thead = table.querySelector('thead');
        const tbody = table.querySelector('tbody');

        if (!thead || !tbody) {
            console.error('[UsersPopup] _renderTable: thead or tbody missing');
            return;
        }

        thead.innerHTML = '';
        tbody.innerHTML = '';

        // header
        const headRow = document.createElement('tr');

        columns.forEach(col => {
            if (!this._isColumnVisible(col.key)) {
                return;
            }

            const th = document.createElement('th');
            th.textContent = col.label;

            if (col.sortable) {
                th.dataset.sortKey = col.key;
                th.classList.add('ca-users-sortable');

                if (this.state.sortKey === col.key) {
                    th.classList.add('ca-users-sorted');
                    th.dataset.sortDir = this.state.sortDir;
                }
            }

            headRow.appendChild(th);
        });

        thead.appendChild(headRow);

        // body
        users.forEach(user => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-uid', String(user.uid || ''));

            columns.forEach(col => {
                if (!this._isColumnVisible(col.key)) {
                    return;
                }

                const td = document.createElement('td');
                td.dataset.colKey = col.key;

                if (col.key === 'avatar') {
                    const src = user.avatar || '';

                    if (src) {
                        const img = document.createElement('img');
                        img.className = 'avav chat_image';
                        img.src = src;
                        img.dataset.previewSrc = src;
                        img.alt = user.name ? `Avatar of ${user.name}` : 'Avatar';
                        td.appendChild(img);
                    } else {
                        td.textContent = '—';
                    }
                } else if (col.key === 'uid') {
                    const uid = String(user.uid || '');
                    if (uid) {
                        const link = document.createElement('a');
                        link.href = '#';
                        link.textContent = uid;
                        link.setAttribute('data-action', 'open-profile');
                        link.setAttribute('data-uid', uid);
                        td.appendChild(link);
                    } else {
                        td.textContent = '—';
                    }
                } else if (col.key === 'name') {
                    const nameWrapper = document.createElement('div');
                    nameWrapper.className = 'ca-users-name-cell';

                    const dot = document.createElement('span');
                    dot.className = 'ca-log-dot';
                    if (user.isLoggedIn === true) {
                        dot.classList.add('ca-log-dot-green');
                    } else {
                        dot.classList.add('ca-log-dot-red');
                    }
                    dot.textContent = '●';
                    nameWrapper.appendChild(dot);

                    const html = this.app.userLinkHTML(user);

                    const tmp = document.createElement('span');
                    tmp.innerHTML = html;
                    const link = tmp.querySelector('a') || tmp.firstElementChild || document.createElement('span');
                    link.setAttribute('data-action', 'open-profile');
                    link.setAttribute('data-uid', String(user.uid || ''));
                    nameWrapper.appendChild(link);

                    td.appendChild(nameWrapper);
                } else if (col.key === '__dm__') {
                    this.app.ensureDmLink(td, user);
                } else if (col.key === '__actions__') {
                    const actions = document.createElement('div');
                    actions.className = 'ca-users-actions';

                    const editLink = document.createElement('a');
                    editLink.href = '#';
                    editLink.title = 'Edit user JSON';
                    editLink.className = 'ca-log-action ca-edit-link';
                    editLink.setAttribute('data-action', 'user-edit-json');
                    editLink.setAttribute('data-uid', String(user.uid || ''));

                    editLink.appendChild(
                        this.helpers.renderSvgIconWithClass(
                            'lucide lucide-pencil',
                            '<path d="M17 3a2.828 2.828 0 0 1 4 4L7 21l-4 1 1-4L17 3z"></path>'
                        )
                    );

                    const deleteLink = document.createElement('a');
                    deleteLink.href = '#';
                    deleteLink.title = 'Delete user';
                    deleteLink.className = 'ca-log-action ca-del-link';
                    deleteLink.setAttribute('data-action', 'user-delete');
                    deleteLink.setAttribute('data-uid', String(user.uid || ''));

                    deleteLink.appendChild(
                        this.helpers.renderSvgIconWithClass(
                            'lucide lucide-x',
                            '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>'
                        )
                    );

                    actions.appendChild(editLink);
                    actions.appendChild(deleteLink);
                    td.appendChild(actions);
                } else {
                    const value = user[col.key];
                    td.textContent = this._formatCellValue(value);
                }

                tbody.appendChild(tr);
                tr.appendChild(td);
            });
        });
    }

    _renderPagination(popup, totalPages) {
        const root = popup.querySelector('#ca-users-pagination');
        if (!root) {
            return;
        }

        root.innerHTML = '';

        if (totalPages <= 1) {
            return;
        }

        const ul = document.createElement('ul');
        ul.className = 'ca-users-pagination-list';

        for (let p = 1; p <= totalPages; p++) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = '#';
            a.textContent = String(p);
            a.setAttribute('data-page', String(p));

            if (p === this.state.page) {
                a.classList.add('ca-users-page-current');
            }

            li.appendChild(a);
            ul.appendChild(li);
        }

        root.appendChild(ul);
    }

    // ---------- filtering + sorting ----------

    _filterUsers(users) {
        const query = this.state.query;
        const onlyFemales = !!this.state.onlyFemales;
        const onlyOnline = !!this.state.onlyOnline; // NEW

        return users.filter(u => {
            if (onlyFemales && !u.isFemale) {
                return false;
            }

            // NEW: require isLoggedIn when filter active
            if (onlyOnline && !u.isLoggedIn) {
                return false;
            }

            if (!query) {
                return true;
            }

            const haystackParts = [];

            Object.keys(u).forEach(k => {
                const v = u[k];
                if (v == null) {
                    return;
                }
                haystackParts.push(String(v));
            });

            const haystack = haystackParts.join(' ').toLowerCase();
            return haystack.indexOf(query) !== -1;
        });
    }


    _toggleSort(sortKey) {
        if (!sortKey) {
            return;
        }

        if (this.state.sortKey === sortKey) {
            this.state.sortDir = this.state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this.state.sortKey = sortKey;
            this.state.sortDir = 'asc';
        }
    }

    _sortUsers(users) {
        const key = this.state.sortKey;
        const dir = this.state.sortDir === 'desc' ? -1 : 1;

        if (!key) {
            return users.slice();
        }

        const sortableKeys = new Set(['name', 'age', 'country']);

        if (!sortableKeys.has(key)) {
            return users.slice();
        }

        const out = users.slice();

        out.sort((a, b) => {
            const av = a[key];
            const bv = b[key];

            if (key === 'age') {
                const an = Number(av) || 0;
                const bn = Number(bv) || 0;
                return (an - bn) * dir;
            }

            const as = String(av || '').toLowerCase();
            const bs = String(bv || '').toLowerCase();
            if (as < bs) return -1 * dir;
            if (as > bs) return 1 * dir;
            return 0;
        });

        return out;
    }

    _computeColumns(users) {
        const base = new Set(['avatar', 'uid', 'name', 'age', 'country']);

        const extra = new Set();
        users.forEach(u => {
            Object.keys(u || {}).forEach(k => {
                if (!base.has(k)) {
                    extra.add(k);
                }
            });
        });

        const columns = [];

        // Avatar
        columns.push({
            key: 'avatar',
            label: 'Avatar',
            sortable: false
        });

        // ID
        columns.push({
            key: 'uid',
            label: 'ID',
            sortable: false
        });

        // Name (logged-in dot handled in rendering)
        columns.push({
            key: 'name',
            label: 'Name',
            sortable: true
        });

        // Age
        columns.push({
            key: 'age',
            label: 'Age',
            sortable: true
        });

        // Country
        columns.push({
            key: 'country',
            label: 'Country',
            sortable: true
        });

        // Extra keys (sorted alphabetically)
        Array.from(extra)
            .sort()
            .forEach(k => {
                if (k === 'isLoggedIn') {
                    return;
                }
                columns.push({
                    key: k,
                    label: k,
                    sortable: false
                });
            });

        // DM + actions
        columns.push({
            key: '__dm__',
            label: 'DM',
            sortable: false
        });
        columns.push({
            key: '__actions__',
            label: 'Actions',
            sortable: false
        });

        return columns;
    }

    // ---------- inline edit ----------

    _startInlineUserCellEdit(td, uid, colKey, popup) {
        const originalText = td.textContent || '';
        td.innerHTML = '';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalText;
        input.className = 'ca-users-inline-input';

        td.appendChild(input);
        input.focus();
        input.select();

        const commit = async () => {
            const newValue = input.value;
            const user = this.userStore.get(uid);

            if (!user) {
                console.error('[UsersPopup] inline edit: user not found for uid', uid);
                return;
            }

            const updated = {...user};

            if (colKey === 'age') {
                const ageNum = Number(newValue);
                if (!Number.isFinite(ageNum) || ageNum < 0) {
                    console.warn('[UsersPopup] inline edit: invalid age value', newValue);
                    return;
                }
                updated.age = ageNum;
            } else {
                updated[colKey] = newValue;
            }

            this.userStore.set(updated);
            this.renderUserManagementPopup(popup);
            this.helpers.installLogImageHoverPreview([popup]);
        };

        const cancel = () => {
            td.innerHTML = '';
            td.textContent = originalText;
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                return commit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
        });

        input.addEventListener('blur', () => {
            cancel();
        });
    }

    // ---------- actions (delete/edit-json) ----------

    _handleDeleteUser(uid, popup) {
        if (!uid) {
            console.error('[UsersPopup] _handleDeleteUser: missing uid');
            return;
        }

        this.userStore.remove(uid);

        this.renderUserManagementPopup(popup);
        this.helpers.installLogImageHoverPreview([popup]);
    }

    _handleEditUserJson(uid, popup) {
        const user = this.userStore.get(uid);
        if (!user) {
            console.error('[UsersPopup] _handleEditUserJson: user not found for uid', uid);
            return;
        }

        const src = JSON.stringify(user, null, 2);
        const edited = window.prompt('Edit JSON for this user (local store only):', src);

        if (edited == null) {
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(edited);
        } catch (err) {
            console.error('[UsersPopup] Invalid JSON:', err);
            window.alert('Invalid JSON, see console for details.');
            return;
        }

        if (!parsed || parsed.uid == null) {
            window.alert('User JSON must contain a uid field');
            return;
        }

        const merged = this.userStore._mergeUser
            ? this.userStore._mergeUser(parsed)
            : {...user, ...parsed};

        this.userStore.set(merged);
        this.renderUserManagementPopup(popup);
        this.helpers.installLogImageHoverPreview([popup]);
    }

    _loadColumnPrefs() {
        const raw = this.settingsStore.getUserManagerVisibleColumnPrefs();

        if (!raw) {
            this.state.visibleColumns = {};
            return;
        }

        try {
            if (raw && typeof raw === 'object') {
                this.state.visibleColumns = raw;
            } else {
                this.state.visibleColumns = {};
            }
            console.debug('[UsersPopup] Loaded visible columns:', this.state.visibleColumns);
        } catch (e) {
            console.error('[UsersPopup] Failed to parse column prefs:', e);
            this.state.visibleColumns = {};
        }
    }

    _isColumnVisible(colKey) {
        if (!colKey) {
            return false;
        }

        const prefs = this.state.visibleColumns || {};

        if (Object.keys(prefs).length === 0) {
            return true;
        }

        const v = prefs[colKey];

        if (v === undefined) {
            return true;
        }

        return !!v;
    }

    // ---------- helpers ----------

    _formatCellValue(v) {
        if (v === null || v === undefined) {
            return '—';
        }

        if (typeof v === 'boolean') {
            return v ? 'true' : 'false';
        }

        if (typeof v === 'object') {
            return JSON.stringify(v);
        }

        return String(v);
    }
}