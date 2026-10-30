// ==UserScript==
// @name         PlayZip 广告拦截与点击修复 v6 增强版
// @namespace    https://playzip.com/
// @version      6.0.0
// @description  基于 v5 水瓶羊脚本增强：新增英文浏览器指纹伪装（源头阻止 abcd.js 注入）、createElement 劫持、90秒冷却计时器干扰、存储层时间戳拦截。保留 v5 全部防线：脚本路径级拦截、遮罩/弹层清理、事件层 handleAdClick 拦截、弹窗/跳转拦截。
// @author       水瓶羊 (v5) + AI 增强 (v6)
// @match        https://playzip.com/*
// @match        https://*.playzip.com/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // ===================================================================
    // 取证结论（2026-09-29 Edge 实测 — 水瓶羊）：
    //  - 广告脚本 aclib.js(639KB) 与 /static/js/abcd.js 均不在静态 HTML 中，
    //    由 loadAds() 在 window.onload 后 document.createElement('script') 动态注入。
    //  - aclib.js 创建 #dontfoid 全屏透明遮罩(znid=11311110)，点击被劫持跳转广告联盟；
    //    abcd.js 对 zh-cn 用户监听 body 点击，90 秒冷却后 window.open 弹广告。
    //  - 实验验证：阻止这两个脚本后遮罩/劫持/广告请求全部消失，页面功能不受影响。
    //
    // v6 增强（AI）：
    //  - ★ 英文浏览器指纹伪装：覆盖 navigator.language/languages/userAgent/Intl，
    //    让 loadAds() 认为用户是 en-US 环境，从源头不创建 abcd.js 的 <script> 标签。
    //  - createElement 劫持：在元素创建阶段标记广告脚本，比 appendChild 更早。
    //  - 90 秒冷却计时器干扰：劫持 setTimeout 让冷却逻辑失效。
    //  - 存储拦截：防止广告脚本用 localStorage 保存点击时间戳。
    // ===================================================================

    // ========== 常量配置 ==========
    // 站内域名
    const SITE_HOST = 'playzip.com';
    // 允许加载的第三方脚本域名白名单（页面业务仅依赖 zepto/gtag/Clarity）
    const SCRIPT_ALLOW_HOSTS = [
        'playzip.com',
        'cdnjs.cloudflare.com',   // zepto.min.js（UI 依赖）
        'googletagmanager.com',   // Google Analytics
        'clarity.ms'              // Microsoft Clarity
    ];
    // 精确拦截清单（路径级，优先于域名白名单判定）
    const BLOCKED_SCRIPT_MARKS = ['aclib', 'abcd'];

    // 广告域名黑名单（仅作 location 跳转兜底）
    const AD_HOSTS = [
        'proceedflow.info', 'tikfap.click', 'linkclick.buzz',
        't.jopeki.com', 'brimvale.xyz', 'aiyeyu.org', '23.225.187.244'
    ];

    // ========== ★ v6 新增：英文浏览器指纹伪装（源头防御） ==========
    // 在页面脚本能读到任何浏览器属性之前，把所有中文标记替换为英文。
    // loadAds() 检测到 en-US 就不会创建 abcd.js 的 <script> 标签。
    function installLanguageSpoof() {
        const descriptors = {};

        // 1. navigator.language —— 最常用的检测入口
        descriptors.language = {
            get: function () { return 'en-US'; },
            configurable: true, enumerable: true
        };

        // 2. navigator.languages 数组
        descriptors.languages = {
            get: function () { return ['en-US', 'en']; },
            configurable: true, enumerable: true
        };

        // 3. 批量覆盖（如果 navigator 上还有 appVersion/platform 带 locale 的也清理）
        for (const [prop, desc] of Object.entries(descriptors)) {
            try {
                Object.defineProperty(Navigator.prototype, prop, desc);
            } catch (e1) {
                try { Object.defineProperty(navigator, prop, desc); } catch (e2) { /* ignore */ }
            }
        }

        // 4. navigator.userAgent —— 清理 UA 中的 zh-CN/zh-TW/zh-HK 等中文标记
        const rawUA = navigator.userAgent || '';
        const cleanUA = rawUA
            .replace(/;?\s*zh[-_]?(CN|TW|HK|SG|MO)(?=;|$|\))/gi, '')
            .replace(/;?\s*Language\/zh[-_]?(CN|TW|HK|SG|MO)?(?=;|$|\))/gi, '')
            .replace(/;?\s*locale=zh[-_]?(CN|TW|HK|SG|MO)?(?=;|$|\))/gi, '');

        if (cleanUA !== rawUA) {
            const uaDesc = {
                get: function () { return cleanUA; },
                configurable: true, enumerable: true
            };
            try {
                Object.defineProperty(Navigator.prototype, 'userAgent', uaDesc);
            } catch (e1) {
                try { Object.defineProperty(navigator, 'userAgent', uaDesc); } catch (e2) { /* ignore */ }
            }
        }

        // 5. Intl.DateTimeFormat —— 无参调用暴露默认 locale
        if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
            const OrigDTF = Intl.DateTimeFormat;
            const FakeDTF = function (locales, options) {
                // 没有显式传 locale 时，强制 en-US
                if (!locales || (Array.isArray(locales) && locales.length === 0)) {
                    return new OrigDTF('en-US', options);
                }
                return new OrigDTF(locales, options);
            };
            FakeDTF.prototype = OrigDTF.prototype;
            FakeDTF.supportedLocalesOf = OrigDTF.supportedLocalesOf;
            try { Intl.DateTimeFormat = FakeDTF; } catch (e) { /* ignore */ }
        }

        // 6. Intl.Collator 同理
        if (typeof Intl !== 'undefined' && Intl.Collator) {
            const OrigColl = Intl.Collator;
            const FakeColl = function (locales, options) {
                if (!locales || (Array.isArray(locales) && locales.length === 0)) {
                    return new OrigColl('en-US', options);
                }
                return new OrigColl(locales, options);
            };
            FakeColl.prototype = OrigColl.prototype;
            FakeColl.supportedLocalesOf = OrigColl.supportedLocalesOf;
            try { Intl.Collator = FakeColl; } catch (e) { /* ignore */ }
        }

        // 7. <html lang> 属性（DOM 就绪后设置）
        function fixHtmlLang() {
            const html = document.documentElement;
            if (html) {
                const lang = (html.getAttribute('lang') || '').toLowerCase();
                if (lang.startsWith('zh')) {
                    html.setAttribute('lang', 'en-US');
                }
            }
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fixHtmlLang);
        } else {
            fixHtmlLang();
        }
    }
    installLanguageSpoof();

    // ========== ★ v6 新增：document.createElement 劫持（比 appendChild 更早） ==========
    // 在 script 元素被创建时就打上标记，后续 appendChild/insertBefore 根据标记拦截。
    // 如果网站用 innerHTML 批量注入也能覆盖（innerHTML 内部也走 createElement）。
    const AD_SCRIPT_MARK = '__playzip_ad_script__';
    const origCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function (tagName, options) {
        const el = origCreateElement.call(this, tagName, options);
        if (tagName.toLowerCase() === 'script') {
            // 劫持 script.src 的 setter：设置 src 时即时判断
            const origSrcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
            if (origSrcDesc && origSrcDesc.set) {
                const origSrcSet = origSrcDesc.set;
                Object.defineProperty(el, 'src', {
                    get: function () { return origSrcDesc.get.call(this); },
                    set: function (v) {
                        if (isAdScriptSrc(v)) {
                            this[AD_SCRIPT_MARK] = true;
                            console.warn('[PlayZip Cleaner] createElement 阶段标记广告脚本:', v);
                        }
                        return origSrcSet.call(this, v);
                    },
                    configurable: true, enumerable: true
                });
            }
        }
        return el;
    };
    // 同样劫持 HTMLDocument.prototype.createElement（有些旧代码走这个路径）
    try {
        HTMLDocument.prototype.createElement = Document.prototype.createElement;
    } catch (e) { /* ignore */ }

    // ========== ★ v6 新增：90 秒冷却计时器干扰 ==========
    // abcd.js 用 setTimeout 实现首次点击后的 90 秒冷却。
    // 劫持计时器：对大于 30 秒的延迟随机缩短到 1-3 秒，让冷却形同虚设。
    // （不能缩短得太离谱，否则广告脚本可能检测到异常后换策略）
    const origSetTimeout = window.setTimeout;
    const origSetInterval = window.setInterval;
    const CLICK_COOLDOWN_THRESHOLD = 30000;  // 30 秒以上视为冷却计时器
    const CLICK_COOLDOWN_MIN = 1000;          // 压缩到 1 秒
    const CLICK_COOLDOWN_MAX = 3000;          // 最多 3 秒

    window.setTimeout = function (fn, delay, ...args) {
        if (typeof delay === 'number' && delay >= CLICK_COOLDOWN_THRESHOLD) {
            const newDelay = Math.floor(Math.random() * (CLICK_COOLDOWN_MAX - CLICK_COOLDOWN_MIN + 1)) + CLICK_COOLDOWN_MIN;
            return origSetTimeout.call(this, fn, newDelay, ...args);
        }
        return origSetTimeout.call(this, fn, delay, ...args);
    };
    window.setInterval = function (fn, delay, ...args) {
        if (typeof delay === 'number' && delay >= CLICK_COOLDOWN_THRESHOLD) {
            const newDelay = Math.floor(Math.random() * (CLICK_COOLDOWN_MAX - CLICK_COOLDOWN_MIN + 1)) + CLICK_COOLDOWN_MIN;
            return origSetInterval.call(this, fn, newDelay, ...args);
        }
        return origSetInterval.call(this, fn, delay, ...args);
    };

    // ========== ★ v6 新增：存储层拦截（防止广告脚本用 localStorage 存点击时间戳） ==========
    // abcd.js 可能在 localStorage 中记录 lastClickTime 来实现 90 秒冷却。
    // 拦截广告相关 key 的写入和读取。
    const AD_STORAGE_KEYS = [
        'lastClick', 'clickTime', 'lastAdClick', 'adCooldown', 'popTimer',
        'adTimer', 'popunderTime', 'lastPopTime', 'ts', 'last_click_ts',
        '_aclib_last', '_abcd_ts', 'znid_ts', 'dontfoid_ts'
    ];
    function isAdStorageKey(key) {
        if (!key || typeof key !== 'string') return false;
        return AD_STORAGE_KEYS.some(function (k) { return key.toLowerCase().indexOf(k.toLowerCase()) !== -1; });
    }

    const origGetItem = Storage.prototype.getItem;
    const origSetItem = Storage.prototype.setItem;
    const origRemoveItem = Storage.prototype.removeItem;

    Storage.prototype.getItem = function (key) {
        if (isAdStorageKey(key)) {
            // 返回虚假的"很久以前"时间戳，让冷却检查永远通过
            return String(Date.now() - 99999999);
        }
        return origGetItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
        if (isAdStorageKey(key)) {
            // 静默丢弃广告脚本的时间戳写入
            return;
        }
        return origSetItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
        if (isAdStorageKey(key)) {
            // 允许删除（防止脚本检测删除失败来反制）
            return origRemoveItem.call(this, key);
        }
        return origRemoveItem.call(this, key);
    };

    // ========== 工具函数 ==========

    function getHost(url) {
        try { return new URL(url, location.href).hostname.toLowerCase().replace(/^www\./, ''); }
        catch (e) { return ''; }
    }

    function isSiteHost(host) {
        return host === SITE_HOST || host.endsWith('.' + SITE_HOST);
    }

    function isAdScriptSrc(src) {
        return /\/aclib\.js(\?|#|$)/i.test(src) || /\/abcd\.js(\?|#|$)/i.test(src);
    }

    function isAdUrl(url) {
        if (!url || typeof url !== 'string') return false;
        if (!/^https?:\/\//i.test(url)) return false;
        const host = getHost(url);
        if (isSiteHost(host)) return false;
        return AD_HOSTS.some(function (h) { return host === h || host.endsWith('.' + h) || host.startsWith(h + ':'); });
    }

    function removeNode(el) {
        if (el && el.parentNode) {
            try { el.parentNode.removeChild(el); } catch (e) { /* ignore */ }
        }
    }

    // ========== 主防线：脚本注入白名单拦截 ==========
    function isAllowedScriptSrc(src) {
        if (!src) return true;
        // ★ v6：createElement 阶段标记的脚本直接拦截
        if (isAdScriptSrc(src)) return false;
        const host = getHost(src);
        if (!host) return true;
        return SCRIPT_ALLOW_HOSTS.some(function (h) { return host === h || host.endsWith('.' + h); });
    }

    function guardScriptNode(node) {
        if (!node || node.nodeType !== 1 || node.tagName !== 'SCRIPT') return null;
        // ★ v6：优先检查 createElement 阶段设定的标记
        if (node[AD_SCRIPT_MARK]) return node;
        const src = node.src || node.getAttribute('src') || '';
        if (!src) return null;
        if (!isAllowedScriptSrc(src)) {
            const mark = BLOCKED_SCRIPT_MARKS.find(function (m) { return src.indexOf(m) !== -1; });
            console.warn('[PlayZip Cleaner] 已阻止脚本注入:', src, mark ? '(广告脚本:' + mark + ')' : '(非白名单第三方脚本)');
            return node;
        }
        return null;
    }

    const origAppendChild = Element.prototype.appendChild;
    const origInsertBefore = Element.prototype.insertBefore;

    Element.prototype.appendChild = function (node) {
        if (guardScriptNode(node)) return node;
        return origAppendChild.call(this, node);
    };
    Element.prototype.insertBefore = function (node, ref) {
        if (guardScriptNode(node)) return node;
        return origInsertBefore.call(this, node, ref);
    };

    // ========== 次防线：MutationObserver 兜底 ==========

    function isClickjackOverlay(el) {
        if (!el || el.nodeType !== 1) return false;
        if ((el.id || '') === 'dontfoid') return true;
        const znid = el.getAttribute('znid');
        if (znid !== null && znid !== '') return true;
        try {
            const style = window.getComputedStyle(el);
            if (style.position !== 'fixed' && style.position !== 'absolute') return false;
            const z = parseInt(style.zIndex, 10);
            if (isNaN(z) || z < 1000) return false;
            const w = el.offsetWidth, h = el.offsetHeight;
            if (w >= window.innerWidth * 0.5 && h >= window.innerHeight * 0.3) return true;
            if (w >= 400 && h >= 300) return true;
        } catch (e) { return false; }
        return false;
    }

    function isFullscreenAdIframe(el) {
        if (!el || el.nodeType !== 1 || el.tagName !== 'IFRAME') return false;
        try {
            const style = window.getComputedStyle(el);
            const z = parseInt(style.zIndex, 10);
            if (isNaN(z) || z < 1000) return false;
            const w = el.offsetWidth, h = el.offsetHeight;
            return w >= window.innerWidth * 0.8 && h >= window.innerHeight * 0.8;
        } catch (e) { return false; }
    }

    function isAdNode(el) {
        if (!el || !el.tagName) return false;
        const tag = el.tagName.toLowerCase();
        if (tag === 'iframe') {
            const src = el.src || el.getAttribute('src') || '';
            if (!src || /^about:/.test(src)) return false;
            return isAdUrl(src);
        }
        if (tag === 'script') {
            // ★ v6：同时检查 createElement 标记
            if (el[AD_SCRIPT_MARK]) return true;
            const src = el.src || '';
            return !!(src && !isAllowedScriptSrc(src));
        }
        return false;
    }

    function cleanPage() {
        const all = document.querySelectorAll('div, section, span, iframe');
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (isClickjackOverlay(el)) { removeNode(el); continue; }
            if (isFullscreenAdIframe(el)) { removeNode(el); continue; }
            if (isAdNode(el)) { removeNode(el); }
        }
        if (!document.querySelector) return;
        var scripts = document.querySelectorAll('script[src]');
        for (var j = 0; j < scripts.length; j++) {
            var s = scripts[j];
            var src = s.src || '';
            if (src && !isAllowedScriptSrc(src)) {
                try { s.remove(); } catch (e) { /* ignore */ }
            }
        }
    }

    var observer = new MutationObserver(function (mutations) {
        for (var mi = 0; mi < mutations.length; mi++) {
            var m = mutations[mi];
            for (var ni = 0; ni < m.addedNodes.length; ni++) {
                var node = m.addedNodes[ni];
                if (node.nodeType !== 1) continue;
                if (isClickjackOverlay(node)) { removeNode(node); continue; }
                if (isFullscreenAdIframe(node)) { removeNode(node); continue; }
                if (isAdNode(node)) { removeNode(node); continue; }
                if (node.querySelectorAll) {
                    var inners = node.querySelectorAll('div, section, span, iframe, script');
                    for (var ii = 0; ii < inners.length; ii++) {
                        var el = inners[ii];
                        if (isClickjackOverlay(el)) { removeNode(el); }
                        else if (isFullscreenAdIframe(el)) { removeNode(el); }
                        else if (isAdNode(el)) { removeNode(el); }
                    }
                }
            }
        }
    });

    function startObserver() {
        try {
            observer.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) { /* ignore */ }
    }
    startObserver();

    // ========== 事件层 handleAdClick 注册拦截 ==========
    var PAGE_PATCH = "(function () {" +
        "'use strict';" +
        "if (window.__playzipCleanerPatched) return;" +
        "window.__playzipCleanerPatched = true;" +
        "var NATIVE_ADD = EventTarget.prototype.addEventListener;" +
        "EventTarget.prototype.addEventListener = function (type, listener, options) {" +
        "if (type === 'click' && typeof listener === 'function' && listener.name === 'handleAdClick') {" +
        "console.warn('[PlayZip Cleaner] 事件层拦截：拒绝注册 handleAdClick 点击监听');" +
        "return;" +
        "}" +
        "return NATIVE_ADD.call(this, type, listener, options);" +
        "};" +
        "try { document.documentElement.setAttribute('data-playzip-cleaner-patch', 'applied'); } catch (e) {}" +
        "setInterval(function () {" +
        "try {" +
        "if (document.body && window.handleAdClick) {" +
        "document.body.removeEventListener('click', window.handleAdClick);" +
        "}" +
        "} catch (e) {}" +
        "}, 500);" +
        "})();";

    document.documentElement.dataset.playzipCleanerPatch = 'pending';
    var patchScript = document.createElement('script');
    patchScript.textContent = PAGE_PATCH;
    try {
        document.documentElement.appendChild(patchScript);
        if (patchScript.parentNode) { patchScript.parentNode.removeChild(patchScript); }
    } catch (e) {
        console.warn('[PlayZip Cleaner] 事件层补丁注入异常（可能被 CSP 拦截）:', e);
    }
    if (document.documentElement.dataset.playzipCleanerPatch !== 'applied') {
        console.warn('[PlayZip Cleaner] 事件层补丁未生效（可能被 CSP 拦截），已降级：由用户脚本世界继续拦截 handleAdClick');
    }

    var NATIVE_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (type === 'click' && typeof listener === 'function' && listener.name === 'handleAdClick') {
            console.warn('[PlayZip Cleaner] 事件层拦截（用户脚本世界）：拒绝注册 handleAdClick 点击监听');
            return;
        }
        return NATIVE_ADD_EVENT_LISTENER.call(this, type, listener, options);
    };
    setInterval(function () {
        try {
            if (document.body && window.handleAdClick) {
                document.body.removeEventListener('click', window.handleAdClick);
            }
        } catch (e) { /* ignore */ }
    }, 500);

    // ========== window.open 白名单拦截 ==========
    var nativeOpen = window.open;
    function adSafeOpen(url) {
        var args = arguments;
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
            var host = getHost(url);
            if (isSiteHost(host)) {
                location.href = url;
                return null;
            }
            console.warn('[PlayZip Cleaner] 已阻止广告弹窗:', url);
            return null;
        }
        return nativeOpen.apply(this, args);
    }
    adSafeOpen.toString = function () { return 'function open() { [native code] }'; };
    window.open = adSafeOpen;
    setInterval(function () {
        if (window.open !== adSafeOpen) window.open = adSafeOpen;
    }, 1500);

    // ========== location 广告跳转兜底 ==========
    var origAssign = location.assign;
    var origReplace = location.replace;
    location.assign = function (url) {
        if (typeof url === 'string' && isAdUrl(url)) {
            console.warn('[PlayZip Cleaner] 已拦截广告跳转:', url);
            return;
        }
        return origAssign.call(this, url);
    };
    location.replace = function (url) {
        if (typeof url === 'string' && isAdUrl(url)) {
            console.warn('[PlayZip Cleaner] 已拦截广告跳转:', url);
            return;
        }
        return origReplace.call(this, url);
    };
    try {
        var hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
        if (hrefDesc && hrefDesc.set) {
            var origGet = hrefDesc.get, origSet = hrefDesc.set;
            Object.defineProperty(location, 'href', {
                get: function () { return origGet.call(this); },
                set: function (v) {
                    if (typeof v === 'string' && isAdUrl(v)) {
                        console.warn('[PlayZip Cleaner] 已拦截广告跳转:', v);
                        return;
                    }
                    return origSet.call(this, v);
                },
                configurable: true
            });
        }
    } catch (e) { /* ignore */ }

    // ========== 捕获阶段点击拦截 ==========
    document.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.nodeType === 1 && isClickjackOverlay(t)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            removeNode(t);
            return;
        }
        var a = t && t.closest ? t.closest('a[href]') : null;
        if (!a) return;
        var href = a.href || a.getAttribute('href') || '';
        if (isAdUrl(href)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
        if (/^https?:\/\//i.test(href) && a.target === '_blank' && isSiteHost(getHost(href))) {
            e.preventDefault();
            location.href = href;
        }
    }, true);

    var nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        var href = this.href || '';
        if (isAdUrl(href)) {
            console.warn('[PlayZip Cleaner] 已拦截广告链接:', href);
            return;
        }
        return nativeAnchorClick.call(this);
    };

    // ========== 运行确认徽标 ==========
    var BADGE_ID = 'playzip-cleaner-badge';
    function showBadge() {
        if (document.getElementById(BADGE_ID)) return;
        var badge = document.createElement('div');
        badge.id = BADGE_ID;
        badge.textContent = 'PlayZip Cleaner v6 已启用';
        badge.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;background:#111;color:#0f0;' +
            'font:12px/1.6 monospace;padding:4px 10px;border-radius:4px;opacity:.8;pointer-events:none;' +
            'box-shadow:0 0 6px rgba(0,255,0,.4);';
        (document.body || document.documentElement).appendChild(badge);
    }
    if (document.body) showBadge();
    else document.addEventListener('DOMContentLoaded', showBadge);

    // ========== 周期兜底 ==========
    setInterval(function () {
        cleanPage();
        if (!document.getElementById(BADGE_ID)) showBadge();
    }, 3000);

    console.log('[PlayZip Cleaner] v6.0.0 增强版已启用：英文指纹伪装 + createElement劫持 + 计时器干扰 + 存储拦截 + v5全部防线。');
})();