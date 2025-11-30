class UsersPopup {
    constructor(app) {
        if (!app) {
            throw new Error('[UsersPopup] constructor requires app instance');
        }

        this.app = app;
        this.COLUMN_PREFS_KEY = `${app.STORAGE_KEY_PREFIX}.usersTableColumns.v1`;

        this.state = {
            page: 1,
            pageSize: 50,
            query: '',
            onlyFemales: false,
            onlyOnline: false, // NEW
            sortKey: 'name',
            sortDir: 'asc',
            visibleColumns: {}
        };

        this._loadColumnPrefs();
    }

    // ---------- public API ----------

    open() {
        const popup = this._ensurePopup();

        if (!popup) {
            console.error('[UsersPopup] open: popup not created');
            return;
        }

        this._render(popup);
        this.app.togglePopup('ca-users-popup');
        this.app.installLogImageHoverPreview(popup);
    }

    // ---------- popup skeleton ----------

    _ensurePopup() {
        const bodyHtml = `
<div class="ca-users-popup-root" id="ca-users-table-root">
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

        const popup = this.app.ensurePopup({
            id: 'ca-users-popup',
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
                this._render(popup);
                this.app.installLogImageHoverPreview(popup);
            });
        }

        // NEW: “only online” wiring
        if (onlyOnlineCheckbox) {
            onlyOnlineCheckbox.addEventListener('change', () => {
                this.state.onlyOnline = !!onlyOnlineCheckbox.checked;
                this.state.page = 1;
                this._render(popup);
                this.app.installLogImageHoverPreview(popup);
            });
        }

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.state.query = String(searchInput.value || '').trim().toLowerCase();
                this.state.page = 1;
                this._render(popup);
                this.app.installLogImageHoverPreview(popup);
            });
        } else {
            console.warn('[UsersPopup] _wirePopup: search input not found');
        }

        if (onlyFemalesCheckbox) {
            onlyFemalesCheckbox.addEventListener('change', () => {
                this.state.onlyFemales = !!onlyFemalesCheckbox.checked;
                this.state.page = 1;
                this._render(popup);
                this.app.installLogImageHoverPreview(popup);
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
                this._render(popup);
                this.app.installLogImageHoverPreview(popup);
            });
        }

        // Sorting + inline editing + actions
        table.addEventListener('click', async (e) => {
            const thSortable = e.target.closest('th[data-sort-key]');
            if (thSortable) {
                e.preventDefault();
                const sortKey = String(thSortable.getAttribute('data-sort-key') || '').trim();
                this._toggleSort(sortKey);
                this._render(popup);
                this.app.installLogImageHoverPreview(popup);
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
                    this.app.openProfileOnHost(uid);
                    return;
                }

                if (action === 'open-dm') {
                    const user = await this.app.UserStore.getOrFetch(uid);
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

    // ---------- render ----------

    _render(popup) {
        if (!popup) {
            console.error('[UsersPopup] _render called without popup');
            return;
        }

        const usersAll = this.app.UserStore.list();
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
            return;
        }

        const total = Array.isArray(allUsers) ? allUsers.length : 0;
        const totalFiltered = Array.isArray(filteredUsers) ? filteredUsers.length : 0;
        const totalFemales = allUsers.filter(u => u.isFemale).length;
        const totalFemalesOnline = this.app.UsersStore
            ? this.app.UsersStore.getAllLoggedInFemales().length
            : allUsers.filter(u => u.isFemale && u.isLoggedIn).length;

        el.textContent =
            `Users: ${totalFiltered}/${total} visible ` +
            `— Females: ${totalFemales} (online: ${totalFemalesOnline})`;
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
                this._saveColumnPrefs();
                this._render(popup);
                this.app.installLogImageHoverPreview(popup);
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

                    const html = this.app.userLinkHTML
                        ? this.app.userLinkHTML(user)
                        : this._fallbackUserLinkHTML(user);

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
                        this.app.renderSvgIconWithClass(
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
                        this.app.renderSvgIconWithClass(
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
            const user = this.app.UserStore.get(uid);

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

            this.app.UserStore.set(updated);
            this._render(popup);
            this.app.installLogImageHoverPreview(popup);
        };

        const cancel = () => {
            td.innerHTML = '';
            td.textContent = originalText;
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commit();
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

        const ok = window.confirm(`Delete
        user with ID
        ${uid}
        from
        local
        store
        ?
        This
        cannot
        be
        undone
        .`);
        if (!ok) {
            return;
        }

        if (typeof this.app.UserStore.delete === 'function') {
            this.app.UserStore.delete(uid);
        } else {
            console.warn('[UsersPopup] UserStore.delete is not available — falling back to manual delete');

            const all = this.app.UserStore.list();
            const next = all.filter(u => String(u.uid) !== String(uid));
            if (typeof this.app.UserStore._saveAll === 'function') {
                this.app.UserStore._saveAll(next);
            } else {
                console.error('[UsersPopup] No way to persist delete, _saveAll missing');
            }
        }

        this._render(popup);
        this.app.installLogImageHoverPreview(popup);
    }

    _handleEditUserJson(uid, popup) {
        const user = this.app.UserStore.get(uid);
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

        const merged = this.app.UserStore._mergeUser
            ? this.app.UserStore._mergeUser(parsed)
            : {...user, ...parsed};

        this.app.UserStore.set(merged);
        this._render(popup);
        this.app.installLogImageHoverPreview(popup);
    }

    // ---------- column prefs ----------

    _loadColumnPrefs() {
        if (!this.app.Store) {
            console.error('[UsersPopup] _loadColumnPrefs: Store not initialized');
            return;
        }

        const raw = this.app.Store.get(this.COLUMN_PREFS_KEY);
        if (raw && typeof raw === 'object') {
            this.state.visibleColumns = {...raw};
        } else {
            this.state.visibleColumns = {};
        }
    }

    _saveColumnPrefs() {
        if (!this.app.Store) {
            console.error('[UsersPopup] _saveColumnPrefs: Store not initialized');
            return;
        }

        this.app.Store.set(this.COLUMN_PREFS_KEY, this.state.visibleColumns || {});
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

    _fallbackUserLinkHTML(user) {
        const uid = this.app.escapeAttr ? this.app.escapeAttr(user.uid) : String(user.uid || '');
        const name = this.app.escapeHTML ? this.app.escapeHTML(user.name) : String(user.name || '');
        return `<a href="#" class="ca-user-link" data-action="open-profile" data-uid="${uid}">${name}</a>`;
    }
}

window.CAPlugins.UsersPopup = UsersPopup;