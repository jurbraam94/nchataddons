(async function () {
    class ChatAddonTester {
        constructor(appInstance) {
            if (!appInstance) {
                console.error('[ChatAddonTester] Missing app instance');
            }
            this.app = appInstance;
        }

        /**
         * Low-level test:
         * Performs ONLY fetchPrivateMessagesForUid and logs raw + JSON.
         *
         * @param {string|number} uid
         * @param {object} [opts]
         * @param {number} [opts.pcount=20]
         */
        async testFetchPrivateMessagesForUid(uid, opts = {}) {
            if (!this.app) {
                console.error('[ChatAddonTester] No app instance available');
                return null;
            }

            const uidStr = String(uid || '').trim();
            if (!uidStr) {
                console.error('[ChatAddonTester] Invalid uid:', uid);
                return null;
            }

            const pcount = Number.isFinite(opts.pcount) ? Number(opts.pcount) : 20;

            const params = new URLSearchParams();
            params.set('pcount', String(pcount));

            console.log('[ChatAddonTester] Calling fetchPrivateMessagesForUid with:', {
                uid: uidStr,
                pcount
            });

            const rawResponse = await this.app.fetchPrivateMessagesForUid(uidStr, params);
            if (!rawResponse) {
                console.warn('[ChatAddonTester] Empty or null response');
                return rawResponse;
            }

            try {
                const parsed = JSON.parse(rawResponse);
                console.log('[ChatAddonTester] Parsed JSON response:', parsed);
                return parsed;
            } catch (err) {
                console.warn('[ChatAddonTester] Non-JSON response:', err);
                return rawResponse;
            }
        }

        /**
         * End-to-end test:
         * 1) fetchPrivateMessagesForUid
         * 2) toPrivateChatLogResponse
         * 3) caProcessPrivateLogResponse   (NO 'last' now)
         * 4) prints updated per-user fields
         */
        async testEndToEndPrivateMessagesForUid(uid, opts = {}) {
            if (!this.app) {
                console.error('[ChatAddonTester] No app instance');
                return null;
            }

            const uidStr = String(uid || '').trim();
            if (!uidStr) {
                console.error('[ChatAddonTester] Invalid uid in testEndToEnd:', uid);
                return null;
            }

            console.log('[ChatAddonTester] === End-to-end test for uid', uidStr, '===');

            // ----------------------------------------------------------
            // (0) Show user BEFORE processing
            // ----------------------------------------------------------
            let userBefore = await this.app.UserStore.getOrFetch(uidStr);
            console.log('[ChatAddonTester] User BEFORE processing:', {
                uid: userBefore?.uid,
                parsedDmInUpToLog: userBefore?.parsedDmInUpToLog,
                noNewPrivateDmTries: userBefore?.noNewPrivateDmTries,
                stalePrivateDmBeforeDate: userBefore?.stalePrivateDmBeforeDate
            });

            // ----------------------------------------------------------
            // (1) Fetch PM logs (raw + JSON)
            // ----------------------------------------------------------
            const result = await this.testFetchPrivateMessagesForUid(uidStr, opts);

            if (result == null) {
                console.warn('[ChatAddonTester] Abort: fetch returned nothing');
                return null;
            }

            if (typeof result === 'string') {
                console.warn('[ChatAddonTester] End-to-end aborted: response was not JSON.');
                return null;
            }

            // ----------------------------------------------------------
            // (2) Normalize response
            // ----------------------------------------------------------
            const privateChatLogResponse = this.app.toPrivateChatLogResponse(result);
            console.log('[ChatAddonTester] Normalized privateChatLogResponse:', privateChatLogResponse);

            const privateChatLogs =
                (Array.isArray(privateChatLogResponse?.pload) && privateChatLogResponse.pload.length
                    ? privateChatLogResponse.pload
                    : (Array.isArray(privateChatLogResponse?.plogs)
                        ? privateChatLogResponse.plogs
                        : []));

            console.log('[ChatAddonTester] privateChatLogs length:', privateChatLogs.length);

            // ----------------------------------------------------------
            // (3) Process logs through your full logic (NO last)
            // ----------------------------------------------------------
            await this.app.caProcessPrivateLogResponse(
                uidStr,
                privateChatLogs,
                undefined   // no last
            );

            // ----------------------------------------------------------
            // (4) Show user AFTER processing
            // ----------------------------------------------------------
            let userAfter = await this.app.UserStore.getOrFetch(uidStr);
            console.log('[ChatAddonTester] User AFTER processing:', {
                uid: userAfter?.uid,
                parsedDmInUpToLog: userAfter?.parsedDmInUpToLog,
                noNewPrivateDmTries: userAfter?.noNewPrivateDmTries,
                stalePrivateDmBeforeDate: userAfter?.stalePrivateDmBeforeDate
            });

            return userAfter;
        }


    }

    const text = document.body.innerText || "";
    if (text.includes("Verifieer dat u een mens bent")) {
        console.warn("Human verification page detected — not initializing.");
        return;
    }
    window.tester = new ChatAddonTester(window.app);
})();
