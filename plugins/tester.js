class ChatAddonTester {
    constructor(appInstance) {
        if (!appInstance) {
            console.error("[ChatAddonTester] Missing app instance");
        }
        this.app = appInstance;
    }

    async testFetchPrivateMessagesForUid(uid, opts = {}) {
        if (!this.app) {
            console.error("[ChatAddonTester] No app instance available");
            return null;
        }

        const uidStr = String(uid || "").trim();
        if (!uidStr) {
            console.error("[ChatAddonTester] Invalid uid:", uid);
            return null;
        }

        const pcount = Number.isFinite(opts.pcount) ? Number(opts.pcount) : 20;

        const params = new URLSearchParams();
        params.set("pcount", String(pcount));

        console.log("[ChatAddonTester] Calling fetchPrivateMessagesForUid with:", {
            uid: uidStr,
            pcount,
        });

        const rawResponse = await this.app.fetchPrivateMessagesForUid(
            uidStr,
            params
        );
        if (!rawResponse) {
            console.warn("[ChatAddonTester] Empty or null response");
            return rawResponse;
        }

        try {
            const parsed = JSON.parse(rawResponse);
            console.log(
                "[ChatAddonTester] Parsed JSON response:",
                parsed
            );
            return parsed;
        } catch (err) {
            console.warn("[ChatAddonTester] Non-JSON response:", err);
            return rawResponse;
        }
    }

    async testEndToEndPrivateMessagesForUid(uid, opts = {}) {
        if (!this.app) {
            console.error("[ChatAddonTester] No app instance");
            return null;
        }

        const uidStr = String(uid || "").trim();
        if (!uidStr) {
            console.error(
                "[ChatAddonTester] Invalid uid in testEndToEnd:",
                uid
            );
            return null;
        }

        console.log(
            "[ChatAddonTester] === End-to-end test for uid",
            uidStr,
            "==="
        );

        let userBefore = await this.app.UserStore.getOrFetch(uidStr);
        console.log("[ChatAddonTester] User BEFORE processing:", {
            uid: userBefore?.uid,
            parsedDmInUpToLog: userBefore?.parsedDmInUpToLog,
            noNewPrivateDmTries: userBefore?.noNewPrivateDmTries,
            stalePrivateDmBeforeDate:
            userBefore?.stalePrivateDmBeforeDate,
        });

        const result = await this.testFetchPrivateMessagesForUid(uidStr, opts);

        if (result == null) {
            console.warn(
                "[ChatAddonTester] Abort: fetch returned nothing"
            );
            return null;
        }

        if (typeof result === "string") {
            console.warn(
                "[ChatAddonTester] End-to-end aborted: response was not JSON."
            );
            return null;
        }

        const privateChatLogResponse =
            this.app.toPrivateChatLogResponse(result);
        console.log(
            "[ChatAddonTester] Normalized privateChatLogResponse:",
            privateChatLogResponse
        );

        const privateChatLogs =
            Array.isArray(privateChatLogResponse?.pload) &&
            privateChatLogResponse.pload.length
                ? privateChatLogResponse.pload
                : Array.isArray(privateChatLogResponse?.plogs)
                    ? privateChatLogResponse.plogs
                    : [];

        console.log(
            "[ChatAddonTester] privateChatLogs length:",
            privateChatLogs.length
        );

        await this.app.caProcessPrivateLogResponse(
            uidStr,
            privateChatLogs,
            undefined
        );

        let userAfter = await this.app.UserStore.getOrFetch(uidStr);
        console.log("[ChatAddonTester] User AFTER processing:", {
            uid: userAfter?.uid,
            parsedDmInUpToLog: userAfter?.parsedDmInUpToLog,
            noNewPrivateDmTries: userAfter?.noNewPrivateDmTries,
            stalePrivateDmBeforeDate:
            userAfter?.stalePrivateDmBeforeDate,
        });

        return userAfter;
    }
}

window.tester = ChatAddonTester;