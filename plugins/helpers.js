class Helpers {
    constructor() {
        this.FEMALE_CODE = '2';
        this.verboseMode = false;
        this.debugMode = false;
    }

    init({verboseMode, debugMode}) {
        this.verboseMode = verboseMode;
        this.debugMode = debugMode;
    }

    setDebugMode(debugMode) {
        this.debugMode = debugMode;
    }

    setVerboseMode(verboseMode) {
        this.verboseMode = verboseMode;
    }

    debug(...args) {

        if (this.debugMode) {
            console.log('[DEBUG]', ...args);
        }
    };

    verbose(...args) {

        if (this.verboseMode) {
            console.log('[VERBOSE]', ...args);
        }
    };

    extractUserId(el) {
        return el.getAttribute('data-id') || null;
    }

    extractUsername(el) {
        const v = el.getAttribute('data-name');
        if (v) {
            return v.trim();
        }
        let n = this.qs('.user_name,.username,.name', el);
        if (n?.textContent) {
            return n.textContent.trim();
        }
        let t = el.getAttribute('title');
        if (t) {
            return t.trim();
        }
        const text = (el.textContent || '').trim();
        const parts = text.split(/\s+/).filter(Boolean);
        parts.sort((a, b) => a.length - b.length);
        return parts[0];
    }

    extractAvatar(el) {
        const img = this.qs('.user_item_avatar img', {
            root: el,
            ignoreWarning: true
        }) || this.qs('.profile_avatar img', {root: el, ignoreWarning: true});
        const src = img?.getAttribute('data-src') || img?.getAttribute('src') || '';
        if (!src) {
            console.warn('[CA] extractAvatar: no avatar found');
        }
        return src ? src.trim() : '';
    }

    extractGender(el) {
        return el.getAttribute('data-gender') || null;
    }

    extractIsFemale(el) {
        return el.getAttribute('data-gender') === this.FEMALE_CODE
    }

    extractRank(el) {
        return el.getAttribute('data-rank') || '';
    }

    extractAge(el) {
        return el.getAttribute('data-age') || '';
    }

    extractCountry(el) {
        return el.getAttribute('data-country') || '';
    }

    extractMood(el) {
        return this.qs(`.list_mood`, el).innerHTML;
    }

    extractUserInfoFromEl(userEl) {
        if (!userEl) {
            throw new Error(`no element is passed`);
        }
        return {
            uid: this.extractUserId(userEl),
            name: this.extractUsername(userEl),
            avatar: this.extractAvatar(userEl),
            gender: this.extractGender(userEl),
            isFemale: this.extractIsFemale(userEl),
            rank: this.extractRank(userEl),
            age: this.extractAge(userEl),
            country: this.extractCountry(userEl),
            mood: this.extractMood(userEl),
            isLoggedIn: !!(userEl && !userEl.classList.contains('offline'))
        }
    }

    buildSvgIconString(className, svgInnerHTML, small = true) {
        return `<svg class="${className} ${small ? 'svg-small' : 'svg-large'}"
                 viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        ${svgInnerHTML}
    </svg>`;
    }

    /**
     * @param {string} className
     * @param {string} svgInnerHTML
     * @param {boolean} [small]
     * @returns {SVGElement | null}
     */
    renderSvgIconWithClass(className, svgInnerHTML, small = true) {
        const el = this.createElementFromString(
            this.buildSvgIconString(className, svgInnerHTML, small)
        );

        if (!el) {
            console.error("[CA] renderSvgIconWithClass: no element created");
            return null;
        }

        if (!(el instanceof SVGElement)) {
            console.error("[CA] renderSvgIconWithClass: created element is not an <svg>", el);
            return null;
        }

        return el;
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

    parseUserSearchHTML(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const nodes = tmp.querySelectorAll('.user_item[data-id]');
        const out = [];
        for (const node of nodes) {
            const user = this.extractUserInfoFromEl(node);
            if (user?.uid) {
                out.push(user);
            }
        }
        return out;
    }

    createElementFromString(htmlString) {
        const template = document.createElement("template");
        template.innerHTML = htmlString.trim();

        return template.content.firstElementChild;
    }

    getToken() {
        if (typeof utk !== 'undefined' && utk) return utk;
        const inp = this.qs('input[name="token"]');
        if (inp?.value) return inp.value;
        const sc = this.qsa('script');
        for (let i = 0; i < sc.length; i++) {
            const t = sc[i].textContent || '';
            const m = t.match(/\butk\s*=\s*['"]([a-f0-9]{16,64})['"]/i);
            if (m) return m[1];
        }
        return null;
    }

    escapeHTML(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    escapeAttr(s) {
        return String(s).replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    trim(s) {
        return String(s || '').replace(/^\s+|\s+$/g, '');
    }

    qs(
        selector,
        options = {}
    ) {
        let root = document;
        let elementType = HTMLElement;
        let ignoreWarning = false;

        if (options instanceof HTMLElement || options instanceof Document) {
            root = options;
        } else if (options && typeof options === "object") {
            root = options.root || document;
            elementType = options.elementType || HTMLElement;
            ignoreWarning = options.ignoreWarning || false;
        }

        const el = root.querySelector(selector);

        if (!el || !(el instanceof elementType) || !(el instanceof HTMLElement)) {
            if (!ignoreWarning) {
                console.warn("[CA] qs: element not found or wrong type:", selector);
            }
            return null;
        }

        return el;
    }

    qsInput(selector, options) {
        const opts = (options instanceof HTMLElement || options instanceof Document)
            ? {root: options}
            : (options || {});

        return this.qs(selector, {
            ...opts,
            elementType: HTMLInputElement
        });
    }

    qsTextarea(selector, options) {
        const opts = (options instanceof HTMLElement || options instanceof Document)
            ? {root: options}
            : (options || {});

        return this.qs(selector, {
            ...opts,
            elementType: HTMLTextAreaElement
        });
    }

    qsForm(selector, options) {
        const opts = (options instanceof HTMLElement || options instanceof Document)
            ? {root: options}
            : (options || {});

        return this.qs(selector, {
            ...opts,
            elementType: HTMLFormElement
        });
    }


    qsa(s, r) {
        return Array.prototype.slice.call((r || document).querySelectorAll(s));
    }

    installLogImageHoverPreview(containers) {
        const filteredContainers = containers.filter(Boolean);
        if (!filteredContainers.length) {
            console.warn('[CA] installLogImageHoverPreview: no containers found to wire');
        }

        // ---- ensure preview element exists (idempotent) ----
        let preview = document.getElementById('ca-log-image-preview');
        let previewImg;

        if (preview) {
            previewImg = preview.querySelector('img');
        }

        if (!preview) {
            preview = document.createElement('div');
            preview.id = 'ca-log-image-preview';
            preview.className = 'ca-log-image-preview';
            previewImg = document.createElement('img');
            preview.appendChild(previewImg);
            document.body.appendChild(preview);
        } else if (!previewImg) {
            previewImg = document.createElement('img');
            preview.appendChild(previewImg);
        }

        const hidePreview = () => {
            preview.classList.remove('ca-visible');
        };

        const positionPreview = (evt) => {
            const margin = 16;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            const mouseX = evt.clientX;
            const mouseY = evt.clientY;

            let x = mouseX + margin;
            let y = mouseY + margin;

            const rect = preview.getBoundingClientRect();
            const w = rect.width || 200;
            const h = rect.height || 200;

            if (x + w > vw) {
                x = mouseX - w - margin;
            }
            if (y + h > vh) {
                y = mouseY - h - margin;
            }

            if (x < margin) x = margin;
            if (y < margin) y = margin;

            preview.style.left = `${x}px`;
            preview.style.top = `${y}px`;
        };

        const HOVER_SELECTOR = 'img.chat_image, img.avav';


        const attachHoverHandlers = (container) => {
            if (!container) return;

            // avoid wiring twice
            if (container.dataset.caHoverWired === '1') {
                return;
            }
            container.dataset.caHoverWired = '1';

            container.addEventListener('mouseover', (evt) => {
                const imgEl = evt.target.closest(HOVER_SELECTOR);
                if (!imgEl || !(imgEl instanceof HTMLImageElement)) {
                    return;
                }

                const src = imgEl.dataset.previewSrc || imgEl.src;
                if (!src) {
                    return;
                }

                previewImg.src = src;
                preview.classList.add('ca-visible');
                positionPreview(evt);
            });

            container.addEventListener('mousemove', (evt) => {
                if (!preview.classList.contains('ca-visible')) return;
                positionPreview(evt);
            });

            container.addEventListener('mouseout', (evt) => {
                const imgEl = evt.target.closest(HOVER_SELECTOR);
                if (!imgEl) return;

                if (!container.contains(evt.relatedTarget)) {
                    hidePreview();
                }
            });
        };

        filteredContainers.forEach((container) => attachHoverHandlers(container));
    }
}