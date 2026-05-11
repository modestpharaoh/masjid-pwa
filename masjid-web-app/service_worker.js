importScripts('version.js');
// Cache buster for new assets (fonts, icons) - Updated for Global Footer Safe Area padding
const STATIC_CACHE_NAME = `my-simple-pwa-static-cache-v${APP_VERSION}`;
const DYNAMIC_CACHE_NAME = `my-simple-pwa-dynamic-cache-v${APP_VERSION}`;
const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000; // One day in milliseconds

// Quran resources use separate caches per resource type and ID.
// Cache names follow: quran-text-{script}, quran-recitation-{id}-{chapter}, quran-translation-{id}, quran-tafsir-{id}
// The SW routes API URLs to the correct cache automatically.
// Audio files (verses.quran.com) are cached by JS code in recitation caches.
function getQuranCacheName(url) {
    // Tafsir API (v3 per-verse and v4 by-chapter)
    let m = url.match(/\/tafsirs\/(\d+)/);
    if (m) return `quran-tafsir-${m[1]}`;
    // Recitation metadata
    m = url.match(/\/recitations\/(\d+)\/by_chapter\/(\d+)/);
    if (m) return `quran-recitation-${m[1]}-${m[2]}`;
    // Audio files — cached explicitly by JS, not the SW
    if (url.includes('verses.quran.com')) return null;
    // Verse requests
    if (url.includes('/verses/by_chapter/')) {
        // Single translation (download manager uses single ID per request)
        const st = url.match(/[?&]translations=(\d+)(?:&|$)/);
        if (st) return `quran-translation-${st[1]}`;
        // Determine script from fields parameter for text cache
        const f = url.match(/[?&]fields=text_(\w+)/);
        if (f) {
            const s = f[1];
            if (s.startsWith('uthmani_tajweed')) return 'quran-text-uthmani_tajweed';
            if (s.startsWith('uthmani')) return 'quran-text-uthmani';
            if (s.startsWith('indopak')) return 'quran-text-indopak';
            return `quran-text-${s}`;
        }
    }
    return null;
}

const staticUrlsToCache = [
    './',
    'version.js',
    'assets/js/theme-init.js',
    'assets/css/materialdesignicons.min.css',
    'assets/css/style.css',
    'assets/css/style-static.css',
    'assets/fonts/materialdesignicons-webfont.eot',
    'assets/fonts/materialdesignicons-webfont.ttf',
    'assets/fonts/materialdesignicons-webfont.woff',
    'assets/fonts/materialdesignicons-webfont.woff2',
    'assets/fonts/indopak-nastaleeq.ttf',
    'assets/fonts/indopak-nastaleeq.woff',
    'assets/fonts/indopak-nastaleeq.woff2',
    'assets/fonts/pdms-saleem-indopak.otf',
    'assets/fonts/me-quran.ttf',
    'assets/icons/favicon.png',
    'assets/icons/apple-touch-icon.png',
    'assets/icons/apple-touch-icon-152x152.png',
    'assets/icons/apple-touch-icon-167x167.png',
    'assets/icons/icon_x128.png',
    'assets/icons/icon_x192.png',
    'assets/icons/icon_x384.png',
    'assets/icons/icon_x512.png',
    'assets/icons/maskable_icon_x128.png',
    'assets/icons/maskable_icon_x192.png',
    'assets/icons/maskable_icon_x384.png',
    'assets/icons/maskable_icon_x512.png',
    'assets/icons/icon_monochrome_x512.png',
    'assets/images/backgrounds/masjid-building-optimized.svg',
    'assets/images/backgrounds/custom-masjid-building.svg',
    'assets/images/backgrounds/custom-masjid-building.webp',
    'assets/images/backgrounds/custom-masjid-building.png',
    'assets/images/backgrounds/fanos.svg',
    'assets/images/backgrounds/crescent.svg',
    'assets/images/backgrounds/aya-num-bg.svg',
    'assets/images/backgrounds/islamic-pattern.svg',
    'assets/images/logos/masjid-logo.png',
    'assets/images/logos/custom-masjid-logo.svg',
    'assets/images/logos/custom-masjid-logo.webp',
    'assets/images/logos/custom-masjid-logo.png',
    'assets/js/config.js',
    'assets/js/celestial.js',
    'assets/js/hijri-converter.js',
    'assets/js/prayers-tables.js',
    'assets/files/prayers-tables.html',
    'assets/js/prayer-times.js',
    'assets/js/prayer-export.js',
    'assets/js/export-handler.js',
    'assets/js/qrcode.min.js',
    'assets/js/jspdf.umd.min.js',
    'assets/js/jspdf.plugin.autotable.min.js',
    'assets/files/prayer-times.html',
    'assets/data/prayers-schedule.json',
    'assets/js/azan-settings.js',
    'assets/files/azan-settings.html',
    'assets/files/qiblah.html',
    'assets/js/qiblah.js',
    'assets/files/contact.html',
    'assets/files/about.html',
    'assets/files/donate.html',
    'assets/files/ramadan.html',
    'assets/files/radio.html',
    'assets/files/events.html',
    'assets/files/posts.html',
    'assets/files/tasbih.html',
    'assets/files/azkar.html',
    'assets/files/quran.html',
    'assets/files/what-new.html',
    'assets/js/radio.js',
    'assets/js/events.js',
    'assets/js/posts.js',
    'assets/js/tasbih.js',
    'assets/js/azkar.js',
    'assets/js/quran.js',
    'assets/js/chatbot.js',
    'assets/js/global-radio.js',
    'assets/data/radio-channels.json',
    'assets/data/notifications.json',
    'assets/data/iqamah-settings.json',
    'assets/data/quran-juz.json',
    'assets/data/quran-chapters.json',
    'assets/data/azkar.json',
    'assets/data/nearby-masjids.json',
    'assets/data/quran-resources.json',
    'assets/data/reciters.json',
    'assets/data/tajweed-rules.json',
    'assets/data/quran-fonts.json',
    'assets/media/azan-makka.mp3',
    'assets/media/fajr-mashari.mp3',
    'assets/js/notification-helper.js',
    'index.html',
    'manifest.json'
];

// --- Legacy dynamic URLs removed (migrated to local JSON/Admin API) ---

// Function to update cache with optional timestamp
async function updateCache(cacheName, request, networkResponse, addTimestamp = false) {
    const responseToCache = networkResponse.clone();
    const cache = await caches.open(cacheName);
    // Add timestamp for static cache if specified
    if (addTimestamp) {
        const headers = new Headers(responseToCache.headers);
        headers.set('x-cache-timestamp', Date.now().toString());
        const responseWithTimestamp = new Response(responseToCache.body, {
            status: responseToCache.status,
            statusText: responseToCache.statusText,
            headers: headers
        });
        await cache.put(request, responseWithTimestamp);
    } else {
        await cache.put(request, responseToCache);
    }
}

// Install event: cache static assets
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(STATIC_CACHE_NAME)
            .then(async cache => {
                console.log('Opened static cache: ' + STATIC_CACHE_NAME);
                
                // Use Promise.allSettled to ensure that one failing asset doesn't stop the whole installation
                const results = await Promise.allSettled(
                    staticUrlsToCache.map(async url => {
                        try {
                            const response = await fetch(new Request(url, { cache: 'reload' }));
                            if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
                            
                            const headers = new Headers(response.headers);
                            headers.set('x-cache-timestamp', Date.now().toString());
                            const responseWithTimestamp = new Response(response.body, {
                                status: response.status,
                                statusText: response.statusText,
                                headers: headers
                            });
                            return cache.put(url, responseWithTimestamp);
                        } catch (error) {
                            console.warn('Failed to cache during install:', url, error);
                            // We don't throw here, so the service worker continues installing
                            return Promise.reject(error);
                        }
                    })
                );

                const failed = results.filter(r => r.status === 'rejected');
                if (failed.length > 0) {
                    console.warn(`${failed.length} assets failed to cache during installation. They will be fetched on demand.`);
                }
            })
    );
});

// Fetch event: cache-first with conditional refresh for static, network-first for dynamic
self.addEventListener('fetch', event => {
    const requestUrl = event.request.url;

    // Bypass radio streams (external) to avoid Mixed Content and handle redirects natively
    // Service Worker fetch has issues with redirects to http and media range requests
    // Also bypass notify.json to allow JS to properly handle fetch failures and fallbacks
    if (requestUrl.includes('radiojar.com') ||
        requestUrl.includes('mp3islam.com') ||
        requestUrl.includes('qurango.net') ||
        requestUrl.includes('open-meteo.com') ||
        requestUrl.includes('geolocation-db.com') ||
        requestUrl.includes('freeipapi.com') ||
        requestUrl.includes('notify.json')) {
        return;
    }


    // Navigation fallback for path-based routing
    if (event.request.mode === 'navigate' &&
        event.request.destination === 'document' &&
        new URL(requestUrl).origin === self.location.origin &&
        !requestUrl.includes('/wp-content/') &&
        !requestUrl.match(/\.(png|jpg|jpeg|gif|svg|ico|webp|mp3|mp4|pdf|woff2?|ttf|otf|eot)$/i)) {
        event.respondWith(
            caches.match('index.html').then(response => {
                return response || fetch(event.request);
            })
        );
        return;
    }

    // Handle version.js (Network-first)
    // This ensures we always check for a new version from the server first
    if (requestUrl.endsWith('version.js')) {
        event.respondWith(
            fetch(event.request).then(response => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(STATIC_CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => caches.match(event.request))
        );
        return;
    }
    // Dynamic API requests are now handled by standard caching strategies below
    // or specific logic in frontend scripts (e.g. prayers-tables.js using localStorage)

    // Cache-first with conditional refresh for static assets
    event.respondWith(
        (async () => {
            // Special handling: for Quran verse API requests with translations selected,
            // try the exact URL first, then fall back to text-only cached version offline.
            const isVerseRequest = requestUrl.includes('api.quran.com') && requestUrl.includes('/verses/by_chapter/');
            const hasTranslations = requestUrl.includes('&translations=');
            const isRecitationChapterRequest = requestUrl.includes('api.quran.com') && /\/recitations\/\d+\/by_chapter\/\d+/.test(requestUrl);

            // Try exact cache match first
            const cached = await caches.match(event.request);
            if (cached) {
                const cachedTime = cached.headers.get('x-cache-timestamp');
                if (!cachedTime || (Date.now() - parseInt(cachedTime) < ONE_DAY_IN_MS)) {
                    return cached;
                }
            }

            // Try network
            try {
                const networkResponse = await fetch(event.request);
                const isQuranDomain = requestUrl.includes('quran.com');
                if (networkResponse && (networkResponse.status === 200 || (networkResponse.type === 'opaque' && isQuranDomain))) {
                    if (isQuranDomain) {
                        const qCacheName = getQuranCacheName(requestUrl);
                        if (qCacheName) {
                            const qCache = await caches.open(qCacheName);
                            await qCache.put(event.request, networkResponse.clone());
                        }
                    } else if (networkResponse.type === 'basic' && networkResponse.status === 200) {
                        updateCache(STATIC_CACHE_NAME, event.request, networkResponse, true);
                    }
                }
                return networkResponse;
            } catch (fetchError) {
                // Network failed — try offline fallbacks
                if (cached) return cached; // Return stale cache if available

                // Special retry for images if they failed and were not in cache
                if (event.request.destination === 'image') {
                    console.log('Image fetch failed, retrying once for:', requestUrl);
                    try {
                        const retryResponse = await fetch(event.request);
                        if (retryResponse && retryResponse.status === 200) {
                            updateCache(STATIC_CACHE_NAME, event.request, retryResponse, true);
                            return retryResponse;
                        }
                    } catch (e) { /* ignore retry error */ }
                }

                if (isRecitationChapterRequest && !requestUrl.includes('&full=1')) {
                    const fullMarkerCached = await caches.match(new Request(`${requestUrl}&full=1`));
                    if (fullMarkerCached) return fullMarkerCached;
                }

                // For verse requests with translations: try the text-only cached version
                if (isVerseRequest && hasTranslations) {
                    const textOnlyUrl = requestUrl.replace(/&translations=[^&]*/g, '');
                    const textOnlyCached = await caches.match(new Request(textOnlyUrl));
                    if (textOnlyCached) return textOnlyCached;
                }

                // Final fallback
                if (event.request.mode === 'navigate' ||
                    (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))) {
                    return caches.match('index.html');
                }

                // For API/JSON requests that failed everything, throw to let the JS handle it
                throw fetchError;
            }
        })()
    );
});

// Activate event: clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    // Keep current-version static/dynamic caches and all quran-* caches
                    if (cacheName === STATIC_CACHE_NAME ||
                        cacheName === DYNAMIC_CACHE_NAME ||
                        cacheName.startsWith('quran-')) {
                        return;
                    }
                    return caches.delete(cacheName);
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Handle notification clicks — focus the existing app tab or open a new one
self.addEventListener('notificationclick', event => {
    event.notification.close();

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            // Try to focus an existing tab (match root or index.html)
            for (const client of clientList) {
                if (client.url && (client.url.includes('index.html') || client.url.endsWith('/')) && 'focus' in client) {
                    return client.focus();
                }
            }
            // If no existing tab, open the app
            if (self.clients.openWindow) {
                return self.clients.openWindow('./');
            }
        })
    );
});
