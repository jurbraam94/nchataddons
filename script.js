(function(){
    /* =========================
     * 321ChatAddons Toolkit (with Activity Log) — initial page-load logging added
     * ========================= */
    var FEMALE_CODE='2', LOG='[321ChatAddons]';

    /* ---------- Helpers ---------- */
    function qs(s,r){return (r||document).querySelector(s);}
    function qsa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
    function trim(s){return (s||'').replace(/^\s+|\s+$/g,'');}
    function norm(s){return trim(s).toLowerCase();}
    function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
    function randBetween(minMs,maxMs){return Math.floor(minMs+Math.random()*(maxMs-minMs));}
    function safeMatches(n,sel){ try { return n && n.nodeType===1 && typeof n.matches==='function' && n.matches(sel); } catch(e){ return false; } }
    function safeQuery(n,sel){ try { return n && n.querySelector ? n.querySelector(sel) : null; } catch(e){ return null; } }
    function escapeHTML(s){ return String(s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);}); }
    function timeHHMM(){ var d=new Date(); var h=String(d.getHours()).padStart(2,'0'), m=String(d.getMinutes()).padStart(2,'0'); return h+':'+m; }
    function truncate(s,n){ s=String(s||'').replace(/\s+/g,' ').trim(); if(s.length<=n) return s; return s.slice(0,Math.max(0,n-1))+'…'; }

    // ---------- Namespace and Modules ----------
    // Small, incremental refactor: add a namespace and a Drafts module for better structure
    var CA = window.CA || (window.CA = {});
    CA.Const = {
        STORAGE_KEYS: {
            draftSpecific: '321chataddons.pm.draft_specific',
            draftBroadcast: '321chataddons.pm.draft_broadcast'
        }
    };
    CA.Drafts = {
        save: function(which, value){
            try{
                var k = which === 'specific' ? CA.Const.STORAGE_KEYS.draftSpecific : CA.Const.STORAGE_KEYS.draftBroadcast;
                sessionStorage.setItem(k, String(value || ''));
            }catch(e){}
        },
        load: function(which){
            try{
                var k = which === 'specific' ? CA.Const.STORAGE_KEYS.draftSpecific : CA.Const.STORAGE_KEYS.draftBroadcast;
                return sessionStorage.getItem(k) || '';
            }catch(e){ return ''; }
        },
        restoreInputs: function(sMsgEl, bMsgEl){
            try{
                var d1 = CA.Drafts.load('specific');
                var d2 = CA.Drafts.load('broadcast');
                if(sMsgEl && d1) sMsgEl.value = d1;
                if(bMsgEl && d2) bMsgEl.value = d2;
            }catch(e){}
        }
    };

    /* ---------- Audio autoplay gate (avoid NotAllowedError before user gesture) ---------- */
    (function setup321ChatAddonsAudioGate(){
        try{
            var userInteracted = false;
            var pending = new Set();
            var origPlay = HTMLAudioElement && HTMLAudioElement.prototype && HTMLAudioElement.prototype.play
                ? HTMLAudioElement.prototype.play
                : null;
            if(!origPlay) return;

            function onInteract(){
                if(userInteracted) return;
                userInteracted = true;
                // Try to flush any queued audio
                pending.forEach(function(a){
                    try{ origPlay.call(a).catch(function(){/* ignore */}); }catch(e){console.error(e)}
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
                try{
                    if(!userInteracted){
                        // Queue and resolve immediately to prevent uncaught NotAllowedError
                        pending.add(this);
                        return Promise.resolve();
                    }
                    var p = origPlay.call(this);
                    if(p && typeof p.catch === 'function'){
                        p.catch(function(err){
                            // If policy still blocks, queue it and swallow the error
                            if(err && String(err.name||err).toLowerCase().indexOf('notallowed') > -1){
                                pending.add(this);
                            }
                        }.bind(this));
                    }
                    return p;
                }catch(e){
                    try{ return origPlay.call(this); } catch(e) { console.error(e);return Promise.resolve(); }
                }
            };
        }catch(e){console.error(e)}
    })();

    /* ---------- 321ChatAddons: bottom log helpers ---------- */
    function caGetLogBox(){
        try{
            var panel = document.getElementById('ca-panel') || document;
            return panel.querySelector('.ca-log-box');
        }catch(e){ return null; }
    }
    function caAppendLog(type, text){
        try{
            var box = caGetLogBox();
            if(!box) return;
            var entry = document.createElement('div');
            entry.className = 'ca-log-entry ' + (type === 'broadcast' ? 'ca-log-broadcast' : (type === 'reset' ? 'ca-log-reset' : ''));
            var ts = document.createElement('div'); ts.className = 'ca-log-ts'; ts.textContent = timeHHMM();
            var dot = document.createElement('div'); dot.className = 'ca-log-dot';
            var msg = document.createElement('div'); msg.className = 'ca-log-text';
            var safe = escapeHTML(String(text||''));
            if(type === 'broadcast'){
                msg.innerHTML = safe + ' <span class="ca-badge-bc">BROADCAST</span>';
            } else {
                msg.innerHTML = safe;
            }
            entry.appendChild(ts); entry.appendChild(dot); entry.appendChild(msg);
            // Prepend so newest appears at top with column-reverse
            box.insertBefore(entry, box.firstChild || null);
        }catch(e){ /* ignore */ }
    }
    // Wire up click handlers for reset tracking anchors and broadcast send button
    document.addEventListener('click', function(e){
        try{
            var resetA = e.target && (e.target.closest && e.target.closest('.ca-pop .ca-reset-link, .ca-reset-link, .ca-reset'));
            if(resetA){
                caAppendLog('reset','Tracking has been reset');
            }
            var bcBtn = e.target && (e.target.closest && e.target.closest('#ca-bc-send'));
            if(bcBtn){
                caAppendLog('broadcast','Message sent');
            }
        }catch(e){console.error(e)}
    });

    /* ---------- Keep original page sizing ---------- */
    function applyInline(){
        try{
            var a=qsa('.pboxed'); for(var i=0;i<a.length;i++){a[i].style.setProperty('height','800px','important');}
            var b=qsa('.pboxed .pcontent'); for(var j=0;j<b.length;j++){b[j].style.setProperty('height','610px','important');}
        }catch(e){}
    }
    function removeAds(root){
        try{
            var scope = root && root.querySelectorAll ? root : document;
            var links = scope.querySelectorAll('a[href*="bit.ly"]');
            if(!links || !links.length) return;
            links.forEach(function(a){
                if(a && !a.closest('#ca-panel') && a.parentNode){
                    a.parentNode.removeChild(a); // remove only the anchor
                }
            });
        }catch(e){}
    }
    function adjustForFooter(){
        try{
            var panel = document.getElementById('ca-panel');
            if(!panel) return;
            // Match panel height to the site's right column (#chat_right), if available
            var chatRight = document.getElementById('chat_right') || document.querySelector('#chat_right');
            if(!chatRight) return;

            // Use getBoundingClientRect for accurate measurement
            var rect = chatRight.getBoundingClientRect();
            var h = rect.height;

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
            var logsSec = panel.querySelector('.ca-log-section');
            if(logsSec){ logsSec.style.paddingBottom = ''; }
        }catch(e){
            console.error(LOG, 'adjustForFooter error:', e);
        }
    }
    if (document.body) {
        // Initial setup with delay to let page layout settle
        setTimeout(function(){ applyInline(); removeAds(document); },0);
        setTimeout(function(){ adjustForFooter(); }, 500);

        // Throttle the MutationObserver to avoid excessive calls
        var lastAdjust = 0;
        new MutationObserver(function(muts){
            try{ 
                applyInline(); 
                removeAds(document); 
                var now = Date.now();
                if(now - lastAdjust > 1000){
                    adjustForFooter();
                    lastAdjust = now;
                }
            }catch(e){}
        }).observe(document.body,{childList:true,subtree:true});

        // Debounce resize handler
        var resizeTimer;
        window.addEventListener('resize', function(){ 
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function(){ adjustForFooter(); }, 250);
        });
    }

    /* ---------- Containers / lists ---------- */
    function getContainer(){ return qs('#container_user')||qs('#chat_right_data'); }

    var isPruning=false, rafId=null;
    function schedule(fn){ if(rafId) cancelAnimationFrame(rafId); rafId=requestAnimationFrame(function(){rafId=null; fn();}); }

    // Shared chat context captured from site chat_log requests (used for our private chat_log calls)
    var CHAT_CTX = { caction:'', last:'', lastp: '', room:'', notify:'', curset:'', pcount:0 };

    // Global watermark - store in same format as log_date: "DD/MM HH:MM"
    var GLOBAL_WATERMARK_KEY = '321chataddons.global.watermark';

    function getGlobalWatermark(){
        try{
            return localStorage.getItem(GLOBAL_WATERMARK_KEY) || '';
        }catch(e){ return ''; }
    }

    function setGlobalWatermark(dateStr){
        try{
            if(dateStr) localStorage.setItem(GLOBAL_WATERMARK_KEY, String(dateStr));
        }catch(e){}
    }

    // Initialize watermark once on page load with current date/time in "DD/MM HH:MM" format
    function initializeGlobalWatermark(){
        try{
            var currentWatermark = getGlobalWatermark();
            console.log(LOG, 'Checking watermark... current value:', currentWatermark || '(not set)');

            if(currentWatermark && currentWatermark.length > 0){
                console.log(LOG, 'Watermark already set:', currentWatermark);
                return;
            }

            // Set watermark to current time in DD/MM HH:MM format
            var now = new Date();
            var day = String(now.getDate()).padStart(2, '0');
            var month = String(now.getMonth() + 1).padStart(2, '0');
            var hours = String(now.getHours()).padStart(2, '0');
            var minutes = String(now.getMinutes()).padStart(2, '0');
            var watermark = day + '/' + month + ' ' + hours + ':' + minutes;

            console.log(LOG, 'Setting initial watermark to:', watermark);
            setGlobalWatermark(watermark);

            // Verify it was set
            var verify = getGlobalWatermark();
            if(verify === watermark){
                console.log(LOG, 'Watermark successfully initialized:', watermark);
            } else {
                console.warn(LOG, 'Watermark set but verification failed. Expected:', watermark, 'Got:', verify);
            }
        }catch(err){
            console.error(LOG, 'Initialize watermark error:', err);
        }
    }

    // Parse log_date format "DD/MM HH:MM" to comparable number (MMDDHHMM)
    function parseLogDateToNumber(logDateStr){
        try{
            if(!logDateStr || typeof logDateStr !== 'string') return 0;

            // Format: "23/10 11:25" (DD/MM HH:MM)
            var parts = logDateStr.trim().split(/[\s\/:/]+/);
            if(parts.length < 4) return 0;

            var day = parseInt(parts[0], 10);
            var month = parseInt(parts[1], 10);
            var hours = parseInt(parts[2], 10);
            var minutes = parseInt(parts[3], 10);

            if(isNaN(day) || isNaN(month) || isNaN(hours) || isNaN(minutes)) return 0;

            // Convert to comparable number: MMDDHHMM
            // This allows simple numeric comparison within same year
            return (month * 1000000) + (day * 10000) + (hours * 100) + minutes;
        }catch(e){
            console.error(LOG, 'Parse log_date error:', e, '— input:', logDateStr);
            return 0;
        }
    }

    // Check if a message is newer than watermark
    function isMessageNewer(logDateStr, debugLog){
        try{
            var watermark = getGlobalWatermark();
            if(!watermark) return true; // No watermark set, show all

            var msgNum = parseLogDateToNumber(logDateStr);
            var wmNum = parseLogDateToNumber(watermark);

            if(!msgNum) return false; // Invalid date, skip

            var isNewer = msgNum >= wmNum;

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
        }catch(e){
            console.error(LOG, 'Date comparison error:', e);
            return false;
        }
    }

    // Normalize various request body types to a query-string
    function normalizeBodyToQuery(body){
        try{
            if(!body) return '';
            if(typeof body === 'string') return body;
            if(typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
            if(typeof FormData !== 'undefined' && body instanceof FormData){
                var usp = new URLSearchParams();
                body.forEach(function(v,k){ usp.append(k, typeof v === 'string' ? v : ''); });
                return usp.toString();
            }
            if(typeof body === 'object'){
                try{ return new URLSearchParams(body).toString(); }catch(e){console.error(e)}
            }
        }catch(e){ console.error(LOG, 'Body normalization error:', e); }
        return '';
    }

    /* ---------- Female pruning (hide, not remove) ---------- */
    function pruneNonFemale(){
        var c=getContainer(); if(!c) return;
        isPruning = true;
        try{
            qsa('.user_item[data-gender]', c).forEach(function(n){
                var female = n.getAttribute('data-gender')===FEMALE_CODE;
                n.classList.toggle('ca-hidden', !female);
            });
        } finally { isPruning=false; }
    }

    /* ---------- ID/Name extraction ---------- */
    function getUserId(el){
        if(!el) return null;
        try{
            var ds=el.dataset||{};
            var id=ds.uid||ds.userid||ds.user||ds.id;
            if(!id){
                var n=qs('[data-uid]',el); if(n&&n.dataset&&n.dataset.uid) id=n.dataset.uid;
                if(!id){ n=qs('[data-userid]',el); if(n&&n.dataset&&n.dataset.userid) id=n.dataset.userid; }
                if(!id){ n=qs('[data-user]',el); if(n&&n.dataset&&n.dataset.user) id=n.dataset.user; }
                if(!id){ n=qs('[data-id]',el); if(n&&n.dataset&&n.dataset.id) id=n.dataset.id; }
            }
            if(!id){
                var a=qs('a[href*="profile"]',el), m=a&&a.href.match(/(?:\/profile\/|[?&]uid=)(\d+)/);
                if(m&&m[1]) id=m[1];
                if(!id){
                    a=qs('a[href*="user"]',el);
                    m=a&&a.href.match(/(?:\/user\/|[?&]id=)(\d+)/);
                    if(m&&m[1]) id=m[1];
                }
            }
            return id?String(id):null;
        }catch(e){ return null; }
    }
    function extractUsername(el){
        if(!el) return '';
        try{
            var v=el.getAttribute('data-name'); if(v) return v.trim();
            var n=qs('.user_name,.username,.name',el); if(n&&n.textContent) return n.textContent.trim();
            var t=el.getAttribute('title'); if(t) return t.trim();
            var text=(el.textContent||'').trim(); if(!text) return '';
            var parts=text.split(/\s+/), out=[]; for(var i=0;i<parts.length;i++){ if(parts[i]) out.push(parts[i]); }
            if(!out.length) return '';
            out.sort(function(a,b){return a.length-b.length;});
            return out[0];
        }catch(e){ return ''; }
    }
    function extractAvatar(el){
        try{
            if(!el) return '';
            var img = safeQuery(el,'img[src*="avatar"]') || safeQuery(el,'.avatar img') || safeQuery(el,'img');
            var src = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
            return src ? src.trim() : '';
        }catch(e){ return ''; }
    }
    function findFemaleByUsername(query){
        var q=norm(query); if(!q) return [];
        var c=getContainer(); if(!c) return [];
        var els=qsa('.user_item[data-gender="'+FEMALE_CODE+'"]',c), out=[];
        for(var i=0;i<els.length;i++){
            var id=getUserId(els[i]); if(!id) continue;
            var name=norm(extractUsername(els[i])); if(!name) continue;
            if(name===q || name.indexOf(q)>-1) out.push({el:els[i],id:id,name:name});
        }
        return out;
    }
    function collectFemaleIds(){
        var c=getContainer(); if(!c) return [];
        var els=qsa('.user_item[data-gender="'+FEMALE_CODE+'"]',c), out=[];
        for(var i=0;i<els.length;i++){
            var id=getUserId(els[i]); if(id) out.push({el:els[i],id:id,name:extractUsername(els[i])});
        }
        return out;
    }

    /* ---------- Token + POST ---------- */
    function getToken(){
        try{ if(typeof utk!=='undefined' && utk) return utk; }catch(e){}
        var inp=qs('input[name="token"]'); if(inp&&inp.value) return inp.value;
        var sc=qsa('script'); for(var i=0;i<sc.length;i++){
            var t=sc[i].textContent||''; var m=t.match(/\butk\s*=\s*['"]([a-f0-9]{16,64})['"]/i); if(m) return m[1];
        }
        return null;
    }
    function withTimeout(startFetchFn, ms){
        if(ms==null) ms = 15000;
        var ac = new AbortController();
        var t = setTimeout(function(){ ac.abort(); }, ms);
        return startFetchFn(ac.signal)
            .catch(function(err){ return { ok:false, status:0, body:String(err&&err.message||'error') }; })
            .finally(function(){ clearTimeout(t); });
    }
    function sendPrivateMessage(target, content){
        var token=getToken(); if(!token||!target||!content){ return Promise.resolve({ok:false,status:0,body:'bad args'}); }
        var body=new URLSearchParams({token:token,cp:'chat',target:String(target),content:String(content),quote:'0'}).toString();
        return withTimeout(function(signal){
            return fetch('/system/action/private_process.php',{
                method:'POST', credentials:'include', signal:signal,
                headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Accept':'application/json, text/javascript, */*; q=0.01','X-Requested-With':'XMLHttpRequest','X-CA-OWN':'1'},
                body: body
            }).then(function(res){
                return res.text().then(function(txt){
                    var parsed; try{ parsed=JSON.parse(txt); }catch(e){}
                    return {ok:res.ok,status:res.status,body:parsed||txt};
                });
            });
        }, 15000);
    }

    /* ---------- Remote search ---------- */
    function searchUsersRemote(query){
        return new Promise(function(resolve){
            var token=getToken(); if(!token || !query){ resolve([]); return; }
            var body=new URLSearchParams({token:token, cp:'chat', query:String(query), search_type:'1', search_order:'0'}).toString();
            fetch('/system/action/action_search.php',{
                method:'POST', credentials:'include',
                headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Accept':'*/*','X-Requested-With':'XMLHttpRequest','X-CA-OWN':'1'},
                body: body
            }).then(function(res){ return res.text(); })
                .then(function(html){ resolve(parseSearchHTML(html)); })
                .catch(function(){ resolve([]); });
        });
    }
    function parseSearchHTML(html){
        var tmp=document.createElement('div'); tmp.innerHTML=html;
        var nodes=tmp.querySelectorAll('.user_item[data-id]'); var out=[];
        for(var i=0;i<nodes.length;i++){
            var el=nodes[i]; if(el.getAttribute('data-gender')!==FEMALE_CODE) continue;
            var id=el.getAttribute('data-id'); if(!id) continue;
            var name='', p=el.querySelector('.username'); if(p&&p.textContent) name=p.textContent.trim();
            if(!name){ var dn=el.getAttribute('data-name'); if(dn) name=dn.trim(); }
            out.push({el:null,id:String(id),name:name});
        }
        return out;
    }

    /* ---------- Message tracking (per-message “new only”) ---------- */
    var STORAGE_PREFIX='321chataddons.pm.', LAST_HASH_KEY=STORAGE_PREFIX+'lastMessageHash';
    function hashMessage(s){var h=5381; s=String(s); for(var i=0;i<s.length;i++){h=((h<<5)+h)+s.charCodeAt(i);} return (h>>>0).toString(36);}
    var NS = location.host + (window.curPage||'') + ':';
    function keyForHash(h){return STORAGE_PREFIX+NS+h;}
    function setLast(h){try{localStorage.setItem(LAST_HASH_KEY,h);}catch(e){}}
    function getLast(){try{return localStorage.getItem(LAST_HASH_KEY)||'';}catch(e){return ''}}
    function loadSent(h){try{var raw=localStorage.getItem(keyForHash(h)); if(!raw) return {}; var a=JSON.parse(raw); if(a&&a.length){var o={},i; for(i=0;i<a.length;i++) o[a[i]]=1; return o;} return {}; }catch(e){return {};}}
    function saveSent(h,obj){try{var a=[],k; for(k in obj) if(obj.hasOwnProperty(k)) a.push(k); localStorage.setItem(keyForHash(h),JSON.stringify(a));}catch(e){}}
    function markSent(el){
        try{
            if(!el) return;
            el.classList.add('chataddons-sent');
            el.style.setProperty('outline','2px solid #8bc34a66','important');
            el.style.setProperty('border-radius','8px','important');
            var id = getUserId(el);
            if(id){ ensureSentChip(el, !!SENT_ALL[id]); }
            resortUserList();
        }catch(e){}
    }

    /* ---------- Exclusion checkboxes (persisted) ---------- */
    var EXC_KEY='321chataddons.excluded';
    function loadExcluded(){ try{ var raw=localStorage.getItem(EXC_KEY); if(!raw) return {}; var a=JSON.parse(raw)||[]; var map={},i; for(i=0;i<a.length;i++) map[a[i]]=1; return map; } catch(e){ return {}; } }
    function saveExcluded(map){ try{ var arr=[],k; for(k in map) if(map.hasOwnProperty(k)&&map[k]) arr.push(k); localStorage.setItem(EXC_KEY,JSON.stringify(arr)); }catch(e){} }
    var EXCLUDED=loadExcluded();

    // Global "already messaged" list (applies to any message)
    var SENT_ALL_KEY='321chataddons.sent.all';
    function loadSentAll(){ try{ var raw=localStorage.getItem(SENT_ALL_KEY); if(!raw) return {}; return JSON.parse(raw)||{}; } catch(e){ return {}; } }
    function saveSentAll(map){ try{ localStorage.setItem(SENT_ALL_KEY, JSON.stringify(map)); } catch(e){} }
    var SENT_ALL = loadSentAll();

    // Track conversations that have been replied to
    var REPLIED_CONVOS_KEY='321chataddons.repliedConversations';
    function loadRepliedConvos(){ try{ var raw=localStorage.getItem(REPLIED_CONVOS_KEY); if(!raw) return {}; return JSON.parse(raw)||{}; } catch(e){ return {}; } }
    function saveRepliedConvos(map){ try{ localStorage.setItem(REPLIED_CONVOS_KEY, JSON.stringify(map)); } catch(e){} }
    var REPLIED_CONVOS = loadRepliedConvos();

    // Mark all received messages from a specific user as replied
    function markConversationAsReplied(uid){
        try{
            if(!uid) return;
            REPLIED_CONVOS[uid] = 1;
            saveRepliedConvos(REPLIED_CONVOS);

            // Replace reply icons with checkmarks for all existing received messages from this user
            if($logBoxReceived){
                var entries = qsa('.ca-log-pv', $logBoxReceived);
                entries.forEach(function(entry){
                    var userLink = entry.querySelector('.ca-user-link');
                    if(!userLink) return;
                    var entryUid = userLink.getAttribute('data-uid');
                    if(entryUid === String(uid)){
                        // Find and replace reply icon with replied mark
                        var replyIcon = entry.querySelector('.ca-reply-icon');
                        if(replyIcon && !entry.querySelector('.ca-replied-mark')){
                            var uname = userLink.getAttribute('data-name') || '';

                            // Create checkmark link (clickable to open chat)
                            var mark = document.createElement('a');
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
                    }
                });
            }
        }catch(e){
            console.error(LOG, 'Mark conversation replied error:', e);
        }
    }

    // Persisted per-user last processed pcount to avoid refetching same batch
    var LAST_PCOUNT_MAP_KEY='321chataddons.lastPcountPerConversation';
    function loadLastPcountMap(){ try{ var raw=localStorage.getItem(LAST_PCOUNT_MAP_KEY); return raw ? (JSON.parse(raw)||{}) : {}; }catch(e){ return {}; } }
    function saveLastPcountMap(map){ try{ localStorage.setItem(LAST_PCOUNT_MAP_KEY, JSON.stringify(map||{})); }catch(e){} }
    var LAST_PCOUNT_MAP = loadLastPcountMap();
    function getLastPcountFor(uid){ try{ return (LAST_PCOUNT_MAP && Number(LAST_PCOUNT_MAP[uid]))||0; }catch(e){ return 0; } }
    function setLastPcountFor(uid, pc){ try{ if(!uid) return; LAST_PCOUNT_MAP[uid]=Number(pc)||0; saveLastPcountMap(LAST_PCOUNT_MAP); }catch(e){} }

    // Track displayed message log_id per conversation to prevent duplicates
    var DISPLAYED_LOGIDS_KEY='321chataddons.displayedLogIds';
    var MAX_LOGIDS_PER_CONVERSATION = 100; // Keep last 100 IDs per conversation

    function loadDisplayedLogIds(){
        try{
            var raw=localStorage.getItem(DISPLAYED_LOGIDS_KEY);
            return raw ? (JSON.parse(raw)||{}) : {};
        }catch(e){ return {}; }
    }

    function saveDisplayedLogIds(map){
        try{
            localStorage.setItem(DISPLAYED_LOGIDS_KEY, JSON.stringify(map||{}));
        }catch(e){}
    }

    var DISPLAYED_LOGIDS = loadDisplayedLogIds();

    function getDisplayedLogIdsFor(uid){
        try{
            if(!uid || !DISPLAYED_LOGIDS[uid]) return [];
            return DISPLAYED_LOGIDS[uid] || [];
        }catch(e){ return []; }
    }

    function addDisplayedLogId(uid, logId){
        try{
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
        }catch(e){
            console.error(LOG, 'Add displayed log_id error:', e);
        }
    }

    function hasDisplayedLogId(uid, logId){
        try{
            if(!uid || !logId) return false;
            var displayed = getDisplayedLogIdsFor(uid);
            return displayed.indexOf(logId) !== -1;
        }catch(e){ return false; }
    }

    // Visual chip on user list items when already messaged
    function ensureSentChip(el, on){
        try{
            if(!el) return;
            var chip = el.querySelector('.ca-sent-chip');
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
        }catch(e){}
    }
    function updateSentBadges(){
        try{
            var c=getContainer(); if(!c) return;
            qsa('.user_item', c).forEach(function(el){
                var id=getUserId(el);
                ensureSentChip(el, !!(id && SENT_ALL[id]));
            });
        }catch(e){}
    }
    // Resort user list so non-messaged appear first
    function resortUserList(){
        try{
            var c=getContainer(); if(!c) return;
            var items = qsa('.user_item', c);
            if(!items.length) return;
            var unsent=[], sent=[];
            items.forEach(function(el){
                var id=getUserId(el);
                if(id && SENT_ALL[id]) sent.push(el); else unsent.push(el);
            });
            var frag=document.createDocumentFragment();
            unsent.forEach(function(n){ frag.appendChild(n); });
            sent.forEach(function(n){ frag.appendChild(n); });
            c.appendChild(frag);
        }catch(e){}
    }

    function isAllowedRank(el){
        try{
            var rankAttr = el ? (el.getAttribute('data-rank') || '') : '';
            var roomRankIcon = el ? safeQuery(el,'.list_rank') : null;
            var roomRank = roomRankIcon ? (roomRankIcon.getAttribute('data-r') || '') : '';
            return (rankAttr==='1' || rankAttr==='50') && (roomRank!=='4');
        }catch(e){ return false; }
    }
    function ensureCheckboxOn(el){
        try{
            if(!el || el.getAttribute('data-gender')!==FEMALE_CODE) return;
            if(qs('.ca-ck-wrap', el)) return;
            if(!isAllowedRank(el)) return;
            var id=getUserId(el); if(!id) return;
            isMakingOwnChanges = true;
            var wrap=document.createElement('label');
            wrap.className='ca-ck-wrap'; wrap.title='Include in broadcast';
            var cb=document.createElement('input'); cb.type='checkbox'; cb.className='ca-ck';
            cb.checked = !EXCLUDED[id];
            cb.addEventListener('click', function(e){ e.stopPropagation(); });
            cb.addEventListener('change', function(){
                if(cb.checked){ delete EXCLUDED[id]; } else { EXCLUDED[id]=1; }
                saveExcluded(EXCLUDED);
            });
            wrap.appendChild(cb);
            el.appendChild(wrap);
            setTimeout(function(){ isMakingOwnChanges = false; }, 10);
        }catch(e){}
    }
    function attachCheckboxes(){
        try{
            var c=getContainer(); if(!c) return;
            var els=qsa('.user_item[data-gender="'+FEMALE_CODE+'"]',c);
            for(var i=0;i<els.length;i++){
                var el = els[i];
                ensureCheckboxOn(el);
                var id = getUserId(el);
                ensureSentChip(el, !!(id && SENT_ALL[id]));
            }
            resortUserList();
        }catch(e){}
    }

    /* ---------- Panel UI ---------- */
    function appendAfterMain(el){
        var main=document.querySelector('#chat_right')||document.querySelector('#container_user')||document.body;
        if(main && main.parentElement) main.parentElement.appendChild(el); else document.body.appendChild(el);
    }
    function buildPanel(){
        var h=document.createElement('section');
        h.id='ca-panel';
        h.className='ca-panel';
        h.innerHTML=
            '<div class="ca-body">'+
            '  <div class="ca-nav">'+
            '    <button id="ca-nav-bc" class="ca-nav-btn" type="button">Broadcast</button>'+
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
            '    <div id="ca-log-box-received" class="ca-log-box ca-log-box-expand" aria-live="polite" style="flex:1;min-height:0;overflow-y:auto;"></div>'+
            '  </div>'+
            '  <div class="ca-section ca-log-section">'+
            '    <hr class="ca-divider">'+
            '    <div class="ca-section-title">'+
            '      <span>Logon/Logoff</span>'+
            '    </div>'+
            '    <div id="ca-log-box-presence" class="ca-log-box" aria-live="polite"></div>'+
            '    <div class="ca-log-controls ca-log-controls-bottom">'+
            '      <label class="ca-log-ctl"><input id="ca-log-autoscroll" type="checkbox" checked> Autoscroll</label>'+
            '      <button id="ca-log-clear" class="ca-btn ca-btn-xs" type="button">Clear</button>'+
            '    </div>'+
            '  </div>'+
            '</div>';
        appendAfterMain(h);
        return h;
    }
    // Popup for Broadcast
    function createBroadcastPopup(){
        var pop=document.getElementById('ca-bc-pop');
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
        var closeBtn=pop.querySelector('#ca-bc-pop-close');
        if(closeBtn){ closeBtn.addEventListener('click', function(){ pop.style.display='none'; }); }
        // drag
        var hdr=pop.querySelector('#ca-bc-pop-header'); var ox=0, oy=0, sx=0, sy=0;
        function mm(e){ var dx=e.clientX-sx, dy=e.clientY-sy; pop.style.left=(ox+dx)+'px'; pop.style.top=(oy+dy)+'px'; pop.style.transform='none'; }
        function mu(){ document.removeEventListener('mousemove',mm); document.removeEventListener('mouseup',mu); }
        if(hdr){ hdr.addEventListener('mousedown', function(e){ sx=e.clientX; sy=e.clientY; var r=pop.getBoundingClientRect(); ox=r.left; oy=r.top; document.addEventListener('mousemove',mm); document.addEventListener('mouseup',mu); }); }
        return pop;
    }
    function openBroadcast(){
        var pop=createBroadcastPopup();
        if(pop){ pop.style.display='block'; if(!openBroadcast._wired){ wireBroadcastControls(); openBroadcast._wired=true; } }
    }
    function wireBroadcastControls(){
        // rebind refs and handlers for broadcast controls inside popup
        $bMsg = qs('#ca-bc-msg'); $bSend = qs('#ca-bc-send'); $bReset = qs('#ca-bc-reset'); $bStat = qs('#ca-bc-status');
        if($bReset && !$bReset._wired){ $bReset._wired=true; $bReset.addEventListener('click', function(e){ e.preventDefault(); resetForText($bMsg?$bMsg.value:'',$bStat); }); }
        if($bSend && !$bSend._wired){
            $bSend._wired=true;
            $bSend.addEventListener('click', function(){
                (function(){
                    var text=trim($bMsg?$bMsg.value:''); if(!text){ if($bStat) $bStat.textContent='Type the message first.'; return; }
                    var h=hashMessage(text), last=getLast(); if(h!==last) setLast(h);
                    var list=buildBroadcastList();
                    var sent=loadSent(h);
                    var to=[], i; for(i=0;i<list.length;i++){ if(!sent[list[i].id]) to.push(list[i]); }
                    if(!to.length){ if($bStat) $bStat.textContent='No new recipients for this message (after exclusions/rank filter).'; return; }
                    $bSend.disabled=true;
                    var ok=0,fail=0,B=10,T=Math.ceil(to.length/B), preview=truncate(text, 80);
                    function runBatch(bi){
                        if(bi>=T){ if($bStat) $bStat.textContent='Done. Success: '+ok+', Failed: '+fail+'.'; $bSend.disabled=false; return; }
                        var start=bi*B, batch=to.slice(start,start+B), idx=0;
                        if($bStat) $bStat.textContent='Batch '+(bi+1)+'/'+T+' — sending '+batch.length+'... (OK:'+ok+' Fail:'+fail+')';
                        function one(){
                            if(idx>=batch.length){ if(bi<T-1){ var wait=randBetween(10000,20000); if($bStat) $bStat.textContent='Batch '+(bi+1)+'/'+T+' done — waiting '+Math.round(wait/1000)+'s...'; sleep(wait).then(function(){ runBatch(bi+1); }); } else { runBatch(bi+1); } return; }
                            var item=batch[idx++], uname=item.name||item.id, av=extractAvatar(item.el);
                            sendWithThrottle(item.id,text).then(function(r){
                                if(r && r.ok){
                                    ok++; sent[item.id]=1; if(item.el) markSent(item.el); saveSent(h,sent);
                                    SENT_ALL[item.id]=1; saveSentAll(SENT_ALL);
                                    logSendOK(uname, preview, item.id, av);
                                } else { fail++; logSendFail(uname, preview, r?r.status:0, item.id, av); }
                                if($bStat) $bStat.textContent='Batch '+(bi+1)+'/'+T+' — '+idx+'/'+batch.length+' sent (OK:'+ok+' Fail:'+fail+')';
                                return sleep(randBetween(2000,5000));
                            }).then(one)['catch'](function(){
                                fail++; logSendFail(uname, preview, 'ERR', item.id, av);
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
    var panel=document.getElementById('ca-panel')||buildPanel();

    /* Refs */
    var $sUser=qs('#ca-specific-username'), $sMsg=qs('#ca-specific-msg'), $sSend=qs('#ca-specific-send'), $sStat=qs('#ca-specific-status'), $sReset=qs('#ca-specific-reset');
    var $bMsg=qs('#ca-bc-msg'), $bSend=qs('#ca-bc-send'), $bStat=qs('#ca-bc-status'), $bReset=qs('#ca-bc-reset');
    var $logBoxSent=qs('#ca-log-box-sent'), $logBoxReceived=qs('#ca-log-box-received'), $logBoxPresence=qs('#ca-log-box-presence'), $logClear=qs('#ca-log-clear'), $logAuto=qs('#ca-log-autoscroll');
    var $navBc=qs('#ca-nav-bc');
    if($navBc){ $navBc.addEventListener('click', function(){ openBroadcast(); }); }

    // Persist Activity Log preferences
    var PREF_AUTOSCROLL='321chataddons.pref.autoscroll';
    function loadPref(k, d){ try{ var v=localStorage.getItem(k); return v===null?d:String(v); }catch(e){ return d; } }
    function savePref(k, v){ try{ localStorage.setItem(k, String(v)); }catch(e){} }
    if($logAuto){ $logAuto.checked = loadPref(PREF_AUTOSCROLL,'1')==='1'; $logAuto.addEventListener('change', function(){ savePref(PREF_AUTOSCROLL, $logAuto.checked?'1':'0'); }); }

    /* ---------- Activity Log ---------- */
    var LOG_MAX=200;
    var LOG_STORE_KEY='321chataddons.activityLog.v1';
    function renderLogEntry(targetBox, ts, kind, details){
        if(!targetBox) return;
        var klass='ca-log-'+kind;
        var html = '<div class="ca-log-entry '+klass+'">' +
            '<span class="ca-log-ts">'+escapeHTML(ts)+'</span>' +
            '<span class="ca-log-dot"></span>' +
            '<span class="ca-log-text">'+details+'</span>' +
            '</div>';
        // Append to end so newest messages appear at bottom
        targetBox.insertAdjacentHTML('beforeend', html);
        // Append a right-aligned dm link using data from username (if present), then the sent badge (if any)
        try{
            var entry = targetBox.lastElementChild;
            if(!entry) return;
            var a = entry.querySelector('.ca-user-link');
            if(!a) return;
            var uid = a.getAttribute('data-uid')||'';
            var name = a.getAttribute('data-name')||'';
            var avatar = a.getAttribute('data-avatar')||'';
            if(!uid) return;

            // Add reply icon for received messages (kind === 'pv')
            if(kind === 'pv'){
                // Check if conversation has been replied to
                var hasReplied = REPLIED_CONVOS && REPLIED_CONVOS[uid];

                if(hasReplied){
                    // Show checkmark for replied conversations (still clickable to open chat)
                    var mark = document.createElement('a');
                    mark.className = 'ca-replied-mark';
                    mark.setAttribute('data-reply','1');
                    mark.setAttribute('data-uid', uid);
                    mark.setAttribute('data-name', name);
                    mark.href = '#';
                    mark.textContent = '✓';
                    mark.title = 'Replied - Click to open chat';
                    // Insert after the dot, before the text
                    var dot = entry.querySelector('.ca-log-dot');
                    if(dot && dot.nextSibling){
                        entry.insertBefore(mark, dot.nextSibling);
                    }
                } else {
                    // Show reply icon for un-replied conversations
                    var replyIcon = document.createElement('a');
                    replyIcon.className = 'ca-reply-icon';
                    replyIcon.setAttribute('data-reply','1');
                    replyIcon.setAttribute('data-uid', uid);
                    replyIcon.setAttribute('data-name', name);
                    replyIcon.href = '#';
                    replyIcon.textContent = '↩';
                    replyIcon.title = 'Reply to ' + name;
                    // Insert reply icon after the dot, before the text
                    var dot = entry.querySelector('.ca-log-dot');
                    if(dot && dot.nextSibling){
                        entry.insertBefore(replyIcon, dot.nextSibling);
                    }
                }
            }

            var dm = document.createElement('a');
            dm.className = 'ca-dm-link ca-dm-right';
            dm.setAttribute('data-dm','1');
            dm.setAttribute('data-uid', uid);
            dm.setAttribute('data-name', name);
            dm.setAttribute('data-avatar', avatar);
            dm.href = '#';
            dm.textContent = 'dm';
            entry.appendChild(dm);
            // place badge immediately to the right of dm, if already messaged
            if(typeof SENT_ALL==='object' && SENT_ALL && SENT_ALL[uid]){
                var badge = document.createElement('span');
                badge.className = 'ca-badge-sent';
                badge.title = 'Already messaged';
                badge.textContent = '✓';
                entry.appendChild(badge);
            }
        }catch(e){}
    }
    function saveLogEntry(ts, kind, details){
        var arr=[];
        try{ var raw=localStorage.getItem(LOG_STORE_KEY); if(raw) arr=JSON.parse(raw)||[]; }catch(e){}
        arr.unshift({ts:ts, kind:kind, details:details});
        if(arr.length>LOG_MAX) arr=arr.slice(0,LOG_MAX);
        try{ localStorage.setItem(LOG_STORE_KEY, JSON.stringify(arr)); }catch(e){}
    }
    function restoreLog(){
        if(!$logBoxSent || !$logBoxReceived || !$logBoxPresence) return;
        var arr=[];
        try{ var raw=localStorage.getItem(LOG_STORE_KEY); if(raw) arr=JSON.parse(raw)||[]; }catch(e){}
        $logBoxSent.innerHTML='';
        $logBoxReceived.innerHTML='';
        $logBoxPresence.innerHTML='';
        // Process oldest to newest (reverse order from storage which has newest first)
        for(var i=arr.length-1; i>=0; i--){
            var e=arr[i];
            if(!e || !e.kind) continue;
            if(e.kind==='send-ok' || e.kind==='send-fail'){
                renderLogEntry($logBoxSent, e.ts||timeHHMM(), e.kind, e.details||'');
            } else if(e.kind==='pv'){
                renderLogEntry($logBoxReceived, e.ts||timeHHMM(), e.kind, e.details||'');
            } else if(e.kind==='login' || e.kind==='logout'){
                renderLogEntry($logBoxPresence, e.ts||timeHHMM(), e.kind, e.details||'');
            }
        }
        // Always auto-scroll to bottom after restore (use RAF for reliability)
        requestAnimationFrame(function(){
            if($logBoxSent) $logBoxSent.scrollTop = $logBoxSent.scrollHeight;
            if($logBoxReceived) $logBoxReceived.scrollTop = $logBoxReceived.scrollHeight;
            if($logBoxPresence) $logBoxPresence.scrollTop = $logBoxPresence.scrollHeight;
        });
    }
    function trimLogBoxToMax(targetBox){
        try{
            if(!targetBox || !targetBox.children) return;
            // Create a static array copy to avoid live HTMLCollection issues
            var kids = Array.prototype.slice.call(targetBox.children);
            if(kids.length <= LOG_MAX) return;
            // Remove oldest entries from the beginning (oldest messages are at the start)
            var toRemove = kids.length - LOG_MAX;
            for(var i = 0; i < toRemove; i++){
                try{
                    if(kids[i] && kids[i].parentNode){
                        kids[i].parentNode.removeChild(kids[i]);
                    }
                }catch(e){
                    console.error(LOG, 'Remove log entry error:', e);
                }
            }
        }catch(e){
            console.error(LOG, 'Trim log error:', e);
        }
    }
    function logLine(kind, details){
        var ts=timeHHMM();
        var target = (kind==='send-ok' || kind==='send-fail') ? $logBoxSent
                   : (kind==='pv') ? $logBoxReceived
                   : (kind==='login' || kind==='logout') ? $logBoxPresence
                   : null;
        if(!target) return;
        renderLogEntry(target, ts, kind, details);
        trimLogBoxToMax(target);
        // Always auto-scroll to bottom when new entry is added (use RAF for reliability)
        requestAnimationFrame(function(){
            if(target) target.scrollTop = target.scrollHeight;
        });
        // Save all log types to localStorage for persistence across page reloads
        saveLogEntry(ts, kind, details);
    }
    function nameAndDmHtml(username, uid, avatar){
        var nameA = '<a href="#" class="ca-user-link" title="Open profile" data-uid="'+escapeHTML(String(uid||''))+'" data-name="'+escapeHTML(String(username||''))+'" data-avatar="'+escapeHTML(String(avatar||''))+'"><strong>'+escapeHTML(username||'?')+'</strong></a>';
        return nameA;
    }
    function logSendOK(username, preview, uid, avatar){
        logLine('send-ok', nameAndDmHtml(username, uid, avatar)+' — “'+escapeHTML(preview)+'”');
    }
    function logSendFail(username, preview, status, uid, avatar){
        logLine('send-fail', nameAndDmHtml(username, uid, avatar)+' — failed ('+String(status||0)+') — “'+escapeHTML(preview)+'”');
    }
    // Throttle presence logging to prevent duplicates
    var lastPresenceLog = {}; // uid -> timestamp
    var PRESENCE_LOG_THROTTLE = 5000; // 5 seconds

    function logLogin(username, uid, avatar){
        var now = Date.now();
        var key = 'login_' + uid;
        if(lastPresenceLog[key] && (now - lastPresenceLog[key]) < PRESENCE_LOG_THROTTLE){
            return; // Skip - logged too recently
        }
        lastPresenceLog[key] = now;
        logLine('login', nameAndDmHtml(username, uid, avatar)+' logged on');
    }
    function logLogout(username, uid, avatar){
        var now = Date.now();
        var key = 'logout_' + uid;
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
            try{localStorage.removeItem(LOG_STORE_KEY);}catch(e){}
        });
    }
    // Apply restored preferences now
    restoreLog();

    // Fallback profile URL builder (only used if site function is not present)
    function buildProfileUrlForId(uid){
        try{
            if(!uid) return '';
            var sel = 'a[href*="profile"][href*="'+uid+'"], a[href*="user"][href*="'+uid+'"]';
            var found = document.querySelector(sel);
            if(found && found.href) return found.href;
            var fallbacks = [
                '/profile/'+uid,
                '/user/'+uid,
                '/system/profile.php?uid='+uid
            ];
            return fallbacks[0];
        }catch(e){ return ''; }
    }
    function attachLogClickHandlers(box){
        if(!box) return;
        box.addEventListener('click', function(e){
            // Reply icon - open chat like DM link
            var reply = e.target && e.target.closest ? e.target.closest('a[data-reply="1"]') : null;
            if(reply){
                e.preventDefault();
                var rUid = reply.getAttribute('data-uid')||'';
                var rName = reply.getAttribute('data-name')||'';
                // Get avatar from the user link if available
                var rAvatar = '';
                try{
                    var entry = reply.closest('.ca-log-entry');
                    if(entry){
                        var userLink = entry.querySelector('.ca-user-link');
                        if(userLink){
                            rAvatar = userLink.getAttribute('data-avatar')||'';
                        }
                    }
                }catch(err){}

                var openDm = (typeof window.openPrivate==='function') ? window.openPrivate
                    : (window.parent && typeof window.parent.openPrivate==='function') ? window.parent.openPrivate
                        : null;
                if(openDm){
                    try{
                        var rUidNum = /^\d+$/.test(rUid) ? parseInt(rUid,10) : rUid;
                        openDm(rUidNum, rName, rAvatar);
                    }catch(err){
                        openDm(rUid, rName, rAvatar);
                    }
                }
                return;
            }
            // DM link
            var dm = e.target && e.target.closest ? e.target.closest('a[data-dm="1"]') : null;
            if(dm){
                e.preventDefault();
                var dUid = dm.getAttribute('data-uid')||'';
                var dName = dm.getAttribute('data-name')||'';
                var dAvatar = dm.getAttribute('data-avatar')||'';
                var openDm = (typeof window.openPrivate==='function') ? window.openPrivate
                    : (window.parent && typeof window.parent.openPrivate==='function') ? window.parent.openPrivate
                        : null;
                if(openDm){
                    try{
                        var dUidNum = /^\d+$/.test(dUid) ? parseInt(dUid,10) : dUid;
                        openDm(dUidNum, dName, dAvatar);
                    }catch(err){
                        openDm(dUid, dName, dAvatar);
                    }
                }
                return;
            }
            // Username link opens profile via site function
            var a = e.target && e.target.closest ? e.target.closest('a[data-uid]') : null;
            if(a){
                e.preventDefault();
                var uid = a.getAttribute('data-uid')||'';
                var getProf = (typeof window.getProfile==='function') ? window.getProfile
                    : (window.parent && typeof window.parent.getProfile==='function') ? window.parent.getProfile
                        : null;
                if(getProf){
                    try{
                        var uidNum = /^\d+$/.test(uid) ? parseInt(uid,10) : uid;
                        getProf(uidNum);
                    }catch(err){
                        getProf(uid);
                    }
                } else {
                    var url = buildProfileUrlForId(uid);
                    if(url){ window.open(url, '_blank'); }
                }
            }
        });
    }
    attachLogClickHandlers($logBoxSent);
    attachLogClickHandlers($logBoxReceived);
    attachLogClickHandlers($logBoxPresence);

    /* Draft persistence (refactored) */
    if($sMsg){ $sMsg.addEventListener('input', function(){ CA.Drafts.save('specific', $sMsg.value); }); }
    if($bMsg){ $bMsg.addEventListener('input', function(){ CA.Drafts.save('broadcast', $bMsg.value); }); }
    CA.Drafts.restoreInputs($sMsg, $bMsg);

    /* Build recipients */
    function buildSpecificListAsync(){
        return new Promise(function(resolve){
            if(!$sUser){ resolve([]); return; }
            var q = trim($sUser.value||''); if(!q){ resolve([]); return; }
            var local = findFemaleByUsername(q);
            if(local && local.length){ resolve(local); return; }
            searchUsersRemote(q).then(function(remote){ resolve(remote); });
        });
    }
    function buildBroadcastList(){
        var list = collectFemaleIds(), out=[], i, id, el, include;
        for(i=0;i<list.length;i++){
            el=list[i].el; id=list[i].id;
            if(!isAllowedRank(el)) continue;
            if(SENT_ALL && SENT_ALL[id]) continue; // skip users already messaged globally
            var cb = el ? qs('.ca-ck', el) : null;
            include = cb ? cb.checked : !EXCLUDED[id];
            if(include) out.push(list[i]);
        }
        return out;
    }

    /* Reset tracking (per message) */
    function resetForText(text, statEl){
        var t=trim(text); if(!t) return false;
        var h=hashMessage(t); localStorage.removeItem(keyForHash(h)); setLast(h);
        if(statEl) statEl.textContent='Cleared sent-tracking for this message.';
        return true;
    }
    if($sReset){ $sReset.addEventListener('click',function(e){ e.preventDefault(); resetForText($sMsg?$sMsg.value:'',$sStat); }); }
    if($bReset){ $bReset.addEventListener('click',function(e){ e.preventDefault(); resetForText($bMsg?$bMsg.value:'',$bStat); }); }

    /* Global throttle */
    var lastSendAt = 0;
    function sendWithThrottle(id, text, minGapMs){
        if(minGapMs===void 0) minGapMs = 3500;
        var now=Date.now(); var wait = Math.max(0, minGapMs - (now - lastSendAt));
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
            var text=trim($sMsg?$sMsg.value:'');
            if(!text){ if($sStat) $sStat.textContent='Type a message first.'; return; }
            if(!$sUser || !trim($sUser.value)){ if($sStat) $sStat.textContent='Enter a username.'; return; }
            var h=hashMessage(text), last=getLast(); if(h!==last) setLast(h);
            buildSpecificListAsync().then(function(list){
                if(!list.length){ if($sStat) $sStat.textContent='User not found (female).'; return; }
                var sentMap=loadSent(h);
                var item=list[0];
                if(sentMap[item.id]){ if($sStat) $sStat.textContent='Already sent to '+(item.name||item.id)+'. Change text to resend.'; return; }
                $sSend.disabled=true;
                sendWithThrottle(item.id,text).then(function(r){
                    var preview = truncate(text, 80);
                    var av = extractAvatar(item.el);
                    if(r && r.ok){
                        sentMap[item.id]=1; saveSent(h,sentMap);
                        SENT_ALL[item.id]=1; saveSentAll(SENT_ALL);
                        if(item.el) markSent(item.el);
                        if($sStat) $sStat.textContent='Sent to '+(item.name||item.id)+'.';
                        // Pass full text as HTML content for emoticon rendering
                        logSendOK(item.name||item.id, preview, item.id, av, text);
                        // Mark conversation as replied
                        markConversationAsReplied(item.id);
                    } else {
                        if($sStat) $sStat.textContent='Failed (HTTP '+(r?r.status:0)+').';
                        logSendFail(item.name||item.id, preview, r?r.status:0, item.id, av);
                    }
                })['catch'](function(){
                    if($sStat) $sStat.textContent='Error sending.'; logSendFail(item.name||item.id, truncate(text,80), 'ERR', item.id, '');
                }).then(function(){ $sSend.disabled=false; });
            });
        })();
    }); }

    /* Broadcast: send (batched, honors checkboxes & rank) */
    if($bSend){ $bSend.addEventListener('click',function(){
        (function(){
            var text=trim($bMsg?$bMsg.value:''); if(!text){ if($bStat) $bStat.textContent='Type the message first.'; return; }
            var h=hashMessage(text), last=getLast(); if(h!==last) setLast(h);
            var list=buildBroadcastList();
            var sent=loadSent(h);
            var to=[], i; for(i=0;i<list.length;i++){ if(!sent[list[i].id]) to.push(list[i]); }
            if(!to.length){ if($bStat) $bStat.textContent='No new recipients for this message (after exclusions/rank filter).'; return; }
            $bSend.disabled=true;
            var ok=0,fail=0,B=10,T=Math.ceil(to.length/B), preview=truncate(text, 80);

            function runBatch(bi){
                if(bi>=T){
                    if($bStat) $bStat.textContent='Done. Success: '+ok+', Failed: '+fail+'.';
                    $bSend.disabled=false;
                    return;
                }
                var start=bi*B, batch=to.slice(start,start+B), idx=0;
                if($bStat) $bStat.textContent='Batch '+(bi+1)+'/'+T+' — sending '+batch.length+'... (OK:'+ok+' Fail:'+fail+')';
                function one(){
                    if(idx>=batch.length){
                        if(bi<T-1){
                            var wait=randBetween(10000,20000);
                            if($bStat) $bStat.textContent='Batch '+(bi+1)+'/'+T+' done — waiting '+Math.round(wait/1000)+'s...';
                            sleep(wait).then(function(){ runBatch(bi+1); });
                        } else {
                            runBatch(bi+1);
                        }
                        return;
                    }
                    var item=batch[idx++], uname=item.name||item.id, av=extractAvatar(item.el);
                    sendWithThrottle(item.id,text).then(function(r){
                        if(r && r.ok){
                            ok++; sent[item.id]=1; if(item.el) markSent(item.el); saveSent(h,sent);
                            SENT_ALL[item.id]=1; saveSentAll(SENT_ALL);
                            // Pass full text as HTML content for emoticon rendering
                            logSendOK(uname, preview, item.id, av, text);
                            // Mark conversation as replied
                            markConversationAsReplied(item.id);
                        } else {
                            fail++; logSendFail(uname, preview, r?r.status:0, item.id, av);
                        }
                        if($bStat) $bStat.textContent='Batch '+(bi+1)+'/'+T+' — '+idx+'/'+batch.length+' sent (OK:'+ok+' Fail:'+fail+')';
                        return sleep(randBetween(2000,5000));
                    }).then(one)['catch'](function(){
                        fail++; logSendFail(uname, preview, 'ERR', item.id, av);
                        return sleep(randBetween(2000,5000)).then(one);
                    });
                }
                one();
            }
            runBatch(0);
        })();
    }); }

    /* Click a user: fill specific username */
    function wireUserClickSelection(){
        try{
            var c=getContainer(); if(!c)return;
            if(c.getAttribute('data-ca-wired')==='1')return;
            c.addEventListener('click',function(e){
                try{
                    // Ignore clicks on interactive controls and our own badges/checkboxes
                    var ignore = e.target.closest('a, button, input, label, .ca-ck-wrap, .ca-ck, .ca-sent-chip');
                    if(ignore) return;
                    var n=e.target;
                    while(n&&n!==c&&!(n.classList&&n.classList.contains('user_item'))) n=n.parentNode;
                    if(!n||n===c)return;
                    var nm=extractUsername(n); if(!nm) return;
                    var inp=qs('#ca-specific-username');
                    if(inp){ inp.value=nm; var ev=document.createEvent('Event'); ev.initEvent('input', true, true); inp.dispatchEvent(ev); }
                }catch(e){console.error(e)}
            }, false); // bubble to avoid fighting site handlers
            c.setAttribute('data-ca-wired','1');
        }catch(e){}
    }

    /* ---------- Login/Logout logging ---------- */
    var currentFemales = new Map(); // id -> name
    var isMakingOwnChanges = false; // Flag to prevent observer loops
    function scanCurrentFemales(){
        currentFemales.clear();
        collectFemaleIds().forEach(function(it){ currentFemales.set(it.id, it.name||''); });
    }
    var didInitialLog = false;
    function runInitialLogWhenReady(maxTries){
        if(maxTries==null) maxTries = 20; // ~2s max
        var c=getContainer();
        var ready = !!c && qsa('.user_item[data-gender="'+FEMALE_CODE+'"]', c).length>0;
        if(ready){
            // Silently populate currentFemales map with existing users (no logging)
            scanCurrentFemales();
            // Prep UI
            pruneNonFemale(); attachCheckboxes(); wireUserClickSelection();
            didInitialLog = true;
            return;
        }
        if(maxTries<=0){
            // No items appeared; just finish without initial presence log
            didInitialLog = true;
            return;
        }
        setTimeout(function(){ runInitialLogWhenReady(maxTries-1); }, 100);
    }

    function handleAddedNode(n){
        var items=[];
        if(safeMatches(n,'.user_item[data-gender="'+FEMALE_CODE+'"]')) items=[n];
        else items=qsa('.user_item[data-gender="'+FEMALE_CODE+'"]', n);
        if(!items.length) return;
        items.forEach(function(el){
            var id=getUserId(el); if(!id) return;
            var wasPresent = currentFemales.has(id);
            var nm=extractUsername(el)||id;

            if(!wasPresent){
                // New user appeared
                currentFemales.set(id, nm);
                // Only log login if initial scan is complete
                if(didInitialLog){
                    logLogin(nm, id, extractAvatar(el));
                }
            } else {
                // User already tracked, just update name if changed (no logging)
                currentFemales.set(id, nm);
            }

            // Chip if already messaged
            ensureSentChip(el, !!(SENT_ALL && SENT_ALL[id]));
        });
    }
    function handleRemovedNode(n){
        var items=[];
        if(safeMatches(n,'.user_item')) items=[n];
        else items=qsa('.user_item', n);
        if(!items.length) return;
        items.forEach(function(el){
            var id=getUserId(el); if(!id) return;
            var isFemale = (el.getAttribute && el.getAttribute('data-gender')===FEMALE_CODE);
            if(isFemale && currentFemales.has(id)){
                var nm=currentFemales.get(id)||id;
                currentFemales.delete(id);
                logLogout(nm, id, extractAvatar(el));
            }
        });
    }

    /* ---------- Observer: prune + checkboxes + selection + login/out ---------- */
    function startObserver(){
        var c=getContainer();
        if(!c){
            var iv=setInterval(function(){
                var cc=getContainer();
                if(cc){
                    clearInterval(iv);
                    startObserver();
                    runInitialLogWhenReady(); // NEW: kick off initial logging as soon as container exists
                }
            },250);
            return;
        }

        var mo=new MutationObserver(function(recs){
            try{
                // Skip if we're making our own changes
                if(isMakingOwnChanges || isPruning) return;

                var hasRelevantChanges = false;
                var processedUsers = new Set(); // Prevent duplicate processing

                recs.forEach(function(r){
                    // Skip changes from our own panel
                    if(r.target && r.target.closest && r.target.closest('#ca-panel')) return;

                    if(r.addedNodes && r.addedNodes.length){
                        for(var i=0;i<r.addedNodes.length;i++){
                            var node = r.addedNodes[i];
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
                        for(var j=0;j<r.removedNodes.length;j++){
                            var node = r.removedNodes[j];
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
                            var uid = getUserId(r.target);
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
                    try{
                        isMakingOwnChanges = true;
                        pruneNonFemale();
                        attachCheckboxes();
                        wireUserClickSelection();
                        updateSentBadges();
                        resortUserList();
                        setTimeout(function(){ isMakingOwnChanges = false; }, 50);
                    }catch(e){
                        isMakingOwnChanges = false;
                    }
                });
            }catch(e){
                console.error(LOG, 'Observer error:', e);
            }
        });
        mo.observe(c,{childList:true,subtree:true,attributes:true,attributeFilter:['data-gender','data-rank']});

        // NEW: initial log pass (once)
        runInitialLogWhenReady();

        var ro=new MutationObserver(function(){
            var nc=getContainer();
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
            try{
                if(!u) return false;
                var s = String(u);
                try{
                    // Normalize to an absolute URL and compare path
                    s = new URL(s, location.origin).pathname;
                }catch(e){console.error(e)}
                return s.indexOf('system/action/chat_log.php') !== -1;
            }catch(e){
                console.error(e);
                return false;
            }
        }

        // Capture and reuse site chat parameters for our own private chat_log calls
        CHAT_CTX = CHAT_CTX || { caction:'', last:'', lastp: '', room:'', notify:'', curset:'', pcount: 0 };
        function caUpdateChatCtxFromBody(bodyLike, urlMaybe){
            try{
                // Only initialize once per page load
                if (caUpdateChatCtxFromBody._initialized) return;

                var qs = normalizeBodyToQuery(bodyLike);
                if(!qs && typeof urlMaybe === 'string'){
                    try{
                        var u = new URL(urlMaybe, location.origin);
                        qs = u.search ? u.search.replace(/^\?/, '') : '';
                    }catch(e){console.error(e)}
                }
                if(!qs){
                    console.warn(LOG, 'No parameters found from chat_log.php call.');
                    return;
                }
                // Do not initialize from our own private chat requests
                if(qs.indexOf('priv=1') !== -1) return;

                var p = new URLSearchParams(qs);
                var ca = p.get('caction'), lp = p.get('lastp'),la = p.get('last'), rm = p.get('room'), nf = p.get('notify'), cs = p.get('curset'), pc = p.get('pcount');

                // Set only values that are not yet set
                if(ca){ CHAT_CTX.caction = String(ca) }

                if(lp)   { CHAT_CTX.lastp    = String(lp) }
                if(rm)   { CHAT_CTX.room    = String(rm) }
                if(nf) { CHAT_CTX.notify  = String(nf)}
                if(cs) { CHAT_CTX.curset  = String(cs) }

                caUpdateChatCtxFromBody._initialized = true;

                CHAT_CTX.pcount  = String(pc)
                CHAT_CTX.last    = String(la)

            }catch(e){ console.error(LOG, 'Chat context initialization error:', e); }
        }

        // Process a chat_log.php payload: only check pico; private messages are fetched separately
        function caProcessChatPayload(txt){
            try{
                // Validate response before attempting to parse
                if(!txt || typeof txt !== 'string' || txt.trim() === ''){
                    console.warn(LOG, 'Empty or invalid chat payload response');
                    return;
                }

                var now = Date.now();

                // Lightweight parse just to check pico - only parse the fields we need
                var data;
                try{
                    data = JSON.parse(txt);
                } catch(e){
                    console.error(LOG, 'Chat payload: JSON parse failed', e, '— response preview:', String(txt).slice(0, 200));
                    return;
                }

                // Update CHAT_CTX.last from public chat response
                try{
                    if(data && data.last){
                        CHAT_CTX.last = String(data.last);
                    }
                }catch(e){
                    console.error(LOG, 'Update CHAT_CTX.last error:', e);
                }

                var pico = Number(data && data.pico);

                // Throttle: Only process when pico > 0 OR every 30 seconds for context refresh
                // (site polls every 2-5s, we don't need to check constantly)
                var CHECK_INTERVAL = 30000; // 30 seconds
                if(!caProcessChatPayload._lastCheck){
                    caProcessChatPayload._lastCheck = 0; // Allow first check immediately
                }

                var timeSinceLastCheck = now - caProcessChatPayload._lastCheck;
                var shouldProcess = (pico > 0) || (timeSinceLastCheck >= CHECK_INTERVAL);

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

                caUpdatePrivateConversationsList(false).then(function(privateConversations){
                    try{
                        privateConversations = Array.isArray(privateConversations) ? privateConversations : [];

                        // Only fetch if unread > 0
                        var toFetch = privateConversations
                            .filter(pc => pc.unread > 0)
                            .map(function(it){ return { id:String(it.id), unread:Number(it.unread)||0 }; });

                        if(!toFetch.length){
                            console.log(LOG, 'None of the conversations has new messages');
                            return;
                        }

                        console.log(LOG, 'Fetching', toFetch.length, 'conversations' + (toFetch.length !== 1 ? 's' : ''), 'with new messages');

                        (async function run(){
                            for(var i=0;i<toFetch.length;i++){
                                var conversation = toFetch[i];
                                try{
                                    console.log(LOG, 'Fetch chat_log for conversation', conversation.id, '— unread messages:', conversation.unread);

                                    var conversationChatLog = await caFetchChatLogFor(conversation.id, getLastPcountFor(conversation.id));
                                    try{
                                        caProcessPrivateLogResponse(conversation.id, conversationChatLog);
                                        setLastPcountFor(conversation.id, CHAT_CTX.pcount);

                                    }catch(err){
                                        console.error(LOG, 'Process messages error:', err);
                                    }
                                }catch(err){
                                    console.error(LOG, 'Fetch error for conversation', conversation.id, '—', err);
                                }
                            }
                        })();
                    }catch(err){
                        console.error(LOG, 'List processing error:', err);
                    }
                });
            }catch(e){ console.error(LOG, 'Chat payload processing error:', e); }
        }

        // fetch() interceptor
        try{
            var _origFetch = window.fetch;
            if(typeof _origFetch === 'function'){
                window.fetch = function(){
                    var args = arguments;
                    var req = args[0];
                    var init = args[1] || null;
                    var url = (req && typeof req === 'object' && 'url' in req) ? req.url : String(req||'');
                    // Try to capture request body for context if this is a chat_log POST
                    //console.log('trying to intercept fetch', req, init, url);
                    try{
                        if(isChatLogUrl(url)){
                            // Skip our own private fetches (marked with X-CA-OWN: 1)
                            var own = false;
                            try{
                                var h = (init && init.headers) || (req && req.headers);
                                if(h){
                                    if(typeof h.get === 'function'){ own = String(h.get('X-CA-OWN')||'') === '1'; }
                                    else if(Array.isArray(h)){ own = h.some(function(x){ return String((x[0]||'').toLowerCase())==='x-ca-own' && String(x[1]||'')==='1'; }); }
                                    else if(typeof h === 'object'){ own = String(h['X-CA-OWN']||h['x-ca-own']||'') === '1'; }
                                }
                            }catch(e){console.error(e)}
                            if(!own){
                                var qs = normalizeBodyToQuery(init && init.body);

                                if(qs){
                                    console.log(qs);
                                    caUpdateChatCtxFromBody(qs, url);
                                } else if(req && typeof req === 'object' && typeof req.clone === 'function'){
                                    console.log(qs);
                                    try{ req.clone().text().then(function(t){ caUpdateChatCtxFromBody(t, url); }); }catch(err){ console.error(LOG, 'Fetch clone error:', err); }
                                }
                            }
                        }
                    }catch(err){ console.error(LOG, 'Fetch body capture error:', err); }
                    var p = _origFetch.apply(this, args);
                    try{
                        if(isChatLogUrl(url)){
                            p.then(function(res){
                                try{ res && res.clone && res.clone().text().then(caProcessChatPayload); }catch(err){ console.error(LOG, 'Response clone error:', err); }
                                return res;
                            });
                        }
                    }catch(e){console.error(e)}
                    return p;
                };
            }
        }catch(e){console.error(e)}

        // XMLHttpRequest interceptor (covers jQuery $.ajax)
        try{
            var _open = XMLHttpRequest.prototype.open;
            var _send = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function(method, url){
                try{ this._ca_url = String(url||''); }catch(e){ this._ca_url = ''; }
                return _open.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function(){
                try{
                    var xhr = this;
                    // Capture body used for chat_log POST to build context
                    try{
                        var targetUrl = xhr._ca_url || '';
                        if(isChatLogUrl(targetUrl) && arguments && arguments.length){
                            var arg0 = arguments[0];
                            var qs0 = normalizeBodyToQuery(arg0);
                            caUpdateChatCtxFromBody(qs0 || '', targetUrl);
                        }
                    }catch(err){ console.error(LOG, 'XHR body capture error:', err); }
                    xhr.addEventListener('readystatechange', function(){
                        try{
                            if(xhr.readyState === 4 && xhr.status === 200 && isChatLogUrl(xhr.responseURL || xhr._ca_url || '')){
                                var txt = '';
                                // Prefer responseText to avoid JSON responseType issues
                                try{ txt = xhr.responseText; }catch(err){ console.error(LOG, 'XHR responseText error:', err); txt = ''; }
                                if(txt) caProcessChatPayload(txt);
                            }
                        }catch(err){ console.error(LOG, 'XHR readystatechange error:', err); }
                    });
                }catch(e){console.error(e)}
                return _send.apply(this, arguments);
            };
        }catch(e){console.error(e)}
    })();

    /* === Intercept site's native private message sending === */
    (function setupPrivateProcessInterceptor(){
        function isPrivateProcessUrl(u){
            try{
                if(!u) return false;
                var s = String(u);
                try{
                    s = new URL(s, location.origin).pathname;
                }catch(e){}
                return s.indexOf('system/action/private_process.php') !== -1;
            }catch(e){
                return false;
            }
        }

        function processPrivateSendResponse(responseText, requestBody){
            try{
                if(!responseText || typeof responseText !== 'string') return;

                var data;
                try{
                    data = JSON.parse(responseText);
                }catch(e){
                    console.error(LOG, 'Private process parse error:', e);
                    return;
                }

                // Check if send was successful (code: 1)
                if(!data || data.code !== 1) return;

                var logData = data.log || {};
                var content = logData.log_content || '';
                var targetId = '';

                // Extract target ID from request body
                try{
                    var params = new URLSearchParams(requestBody);
                    targetId = params.get('target') || '';
                }catch(e){}

                if(!content || !targetId) return;

                // Look up recipient username from user list by target ID
                var targetName = targetId; // fallback to ID
                var targetAvatar = '';
                try{
                    var c = getContainer();
                    if(c){
                        // Try multiple selectors to find the user
                        var userEl = c.querySelector('[data-uid="'+targetId+'"]') 
                                  || c.querySelector('[data-userid="'+targetId+'"]')
                                  || c.querySelector('[data-user="'+targetId+'"]')
                                  || c.querySelector('[data-id="'+targetId+'"]');

                        if(userEl){
                            var foundName = extractUsername(userEl);
                            if(foundName) targetName = foundName;
                            targetAvatar = extractAvatar(userEl);
                        }
                    }
                }catch(e){
                    console.error(LOG, 'Username lookup error:', e);
                }

                var preview = truncate(content, 80);
                console.log(LOG, 'Intercepted native message send to', targetName, '(ID:', targetId, ') —', preview);

                // Log to sent messages box - pass full content for HTML rendering
                logSendOK(targetName, preview, targetId, targetAvatar, content);

                // Mark conversation as replied
                markConversationAsReplied(targetId);
            }catch(err){
                console.error(LOG, 'Process private send error:', err);
            }
        }

        // Intercept fetch
        try{
            var _origFetch = window.fetch;
            if(typeof _origFetch === 'function'){
                window.fetch = function(){
                    var args = arguments;
                    var req = args[0];
                    var init = args[1] || null;
                    var url = (req && typeof req === 'object' && 'url' in req) ? req.url : String(req||'');

                    var capturedBody = '';
                    try{
                        if(isPrivateProcessUrl(url)){
                            capturedBody = normalizeBodyToQuery(init && init.body);
                        }
                    }catch(err){}

                    var p = _origFetch.apply(this, args);

                    try{
                        if(isPrivateProcessUrl(url) && capturedBody){
                            p.then(function(res){
                                try{
                                    res.clone().text().then(function(txt){
                                        processPrivateSendResponse(txt, capturedBody);
                                    });
                                }catch(err){ console.error(LOG, 'Clone response error:', err); }
                                return res;
                            });
                        }
                    }catch(e){console.error(e)}

                    return p;
                };
            }
        }catch(e){console.error(e)}

        // Intercept XHR
        try{
            var _xhrOpen = XMLHttpRequest.prototype.open;
            var _xhrSend = XMLHttpRequest.prototype.send;

            XMLHttpRequest.prototype.open = function(method, url){
                try{ 
                    this._ca_pm_url = String(url||'');
                    this._ca_pm_isTarget = isPrivateProcessUrl(url);
                }catch(e){}
                return _xhrOpen.apply(this, arguments);
            };

            XMLHttpRequest.prototype.send = function(){
                try{
                    var xhr = this;
                    var capturedBody = '';

                    try{
                        if(xhr._ca_pm_isTarget && arguments && arguments.length){
                            capturedBody = normalizeBodyToQuery(arguments[0]);
                        }
                    }catch(err){}

                    if(xhr._ca_pm_isTarget && capturedBody){
                        xhr.addEventListener('readystatechange', function(){
                            try{
                                if(xhr.readyState === 4 && xhr.status === 200){
                                    var txt = '';
                                    try{ txt = xhr.responseText; }catch(err){ txt = ''; }
                                    if(txt){
                                        processPrivateSendResponse(txt, capturedBody);
                                    }
                                }
                            }catch(err){ console.error(LOG, 'XHR readystate error:', err); }
                        });
                    }
                }catch(e){console.error(e)}

                return _xhrSend.apply(this, arguments);
            };
        }catch(e){console.error(e)}
    })();

    // --- Private notifications: fetch -> parse -> render, and actions ---
    function caParsePrivateNotify(html){
        try{
            //console.log(html);
            var tmp=document.createElement('div'); tmp.innerHTML=html;
            var nodes = tmp.querySelectorAll('.fmenu_item.fmuser.priv_mess');
            var out=[], i;
            for(i=0;i<nodes.length;i++){
                var el = nodes[i];
                var info = el.querySelector('.fmenu_name.gprivate');
                if(!info) continue;
                var id = (info.getAttribute('data')||'').trim();
                var name = (info.getAttribute('value')||'').trim();
                var av = (info.getAttribute('data-av')||'').trim();
                var cntEl = el.querySelector('.ulist_notify .pm_notify');
                var unread = 0;
                if(cntEl){
                    var t = (cntEl.textContent||'').trim();
                    unread = parseInt(t.replace(/\D+/g,''),10) || 0;
                }
                out.push({id:id, name:name, avatar:av, unread:unread});
            }
            console.log(LOG, 'Parsed', out.length, 'private conversation' + (out.length !== 1 ? 's' : ''));
            return out;
        }catch(e){ console.error(LOG, 'Parse private notifications error:', e); return []; }
    }
    function caFetchPrivateNotify(){
        var token=getToken();
        if(!token){ return Promise.resolve([]); }
        var body=new URLSearchParams({ token:token, cp:'chat' }).toString();
        return fetch('/system/float/private_notify.php', {
            method:'POST', credentials:'include',
            headers:{ 'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest','Accept':'*/*', 'X-CA-OWN':'1' },
            body: body
        }).then(async function(r){
            const html = await r.text();
            var list = caParsePrivateNotify(html);
            return Array.isArray(list) ? list : [];
        }).catch(function(err){
            console.error(LOG, 'Fetch private notifications error:', err);
            return [];
        });
    }

    function caUpdatePrivateConversationsList(manual){
        return caFetchPrivateNotify().then(function(privateConversations){
            try{
                console.log(LOG, 'Private conversations:', privateConversations.length);
                privateConversations = privateConversations || [];
                // Sort: unread desc, then name
                privateConversations.sort(function(a,b){
                    var au = a.unread||0, bu = b.unread||0;
                    if(bu!==au) return bu-au;
                    var an=(a.name||'').toLowerCase(), bn=(b.name||'').toLowerCase();
                    return an<bn?-1:an>bn?1:0;
                });
                //                 // No rendering; we only use this list to drive chat_log fetches
                return privateConversations;
            }catch(e){ console.error(LOG, 'Update private list error:', e); return privateConversations || []; }
        });
    }

    function caFetchChatLogFor(uid, lastCheckedPcount){
        try{
            var token=getToken(); if(!token||!uid){ return Promise.resolve(''); }

            var bodyObj = {
                token:token,
                cp:'chat',
                fload:'1',
                preload:'1',
                priv:String(uid),
                pcount: lastCheckedPcount
            };

            // Carry over site chat context so server returns the right slice
            try{
                if(typeof CHAT_CTX==='object' && CHAT_CTX){
                    if(CHAT_CTX.caction) bodyObj.caction = String(CHAT_CTX.caction);
                    if(CHAT_CTX.last)    bodyObj.last    = String(CHAT_CTX.last);
                    if(CHAT_CTX.room)    bodyObj.room    = String(CHAT_CTX.room);
                    if(CHAT_CTX.notify)  bodyObj.notify  = String(CHAT_CTX.notify);
                    if(CHAT_CTX.curset)  bodyObj.curset  = String(CHAT_CTX.curset);
                    if(CHAT_CTX.lastp)  bodyObj.lastp  = String(CHAT_CTX.lastp);
                    if(CHAT_CTX.pcount)  bodyObj.pcount  = String(CHAT_CTX.pcount);
                }
            }catch(e){
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

            var body=new URLSearchParams(bodyObj).toString();
            try{
                var bodyLog = body.replace(/token=[^&]*/,'token=[redacted]');
                console.log(LOG, 'caFetchChatLogFor: Full request body:', bodyLog);
            }catch(err){ console.error(LOG, 'caFetchChatLogFor: body log error', err); }

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
        }catch(e){ console.error(e); return Promise.resolve(''); }
    }
    // Process a private chat_log.php response fetched by us
    function caProcessPrivateLogResponse(uid, response){
        try{
            // Handle empty or invalid responses
            if(!response || typeof response !== 'string' || response.trim() === ''){
                console.warn(LOG, 'Empty response for conversation', uid);
                return;
            }

            var conversationChatLog;
            try{
                conversationChatLog = JSON.parse(response);
            }catch(e){
                var prev = String(response||'').slice(0,200);
                console.warn(LOG, 'Parse failed for conversation', uid, '— preview:', prev);
                return;
            }

            // Update CHAT_CTX.last from private chat response
            try{
                if(conversationChatLog && conversationChatLog.last){
                    CHAT_CTX.last = String(conversationChatLog.last);
                }
            }catch(e){
                console.error(LOG, 'Update CHAT_CTX.last from private response error:', e);
            }

            var items = Array.isArray(conversationChatLog && conversationChatLog.pload) ? conversationChatLog.pload
                : (Array.isArray(conversationChatLog && conversationChatLog.plogs) ? conversationChatLog.plogs : []);
            if(!items.length) return;

            // Get current user's ID to filter out own messages
            var myUserId = null;
            try{
                myUserId = (typeof user_id !== 'undefined') ? String(user_id) : null;
            }catch(e){}

            // Sort by log_id to process in chronological order
            items.sort(function(a,b){ return (a.log_id||0)-(b.log_id||0); });

            var watermark = getGlobalWatermark();
            console.log(LOG, 'Processing messages for conversation', uid, '— watermark:', watermark || 'not set');

            // Only show messages with log_date >= watermark and from the other user
            var newMessages = 0;
            var skipped = { fromMe: 0, alreadyShown: 0, tooOld: 0 };
            var newestLogDate = null; // Track newest message date to update watermark

            for(var i=0; i<items.length; i++){
                var t = items[i];
                var fromId = t && t.user_id ? String(t.user_id) : null;
                var logDate = t && t.log_date ? String(t.log_date) : '';
                var logId = t && t.log_id ? String(t.log_id) : null;

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
                var shouldShow = isMessageNewer(logDate, false);

                if(!shouldShow){
                    skipped.tooOld++;
                    continue;
                }

                var uname = (t.user_name) || (fromId!=null?String(fromId):'?');
                var av  = (t.user_tumb) || '';
                var content = (t.log_content) ? String(t.log_content).replace(/\s+/g,' ').trim() : '';
                // Parse content as HTML to support emoticons (img tags), but keep username link escaped
                var details = nameAndDmHtml(uname, fromId, av) + ' — ' + content;
                logLine('pv', details);

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
        }catch(err){
            console.error(LOG, 'Process private messages error:', err);
        }
    }

    // Initialize watermark on page load
    try{
        initializeGlobalWatermark();
    }catch(err){
        console.error(LOG, 'Failed to initialize watermark:', err);
    }

    console.log(LOG,'✓ 321ChatAddons ready — activity logging, message tracking, and throttled sending enabled');
})();
