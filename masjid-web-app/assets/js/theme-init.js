(function () {
    /* Squelch extension-related console clutter (e.g. MetaMask inpage script errors) */
    window.addEventListener('unhandledrejection', function (event) {
        if (event.reason && (
            (event.reason.message && event.reason.message.includes('MetaMask')) ||
            (event.reason.stack && event.reason.stack.includes('inpage.js')) ||
            (typeof event.reason === 'string' && event.reason.includes('MetaMask'))
        )) {
            event.preventDefault();
        }
    });

    // ── One-time Platform Detection (runs once per page load) ──
    var ua = navigator.userAgent.toLowerCase();

    // Early config lookup to avoid hardcoded hostnames
    var earlyConfig = (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : null) ||
        (function () { try { return window.parent.APP_CONFIG; } catch (e) { return null; } })();
    var capHostname = (earlyConfig && earlyConfig.masjidCapacitorHostname) ? earlyConfig.masjidCapacitorHostname : 'masjid-app';

    // Robust early platform detection for Android Capacitor (handles race conditions)
    window.isAndroidApp = (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android') ||
        (ua.includes('android') && (window.location.hostname === 'localhost' || window.location.hostname === capHostname || ua.includes('wv')));

    window.isNative = window.isAndroidApp || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (!window.isNative) {
        try {
            if (window.parent && window.parent !== window && window.parent.isNative) {
                window.isNative = true;
                if (window.parent.isAndroidApp) window.isAndroidApp = true;
            }
        } catch (e) { /* cross-origin iframe */ }
    }
    window.isChromium = /chrome|crios/.test(ua) && !/firefox|fxios|edg\//.test(ua);
    window.isSafari = /safari/.test(ua) && !/chrome|crios|firefox|fxios|edg\//.test(ua);
    window.isIOS = /iphone|ipad|ipod/.test(ua);
    window.isVibrationSupported = window.isNative || window.isChromium || window.isSafari || window.isIOS;

    window.isTV = ua.includes('masjid-tv') || (
        (window.Capacitor && window.Capacitor.getPlatform() === 'android') && (
            ua.includes('tv') ||
            ua.includes('leanback') ||
            ua.includes('largescreen') ||
            !ua.includes('mobile')
        )
    );

    if (window.isTV) {
        document.documentElement.classList.add("is-tv");
    }

    if (window.isNative) {
        document.documentElement.classList.add("is-native");
        if (window.parent && window.parent !== window) {
            try {
                var parentStyle = window.parent.document.documentElement.style;
                ['top', 'right', 'bottom', 'left'].forEach(function (dir) {
                    var val = parentStyle.getPropertyValue('--safe-area-inset-' + dir);
                    if (val) {
                        document.documentElement.style.setProperty('--safe-area-inset-' + dir, val);
                    }
                });
            } catch (e) { /* cross-origin */ }
        }
    }

    window.applyTheme = function () {
        let darkModeEnv = localStorage.getItem("darkMode");

        // Default to true specifically on Android TV if not set
        if (darkModeEnv === null) {
            if (window.isTV) {
                localStorage.setItem("darkMode", "true");
                darkModeEnv = "true";
            }
        }

        const isDark = darkModeEnv === "true";
        if (isDark) {
            document.documentElement.classList.add("dark-mode");
        } else {
            document.documentElement.classList.remove("dark-mode");
        }

        // Update theme toggle button icon if DOM is ready
        var themeBtn = document.getElementById('theme-toggle-btn');
        if (themeBtn) {
            var themeIcon = themeBtn.querySelector('i');
            if (themeIcon) {
                themeIcon.className = isDark ? 'mdi mdi-white-balance-sunny' : 'mdi mdi-weather-night';
            }
            themeBtn.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
        }
    }

    window.toggleTheme = function (isDark) {
        // If isDark is not provided, toggle the current state
        if (isDark === undefined) {
            isDark = localStorage.getItem("darkMode") !== "true";
        }

        const darkStr = isDark ? "true" : "false";
        localStorage.setItem("darkMode", darkStr);

        // Apply to current window
        window.applyTheme();

        // Apply to parent window if inside iframe
        try {
            if (window.parent && window.parent !== window && window.parent.applyTheme) {
                window.parent.applyTheme();
            } else if (window.parent && window.parent.document) {
                if (isDark) window.parent.document.documentElement.classList.add("dark-mode");
                else window.parent.document.documentElement.classList.remove("dark-mode");
            }
        } catch (e) {
            // Handle cross-origin errors if loaded in a different domain (unlikely here)
        }

        // Dispatch storage event manually for same-window listeners if needed
        window.dispatchEvent(new StorageEvent('storage', {
            key: 'darkMode',
            newValue: darkStr
        }));
    };

    // Shared Utility Functions
    window.escapeHTML = function (str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    window.sanitizeHTML = function (html) {
        if (!html) return '';
        const doc = new DOMParser().parseFromString(html, 'text/html');
        // Remove script, iframe, object, embed, form tags
        const dangerous = doc.querySelectorAll('script, iframe, object, embed, form, style, base, meta, svg, link[rel="import"]');
        dangerous.forEach(el => el.remove());
        // Remove on* event attributes and dangerous href/src protocols from all elements
        doc.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                const cleanValue = attr.value.replace(/[\x00-\x20]/g, '').toLowerCase();
                if (attr.name.toLowerCase().startsWith('on') ||
                    cleanValue.startsWith('javascript:') ||
                    (cleanValue.startsWith('data:') && !cleanValue.startsWith('data:image/')) ||
                    cleanValue.startsWith('vbscript:')) {
                    el.removeAttribute(attr.name);
                }
            });
        });
        return doc.body.innerHTML;
    };

    window.formatDate = function (dateString, includeWeekday = false) {
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        if (includeWeekday) options.weekday = 'long';
        return new Date(dateString).toLocaleDateString('en-GB', options);
    };

    window.formatTime = function (dateString) {
        return new Date(dateString).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    };

    window.closeModal = function (modalId, event) {
        if (event) event.stopPropagation();
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    };

    window.triggerVibrate = function (pattern) {
        let vibrated = false;
        try {
            if (navigator && typeof navigator.vibrate === 'function') {
                vibrated = navigator.vibrate(pattern);
            }
        } catch (e) { }

        if (!vibrated) {
            try {
                if (window.parent && window.parent.navigator && typeof window.parent.navigator.vibrate === 'function') {
                    window.parent.navigator.vibrate(pattern);
                }
            } catch (e) { }
        }
    };

    window.createRipple = function (event) {
        const button = event.currentTarget;
        if (!button) return;

        const circle = document.createElement('span');
        const diameter = Math.max(button.clientWidth, button.clientHeight);
        const radius = diameter / 2;
        const rect = button.getBoundingClientRect();

        const clientX = event.clientX || (event.touches && event.touches.length > 0 ? event.touches[0].clientX : 0);
        const clientY = event.clientY || (event.touches && event.touches.length > 0 ? event.touches[0].clientY : 0);

        circle.style.width = circle.style.height = `${diameter}px`;
        circle.style.left = `${clientX - rect.left - radius}px`;
        circle.style.top = `${clientY - rect.top - radius}px`;
        circle.classList.add('ripple');

        circle.addEventListener('animationend', () => {
            circle.remove();
        });

        // Robust cleanup fallback if animation doesn't fire (e.g. display: none)
        setTimeout(() => {
            if (circle.parentNode) circle.remove();
        }, 800);

        const ripple = button.getElementsByClassName('ripple')[0];
        if (ripple) { ripple.remove(); }

        button.appendChild(circle);
    };

    window.clearRipples = function (container) {
        const ripples = (container || document).querySelectorAll('.ripple');
        ripples.forEach(r => r.remove());
    };

    /**
     * Centralized branding HTML generator
     * @param {boolean} logoOnly - If true, only returns the logo link without the site name span
     * @returns {string} - The branding HTML string
     */
    window.getBrandLogoHTML = function (logoOnly = false) {
        const config = (window.parent && window.parent.APP_CONFIG) || (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : null);
        if (!config) return '';

        // Determine relative path to assets/ based on current file location
        // Assets are in /assets/ while pages are in / (root) or /assets/files/
        const isSubDir = window.location.pathname.includes('/assets/files/');
        const logoPath = isSubDir ? config.masjidLogoPath.replace('assets/', '../') : config.masjidLogoPath;

        const mName = config.masjidName;
        const mSite = config.masjidSite;

        // Escape URL and display values before embedding in HTML attributes
        const esc = window.escapeHTML;
        const targetUrl = config.masjidBaseUrl;
        const safeUrl = esc ? esc(targetUrl) : String(targetUrl).replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const safeLogoPath = esc ? esc(logoPath) : String(logoPath).replace(/"/g, '&quot;');
        const safeName = esc ? esc(mName) : String(mName).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeSite = esc ? esc(mSite) : String(mSite).replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const logoHtml = `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer"><img src="${safeLogoPath}" alt="${safeName} Logo"></a>`;

        if (logoOnly) return logoHtml;
        const siteHtml = `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: none;"><span>${safeSite}</span></a>`;
        return `${logoHtml}${siteHtml}`;
    };

    window.injectBranding = function () {
        const config = (window.parent && window.parent.APP_CONFIG) || (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : null);
        if (!config) return;

        const isSubDir = window.location.pathname.includes('/assets/files/');

        // Update standard page brand sections
        const brandContainers = document.querySelectorAll('.page-brand');
        brandContainers.forEach(container => {
            container.innerHTML = window.getBrandLogoHTML();
        });

        // Update Full Screen iqamah logo sections
        const fsLogoContainers = document.querySelectorAll('.iqamah-fs-logo');
        fsLogoContainers.forEach(container => {
            container.innerHTML = window.getBrandLogoHTML(true);
        });

        // Inject building image as a CSS variable for style.css
        const buildingPath = isSubDir ? config.masjidBuildingImagePath.replace('assets/', '../') : config.masjidBuildingImagePath;
        document.documentElement.style.setProperty('--masjid-building-image', `url('${buildingPath}')`);
    };

    // Auto-wire theme toggle button click and branding injection on DOM ready
    document.addEventListener('DOMContentLoaded', function () {
        var btn = document.getElementById('theme-toggle-btn');
        if (btn && !btn._themeWired) {
            btn._themeWired = true;
            btn.addEventListener('click', function () { window.toggleTheme(); });
            window.applyTheme(); // sync icon now that DOM exists
        }
        window.injectBranding();
    });

    // Apply on load
    window.applyTheme();

    // Listen for changes from other windows/iframes
    if (!window._darkModeStorageListenerWired) {
        window._darkModeStorageListenerWired = true;
        window.addEventListener('storage', (e) => {
            if (e.key === 'darkMode') {
                window.applyTheme();
            }
        });
    }
})();
