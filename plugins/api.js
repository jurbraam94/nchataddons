class Api {
    constructor({settingsStore, helpers}) {
        this.settingsStore = settingsStore;
        this.helpers = helpers;

        this.FEMALE_CODE = '2';
        this.maxRequestTimeout = 10000;
    }

    async searchUserNameRemote(uid) {
        if (!uid) {
            console.error(`[searchUserNameRemote] No uid provided`);
            return null
        }

        console.log(`Starting remote search for profile with uid ${uid}`);

        const body = new URLSearchParams({
            token: this.helpers.getToken(),
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

        return await response.text();
    }

    async fetchPrivateNotify() {
        const body = new URLSearchParams({
            token: this.helpers.getToken(),
            cp: 'chat'
        }).toString();
        const res = await fetch('/system/float/private_notify.php', {
            method: 'POST', credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': '*/*'
            },
            body
        })

        return await res.text();
    }

    async fetchChatLog(body) {
        body = new URLSearchParams({
            token: this.helpers.getToken(),
            cp: 'chat',
            fload: '1',
            preload: '0',
            ...body
        }).toString();
        const res = await fetch('/system/action/chat_log.php?timestamp=234284923', {
            method: 'POST', credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body
        });

        return await res.text();
    }

    async refreshUserList() {
        const body = new URLSearchParams({
            token: this.helpers.getToken(),
        }).toString();

        const res = await fetch('system/panel/user_list.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: body,
            credentials: 'same-origin',
        });

        return await res.text();
    }

    sendPrivateMessage(target, content) {
        const token = this.helpers.getToken();
        if (!token || !target || !content) return Promise.resolve({ok: false, status: 0, body: 'bad args'});

        this.logger.debug('Sending private message to:', target, 'content length:', content.length);

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

                return {
                    code: jsonResponse?.code,
                    log: jsonResponse?.log,
                };
            }));
        }, 10000);
    }

    _withTimeout(startFetchFn, ms = this.maxRequestTimeout) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), ms);
        return startFetchFn(ac.signal)
            .catch(err => ({ok: false, status: 0, body: String((err && err.message) || 'error')}))
            .finally(() => clearTimeout(t));
    }

    async searchUserRemoteByUsername(username) {
        if (!username) {
            console.error(`[RemoteSearch] No username provided`);
            return null
        }

        console.log(`Starting remote search for profile with username ${username}`);

        const body = new URLSearchParams({
            token: this.helpers.getToken(),
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

        return await res.text();
    }
}