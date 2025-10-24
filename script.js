
(function(){
    try{
        window.CA = window.CA || {};
        if (typeof window.CA.debug !== 'function') {
            window.CA.debug = function(){ /* debug shim */ };
        }
    } catch (e) {}
})();

(function(){
    /* =========================
     * 321ChatAddons Toolkit (with Activity Log) — initial page-load logging added
     * ========================= */
    const FEMALE_CODE='2', LOG='[321ChatAddons]';

    /* ---------- Helpers ---------- */
    const qs = (s, r) => (r || document).querySelector(s);
    const qsa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
    const trim = function (s){return (s||'').replace(/^\s+|\s+$/g,'');}
    const norm = function (s){return trim(s).toLowerCase();}
    const sleep = function (ms){return new Promise(function(r){setTimeout(r,ms);});}
    const randBetween = function (minMs,maxMs){return Math.floor(minMs+Math.random()*(maxMs-minMs));}
    const safeMatches = function (n,sel){ try { return n && n.nodeType===1 && typeof n.matches==='function' && n.matches(sel); } catch (e) {console.error(e);
        return false; } }
    const safeQuery = function (n,sel){ try { return n && n.querySelector ? n.querySelector(sel) : null; } catch (e) {console.error(e);
        return null; } }
    const escapeHTML = function (s){ return String(s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);}); }
    const decodeHTMLEntities = function (s){
        try {
            let txt = document.createElement('textarea');
            txt.innerHTML = String(s);
            return txt.value;
        } catch (e) {console.error(e);
            return String(s); }
    }
    const timeHHMM = function (){ const d=new Date(); let h=String(d.getHours()).padStart(2,'0'), m=String(d.getMinutes()).padStart(2,'0'); return h+':'+m; }

    /* ====== Types, defaults, and normalizers (added) ====== */
    /** @typedef {{
     *   last: string,
     *   pico: number,
     *   pload: PrivLogItem[],
     *   plogs: PrivLogItem[]
     * }} ChatLogResponse */

    /** @typedef {{
     *   log_id: string,
     *   log_date: string,     // "DD/MM HH:MM"
     *   user_id: string,
     *   user_name: string,
     *   user_tumb: string,
     *   log_content: string
     * }} PrivLogItem */

    /** @typedef {{
     *   code: number,
     *   log: { log_content: string }
     * }} PrivateSendResponse */

    /** @typedef {{
     *   last: string,
     *   pload: PrivLogItem[],
     *   plogs: PrivLogItem[]
     * }} PrivateChatLogResponse */

    /** Safe JSON.parse that returns {} on failure */
    function parseJSONOrEmpty(str){
        try { return JSON.parse(String(str)); } catch (e) { try { console.error(e); } catch (_) {} return {}; }
    }

    /** @param {any} x @returns {PrivLogItem} */
    function toPrivLogItem(x){
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

    /** @param {any} x @returns {ChatLogResponse} */
    function toChatLogResponse(x){
        const o = x && typeof x === 'object' ? x : {};
        const picoNum = Number.isFinite(o.pico) ? o.pico : (typeof o.pico === 'string' ? (Number(o.pico) || 0) : 0);
        const pload = Array.isArray(o.pload) ? o.pload.map(toPrivLogItem) : [];
        const plogs = Array.isArray(o.plogs) ? o.plogs.map(toPrivLogItem) : [];
        return {
            last: typeof o.last === 'string' ? o.last : '',
            pico: picoNum,
            pload,
            plogs
        };
    }

    /** @param {any} x @returns {PrivateSendResponse} */
    function toPrivateSendResponse(x){
        const o = x && typeof x === 'object' ? x : {};
        const codeNum = Number.isFinite(o.code) ? o.code : (typeof o.code === 'string' ? (Number(o.code) || 0) : 0);
        return {
            code: codeNum,
            log: { log_content: String(o?.log?.log_content ?? '') }
        };
    }

    /** @param {any} x @returns {PrivateChatLogResponse} */
    function toPrivateChatLogResponse(x){
        const o = x && typeof x === 'object' ? x : {};
        const pload = Array.isArray(o.pload) ? o.pload.map(toPrivLogItem) : [];
        const plogs = Array.isArray(o.plogs) ? o.plogs.map(toPrivLogItem) : [];
        return {
            last: typeof o.last === 'string' ? o.last : '',
            pload,
            plogs
        };
    }

    window.CA = window.CA || {};

    CA.Const = {
        STORAGE_KEYS: {
            draftSpecific: '321chataddons.pm.draft_specific',
            draftBroadcast: '321chataddons.pm.draft_broadcast'
        }
    };

    CA.Drafts = {
        save(key, value) {
            const k = typeof key === 'string' ? key : String(key || '');
            if (!k) return false;
            return CA.Store.set(k, value == null ? '' : String(value));
        },

        bindInput(el, key) {
            if (!el) return;
            // restore directly
            el.value = String(CA.Store.get(key) ?? '');
            // save on input
            el.addEventListener('input', () => this.save(key, el.value));
        }
    };

    // ---------- Centralized safe localStorage helpers ----------
    CA.Store = {
        /** Raw get; auto-parses JSON if detected */
        has(key) {
            try {
                const val = localStorage.getItem(key);
                return val !== null;
            } catch (e) {
                console.error(e);
                return false;
            }
        },

        get(key){
            try {
                const raw = localStorage.getItem(key);
                if (raw == null) return null;

                const trimmed = String(raw).trim();
                // Auto-detect JSON and parse if possible
                if (/^[{\[]/.test(trimmed) || trimmed === "true" || trimmed === "false" || /^-?\d+(\.\d+)?$/.test(trimmed)) {
                    try {
                        return JSON.parse(trimmed);
                    } catch {
                        return raw; // return as-is if parsing fails
                    }
                }

                return raw;
            } catch (e) {
                console.error(e);
                return null;
            }
        },
        /** Raw set; accepts strings or objects */
        set(key, value){
            try{
                const toStore = (typeof value === 'string') ? value : JSON.stringify(value == null ? {} : value);
                localStorage.setItem(key, toStore);
                return true;
            }catch(e){ console.error(e); return false; }
        },
        remove(key) {
            try{ localStorage.removeItem(key); }catch(e){ try{console.error(e);}catch(__){} }
        }
    };

    CA.CapturedUsers = {
        KEY: '321chataddons.capturedUsers',

        has(id) {
            if (!id) return false;
            try {
                const data = CA.Store.get(this.KEY) || {};
                return Object.prototype.hasOwnProperty.call(data, String(id));
            } catch (e) {
                console.error(e);
                return false;
            }
        },

        get(id) {
            if (!id) return null;
            try {
                const data = CA.Store.get(this.KEY) || {};
                const v = data[String(id)];
                if (v && typeof v === 'object')
                    return { name: String(v.name || ''), avatar: String(v.avatar || '') };
                return v ? { name: String(v), avatar: '' } : null;
            } catch (e) {
                console.error(e);
                return null;
            }
        },

        set(id, name, avatar) {
            if (!id) return false;
            try {
                const data = CA.Store.get(this.KEY) || {};
                const key = String(id);
                const prev = data[key] && typeof data[key] === 'object' ? data[key] : {};
                data[key] = {
                    name: String(name || prev.name || ''),
                    avatar: String(avatar || prev.avatar || '')
                };
                return CA.Store.set(this.KEY, data);
            } catch (e) {
                console.error(e);
                return false;
            }
        },

        remove(id) {
            if (!id) return false;
            try {
                const data = CA.Store.get(this.KEY) || {};
                delete data[String(id)];
                return CA.Store.set(this.KEY, data);
            } catch (e) {
                console.error(e);
                return false;
            }
        }
    };


    CA.Debug = {
        KEY: '321chataddons.debug',

        // Current enabled state (lazy-loaded from Store)
        get enabled() {
            return String(CA.Store.get(this.KEY) ?? '0') === '1';
        },

        set enabled(val) {
            this.set(val);
        },

        // Explicitly toggle persistence and state
        set(on) {
            const state = !!on;
            try {
                CA.Store.set(this.KEY, state ? '1' : '0');
            } catch (e) {
                console.error(e);
            }
        },

        // Log only if enabled
        log(...args) {
            if (this.enabled) {
                try {
                    console.log(...args);
                } catch (e) {}
            }
        },

        // Inject a toggle checkbox into the panel
        ensureToggle() {
            try {
                const panel = document.getElementById('ca-panel');
                if (!panel || panel.querySelector('#ca-debug-toggle')) return;

                const row = document.createElement('div');
                row.className = 'ca-debug-row';
                row.style.cssText =
                    'display:flex;align-items:center;gap:6px;justify-content:flex-end;padding:4px 6px;border-bottom:1px solid rgba(0,0,0,.06);';

                const label = document.createElement('label');
                label.style.cssText =
                    'display:flex;align-items:center;gap:6px;font:12px/1.2 sans-serif;cursor:pointer;';

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.id = 'ca-debug-toggle';
                cb.checked = this.enabled;

                const span = document.createElement('span');
                span.textContent = 'Debug logs';

                label.append(cb, span);
                row.appendChild(label);
                panel.insertBefore(row, panel.firstChild);

                cb.addEventListener('change', () => this.set(cb.checked));
            } catch (e) {
                console.error(e);
            }
        },

        // Bootstraps the toggle automatically
        init() {
            setTimeout(() => {
                try {
                    this.ensureToggle();
                } catch (e) {}
            }, 300);
        }
    };

    // Shortcut alias for logging
    CA.debug = (...args) => CA.Debug.log(...args);

// Initialize toggle
    CA.Debug.init();

    /* ---------- Audio autoplay gate (avoid NotAllowedError before user gesture) ---------- */
    (function setup321ChatAddonsAudioGate(){
        try {
            let userInteracted = false;
            const pending = new Set();
            const origPlay = HTMLAudioElement && HTMLAudioElement.prototype && HTMLAudioElement.prototype.play
                ? HTMLAudioElement.prototype.play
                : null;
            if(!origPlay) return;

            function onInteract(){
                if(userInteracted) return;
                userInteracted = true;
                // Try to flush any queued audio
                pending.forEach(function(a){
                    try { origPlay.call(a).catch(function(){/* ignore */}); } catch (e) {console.error(e);
                        console.error(e)}
                });
                pending.clear();
                window.removeEventListener('click', onInteract, true);
                window.removeEventListener('keydown', onInteract, true);
                window.removeEventListener('touchstart', onInteract, true);
            }
            window.addEventListener('click', onInteract, true);
            window.addEventListener('keydown', onInteract, true);
            window.addEventListener('touchstart', onInteract, true);

            HTMLAudioElement.prototype.play = function(){
                try {
                    if(!userInteracted){
                        // Queue and resolve immediately to prevent uncaught NotAllowedError
                        pending.add(this);
                        return Promise.resolve();
                    }
                    let p = origPlay.call(this);
                    if(p && typeof p.catch === 'function'){
                        p.catch(function(err){
                            // If policy still blocks, queue it and swallow the error
                            if(err && String(err.name||err).toLowerCase().indexOf('notallowed') > -1){
                                pending.add(this);
                            }
                        }.bind(this));
                    }
                    return p;
                } catch (e) {console.error(e);
                    try { return origPlay.call(this); } catch (e) { console.error(e);return Promise.resolve(); }
                }
            };
        } catch (e) {console.error(e);
            console.error(e)}
    })();

    /* ---------- 321ChatAddons: bottom log helpers ---------- */
    const caGetLogBox = function (){
        try {
            let panel = document.getElementById('ca-panel') || document;
            return panel.querySelector('.ca-log-box');
        } catch (e) {console.error(e);
            return null; }
    }
    const caAppendLog = function (type, text){
        try {
            const box = caGetLogBox();
            if(!box) return;
            let entry = document.createElement('div');
            entry.className = 'ca-log-entry ' + (type === 'broadcast' ? 'ca-log-broadcast' : (type === 'reset' ? 'ca-log-reset' : ''));
            let ts = document.createElement('div'); ts.className = 'ca-log-ts'; ts.textContent = timeHHMM();
            let dot = document.createElement('div'); dot.className = 'ca-log-dot';
            const msg = document.createElement('div'); msg.className = 'ca-log-text';
            const safe = escapeHTML(String(text||''));
            if(type === 'broadcast'){
                msg.innerHTML = safe + ' <span class="ca-badge-bc">BROADCAST</span>';
            } else {
                msg.innerHTML = safe;
            }
            entry.appendChild(ts); entry.appendChild(dot); entry.appendChild(msg);
            // Prepend so newest appears at top with column-reverse
            box.insertBefore(entry, box.firstChild || null);
        } catch (e) {console.error(e);
            /* ignore */ }
    }
    // Wire up click handlers for reset tracking anchors and broadcast send button
    document.addEventListener('click', function(e){
        try {
            const resetA = e.target && (e.target.closest && e.target.closest('.ca-pop .ca-reset-link, .ca-reset-link, .ca-reset'));
            if(resetA){
                caAppendLog('reset','Tracking has been reset');
            }
            const bcBtn = e.target && (e.target.closest && e.target.closest('#ca-bc-send'));
            if(bcBtn){
                caAppendLog('broadcast','Message sent');
            }
        } catch (e) {console.error(e);
            console.error(e)}
    });

    /* ---------- Keep original page sizing ---------- */
    const applyInline = function (){
        try {
            let a=qsa('.pboxed'); for(let i=0;i<a.length;i++){a[i].style.setProperty('height','800px','important');}
            const b=qsa('.pboxed .pcontent'); for(let j=0;j<b.length;j++){b[j].style.setProperty('height','610px','important');}
        } catch (e) {console.error(e);
        }
    }
    const removeAds = function (root){
        try {
            const scope = root && root.querySelectorAll ? root : document;
            const links = scope.querySelectorAll('a[href*="bit.ly"]');
            if(!links || !links.length) return;
            links.forEach(function(a){
                if(a && !a.closest('#ca-panel') && a.parentNode){
                    a.parentNode.removeChild(a); // remove only the anchor
                }
            });
        } catch (e) {console.error(e);
        }
    }
    const adjustForFooter = function (){
        try {
            let panel = document.getElementById('ca-panel');
            if(!panel) return;
            // Match panel height to the site's right column (#chat_right), if available
            const chatRight = document.getElementById('chat_right') || document.querySelector('#chat_right');
            if(!chatRight) return;

            // Use getBoundingClientRect for accurate measurement
            const rect = chatRight.getBoundingClientRect();
            let h = rect.height;

            // Fallback to offsetHeight/clientHeight if rect is not available or invalid
            if(!h || h <= 0){
                h = chatRight.offsetHeight || chatRight.clientHeight || 0;
            }

            // Apply reasonable constraints (min 400px, max 1200px)
            if(h > 0){
                h = Math.max(400, Math.min(h, 1200));
                panel.style.height = h + 'px';
                panel.style.maxHeight = h + 'px';
            }

            // Ensure no extra padding is applied to the logs section
            const logsSec = panel.querySelector('.ca-log-section');
            if(logsSec){ logsSec.style.paddingBottom = ''; }
        } catch (e) {console.error(e);
            console.error(LOG, 'adjustForFooter error:', e);
        }
    }
    if (document.body) {
        // Initial setup with delay to let page layout settle
        setTimeout(function(){ applyInline(); removeAds(document); },0);
        setTimeout(function(){ adjustForFooter(); }, 500);

        // Throttle the MutationObserver to avoid excessive calls
        let lastAdjust = 0;
        new MutationObserver(function(){
            try {
                applyInline();
                removeAds(document);
                let now = Date.now();
                if(now - lastAdjust > 1000){
                    adjustForFooter();
                    lastAdjust = now;
                }
            } catch (e) {console.error(e);
            }
        }).observe(document.body,{childList:true,subtree:true});

        // Debounce resize handler
        let resizeTimer;
        window.addEventListener('resize', function(){
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function(){ adjustForFooter(); }, 250);
        });
    }

    /* ---------- Containers / lists ---------- */
    const getContainer = function (){ return qs('#container_user')||qs('#chat_right_data'); }

    let isPruning=false, rafId=null;
    const schedule = function (fn){ if(rafId) cancelAnimationFrame(rafId); rafId=requestAnimationFrame(function(){rafId=null; fn();}); }

    // Shared chat context captured from site chat_log requests (used for our private chat_log calls)
    let CHAT_CTX = { caction:'', last:'', lastp: '', room:'', notify:'', curset:'', pcount:0 };

    // Global watermark - store in same format as log_date: "DD/MM HH:MM"
    const GLOBAL_WATERMARK_KEY = '321chataddons.global.watermark';

    const getGlobalWatermark = function (){
        try {
            return CA.Store.get(GLOBAL_WATERMARK_KEY) || '';
        } catch (e) {console.error(e);
            return ''; }
    }

    const setGlobalWatermark = function (dateStr){
        try {
            if(dateStr) CA.Store.set(GLOBAL_WATERMARK_KEY, String(dateStr));
        } catch (e) {console.error(e);
        }
    }

    const getTimeStampInWebsiteFormat = function () {
        // Set watermark to current time in DD/MM HH:MM format
        let now = new Date();
        let day = String(now.getDate()).padStart(2, '0');
        let month = String(now.getMonth() + 1).padStart(2, '0');
        let hours = String(now.getHours()).padStart(2, '0');
        let minutes = String(now.getMinutes()).padStart(2, '0');
        return day + '/' + month + ' ' + hours + ':' + minutes;
    }

    // Initialize watermark once on page load with current date/time in "DD/MM HH:MM" format
    const initializeGlobalWatermark = function (){
        try {
            const currentWatermark = getGlobalWatermark();
            console.log(LOG, 'Checking watermark... current value:', currentWatermark || '(not set)');

            if(currentWatermark && currentWatermark.length > 0){
                console.log(LOG, 'Watermark already set:', currentWatermark);
                return;
            }

            let timestamp = getTimeStampInWebsiteFormat();

            console.log(LOG, 'Setting initial watermark to:', timestamp);
            setGlobalWatermark(timestamp);

            // Verify it was set
            let verify = getGlobalWatermark();
            if(verify === timestamp){
                console.log(LOG, 'Watermark successfully initialized:', timestamp);
            } else {
                console.warn(LOG, 'Watermark set but verification failed. Expected:', timestamp, 'Got:', verify);
            }
        } catch (err) {console.error(err);
            console.error(LOG, 'Initialize watermark error:', err);
        }
    }

    // Parse log_date format "DD/MM HH:MM" to comparable number (MMDDHHMM)
    const parseLogDateToNumber = function (logDateStr){
        try {
            if(!logDateStr || typeof logDateStr !== 'string') return 0;

            // Format: "23/10 11:25" (DD/MM HH:MM)
            let parts = logDateStr.trim().split(/[\s\/:/]+/);
            if(parts.length < 4) return 0;

            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10);
            const hours = parseInt(parts[2], 10);
            const minutes = parseInt(parts[3], 10);

            if(isNaN(day) || isNaN(month) || isNaN(hours) || isNaN(minutes)) return 0;

            // Convert to comparable number: MMDDHHMM
            // This allows simple numeric comparison within same year
            return (month * 1000000) + (day * 10000) + (hours * 100) + minutes;
        } catch (e) {console.error(e);
            console.error(LOG, 'Parse log_date error:', e, '— input:', logDateStr);
            return 0;
        }
    }

    // Check if a message is newer than watermark
    const isMessageNewer = function (logDateStr, debugLog){
        try {
            let watermark = getGlobalWatermark();
            if(!watermark) return true; // No watermark set, show all

            const msgNum = parseLogDateToNumber(logDateStr);
            const wmNum = parseLogDateToNumber(watermark);

            if(!msgNum) return false; // Invalid date, skip

            const isNewer = msgNum >= wmNum;

            // Optional debug logging
            if(debugLog){
                console.log(LOG, 'Date comparison:', {
                    logDate: logDateStr,
                    logDateNum: msgNum,
                    watermark: watermark,
                    watermarkNum: wmNum,
                    isNewer: isNewer
                });
            }

            return isNewer;
        } catch (e) {console.error(e);
            console.error(LOG, 'Date comparison error:', e);
            return false;
        }
    }

    // Normalize letious request body types to a query-string
    const normalizeBodyToQuery = function (body){
        try {
            if(!body) return '';
            if(typeof body === 'string') return body;
            if(typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
            if(typeof FormData !== 'undefined' && body instanceof FormData){
                const usp = new URLSearchParams();
                body.forEach(function(v,k){ usp.append(k, typeof v === 'string' ? v : ''); });
                return usp.toString();
            }
            if(typeof body === 'object'){
                try { return new URLSearchParams(body).toString(); } catch (e) {console.error(e);
                    console.error(e)}
            }
        } catch (e) {console.error(e);
            console.error(LOG, 'Body normalization error:', e); }
        return '';
    }

    /* ---------- Female pruning (hide, not remove) ---------- */
    const pruneNonFemale = function (){
        let c=getContainer(); if(!c) return;
        isPruning = true;
        try {
            qsa('.user_item[data-gender]', c).forEach(function(n){
                const female = n.getAttribute('data-gender')===FEMALE_CODE;
                n.classList.toggle('ca-hidden', !female);
            });
        } finally { isPruning=false; }
    }

    /* ---------- ID/Name extraction ---------- */
    const getUserId = function (el){
        if(!el) return null;
        try {
            const ds=el.dataset||{};
            let id=ds.uid||ds.userid||ds.user||ds.id;
            if(!id){
                let n=qs('[data-uid]',el); if(n&&n.dataset&&n.dataset.uid) id=n.dataset.uid;
                if(!id){ n=qs('[data-userid]',el); if(n&&n.dataset&&n.dataset.userid) id=n.dataset.userid; }
                if(!id){ n=qs('[data-user]',el); if(n&&n.dataset&&n.dataset.user) id=n.dataset.user; }
                if(!id){ n=qs('[data-id]',el); if(n&&n.dataset&&n.dataset.id) id=n.dataset.id; }
            }
            if(!id){
                let a=qs('a[href*="profile"]',el), m=a&&a.href.match(/(?:\/profile\/|[?&]uid=)(\d+)/);
                if(m&&m[1]) id=m[1];
                if(!id){
                    a=qs('a[href*="user"]',el);
                    m=a&&a.href.match(/(?:\/user\/|[?&]id=)(\d+)/);
                    if(m&&m[1]) id=m[1];
                }
            }
            return id?String(id):null;
        } catch (e) {console.error(e);
            return null; }
    }
    const extractUsername = function (el){
        if(!el) return '';
        try {
            const v=el.getAttribute('data-name'); if(v) return v.trim();
            let n=qs('.user_name,.username,.name',el); if(n&&n.textContent) return n.textContent.trim();
            let t=el.getAttribute('title'); if(t) return t.trim();
            let text=(el.textContent||'').trim(); if(!text) return '';
            const parts=text.split(/\s+/), out=[]; for(let i=0;i<parts.length;i++){ if(parts[i]) out.push(parts[i]); }
            if(!out.length) return '';
            out.sort(function(a,b){return a.length-b.length;});
            return out[0];
        } catch (e) {console.error(e);
            return ''; }
    }
    const extractAvatar = function (el){
        try {
            if(!el) return '';
            const img = safeQuery(el,'img[src*="avatar"]') || safeQuery(el,'.avatar img') || safeQuery(el,'img');
            const src = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
            return src ? src.trim() : '';
        } catch (e) {console.error(e);
            return ''; }
    }
    const findFemaleByUsername = async function (query){
        let q=norm(query); if(!q) return [];
        let c=getContainer(); if(!c) return [];
        let els=qsa('.user_item[data-gender="'+FEMALE_CODE+'"]',c), out=[];
        for(let i=0;i<els.length;i++){
            let id=getUserId(els[i]); if(!id) continue;
            let name=norm(extractUsername(els[i])); if(!name) continue;
            if(name===q || name.indexOf(q)>-1) out.push({el:els[i],id:id,name:name});
        }
        if(out[0]) {
            return out[0];
        }
        else {
            console.warn('User not found (female). Looking through a remote search on the website.');
            const usersFromRemote = await searchUsersRemote(q);
            console.log('Remote search results:', usersFromRemote);
            return usersFromRemote.length > 0 ? usersFromRemote[0] : null;
        }
    }
    const collectFemaleIds = function (){
        let c=getContainer(); if(!c) return [];
        let els=qsa('.user_item[data-gender="'+FEMALE_CODE+'"]',c), out=[];
        for(let i=0;i<els.length;i++){
            let id=getUserId(els[i]); if(id) out.push({el:els[i],id:id,name:extractUsername(els[i])});
        }
        return out;
    }

    /* ---------- Token + POST ---------- */
    const getToken = function (){
        try { if(typeof utk!=='undefined' && utk) return utk; } catch (e) {console.error(e);
        }
        let inp=qs('input[name="token"]'); if(inp&&inp.value) return inp.value;
        const sc=qsa('script'); for(let i=0;i<sc.length;i++){
            let t=sc[i].textContent||''; const m=t.match(/\butk\s*=\s*['"]([a-f0-9]{16,64})['"]/i); if(m) return m[1];
        }
        return null;
    }
    const withTimeout = function (startFetchFn, ms){
        if(ms==null) ms = 15000;
        const ac = new AbortController();
        let t = setTimeout(function(){ ac.abort(); }, ms);
        return startFetchFn(ac.signal)
            .catch(function(err){ return { ok:false, status:0, body:String(err&&err.message||'error') }; })
            .finally(function(){ clearTimeout(t); });
    }
    const sendPrivateMessage = function (target, content){
        let token=getToken(); if(!token||!target||!content){ return Promise.resolve({ok:false,status:0,body:'bad args'}); }
        let body=new URLSearchParams({token:token,cp:'chat',target:String(target),content:String(content),quote:'0'}).toString();
        return withTimeout(function(signal){
            return fetch('/system/action/private_process.php',{
                method:'POST', credentials:'include', signal:signal,
                headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Accept':'application/json, text/javascript, */*; q=0.01','X-Requested-With':'XMLHttpRequest','X-CA-OWN':'1'},
                body: body
            }).then(function(res){
                return res.text().then(function(txt){
                    let parsed; try { parsed=JSON.parse(txt); } catch (e) {console.error(e);
                    }
                    return {ok:res.ok,status:res.status,body:parsed||txt};
                });
            });
        }, 15000);
    }

    /* ---------- Remote search ---------- */
    const searchUsersRemote = function (query){
        return new Promise(function(resolve){
            let token=getToken(); if(!token || !query){ resolve([]); return; }
            let body=new URLSearchParams({token:token, cp:'chat', query:String(query), search_type:'1', search_order:'0'}).toString();
            fetch('/system/action/action_search.php',{
                method:'POST', credentials:'include',
                headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Accept':'*/*','X-Requested-With':'XMLHttpRequest','X-CA-OWN':'1'},
                body: body
            }).then(function(res){ return res.text(); })
                .then(function(html){ resolve(parseSearchHTML(html)); })
                .catch(function(){ resolve([]); });
        });
    }
    const parseSearchHTML = function (html){
        let tmp=document.createElement('div'); tmp.innerHTML=html;
        let nodes=tmp.querySelectorAll('.user_item[data-id]'); let out=[];
        for(let i=0;i<nodes.length;i++){
            let el=nodes[i]; if(el.getAttribute('data-gender')!==FEMALE_CODE) continue;
            let id=el.getAttribute('data-id'); if(!id) continue;
            let name='', p=el.querySelector('.username'); if(p&&p.textContent) name=p.textContent.trim();
            if(!name){ const dn=el.getAttribute('data-name'); if(dn) name=dn.trim(); }
            out.push({el:null,id:String(id),name:name});
        }
        return out;
    }

    /* ---------- Message tracking (per-message “new only”) ---------- */
    const STORAGE_PREFIX='321chataddons.pm.', LAST_HASH_KEY=STORAGE_PREFIX+'lastMessageHash';
    const hashMessage = function (s){let h=5381; s=String(s); for(let i=0;i<s.length;i++){h=((h<<5)+h)+s.charCodeAt(i);} return (h>>>0).toString(36);}
    const NS = location.host + (window.curPage||'') + ':';
    const keyForHash = function (h){return STORAGE_PREFIX+NS+h;}
    const setLast = function (h){CA.Store.set(LAST_HASH_KEY,h);}
    const getLast = function (){try {return CA.Store.get(LAST_HASH_KEY)||'';} catch (e) {console.error(e);
        return ''}}
    const markSent = function (el){
        try {
            if(!el) return;
            el.classList.add('chataddons-sent');
            el.style.setProperty('outline','2px solid #8bc34a66','important');
            el.style.setProperty('border-radius','8px','important');
            let id = getUserId(el);
            if(id){ ensureSentChip(el, !!SENT_ALL[id]); }
            resortUserList();
        } catch (e) {console.error(e);
        }
    }

    /* ---------- Exclusion checkboxes (persisted) ---------- */
    const EXC_KEY='321chataddons.excluded';
    const loadExcluded = function () {
        const raw =CA.Store.get(EXC_KEY);
        if (!raw) return {};
        const arr = Array.isArray(raw) ? raw : [];
        const map = {};
        for (let i = 0; i < arr.length; i++) {
            const k = String(arr[i]);
            if (k) map[k] = 1;
        }
        return map;
    };
    const saveExcluded = function (map){  let arr=[],k; for(k in map) if(map.hasOwnProperty(k)&&map[k]) arr.push(k); CA.Store.set(EXC_KEY, arr); };
    const EXCLUDED=loadExcluded();

// Global "already messaged" list (applies to any message)
    const SENT_ALL_KEY='321chataddons.sent.all';
    const loadSentAll = function (){ return CA.Store.get(SENT_ALL_KEY) || {} }
    const saveSentAll = function (map){ CA.Store.set(SENT_ALL_KEY, map); }
    let SENT_ALL = loadSentAll();

    // Track conversations that have been replied to
    const REPLIED_CONVOS_KEY='321chataddons.repliedConversations';
    const loadRepliedConvos = function (){ return (CA.Store.get(REPLIED_CONVOS_KEY) || {}) }
    const saveRepliedConvos = function (map){ CA.Store.set(REPLIED_CONVOS_KEY, map); }
    const REPLIED_CONVOS = loadRepliedConvos();

    // Global user map: ID -> {name, avatar}
    const USER_MAP = {};

    const getUserFromMap = function (uid){
        try {
            if(!uid) return {name: '', avatar: ''};
            let user = USER_MAP[uid];
            if(!user) return {name: String(uid), avatar: ''}; // Fallback to ID as name
            return {
                name: user.name || String(uid),
                avatar: user.avatar || ''
            };
        } catch (e) {console.error(e);
            return {name: String(uid), avatar: ''};
        }
    }

    // Mark all received messages from a specific user as replied
    const markConversationAsReplied = function (uid){
        try {
            if(!uid) return;
            REPLIED_CONVOS[uid] = getTimeStampInWebsiteFormat();
            saveRepliedConvos(REPLIED_CONVOS);

            // Move messages from unreplied to replied section
            const unrepliedBox = document.getElementById('ca-log-received-unreplied');
            const repliedBox = document.getElementById('ca-log-received-replied');

            if(unrepliedBox && repliedBox){
                const entries = qsa('.ca-log-pv', unrepliedBox);
                entries.forEach(function(entry){
                    let userLink = entry.querySelector('.ca-user-link');
                    if(!userLink) return;
                    let entryUid = userLink.getAttribute('data-uid');
                    if(entryUid === String(uid)){
                        // Find and replace reply icon with replied mark
                        let replyIcon = entry.querySelector('.ca-reply-icon');
                        if(replyIcon && !entry.querySelector('.ca-replied-mark')){
                            let uname = userLink.getAttribute('data-name') || '';

                            // Create checkmark link (clickable to open chat)
                            let mark = document.createElement('a');
                            mark.className = 'ca-replied-mark';
                            mark.setAttribute('data-reply','1');
                            mark.setAttribute('data-uid', entryUid);
                            mark.setAttribute('data-name', uname);
                            mark.href = '#';
                            mark.textContent = '✓';
                            mark.title = 'Replied - Click to open chat';

                            // Replace reply icon with checkmark
                            replyIcon.parentNode.replaceChild(mark, replyIcon);
                        }

                        // Move entry to replied section
                        repliedBox.appendChild(entry);
                    }
                });
            }
        } catch (e) {console.error(e);
            console.error(LOG, 'Mark conversation replied error:', e);
        }
    }

    // Persisted per-user last processed pcount to avoid refetching same batch
    const LAST_PCOUNT_MAP_KEY='321chataddons.lastPcountPerConversation';
    const loadLastPcountMap = function (){ try { let raw=CA.Store.get(LAST_PCOUNT_MAP_KEY); return raw ? (raw||{}) : {}; } catch (e) {console.error(e);
        return {}; } }
    const saveLastPcountMap = function (map){ CA.Store.set(LAST_PCOUNT_MAP_KEY, map||{}); }
    const LAST_PCOUNT_MAP = loadLastPcountMap();
    const getLastPcountFor = function (uid){ try { return (LAST_PCOUNT_MAP && Number(LAST_PCOUNT_MAP[uid]))||0; } catch (e) {console.error(e);
        return 0; } }
    const setLastPcountFor = function (uid, pc){ try { if(!uid) return; LAST_PCOUNT_MAP[uid]=Number(pc)||0; saveLastPcountMap(LAST_PCOUNT_MAP); } catch (e) {console.error(e);
    } }

    // Track displayed message log_id per conversation to prevent duplicates
    const DISPLAYED_LOGIDS_KEY='321chataddons.displayedLogIds';
    const MAX_LOGIDS_PER_CONVERSATION = 100; // Keep last 100 IDs per conversation

    const loadDisplayedLogIds = function (){
        try {
            let raw=CA.Store.get(DISPLAYED_LOGIDS_KEY);
            return raw ? (raw||{}) : {};
        } catch (e) {console.error(e);
            return {}; }
    }

    const saveDisplayedLogIds = function (map){
        CA.Store.set(DISPLAYED_LOGIDS_KEY, map||{});
    }

    const DISPLAYED_LOGIDS = loadDisplayedLogIds();

    const getDisplayedLogIdsFor = function (uid){
        try {
            if(!uid || !DISPLAYED_LOGIDS[uid]) return [];
            return DISPLAYED_LOGIDS[uid] || [];
        } catch (e) {console.error(e);
            return []; }
    }

    const addDisplayedLogId = function (uid, logId){
        try {
            if(!uid || !logId) return;
            if(!DISPLAYED_LOGIDS[uid]) DISPLAYED_LOGIDS[uid] = [];

            // Add log_id if not already present
            if(DISPLAYED_LOGIDS[uid].indexOf(logId) === -1){
                DISPLAYED_LOGIDS[uid].push(logId);
            }

            // Keep only last N log_ids to prevent unbounded growth
            if(DISPLAYED_LOGIDS[uid].length > MAX_LOGIDS_PER_CONVERSATION){
                DISPLAYED_LOGIDS[uid] = DISPLAYED_LOGIDS[uid].slice(-MAX_LOGIDS_PER_CONVERSATION);
            }

            saveDisplayedLogIds(DISPLAYED_LOGIDS);
        } catch (e) {console.error(e);
            console.error(LOG, 'Add displayed log_id error:', e);
        }
    }

    const hasDisplayedLogId = function (uid, logId){
        try {
            if(!uid || !logId) return false;
            const displayed = getDisplayedLogIdsFor(uid);
            return displayed.indexOf(logId) !== -1;
        } catch (e) {console.error(e);
            return false; }
    }

    // Visual chip on user list items when already messaged
    const ensureSentChip = function (el, on){
        try {
            if(!el) return;
            let chip = el.querySelector('.ca-sent-chip');
            if(on){
                if(!chip){
                    isMakingOwnChanges = true;
                    chip = document.createElement('span');
                    chip.className = 'ca-sent-chip';
                    chip.textContent = '✓';
                    el.appendChild(chip);
                    setTimeout(function(){ isMakingOwnChanges = false; }, 10);
                } else {
                    chip.textContent = '✓';
                }
            } else {
                if(chip && chip.parentNode){
                    isMakingOwnChanges = true;
                    chip.parentNode.removeChild(chip);
                    setTimeout(function(){ isMakingOwnChanges = false; }, 10);
                }
            }
        } catch (e) {console.error(e);
        }
    }
    const updateSentBadges = function (){
        try {
            let c=getContainer(); if(!c) return;
            qsa('.user_item', c).forEach(function(el){
                let id=getUserId(el);
                ensureSentChip(el, !!(id && SENT_ALL[id]));
            });
        } catch (e) {console.error(e);
        }
    }
    // Resort user list so non-messaged appear first
    const resortUserList = function (){
        try {
            let c=getContainer(); if(!c) return;
            let items = qsa('.user_item', c);
            if(!items.length) return;
            const unsent=[], sent=[];
            items.forEach(function(el){
                let id=getUserId(el);
                if(id && SENT_ALL[id]) sent.push(el); else unsent.push(el);
            });
            const frag=document.createDocumentFragment();
            unsent.forEach(function(n){ frag.appendChild(n); });
            sent.forEach(function(n){ frag.appendChild(n); });
            c.appendChild(frag);
        } catch (e) {console.error(e);
        }
    }

    const isAllowedRank = function (el){
        try {
            let rankAttr = el ? (el.getAttribute('data-rank') || '') : '';
            const roomRankIcon = el ? safeQuery(el,'.list_rank') : null;
            const roomRank = roomRankIcon ? (roomRankIcon.getAttribute('data-r') || '') : '';
            return (rankAttr==='1' || rankAttr==='50') && (roomRank!=='4');
        } catch (e) {console.error(e);
            return false; }
    }
    const ensureCheckboxOn = function (el){
        try {
            if(!el || el.getAttribute('data-gender')!==FEMALE_CODE) return;
            if(qs('.ca-ck-wrap', el)) return;
            if(!isAllowedRank(el)) return;
            let id=getUserId(el); if(!id) return;
            isMakingOwnChanges = true;
            const wrap=document.createElement('label');
            wrap.className='ca-ck-wrap'; wrap.title='Include in broadcast';
            let cb=document.createElement('input'); cb.type='checkbox'; cb.className='ca-ck';
            cb.checked = !EXCLUDED[id];
            cb.addEventListener('click', function(e){ e.stopPropagation(); });
            cb.addEventListener('change', function(){
                if(cb.checked){ delete EXCLUDED[id]; } else { EXCLUDED[id]=1; }
                saveExcluded(EXCLUDED);
            });
            wrap.appendChild(cb);
            el.appendChild(wrap);
            setTimeout(function(){ isMakingOwnChanges = false; }, 10);
        } catch (e) {console.error(e);
        }
    }
    const attachCheckboxes = function (){
        try {
            let c=getContainer(); if(!c) return;
            const els=qsa('.user_item[data-gender="'+FEMALE_CODE+'"]',c);
            for(let i=0;i<els.length;i++){
                let el = els[i];
                ensureCheckboxOn(el);
                let id = getUserId(el);
                ensureSentChip(el, !!(id && SENT_ALL[id]));
            }
            resortUserList();
        } catch (e) {console.error(e);
        }
    }

    /* ---------- Panel UI ---------- */
    const appendAfterMain = function (el){
        const main=document.querySelector('#chat_right')||document.querySelector('#container_user')||document.body;
        if(main && main.parentElement) main.parentElement.appendChild(el); else document.body.appendChild(el);
    }
    const buildPanel = function (){
        let h=document.createElement('section');
        h.id='ca-panel';
        h.className='ca-panel';
        h.innerHTML=
            '<div class="ca-body">'+
            '  <div class="ca-nav">'+
            '    <button id="ca-nav-bc" class="ca-nav-btn" type="button">Broadcast</button>'+
            '    <button id="ca-log-clear" class="ca-btn ca-btn-xs" type="button">Clear</button>'+
            '  </div>'+
            '  <div class="ca-section">'+
            '    <div class="ca-section-title">'+
            '      <span>Send to specific username</span>'+
            '      <a id="ca-specific-reset" href="#" class="ca-reset-link">Reset tracking</a>'+
            '    </div>'+
            '    <div class="ca-row">'+
            '      <input id="ca-specific-username" class="ca-input-slim" type="text" placeholder="Enter username (case-insensitive)">'+
            '      <button id="ca-specific-send" class="ca-btn ca-btn-slim" type="button">Send</button>'+
            '    </div>'+
            '    <textarea id="ca-specific-msg" class="ca-8" rows="3" placeholder="Type the message..."></textarea>'+
            '  </div>'+
            '  <hr class="ca-divider">'+
            '  <div class="ca-section ca-section-compact">'+
            '    <div class="ca-section-title">'+
            '      <span>Sent Messages</span>'+
            '    </div>'+
            '    <div id="ca-log-box-sent" class="ca-log-box ca-log-box-compact" aria-live="polite" style="min-height:80px;max-height:120px;"></div>'+
            '  </div>'+
            '  <hr class="ca-divider">'+
            '  <div class="ca-section ca-section-expand" style="flex:1;display:flex;flex-direction:column;min-height:0;">'+
            '    <div class="ca-section-title">'+
            '      <span>Received Messages</span>'+
            '    </div>'+
            '    <div id="ca-log-box-received" class="ca-log-box ca-log-box-expand" aria-live="polite" style="flex:1;min-height:0;">'+
            '      <div class="ca-log-subsection-unreplied-wrapper">'+
            '        <div class="ca-log-subsection-header">Not Replied</div>'+
            '        <div id="ca-log-received-unreplied"></div>'+
            '      </div>'+
            '      <div class="ca-log-subsection-replied-wrapper">'+
            '        <div class="ca-log-subsection-header">Replied</div>'+
            '        <div id="ca-log-received-replied"></div>'+
            '      </div>'+
            '    </div>'+
            '  </div>'+
            '  <div class="ca-section ca-log-section">'+
            '    <hr class="ca-divider">'+
            '    <div class="ca-section-title">'+
            '      <span>Logon/Logoff</span>'+
            '    </div>'+
            '    <div id="ca-log-box-presence" class="ca-log-box" aria-live="polite"></div>'+
            '  </div>'+
            '</div>';
        appendAfterMain(h);
        return h;
    }
    // Popup for Broadcast
    const createBroadcastPopup = function (){
        let pop=document.getElementById('ca-bc-pop');
        if(pop) return pop;
        pop=document.createElement('div');
        pop.id='ca-bc-pop';
        pop.className='ca-pop';
        pop.innerHTML=
            '<div id="ca-bc-pop-header" class="ca-pop-header">'+
            '  <span>Broadcast</span>'+
            '  <button id="ca-bc-pop-close" class="ca-pop-close" type="button">✕</button>'+
            '</div>'+
            '<div class="ca-pop-body">'+
            '  <textarea id="ca-bc-msg" class="ca-8" rows="5" placeholder="Type the broadcast message..."></textarea>'+
            '  <div class="ca-controls" style="margin-top:4px;">'+
            '    <span id="ca-bc-status" class="ca-status"></span>'+
            '    <a id="ca-bc-reset" href="#" class="ca-reset-link" style="margin-left:auto">Reset tracking</a>'+
            '  </div>'+
            '  <div class="ca-pop-actions">'+
            '    <button id="ca-bc-send" class="ca-btn ca-btn-slim" type="button">Send</button>'+
            '  </div>'+
            '</div>';
        document.body.appendChild(pop);
        // close
        const closeBtn=pop.querySelector('#ca-bc-pop-close');
        if(closeBtn){ closeBtn.addEventListener('click', function(){ pop.style.display='none'; }); }
        // drag
        const hdr=pop.querySelector('#ca-bc-pop-header'); let ox=0, oy=0, sx=0, sy=0;
        function mm(e){ const dx=e.clientX-sx, dy=e.clientY-sy; pop.style.left=(ox+dx)+'px'; pop.style.top=(oy+dy)+'px'; pop.style.transform='none'; }
        function mu(){ document.removeEventListener('mousemove',mm); document.removeEventListener('mouseup',mu); }
        if(hdr){ hdr.addEventListener('mousedown', function(e){ sx=e.clientX; sy=e.clientY; const r=pop.getBoundingClientRect(); ox=r.left; oy=r.top; document.addEventListener('mousemove',mm); document.addEventListener('mouseup',mu); }); }
        return pop;
    }
    const openBroadcast = function (){
        const pop=createBroadcastPopup();
        if(pop){ pop.style.display='block'; if(!openBroadcast._wired){ wireBroadcastControls(); openBroadcast._wired=true; } }
    }
    const wireBroadcastControls = function (){
        // rebind refs and handlers for broadcast controls inside popup
        $bMsg = qs('#ca-bc-msg'); $bSend = qs('#ca-bc-send'); $bReset = qs('#ca-bc-reset'); $bStat = qs('#ca-bc-status');
        if($bReset && !$bReset._wired){ $bReset._wired=true; $bReset.addEventListener('click', function(e){ e.preventDefault(); resetForText($bMsg?$bMsg.value:'',$bStat); }); }
        if($bSend && !$bSend._wired){
            $bSend._wired=true;
            $bSend.addEventListener('click', function(){
                (function(){
                    let text=trim($bMsg?$bMsg.value:''); if(!text){ if($bStat) $bStat.textContent='Type the message first.'; return; }
                    let list=buildBroadcastList();
                    let sent=loadSentAll();
                    let to=[], i; for(i=0;i<list.length;i++){ if(!sent[list[i].id]) to.push(list[i]); }
                    if(!to.length){ if($bStat) $bStat.textContent='No new recipients for this message (after exclusions/rank filter).'; return; }
                    $bSend.disabled=true;
                    let ok=0,fail=0,B=10,T=Math.ceil(to.length/B);
                    function runBatch(bi){
                        if(bi>=T){ if($bStat) $bStat.textContent='Done. Success: '+ok+', Failed: '+fail+'.'; $bSend.disabled=false; return; }
                        let start=bi*B, batch=to.slice(start,start+B), idx=0;
                        if($bStat) $bStat.textContent='Batch '+(bi+1)+'/'+T+' — sending '+batch.length+'... (OK:'+ok+' Fail:'+fail+')';
                        function one(){
                            if(idx>=batch.length){ if(bi<T-1){ let wait=randBetween(10000,20000); if($bStat) $bStat.textContent='Batch '+(bi+1)+'/'+T+' done — waiting '+Math.round(wait/1000)+'s...'; sleep(wait).then(function(){ runBatch(bi+1); }); } else { runBatch(bi+1); } return; }
                            let item=batch[idx++], uname=item.name||item.id, av=extractAvatar(item.el);
                            sendWithThrottle(item.id,text).then(function(r){
                                if(r && r.ok){
                                    ok++; sent[item.id]=1;
                                } else { fail++; logSendFail(uname, item.id, av, r?r.status:0, text); }
                                if($bStat) $bStat.textContent='Batch '+(bi+1)+'/'+T+' — '+idx+'/'+batch.length+' sent (OK:'+ok+' Fail:'+fail+')';
                                return sleep(randBetween(2000,5000));
                            }).then(one)['catch'](function(){
                                fail++; logSendFail(uname, item.id, av, 'ERR', text);
                                return sleep(randBetween(2000,5000)).then(one);
                            });
                        }
                        one();
                    }
                    runBatch(0);
                })();
            });
        }
    }

    buildPanel();

    /* Refs */
    const $sUser=qs('#ca-specific-username'), $sMsg=qs('#ca-specific-msg'), $sSend=qs('#ca-specific-send'), $sStat=qs('#ca-specific-status'), $sReset=qs('#ca-specific-reset');
    let $bMsg=qs('#ca-bc-msg'), $bSend=qs('#ca-bc-send'), $bStat=qs('#ca-bc-status'), $bReset=qs('#ca-bc-reset');
    const $logBoxSent=qs('#ca-log-box-sent'), $logBoxReceived=qs('#ca-log-box-received'), $logBoxPresence=qs('#ca-log-box-presence'), $logClear=qs('#ca-log-clear');
    const $navBc=qs('#ca-nav-bc');
    if($navBc){ $navBc.addEventListener('click', function(){ openBroadcast(); }); }

    /* ---------- Activity Log ---------- */
    const LOG_MAX=200;
    const LOG_STORE_KEY='321chataddons.activityLog.v1';
    // Replace the whole function
    const renderLogEntry = function (targetBox, ts, kind, details, userId){
        if(!targetBox) return;

        // 1) Decode any HTML entities so rich content (emoticons/img) renders
        const detailsHTML = decodeHTMLEntities(String(details || ''));

        // 2) If this is a received private message and we didn't get a userId,
        //    extract it from the details markup (works for restore *and* live).
        if(kind === 'pv'){
            try {
                if(!userId){
                    let tmp = document.createElement('div');
                    tmp.innerHTML = detailsHTML;
                    const link = tmp.querySelector('.ca-user-link');
                    if(link) userId = link.getAttribute('data-uid') || null;
                }
            } catch (e) {console.error(e);
                /* ignore */ }
        }

        // 3) Route pv to "Not Replied" vs "Replied" subsection (now centralized here)
        if(kind === 'pv' && targetBox.id === 'ca-log-box-received'){
            let hasReplied = false;

            if (REPLIED_CONVOS[userId]) {
                const repliedTime = parseLogDateToNumber(REPLIED_CONVOS[userId]); // numeric timestamp for replied datetime
                const msgTime = parseLogDateToNumber(ts); // numeric timestamp for this message

                // only mark as replied if repliedTime is *set* and strictly newer than message time
                if (repliedTime && msgTime && repliedTime > msgTime) {
                    hasReplied = true;
                }
            }
            const subTarget = hasReplied
                ? document.getElementById('ca-log-received-replied')
                : document.getElementById('ca-log-received-unreplied');
            if(subTarget) targetBox = subTarget;
        }

        // 4) Build the entry (using innerHTML for the details span to render HTML)
        const klass = 'ca-log-' + kind;
        const isSentMessage = (kind === 'send-ok' || kind === 'send-fail');

        const wrapper = document.createElement('div');
        wrapper.className = 'ca-log-entry ' + klass;

        const tsEl = document.createElement('span');
        tsEl.className = 'ca-log-ts';
        tsEl.textContent = ts.split(' ')[1] || ts;

        const dot = document.createElement('span');
        dot.className = 'ca-log-dot';

        let text = document.createElement('span');
        text.className = 'ca-log-text';
        text.innerHTML = detailsHTML; // ← render HTML for ALL kinds

        wrapper.appendChild(tsEl);
        wrapper.appendChild(dot);

        if(isSentMessage){
            const exp = document.createElement('span');
            exp.className = 'ca-expand-indicator';
            exp.title = 'Click to expand/collapse';
            exp.textContent = '▾';
            wrapper.appendChild(exp);
        }

        wrapper.appendChild(text);

        // Append to end so newest appears at bottom (matches existing behavior)
        targetBox.prepend(wrapper);


        // 5) Post-decorate with reply/DM/badge — this already works for all kinds
        try {
            let a = wrapper.querySelector('.ca-user-link');
            if(!a) return;
            let uid = a.getAttribute('data-uid')||'';
            let name = a.getAttribute('data-name')||'';
            let avatar = a.getAttribute('data-avatar')||'';
            if(!uid) return;

            if(kind === 'pv'){
                let hasReplied2 = false;

                if (REPLIED_CONVOS[userId]) {
                    const repliedTime = parseLogDateToNumber(REPLIED_CONVOS[userId]); // numeric timestamp for replied datetime
                    const msgTime = parseLogDateToNumber(ts); // numeric timestamp for this message

                    // only mark as replied if repliedTime is *set* and strictly newer than message time
                    if (repliedTime && msgTime && repliedTime > msgTime) {
                        hasReplied2 = true;
                    }
                }
                const afterDot = wrapper.querySelector('.ca-log-dot');

                if(hasReplied2){
                    const mark = document.createElement('a');
                    mark.className = 'ca-replied-mark';
                    mark.setAttribute('data-reply','1');
                    mark.setAttribute('data-uid', uid);
                    mark.setAttribute('data-name', name);

                    mark.setAttribute('data-avatar', avatar);
                    mark.href = '#';
                    mark.textContent = '✓';
                    mark.title = 'Replied - Click to open chat';
                    if(afterDot && afterDot.nextSibling){
                        wrapper.insertBefore(mark, afterDot.nextSibling);
                    }
                } else {
                    const replyIcon = document.createElement('a');
                    replyIcon.className = 'ca-reply-icon';
                    replyIcon.setAttribute('data-reply','1');
                    replyIcon.setAttribute('data-uid', uid);
                    replyIcon.setAttribute('data-name', name);
                    replyIcon.setAttribute('data-avatar', avatar);
                    replyIcon.href = '#';
                    replyIcon.textContent = '↩';
                    replyIcon.title =`Reply to ${name}`;
                    if(afterDot && afterDot.nextSibling){
                        wrapper.insertBefore(replyIcon, afterDot.nextSibling);
                    }
                }
            }

            let dm = document.createElement('a');
            dm.className = 'ca-dm-link ca-dm-right';
            dm.setAttribute('data-dm','1');
            dm.setAttribute('data-uid', uid);
            dm.setAttribute('data-name', name);
            dm.setAttribute('data-avatar', avatar);
            dm.href = '#';
            dm.textContent = 'dm';
            wrapper.appendChild(dm);

            if(typeof SENT_ALL==='object' && SENT_ALL && SENT_ALL[uid]){
                const badge = document.createElement('span');
                badge.className = 'ca-badge-sent';
                badge.title = 'Already messaged';
                badge.textContent = '✓';
                wrapper.appendChild(badge);
            }
        } catch (e) {console.error(e);
            /* ignore */ }
    }

    const saveLogEntry = function (ts, kind, details){
        // Do not persist presence events on disk
        if (kind === 'login' || kind === 'logout') return;
        let arr=[];
        try { let raw=CA.Store.get(LOG_STORE_KEY); if(raw) arr=raw||[]; } catch (e) {console.error(e);
        }
        arr.unshift({ts:ts, kind:kind, details:details});
        if(arr.length>LOG_MAX) arr=arr.slice(0,LOG_MAX);
        CA.Store.set(LOG_STORE_KEY, arr);
    }


    const restoreLog = function (){
        if(!$logBoxSent || !$logBoxReceived || !$logBoxPresence) return;
        let arr=[];
        try { const raw=CA.Store.get(LOG_STORE_KEY); if(raw) arr=raw||[]; } catch (e) {console.error(e);
        }
        $logBoxSent.innerHTML='';


        // Rebuild received box with subsections
        $logBoxReceived.innerHTML =
            '<div class="ca-log-subsection-unreplied-wrapper">'+
            '  <div class="ca-log-subsection-header">Not Replied</div>'+
            '  <div id="ca-log-received-unreplied"></div>'+
            '</div>'+
            '<div class="ca-log-subsection-replied-wrapper">'+
            '  <div class="ca-log-subsection-header">Replied</div>'+
            '  <div id="ca-log-received-replied"></div>'+
            '</div>';

        // $logBoxPresence.innerHTML='';

        // In restoreLog(), inside the loop:
        for(let i=arr.length-1; i>=0; i--){
            const e=arr[i];
            if(!e || !e.kind) continue;
            if(e.kind==='send-ok' || e.kind==='send-fail'){
                renderLogEntry($logBoxSent, e.ts, e.kind, e.details||'');
            } else if(e.kind==='pv'){
                // OLD code that parsed userId can be removed.
                // Just call renderLogEntry; it will decode + route + decorate itself.
                renderLogEntry($logBoxReceived, e.ts, e.kind, e.details||'');
            } else if(e.kind==='login' || e.kind==='logout'){
                renderLogEntry($logBoxPresence, e.ts, e.kind, e.details||'');
            }
        }
    }
    const trimLogBoxToMax = function (targetBox){
        try {
            if(!targetBox || !targetBox.children) return;
            // Create a static array copy to avoid live HTMLCollection issues
            const kids = Array.prototype.slice.call(targetBox.children);
            if(kids.length <= LOG_MAX) return;
            // Remove oldest entries from the beginning (oldest messages are at the start)
            const toRemove = kids.length - LOG_MAX;
            for(let i = 0; i < toRemove; i++){
                try {
                    if(kids[i] && kids[i].parentNode){
                        kids[i].parentNode.removeChild(kids[i]);
                    }
                } catch (e) {console.error(e);
                    console.error(LOG, 'Remove log entry error:', e);
                }
            }
        } catch (e) {console.error(e);
            console.error(LOG, 'Trim log error:', e);
        }
    }
    const logLine = function (kind, details, userId){
        const ts= getTimeStampInWebsiteFormat();
        const target = (kind==='send-ok' || kind==='send-fail') ? $logBoxSent
            : (kind==='pv') ? $logBoxReceived
                : (kind==='login' || kind==='logout') ? $logBoxPresence
                    : null;
        if(!target) return;
        renderLogEntry(target, ts, kind, details, userId);
        trimLogBoxToMax(target);
        // Always auto-scroll to bottom when new entry is added (use RAF for reliability)
        requestAnimationFrame(function(){
            if(target) target.scrollTop = target.scrollHeight;
        });
        // Save all log types to localStorage for persistence across page reloads
        saveLogEntry(ts, kind, details);
    }
    const nameAndDmHtml = function (username, uid, avatar){
        return '<a href="#" class="ca-user-link" title="Open profile" data-uid="'+escapeHTML(String(uid||''))+'" data-name="'+escapeHTML(String(username||''))+'" data-avatar="'+escapeHTML(String(avatar||''))+'"><strong>'+escapeHTML(username||'?')+'</strong></a>';
    }
    const logSendOK = function (username, uid, avatar, text){
        logLine('send-ok', nameAndDmHtml(username, uid, avatar)+' — “'+text+'”');
    }
    const logSendFail = function (username, uid, avatar, status, text){
        logLine('send-fail', nameAndDmHtml(username, uid, avatar)+' — failed ('+String(status||0)+') — “'+text+'”');
    }
    // Throttle presence logging to prevent duplicates
    const lastPresenceLog = {}; // uid -> timestamp
    const PRESENCE_LOG_THROTTLE = 5000; // 5 seconds

    const logLogin = function (username, uid, avatar){
        let now = Date.now();
        let key =`login_${uid}`;
        if(lastPresenceLog[key] && (now - lastPresenceLog[key]) < PRESENCE_LOG_THROTTLE){
            return; // Skip - logged too recently
        }
        lastPresenceLog[key] = now;
        logLine('login', nameAndDmHtml(username, uid, avatar)+' logged on');
    }
    const logLogout = function (username, uid, avatar){
        let now = Date.now();
        const key =`logout_${uid}`;
        if(lastPresenceLog[key] && (now - lastPresenceLog[key]) < PRESENCE_LOG_THROTTLE){
            return; // Skip - logged too recently
        }
        lastPresenceLog[key] = now;
        logLine('logout', nameAndDmHtml(username, uid, avatar)+' logged off');
    }
    if($logClear){
        $logClear.addEventListener('click', function(){
            if($logBoxSent) $logBoxSent.innerHTML='';
            if($logBoxReceived) $logBoxReceived.innerHTML='';
            if($logBoxPresence) $logBoxPresence.innerHTML='';
            try {CA.Store.remove(LOG_STORE_KEY);} catch (e) {console.error(e);
            }
        });
    }
    // Apply restored preferences now
    restoreLog();

    // Fallback profile URL builder (only used if site function is not present)
    const buildProfileUrlForId = function (uid){
        try {
            if(!uid) return '';
            const sel = `a[href*="profile"][href*="${uid}"], a[href*="user"][href*="${uid}"]`;
            const found = document.querySelector(sel);
            if(found && found.href) return found.href;
            const fallbacks = [
                '/profile/'+uid,
                '/user/'+uid,
                '/system/profile.php?uid='+uid
            ];
            return fallbacks[0];
        } catch (e) {console.error(e);
            return ''; }
    }
    const attachLogClickHandlers = function (box){
        if(!box) return;
        box.addEventListener('click', function(e){
            // Reply icon - open chat like DM link
            let reply = e.target && e.target.closest ? e.target.closest('a[data-reply="1"]') : null;
            if(reply){
                e.preventDefault();
                const rUid = reply.getAttribute('data-uid')||'';
                const rName = reply.getAttribute('data-name')||'';
                // Get avatar from the user link if available
                let rAvatar = '';
                try {
                    let entry = reply.closest('.ca-log-entry');
                    if(entry){
                        const userLink = entry.querySelector('.ca-user-link');
                        if(userLink){
                            rAvatar = userLink.getAttribute('data-avatar')||'';
                        }
                    }
                } catch (err) {console.error(err);
                }
                if (rAvatar && !rAvatar.startsWith('avatar/')) {
                    rAvatar = 'avatar/' + rAvatar;
                }
                let openDm = (typeof window.openPrivate==='function') ? window.openPrivate
                    : (window.parent && typeof window.parent.openPrivate==='function') ? window.parent.openPrivate
                        : null;
                if(openDm){
                    morePriv = 0;
                    closeList();
                    hideModal();
                    hideOver();
                    privReload = 1;
                    lastPriv = 0;
                    try {
                        const rUidNum = /^\d+$/.test(rUid) ? parseInt(rUid,10) : rUid;
                        openDm(rUidNum, rName, `${rAvatar}`);
                    } catch (err) {console.error(err);
                        console.error(LOG, 'Error opening private chat:', err);
                        openDm(rUid, rName, `${rAvatar}`);
                    }
                }
                return;
            }
            // DM link
            let dm = e.target && e.target.closest ? e.target.closest('a[data-dm="1"]') : null;
            if(dm){
                e.preventDefault();
                const dUid = dm.getAttribute('data-uid')||'';
                const dName = dm.getAttribute('data-name')||'';
                let dAvatar = dm.getAttribute('data-avatar')||'';
                if (dAvatar && !dAvatar.startsWith('avatar/')) {
                    dAvatar = 'avatar/' + dAvatar;
                }
                const openDm = (typeof window.openPrivate==='function') ? window.openPrivate
                    : (window.parent && typeof window.parent.openPrivate==='function') ? window.parent.openPrivate
                        : null;
                if(openDm){
                    morePriv = 0;
                    closeList();
                    hideModal();
                    hideOver();
                    privReload = 1;
                    lastPriv = 0;
                    try {
                        const dUidNum = /^\d+$/.test(dUid) ? parseInt(dUid,10) : dUid;
                        openDm(dUidNum, dName, `${dAvatar}`);
                    } catch (err) {console.error(err);
                        console.error(LOG, 'Error opening private chat:', err);
                    }
                }
                return;
            }
            // Username link opens profile via site function
            const a = e.target && e.target.closest ? e.target.closest('a[data-uid]') : null;
            if(a){
                e.preventDefault();
                let uid = a.getAttribute('data-uid')||'';
                const getProf = (typeof window.getProfile==='function') ? window.getProfile
                    : (window.parent && typeof window.parent.getProfile==='function') ? window.parent.getProfile
                        : null;
                if(getProf){
                    try {
                        const uidNum = /^\d+$/.test(uid) ? parseInt(uid,10) : uid;
                        getProf(uidNum);
                    } catch (err) {console.error(err);
                        getProf(uid);
                    }
                } else {
                    let url = buildProfileUrlForId(uid);
                    if(url){ window.open(url, '_blank'); }
                }
            }
        });
    }
    attachLogClickHandlers($logBoxSent);
    attachLogClickHandlers($logBoxReceived);
    attachLogClickHandlers($logBoxPresence);

    // Add expand/collapse handler for sent messages
    if($logBoxSent){
        $logBoxSent.addEventListener('click', function(e){
            try {
                // Check if clicked on expand indicator or message text in a sent message
                const entry = e.target.closest('.ca-log-send-ok, .ca-log-send-fail');
                if(!entry) return;

                const isExpandBtn = e.target.classList.contains('ca-expand-indicator');
                const isMessageText = e.target.classList.contains('ca-log-text');

                if(isExpandBtn || isMessageText){
                    e.stopPropagation();
                    entry.classList.toggle('ca-expanded');

                    // Update indicator arrow
                    const indicator = entry.querySelector('.ca-expand-indicator');
                    if(indicator){
                        indicator.textContent = entry.classList.contains('ca-expanded') ? '▴' : '▾';
                    }
                }
            } catch (err) {console.error(err);
                console.error(LOG, 'Expand/collapse error:', err);
            }
        });
    }

    // --- Usage ---
    CA.Drafts.bindInput($sMsg, CA.Const.STORAGE_KEYS.draftSpecific);
    CA.Drafts.bindInput($bMsg, CA.Const.STORAGE_KEYS.draftBroadcast);

    /* Build recipients */
    const buildSpecificListAsync = function (){
        return new Promise(async function (resolve) {
            if (!$sUser) {
                resolve([]);
                return;
            }
            let q = trim($sUser.value || '');
            if (!q) {
                resolve([]);
                return;
            }
            return  await findFemaleByUsername(q);
        });
    }
    const buildBroadcastList = function (){
        let list = collectFemaleIds(), out=[], i, id, el, include;
        for(i=0;i<list.length;i++){
            el=list[i].el; id=list[i].id;
            if(!isAllowedRank(el)) continue;
            if(SENT_ALL && SENT_ALL[id]) continue; // skip users already messaged globally
            const cb = el ? qs('.ca-ck', el) : null;
            include = cb ? cb.checked : !EXCLUDED[id];
            if(include) out.push(list[i]);
        }
        return out;
    }

    /* Reset tracking (per message) */
    const resetForText = function (text, statEl){
        let t=trim(text); if(!t) return false;
        let h=hashMessage(t); CA.Store.remove(keyForHash(h)); setLast(h);
        if(statEl) statEl.textContent='Cleared sent-tracking for this message.';
        return true;
    }
    if($sReset){ $sReset.addEventListener('click',function(e){ e.preventDefault(); resetForText($sMsg?$sMsg.value:'',$sStat); }); }
    if($bReset){ $bReset.addEventListener('click',function(e){ e.preventDefault(); resetForText($bMsg?$bMsg.value:'',$bStat); }); }

    /* Global throttle */
    let lastSendAt = 0;
    const sendWithThrottle = function (id, text, minGapMs){
        if(minGapMs===void 0) minGapMs = 3500;
        let now=Date.now(); let wait = Math.max(0, minGapMs - (now - lastSendAt));
        return sleep(wait).then(function(){
            return sendPrivateMessage(id, text).then(function(r){
                lastSendAt = Date.now();
                return r;
            });
        });
    }

    /* Specific: send */
    if($sSend){ $sSend.addEventListener('click',function(){
        (function(){
            let text=trim($sMsg?$sMsg.value:'');
            if(!text){ if($sStat) $sStat.textContent='Type a message first.'; return; }
            if(!$sUser || !trim($sUser.value)){ if($sStat) $sStat.textContent='Enter a username.'; return; }
            let h=hashMessage(text), last=getLast(); if(h!==last) setLast(h);
            buildSpecificListAsync().then(function(list){
                if(!list.length){ if($sStat) $sStat.textContent='User not found (female).'; return; }
                const sentMap=loadSentAll();
                let item=list[0];
                if(sentMap[item.id]){ if($sStat) $sStat.textContent='Already sent to '+(item.name||item.id)+'. Change text to resend.'; return; }
                $sSend.disabled=true;
                sendWithThrottle(item.id,text).then(function(r){
                    if(r && r.ok){
                        if($sStat) $sStat.textContent='Sent to '+(item.name||item.id)+'.';
                    } else {
                        if($sStat) $sStat.textContent='Failed (HTTP '+(r?r.status:0)+').';
                    }
                })['catch'](function(){
                    if($sStat) $sStat.textContent='Error sending.'; logSendFail(item.name||item.id, item.id, '', 'ERR', text);
                }).then(function(){ $sSend.disabled=false; });
            });
        })();
    }); }

    /* Broadcast: send (batched, honors checkboxes & rank) */
    if($bSend){ $bSend.addEventListener('click',function(){
        (function(){
            const text=trim($bMsg?$bMsg.value:''); if(!text){ if($bStat) $bStat.textContent='Type the message first.'; return; }
            let list=buildBroadcastList();
            const sent=loadSentAll();
            let to=[], i; for(i=0; i<list.length; i++){ if(!sent[list[i].id]) to.push(list[i]); }
            if(!to.length){ if($bStat) $bStat.textContent='No new recipients for this message (after exclusions/rank filter).'; return; }
            $bSend.disabled=true;
            let ok=0,fail=0,B=10,T=Math.ceil(to.length/B);

            function runBatch(bi){
                if(bi>=T){
                    if($bStat) $bStat.textContent='Done. Success: '+ok+', Failed: '+fail+'.';
                    $bSend.disabled=false;
                    return;
                }
                let start=bi*B, batch=to.slice(start,start+B), idx=0;
                if($bStat) $bStat.textContent='Batch '+(bi+1)+'/'+T+' — sending '+batch.length+'... (OK:'+ok+' Fail:'+fail+')';
                function one(){
                    if(idx>=batch.length){
                        if(bi<T-1){
                            const wait=randBetween(10000,20000);
                            if($bStat) $bStat.textContent='Batch '+(bi+1)+'/'+T+' done — waiting '+Math.round(wait/1000)+'s...';
                            sleep(wait).then(function(){ runBatch(bi+1); });
                        } else {
                            runBatch(bi+1);
                        }
                        return;
                    }
                    const item=batch[idx++], uname=item.name||item.id, av=extractAvatar(item.el);
                    sendWithThrottle(item.id,text).then(function(r){
                        if(r && r.ok){
                            ok++; sent[item.id]=1;
                        }
                        if($bStat) $bStat.textContent='Batch '+(bi+1)+'/'+T+' — '+idx+'/'+batch.length+' sent (OK:'+ok+' Fail:'+fail+')';
                        return sleep(randBetween(2000,5000));
                    }).then(one)['catch'](function(){
                        fail++; logSendFail(uname, item.id, av, 'ERR', text);
                        return sleep(randBetween(2000,5000)).then(one);
                    });
                }
                one();
            }
            runBatch(0);
        })();
    }); }

    /* Click a user: fill specific username */
    const wireUserClickSelection = function (){
        try {
            let c=getContainer(); if(!c)return;
            if(c.getAttribute('data-ca-wired')==='1')return;
            c.addEventListener('click',function(e){
                try {
                    // Ignore clicks on interactive controls and our own badges/checkboxes
                    const ignore = e.target.closest('a, button, input, label, .ca-ck-wrap, .ca-ck, .ca-sent-chip');
                    if(ignore) return;
                    let n=e.target;
                    while(n&&n!==c&&!(n.classList&&n.classList.contains('user_item'))) n=n.parentNode;
                    if(!n||n===c)return;
                    let nm=extractUsername(n); if(!nm) return;
                    const inp=qs('#ca-specific-username');
                    if (inp) {
                        inp.value = nm;
                        const ev = new Event('input', { bubbles: true, cancelable: true });
                        inp.dispatchEvent(ev);
                    }
                } catch (e) {console.error(e);
                    console.error(e)}
            }, false); // bubble to avoid fighting site handlers
            c.setAttribute('data-ca-wired','1');
        } catch (e) {console.error(e);
        }
    }

    /* ---------- Login/Logout logging ---------- */
    const currentFemales = new Map(); // id -> name
    let isMakingOwnChanges = false; // Flag to prevent observer loops
    const scanCurrentFemales = function (){
        currentFemales.clear();
        collectFemaleIds().forEach(function(it){
            currentFemales.set(it.id, it.name||'');
            // Also populate user map
            CA.CapturedUsers.set(it.id, it.name, extractAvatar(it.el));
        });
    }
    let didInitialLog = false;

    const PRESENCE_ARM_DELAY_MS = 4000;
    let presenceArmed = false;
    const runInitialLogWhenReady = function (maxTries){
        if(maxTries==null) maxTries = 20; // ~2s max
        let c=getContainer();
        const ready = !!c && qsa('.user_item[data-gender="'+FEMALE_CODE+'"]', c).length>0;
        if(ready){
            // Silently populate currentFemales map with existing users (no logging)
            scanCurrentFemales();
            // Prep UI
            pruneNonFemale(); attachCheckboxes(); wireUserClickSelection();
            didInitialLog = true;

            setTimeout(function(){ presenceArmed = true; }, PRESENCE_ARM_DELAY_MS);
            return;
        }
        if(maxTries<=0){
            // No items appeared; just finish without initial presence log
            didInitialLog = true;
            return;
        }
        setTimeout(function(){ runInitialLogWhenReady(maxTries-1); }, 100);
    }


    const handleAddedNode = function (n){
        let items;
        if (safeMatches(n,'.user_item[data-gender="'+FEMALE_CODE+'"]')) items=[n];
        else items=qsa('.user_item[data-gender="'+FEMALE_CODE+'"]', n);
        if(!items.length) return;
        items.forEach(function(el){
            let id=getUserId(el); if(!id) return;
            const wasPresent = currentFemales.has(id);
            let nm=extractUsername(el)||id;
            let av=extractAvatar(el);

            // Update user map with latest info
            CA.CapturedUsers.set(id, nm, av);

            if(!wasPresent){
                // New user appeared
                currentFemales.set(id, nm);
                // Only log login if initial scan is complete AND this is truly a new appearance
                // (not just a delayed initial scan item)
                if (didInitialLog && presenceArmed) {
                    console.log(LOG, 'New user appeared:', nm, '(ID:', id, ')');
                    logLogin(nm, id, av);
                }
            } else {
                // User already tracked, just update name if changed (no logging)
                currentFemales.set(id, nm);
            }

            // Chip if already messaged
            ensureSentChip(el, !!(SENT_ALL && SENT_ALL[id]));
        });
    }

    const handleRemovedNode = function (n){
        let items;
        if (safeMatches(n,'.user_item')) items=[n];
        else items=qsa('.user_item', n);
        if(!items.length) return;
        items.forEach(function(el){
            let id=getUserId(el); if(!id) return;
            const isFemale = (el.getAttribute && el.getAttribute('data-gender')===FEMALE_CODE);
            if(isFemale && currentFemales.has(id)){
                const nm=currentFemales.get(id)||id;
                currentFemales.delete(id);
                if (didInitialLog && presenceArmed) { logLogout(nm, id, extractAvatar(el)); }
            }
        });
    }

    /* ---------- Observer: prune + checkboxes + selection + login/out ---------- */
    const startObserver = function (){
        const c=getContainer();
        if(!c){
            const iv=setInterval(function(){
                const cc=getContainer();
                if(cc){
                    clearInterval(iv);
                    startObserver();
                    runInitialLogWhenReady(); // NEW: kick off initial logging as soon as container exists
                }
            },250);
            return;
        }

        const mo=new MutationObserver(function(recs){
            try {
                // Skip if we're making our own changes
                if(isMakingOwnChanges || isPruning) return;

                let hasRelevantChanges = false;
                const processedUsers = new Set(); // Prevent duplicate processing

                recs.forEach(function(r){
                    // Skip changes from our own panel
                    if(r.target && r.target.closest && r.target.closest('#ca-panel')) return;

                    if(r.addedNodes && r.addedNodes.length){
                        for(let i=0;i<r.addedNodes.length;i++){
                            let node = r.addedNodes[i];
                            // Skip our own elements (chips, checkboxes, etc.)
                            if(node.nodeType === 1){
                                if(node.closest && node.closest('#ca-panel')) continue;
                                if(node.classList && (node.classList.contains('ca-sent-chip') || node.classList.contains('ca-ck-wrap'))) continue;
                            }
                            // Only process if it's a user_item or contains user_items
                            if(safeMatches(node, '.user_item') || safeQuery(node, '.user_item')){
                                handleAddedNode(node);
                                hasRelevantChanges = true;
                            }
                        }
                    }
                    if(r.removedNodes && r.removedNodes.length){
                        for(let j=0;j<r.removedNodes.length;j++){
                            const node = r.removedNodes[j];
                            // Skip our own elements
                            if(node.nodeType === 1){
                                if(node.closest && node.closest('#ca-panel')) continue;
                                if(node.classList && (node.classList.contains('ca-sent-chip') || node.classList.contains('ca-ck-wrap'))) continue;
                            }
                            // Only process if it's a user_item or contains user_items
                            if(safeMatches(node, '.user_item') || safeQuery(node, '.user_item')){
                                handleRemovedNode(node);
                                hasRelevantChanges = true;
                            }
                        }
                    }
                    // React to attribute changes on existing user items (e.g., gender/rank toggles)
                    // But NOT changes to our own chips/checkboxes
                    if(r.type==='attributes' && r.target && safeMatches(r.target,'.user_item')){
                        // Only process if it's a relevant attribute
                        if(r.attributeName === 'data-gender' || r.attributeName === 'data-rank'){
                            const uid = getUserId(r.target);
                            if(uid && !processedUsers.has(uid)){
                                processedUsers.add(uid);
                                handleAddedNode(r.target);
                                hasRelevantChanges = true;
                            }
                        }
                    }
                });

                if(!hasRelevantChanges) return;

                // Schedule UI updates
                schedule(function(){
                    try {
                        isMakingOwnChanges = true;
                        pruneNonFemale();
                        attachCheckboxes();
                        wireUserClickSelection();
                        updateSentBadges();
                        resortUserList();
                        setTimeout(function(){ isMakingOwnChanges = false; }, 50);
                    } catch (e) {console.error(e);
                        isMakingOwnChanges = false;
                    }
                });
            } catch (e) {console.error(e);
                console.error(LOG, 'Observer error:', e);
            }
        });
        mo.observe(c,{childList:true,subtree:true,attributes:true,attributeFilter:['data-gender','data-rank']});

        // NEW: initial log pass (once)
        runInitialLogWhenReady();

        const ro=new MutationObserver(()=>{
            const nc=getContainer();
            if(nc && nc!==c){
                mo.disconnect(); ro.disconnect();
                scanCurrentFemales(); // rebuild map without logging
                pruneNonFemale(); attachCheckboxes(); wireUserClickSelection();
                startObserver(); // re-arm on new container
            }
        });
        ro.observe(document.body,{childList:true,subtree:true});
    }
    startObserver();

    /* === Intercept site poll to chat_log.php and reuse its private payload === */
    (function setupCAChatTap(){
        function isChatLogUrl(u){
            try {
                if(!u) return false;
                let s = String(u);
                try {
                    // Normalize to an absolute URL and compare path
                    s = new URL(s, location.origin).pathname;
                } catch (e) {console.error(e);
                    console.error(e)}
                return s.indexOf('system/action/chat_log.php') !== -1;
            } catch (e) {console.error(e);
                return false;
            }
        }

        // Capture and reuse site chat parameters for our own private chat_log calls
        CHAT_CTX = CHAT_CTX || { caction:'', last:'', lastp: '', room:'', notify:'', curset:'', pcount: 0 };
        function caUpdateChatCtxFromBody(bodyLike, urlMaybe){
            try {
                // Only initialize once per page load
                if (caUpdateChatCtxFromBody._initialized) return;

                let qs = normalizeBodyToQuery(bodyLike);
                if(!qs && typeof urlMaybe === 'string'){
                    try {
                        const u = new URL(urlMaybe, location.origin);
                        qs = u.search ? u.search.replace(/^\?/, '') : '';
                    } catch (e) {console.error(e);
                        console.error(e)}
                }
                if(!qs){
                    console.warn(LOG, 'No parameters found from chat_log.php call.');
                    return;
                }
                // Do not initialize from our own private chat requests
                if(qs.indexOf('priv=1') !== -1) return;

                let p = new URLSearchParams(qs);
                const ca = p.get('caction'), lp = p.get('lastp'),la = p.get('last'), rm = p.get('room'), nf = p.get('notify'), cs = p.get('curset'), pc = p.get('pcount');

                // Set only values that are not yet set
                if(ca){ CHAT_CTX.caction = String(ca) }

                if(lp)   { CHAT_CTX.lastp    = String(lp) }
                if(rm)   { CHAT_CTX.room    = String(rm) }
                if(nf) { CHAT_CTX.notify  = String(nf)}
                if(cs) { CHAT_CTX.curset  = String(cs) }

                caUpdateChatCtxFromBody._initialized = true;

                CHAT_CTX.pcount  = String(pc)
                CHAT_CTX.last    = String(la)

            } catch (e) {console.error(e);
                console.error(LOG, 'Chat context initialization error:', e); }
        }

        // Process a chat_log.php payload: only check pico; private messages are fetched separately
        function caProcessChatPayload(txt){
            try {
                // Validate response before attempting to parse
                if(!txt || typeof txt !== 'string' || txt.trim() === ''){
                    console.warn(LOG, 'Empty or invalid chat payload response');
                    return;
                }

                const now = Date.now();

                // Lightweight parse just to check pico - only parse the fields we need
                let data;
                try {
                    data = parseJSONOrEmpty(txt);
                } catch (e) {console.error(e);
                    console.error(LOG, 'Chat payload: JSON parse failed', e, '— response preview:', String(txt).slice(0, 200));
                    return;
                }

                data = toChatLogResponse(data);

                // Update CHAT_CTX.last from public chat response
                try {
                    if(data && data.last){
                        CHAT_CTX.last = String(data.last);
                    }
                } catch (e) {console.error(e);
                    console.error(LOG, 'Update CHAT_CTX.last error:', e);
                }

                const pico = Number(data && data.pico);

                // Throttle: Only process when pico > 0 OR every 30 seconds for context refresh
                // (site polls every 2-5s, we don't need to check constantly)
                const CHECK_INTERVAL = 30000; // 30 seconds
                if(!caProcessChatPayload._lastCheck){
                    caProcessChatPayload._lastCheck = 0; // Allow first check immediately
                }

                const timeSinceLastCheck = now - caProcessChatPayload._lastCheck;
                const shouldProcess = (pico > 0) || (timeSinceLastCheck >= CHECK_INTERVAL);

                if(!shouldProcess){
                    // Skip - no new private messages and checked recently
                    return;
                }

                caProcessChatPayload._lastCheck = now;

                // No private messages or already have them in current payload
                if(!isFinite(pico) || pico < 1 || data.pload?.length > 0 || data.plogs?.length > 0) return;

                // Additional throttle for actual private message fetching (if pico > 0)
                if(caProcessChatPayload._lastPN && (now - caProcessChatPayload._lastPN) <= 10000){
                    console.log(LOG, 'Private messages: throttled — last check', Math.round((now - caProcessChatPayload._lastPN)/1000), 'seconds ago');
                    return;
                }
                caProcessChatPayload._lastPN = now;

                console.log(LOG, 'Private messages count:', pico, '— checking for new messages');
                if(typeof caUpdatePrivateConversationsList !== 'function') return;

                caUpdatePrivateConversationsList(false).then((privateConversations)=>{
                    try {
                        privateConversations = Array.isArray(privateConversations) ? privateConversations : [];

                        // Only fetch if unread > 0
                        const toFetch = privateConversations
                            .filter(pc => pc.unread > 0)
                            .map(function(it){ return { id:String(it.id), unread:Number(it.unread)||0 }; });

                        if(!toFetch.length){
                            console.log(LOG, 'None of the conversations has new messages');
                            return;
                        }

                        console.log(LOG, 'Fetching', toFetch.length, 'conversations' + (toFetch.length !== 1 ? 's' : ''), 'with new messages');

                        (async function run(){
                            for(let i=0;i<toFetch.length;i++){
                                const conversation = toFetch[i];
                                try {
                                    console.log(LOG, 'Fetch chat_log for conversation', conversation.id, '— unread messages:', conversation.unread);

                                    let conversationChatLog = await caFetchChatLogFor(conversation.id, getLastPcountFor(conversation.id));
                                    try {
                                        caProcessPrivateLogResponse(conversation.id, conversationChatLog);
                                        setLastPcountFor(conversation.id, CHAT_CTX.pcount);

                                    } catch (err) {console.error(err);
                                        console.error(LOG, 'Process messages error:', err);
                                    }
                                } catch (err) {console.error(err);
                                    console.error(LOG, 'Fetch error for conversation', conversation.id, '—', err);
                                }
                            }
                        })();
                    } catch (err) {console.error(err);
                        console.error(LOG, 'List processing error:', err);
                    }
                });
            } catch (e) {console.error(e);
                console.error(LOG, 'Chat payload processing error:', e); }
        }

        // fetch() interceptor
        try {
            let _origFetch = window.fetch;
            if(typeof _origFetch === 'function'){
                window.fetch = function(){
                    let args = arguments;
                    let req = args[0];
                    let init = args[1] || null;
                    let url = (req && typeof req === 'object' && 'url' in req) ? req.url : String(req||'');
                    // Try to capture request body for context if this is a chat_log POST
                    //console.log('trying to intercept fetch', req, init, url);
                    try {
                        if(isChatLogUrl(url)){
                            // Skip our own private fetches (marked with X-CA-OWN: 1)
                            let own = false;
                            try {
                                let h = (init && init.headers) || (req && req.headers);
                                if(h){
                                    if(typeof h.get === 'function'){ own = String(h.get('X-CA-OWN')||'') === '1'; }
                                    else if(Array.isArray(h)){ own = h.some(function(x){ return String((x[0]||'').toLowerCase())==='x-ca-own' && String(x[1]||'')==='1'; }); }
                                    else if(typeof h === 'object'){ own = String(h['X-CA-OWN']||h['x-ca-own']||'') === '1'; }
                                }
                            } catch (e) {console.error(e);
                                console.error(e)}
                            if(!own){
                                const qs = normalizeBodyToQuery(init && init.body);

                                if(qs){
                                    console.log(qs);
                                    caUpdateChatCtxFromBody(qs, url);
                                } else if(req && typeof req === 'object' && typeof req.clone === 'function'){
                                    console.log(qs);
                                    try { req.clone().text().then(function(t){ caUpdateChatCtxFromBody(t, url); }); } catch (err) {console.error(err);
                                        console.error(LOG, 'Fetch clone error:', err); }
                                }
                            }
                        }
                    } catch (err) {console.error(err);
                        console.error(LOG, 'Fetch body capture error:', err); }
                    let p = _origFetch.apply(this, args);
                    try {
                        if(isChatLogUrl(url)){
                            p.then(function(res){
                                try { res && res.clone && res.clone().text().then(caProcessChatPayload); } catch (err) {console.error(err);
                                    console.error(LOG, 'Response clone error:', err); }
                                return res;
                            });
                        }
                    } catch (e) {console.error(e);
                        console.error(e)}
                    return p;
                };
            }
        } catch (e) {console.error(e);
            console.error(e)}

        // XMLHttpRequest interceptor (covers jQuery $.ajax)
        try {
            const _open = XMLHttpRequest.prototype.open;
            const _send = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function(method, url){
                try { this._ca_url = String(url||''); } catch (e) {console.error(e);
                    this._ca_url = ''; }
                return _open.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function(){
                try {
                    let xhr = this;
                    // Capture body used for chat_log POST to build context
                    try {
                        const targetUrl = xhr._ca_url || '';
                        if(isChatLogUrl(targetUrl) && arguments && arguments.length){
                            const arg0 = arguments[0];
                            const qs0 = normalizeBodyToQuery(arg0);
                            caUpdateChatCtxFromBody(qs0 || '', targetUrl);
                        }
                    } catch (err) {console.error(err);
                        console.error(LOG, 'XHR body capture error:', err); }
                    xhr.addEventListener('readystatechange', function(){
                        try {
                            if(xhr.responseText && xhr.readyState === 4 && xhr.status === 200 && isChatLogUrl(xhr.responseURL || xhr._ca_url || '')){
                                caProcessChatPayload(xhr?.responseText);
                            }
                        } catch (err) {console.error(err);
                            console.error(LOG, 'XHR readystatechange error:', err); }
                    });
                } catch (e) {console.error(e);
                    console.error(e)}
                return _send.apply(this, arguments);
            };
        } catch (e) {console.error(e);
            console.error(e)}
    })();

    /* === Intercept site's native private message sending === */
    (function setupPrivateProcessInterceptor(){
        function isPrivateProcessUrl(u){
            try {
                if(!u) return false;
                let s = String(u);
                try {
                    s = new URL(s, location.origin).pathname;
                } catch (e) {console.error(e);
                }
                return s.indexOf('system/action/private_process.php') !== -1;
            } catch (e) {console.error(e);
                return false;
            }
        }

        function processPrivateSendResponse(responseText, requestBody){
            try {
                if(!responseText || typeof responseText !== 'string') return;

                let data;
                try {
                    data = parseJSONOrEmpty(responseText);
                } catch (e) {console.error(e);
                    console.error(LOG, 'Private process parse error:', e);
                    return;
                }

                data = toPrivateSendResponse(data);

                // Check if send was successful (code: 1)
                if(!data || data.code !== 1) return;

                const logData = data.log || {};
                let content = logData.log_content || '';
                let targetId = '';

                // Extract target ID from request body
                try {
                    const params = new URLSearchParams(requestBody);
                    targetId = params.get('target') || '';
                } catch (e) {console.error(e);
                }

                if(!content || !targetId) return;

                // Look up username and avatar from user map
                const userInfo = getUserFromMap(targetId);
                const targetName = userInfo.name;
                const targetAvatar = userInfo.avatar;
                SENT_ALL[targetId]=1; saveSentAll(SENT_ALL);
                const user = findFemaleByUsername(targetName);
                if(user.el) markSent(user.el);

                console.log(LOG, 'Intercepted native message send to', targetName, '(ID:', targetId, ')');

                // Log to sent messages box - pass full content for HTML rendering
                logSendOK(targetName, targetId, targetAvatar, content);

                // Mark conversation as replied
                markConversationAsReplied(targetId);
            } catch (err) {console.error(err);
                console.error(LOG, 'Process private send error:', err);
            }
        }

        // Intercept fetch
        try {
            let _origFetch = window.fetch;
            if(typeof _origFetch === 'function'){
                window.fetch = function(){
                    const args = arguments;
                    let req = args[0];
                    const init = args[1] || null;
                    const url = (req && typeof req === 'object' && 'url' in req) ? req.url : String(req||'');

                    let capturedBody = '';
                    try {
                        if(isPrivateProcessUrl(url)){
                            capturedBody = normalizeBodyToQuery(init && init.body);
                        }
                    } catch (err) {console.error(err);
                    }

                    const p = _origFetch.apply(this, args);

                    try {
                        if(isPrivateProcessUrl(url) && capturedBody){
                            p.then(function(res){
                                try {
                                    res.clone().text().then(function(txt){
                                        processPrivateSendResponse(txt, capturedBody);
                                    });
                                } catch (err) {console.error(err);
                                    console.error(LOG, 'Clone response error:', err); }
                                return res;
                            });
                        }
                    } catch (e) {console.error(e);
                        console.error(e)}

                    return p;
                };
            }
        } catch (e) {console.error(e);
            console.error(e)}

        // Intercept XHR
        try {
            const _xhrOpen = XMLHttpRequest.prototype.open;
            const _xhrSend = XMLHttpRequest.prototype.send;

            XMLHttpRequest.prototype.open = function(method, url){
                try {
                    this._ca_pm_isTarget = isPrivateProcessUrl(url);
                } catch (e) {console.error(e);
                }
                return _xhrOpen.apply(this, arguments);
            };

            XMLHttpRequest.prototype.send = function(){
                try {
                    const xhr = this;
                    let capturedBody = '';

                    try {
                        if(xhr._ca_pm_isTarget && arguments && arguments.length){
                            capturedBody = normalizeBodyToQuery(arguments[0]);
                        }
                    } catch (err) {console.error(err);
                    }

                    if(xhr._ca_pm_isTarget && capturedBody){
                        xhr.addEventListener('readystatechange', function(){
                            try {
                                if(xhr.readyState === 4 && xhr.status === 200){
                                    try {
                                        processPrivateSendResponse(xhr?.responseText || '', capturedBody);
                                    } catch (err) {
                                        console.error(err);
                                    }
                                }
                            } catch (err) {console.error(err);
                                console.error(LOG, 'XHR readystate error:', err); }
                        });
                    }
                } catch (e) {console.error(e);
                    console.error(e)}

                return _xhrSend.apply(this, arguments);
            };
        } catch (e) {console.error(e);
            console.error(e)}
    })();

    // --- Private notifications: fetch -> parse -> render, and actions ---
    const caParsePrivateNotify = (html)=>{
        try {
            //console.log(html);
            const tmp=document.createElement('div'); tmp.innerHTML=html;
            const nodes = tmp.querySelectorAll('.fmenu_item.fmuser.priv_mess');
            let out=[], i;
            for(i=0;i<nodes.length;i++){
                const el = nodes[i];
                let info = el.querySelector('.fmenu_name.gprivate');
                if(!info) continue;
                const id = (info.getAttribute('data')||'').trim();
                let name = (info.getAttribute('value')||'').trim();
                let av = (info.getAttribute('data-av')||'').trim();
                const cntEl = el.querySelector('.ulist_notify .pm_notify');
                let unread = 0;
                if(cntEl){
                    let t = (cntEl.textContent||'').trim();
                    unread = parseInt(t.replace(/\D+/g,''),10) || 0;
                }
                out.push({id:id, name:name, avatar:av, unread:unread});
            }
            console.log(LOG, 'Parsed', out.length, 'private conversation' + (out.length !== 1 ? 's' : ''));
            return out;
        } catch (e) {console.error(e);
            console.error(LOG, 'Parse private notifications error:', e); return []; }
    }
    const caFetchPrivateNotify = ()=>{
        let token=getToken();
        if(!token){ return Promise.resolve([]); }
        let body=new URLSearchParams({ token:token, cp:'chat' }).toString();
        return fetch('/system/float/private_notify.php', {
            method:'POST', credentials:'include',
            headers:{ 'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest','Accept':'*/*', 'X-CA-OWN':'1' },
            body: body
        }).then(async function(r){
            const html = await r.text();
            const list = caParsePrivateNotify(html);
            return Array.isArray(list) ? list : [];
        }).catch(function(err){
            console.error(LOG, 'Fetch private notifications error:', err);
            return [];
        });
    }

    const caUpdatePrivateConversationsList = function (){
        return caFetchPrivateNotify().then(function(privateConversations){
            try {
                console.log(LOG, 'Private conversations:', privateConversations.length);
                privateConversations = privateConversations || [];
                // Sort: unread desc, then name
                privateConversations.sort(function(a,b){
                    const au = a.unread||0, bu = b.unread||0;
                    if(bu!==au) return bu-au;
                    const an=(a.name||'').toLowerCase(), bn=(b.name||'').toLowerCase();
                    return an<bn?-1:an>bn?1:0;
                });
                //                 // No rendering; we only use this list to drive chat_log fetches
                return privateConversations;
            } catch (e) {console.error(e);
                console.error(LOG, 'Update private list error:', e); return privateConversations || []; }
        });
    }

    const caFetchChatLogFor = (uid, lastCheckedPcount)=>{
        try {
            let token=getToken(); if(!token||!uid){ return Promise.resolve(''); }

            const bodyObj = {
                token:token,
                cp:'chat',
                fload:'1',
                preload:'1',
                priv:String(uid),
                pcount: lastCheckedPcount
            };

            // Carry over site chat context so server returns the right slice
            try {
                if(typeof CHAT_CTX==='object' && CHAT_CTX){
                    if(CHAT_CTX.caction) bodyObj.caction = String(CHAT_CTX.caction);
                    if(CHAT_CTX.last)    bodyObj.last    = String(CHAT_CTX.last);
                    if(CHAT_CTX.room)    bodyObj.room    = String(CHAT_CTX.room);
                    if(CHAT_CTX.notify)  bodyObj.notify  = String(CHAT_CTX.notify);
                    if(CHAT_CTX.curset)  bodyObj.curset  = String(CHAT_CTX.curset);
                    if(CHAT_CTX.lastp)  bodyObj.lastp  = String(CHAT_CTX.lastp);
                    if(CHAT_CTX.pcount)  bodyObj.pcount  = String(CHAT_CTX.pcount);
                }
            } catch (e) {console.error(e);
                console.error(LOG, 'Chat context error:', e);
            }

            // Log all parameters being sent
            console.log(LOG, 'caFetchChatLogFor: Fetching conversation', uid, 'with params:', {
                priv: String(uid),
                lastp: bodyObj.lastp,
                pcount: bodyObj.pcount || '(not set)',
                fload: '1',
                preload: '1',
                caction: bodyObj.caction || '(not set)',
                last: bodyObj.last || '(not set)',
                room: bodyObj.room || '(not set)',
                notify: bodyObj.notify || '(not set)',
                curset: bodyObj.curset || '(not set)'
            });

            const body=new URLSearchParams(bodyObj).toString();
            try {
                const bodyLog = body.replace(/token=[^&]*/,'token=[redacted]');
                console.log(LOG, 'caFetchChatLogFor: Full request body:', bodyLog);
            } catch (err) {console.error(err);
                console.error(LOG, 'caFetchChatLogFor: body log error', err); }

            return fetch('/system/action/chat_log.php?timestamp=234284923',{
                method:'POST', credentials:'include',
                headers:{
                    'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',
                    'Accept':'application/json, text/javascript, */*; q=0.01',
                    'X-Requested-With':'XMLHttpRequest',
                    'X-CA-OWN':'1'
                },
                body: body
            }).then(function(res){
                console.log(LOG, 'caFetchChatLogFor: Response status:', res.status, res.statusText);
                return res.text();
            })
                .then(function(txt){
                    console.log(LOG, 'caFetchChatLogFor: Response preview:', String(txt||'').slice(0, 300));
                    return txt;
                })
                .catch(function(err){
                    console.error(LOG, 'Fetch chat log error:', err);
                    return '';
                });
        } catch (e) {console.error(e); return Promise.resolve(''); }
    }
    // Process a private chat_log.php response fetched by us
    const caProcessPrivateLogResponse = function (uid, response){
        try {
            // Handle empty or invalid responses
            if(!response || typeof response !== 'string' || response.trim() === ''){
                console.warn(LOG, 'Empty response for conversation', uid);
                return;
            }

            let conversationChatLog;
            try {
                conversationChatLog = parseJSONOrEmpty(response);
                conversationChatLog = toPrivateChatLogResponse(conversationChatLog);
            } catch (e) {console.error(e);
                const prev = String(response||'').slice(0,200);
                console.warn(LOG, 'Parse failed for conversation', uid, '— preview:', prev);
                return;
            }

            // Update CHAT_CTX.last from private chat response
            try {
                if(conversationChatLog && conversationChatLog.last){
                    CHAT_CTX.last = String(conversationChatLog.last);
                }
            } catch (e) {console.error(e);
                console.error(LOG, 'Update CHAT_CTX.last from private response error:', e);
            }

            const items = Array.isArray(conversationChatLog && conversationChatLog.pload) ? conversationChatLog.pload
                : (Array.isArray(conversationChatLog && conversationChatLog.plogs) ? conversationChatLog.plogs : []);
            if(!items.length) return;

            // Get current user's ID to filter out own messages
            let myUserId = null;
            try {
                myUserId = (typeof user_id !== 'undefined') ? String(user_id) : null;
            } catch (e) {console.error(e);
            }

            // Sort by log_id to process in chronological order
            items.sort(function(a,b){ return (a.log_id||0)-(b.log_id||0); });

            const watermark = getGlobalWatermark();
            console.log(LOG, 'Processing messages for conversation', uid, '— watermark:', watermark || 'not set');

            // Only show messages with log_date >= watermark and from the other user
            let newMessages = 0;
            const skipped = { fromMe: 0, alreadyShown: 0, tooOld: 0 };
            let newestLogDate = null; // Track newest message date to update watermark

            for(let i=0; i<items.length; i++){
                const t = items[i];
                let fromId = t?.user_id != null ? String(t.user_id) : null;
                const logDate = String(t?.log_date ?? '');
                const logId = t?.log_id != null ? String(t.log_id) : null;

                // Track newest log_date from all messages (not just from other user)
                if(logDate && (!newestLogDate || parseLogDateToNumber(logDate) > parseLogDateToNumber(newestLogDate))){
                    newestLogDate = logDate;
                }

                // Skip messages sent by me
                if(myUserId && fromId === myUserId){
                    skipped.fromMe++;
                    continue;
                }

                // Skip if we've already displayed this log_id
                if(logId && hasDisplayedLogId(uid, logId)){
                    skipped.alreadyShown++;
                    continue;
                }

                // Skip if message is older than watermark
                const shouldShow = isMessageNewer(logDate, false);

                if(!shouldShow){
                    skipped.tooOld++;
                    continue;
                }

                const uname = (t.user_name) || (fromId!=null?String(fromId):'?');
                const av  = (t.user_tumb) || '';
                const rawContent = (t.log_content) ? String(t.log_content) : '';
                // Decode HTML entities (like &lt;3 to <3), then escape for safe display
                const decodedContent = decodeHTMLEntities(rawContent);
                const content = escapeHTML(decodedContent).replace(/\s+/g,' ').trim();
                // Parse content as HTML to support emoticons (img tags), but keep username link escaped
                const details = nameAndDmHtml(uname, fromId, av) + ' — ' + content;
                logLine('pv', details, fromId);

                // Mark this log_id as displayed
                if(logId) addDisplayedLogId(uid, logId);

                newMessages++;
            }

            // Log summary of what was skipped
            if(skipped.fromMe > 0 || skipped.alreadyShown > 0 || skipped.tooOld > 0){
                console.log(LOG, 'Skipped messages —',
                    'from me:', skipped.fromMe,
                    'already shown:', skipped.alreadyShown,
                    'too old:', skipped.tooOld);
            }

            // Update watermark to newest message date so we don't show same messages again
            if(newestLogDate){
                setGlobalWatermark(newestLogDate);
                console.log(LOG, 'Updated watermark to:', newestLogDate);
            }

            if(newMessages > 0){
                console.log(LOG, 'User', uid, '—', newMessages, 'new message' + (newMessages !== 1 ? 's' : ''));
            } else {
                console.log(LOG, 'User', uid, '— no new messages (all older than watermark or from me)');
            }
        } catch (err) {console.error(err);
            console.error(LOG, 'Process private messages error:', err);
        }
    }

    // Initialize watermark on page load
    try {
        initializeGlobalWatermark();
    } catch (err) {console.error(err);
        console.error(LOG, 'Failed to initialize watermark:', err);
    }

    /* ---------- Monitor private chat box for user info ---------- */
    (function observePrivateChatBox(){
        try {
            function extractPrivateBoxUserInfo(){
                try {
                    let privateBox = document.getElementById('private_box');
                    if(!privateBox) return;

                    let userId = null;
                    let userName = null;
                    let userAvatar = null;

                    // 1. Extract user ID from #private_av's data attribute (this is the primary source)
                    const privateAv = document.getElementById('private_av');
                    if(privateAv){
                        userId = privateAv.getAttribute('data');
                        if(userId) userId = userId.trim();
                    }

                    // 2. Extract username from #private_name element
                    const privateNameEl = document.getElementById('private_name');
                    if(privateNameEl){
                        userName = privateNameEl.textContent.trim();
                    }

                    // 3. Extract avatar from #private_av's src attribute
                    if(privateAv){
                        userAvatar = privateAv.getAttribute('src') || '';
                        if(userAvatar) userAvatar = userAvatar.trim();
                    }

                    // Fallback: Try to extract from data attributes on private_box itself
                    if(!userId){
                        userId = privateBox.getAttribute('data-uid') || privateBox.getAttribute('data-user') || privateBox.getAttribute('data-id');
                    }

                    // Fallback: Check for hidden inputs
                    if(!userId){
                        const uidInput = privateBox.querySelector('input[name="uid"], input[name="user_id"], input[name="target"]');
                        if(uidInput) userId = uidInput.value;
                    }
                    if (userId && userName) {
                        CA.CapturedUsers.set(userId, userName, userAvatar);
                    }
                } catch (e) {console.error(e);
                    console.error(LOG, 'Extract private box user info error:', e);
                }
            }

            // Initial check
            setTimeout(extractPrivateBoxUserInfo, 500);

            // Observe private_box for changes
            const privateBox = document.getElementById('private_box');
            if(privateBox){
                const privObserver = new MutationObserver(function(mutations){
                    try {
                        // Check if any relevant changes occurred
                        let shouldExtract = false;
                        mutations.forEach(function(mut){
                            if(mut.type === 'childList' && mut.addedNodes.length > 0){
                                shouldExtract = true;
                            }
                            if(mut.type === 'attributes' && (mut.attributeName === 'data-uid' || mut.attributeName === 'data-name' || mut.attributeName === 'data')){
                                shouldExtract = true;
                            }
                        });

                        if(shouldExtract){
                            extractPrivateBoxUserInfo();
                        }
                    } catch (e) {console.error(e);
                        console.error(LOG, 'Private box observer error:', e);
                    }
                });

                privObserver.observe(privateBox, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['data-uid', 'data-user', 'data-name', 'data-id', 'data']
                });
            } else {
                // If private_box doesn't exist yet, wait and try again
                setTimeout(observePrivateChatBox, 1000);
            }
        } catch (e) {console.error(e);
            console.error(LOG, 'Private chat box observer setup error:', e);
        }
    })();

    console.log(LOG,'✓ 321ChatAddons ready — activity logging, message tracking, and throttled sending enabled');
})();


/* ===== DOM-based user list capture (observer-first) ===== */
(function(){
    try{
        window.CA = window.CA || {};
        function scan(){
            try{
                let root = document.getElementById('container_user') || document.querySelector('#container_user, .online_user');
                if (!root) return;
                let nodes = root.querySelectorAll('.online_user .user_item[data-id][data-name], .user_item[data-id][data-name]');
                let added = 0;
                nodes.forEach(function(el){
                    try{
                        let id = (el.getAttribute('data-id')||'').trim();
                        let name = (el.getAttribute('data-name')||'').trim();
                        let av = (el.getAttribute('data-av')||'').trim();
                        if (!av) {
                            try {
                                let img = el.querySelector('.user_item_avatar img.avav, .user_item_avatar img');
                                if (img && img.getAttribute('src')) av = img.getAttribute('src');
                            } catch (e) {}
                        }
                        if (id && name){
                            CA.CapturedUsers.set(id, name, av);
                            added++;
                        }
                    } catch (e) { console.error(e); }
                });
                CA.debug && CA.debug('[DOM capture] saved users:', added);
            } catch (e) { console.error(e); }
        }
        function attach(){
            try{
                let target = document.getElementById('container_user') || document.querySelector('#container_user');
                if (!target){ setTimeout(attach, 300); return; }
                let obs = new MutationObserver(function(){ scan(); });
                obs.observe(target, { childList: true, subtree: true });
                CA.debug && CA.debug('[DOM capture] observer attached');
                // initial scans
                setTimeout(scan, 0);
                setTimeout(scan, 600);
                setTimeout(scan, 2000);
            } catch (e) { console.error(e); }
        }
        if (document.readyState !== 'loading') attach();
        else document.addEventListener('DOMContentLoaded', attach);
    } catch (e) { console.error(e); }
})();
