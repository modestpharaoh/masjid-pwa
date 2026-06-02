document.addEventListener("DOMContentLoaded", function () {
    const toArabicIndic = (n) => {
        if (n === null || n === undefined) return n;
        const digits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        return n.toString().replace(/\d/g, (d) => digits[d]);
    };

    const QURAN_CACHE_NAME = "quran-resources-persistent-v1"; // Legacy cache name for migration
    const QURAN_CACHE_PREFIX = "quran-";
    function quranTextCache(scriptId) { return `quran-text-${scriptId}`; }
    function quranRecitationCache(reciterId, chapterId) { return `quran-recitation-${reciterId}-${chapterId}`; }
    function quranLegacyRecitationCache(reciterId) { return `quran-recitation-${reciterId}`; }
    function quranRecitationCachePrefix(reciterId) { return `quran-recitation-${reciterId}-`; }
    function quranTranslationCache(translationId) { return `quran-translation-${translationId}`; }
    function quranTafsirCache(tafsirId) { return `quran-tafsir-${tafsirId}`; }
    const backgroundDownloadQueue = new Set();

    // UI Elements
    const listView = document.getElementById("list-view");
    const readerView = document.getElementById("reader-view");
    const surahListContainer = document.getElementById("surah-list");
    const searchInput = document.getElementById("search-surah");
    const versesContainer = document.getElementById("reader-verses-container");
    const currentSurahTitle = document.getElementById("current-surah-title");
    const bismillahDiv = document.getElementById("bismillah");

    // Pagination Elements
    const paginationControls = document.getElementById("quran-pagination");
    const prevPageBtn = document.getElementById("page-prev");
    const nextPageBtn = document.getElementById("page-next");
    const currentPageSpan = document.getElementById("current-page-num");

    // Settings Elements
    const readerThemeToggleBtn = document.getElementById("reader-theme-toggle-btn");
    const settingsModal = document.getElementById("settings-modal");
    const settingsBtn = document.getElementById("settings-btn");
    const readerSettingsBtn = document.getElementById("reader-settings-btn");
    const modeToggleBtn = document.getElementById("mode-toggle-btn");
    const readerModeToggleBtn = document.getElementById("reader-mode-toggle-btn");
    const readerTajweedBtn = document.getElementById("reader-tajweed-btn");
    const readerTajweedGuide = document.getElementById("reader-tajweed-guide");
    const closeSettings = document.getElementById("close-settings");

    // Cache & Storage Elements
    const storageTotalSize = document.getElementById("storage-total-size");
    const storageRecitersList = document.getElementById("storage-reciters-list");
    const storageTranslationsList = document.getElementById("storage-translations-list");
    const storageTransliterationsList = document.getElementById("storage-transliterations-list");
    const storageTafsirsList = document.getElementById("storage-tafsirs-list");
    const storageTextList = document.getElementById("storage-text-list");

    // Audio Elements
    const audioPlayer = document.getElementById("quran-audio-player");
    const audioEl = document.getElementById("quran-audio");
    const playPauseBtn = document.getElementById("audio-play-pause");
    const playIcon = document.getElementById("audio-play-icon");
    const prevBtn = document.getElementById("audio-prev");
    const nextBtn = document.getElementById("audio-next");
    const currentAyahSpan = document.getElementById("current-ayah-num");

    // ── Wake Lock Integration ─────────────────────────────
    // Prevents the device screen from turning off automatically while playing
    let screenWakeLock = null;

    async function requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                if (screenWakeLock !== null) return;
                screenWakeLock = await navigator.wakeLock.request('screen');
                screenWakeLock.addEventListener('release', () => {
                    console.info('Screen Wake Lock released');
                    screenWakeLock = null;
                });
                console.info('Screen Wake Lock acquired');
            } catch (err) {
                console.warn(`Wake Lock error: ${err.name}, ${err.message}`);
            }
        }
    }

    function releaseWakeLock() {
        if (screenWakeLock !== null) {
            screenWakeLock.release().then(() => {
                screenWakeLock = null;
            }).catch(() => { });
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !activeAudio.paused) {
            requestWakeLock();
        }
    });

    // ── Media Session Integration ─────────────────────────────
    // Allows background playback natively without aggressive browser suspension
    function initMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => {
                if (activeAudio.paused) playPauseBtn.click();
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                if (!activeAudio.paused) playPauseBtn.click();
            });
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                if (prevBtn) prevBtn.click();
            });
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                if (nextBtn) nextBtn.click();
            });
        }
    }
    initMediaSession();

    function updateMediaSessionMetadata(titleName, reciterName) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: titleName,
                artist: reciterName || 'Quran Reciter',
                album: currentSurahTitle ? currentSurahTitle.textContent : 'Quran'
            });
        }
    }

    // ── Gapless Audio Engine ─────────────────────────────
    // Uses two audio elements (A/B) that swap roles. While one plays,
    // the other pre-loads the next ayah. Both are routed through Web Audio
    // API GainNodes so we can apply a micro fade-out (~150ms) at the end
    // of each ayah, preventing the audible pop/click caused by the audio
    // signal cutting from a non-zero amplitude to silence.
    const audioElB = document.createElement('audio');
    audioElB.preload = 'auto';
    document.body.appendChild(audioElB);

    // Ensure crossOrigin is set where possible to allow WebAudio processing
    try {
        if (audioEl) audioEl.crossOrigin = 'anonymous';
        if (audioElB) audioElB.crossOrigin = 'anonymous';
    } catch (e) { /* ignore */ }

    // Diagnostic listeners to help debug playback issues
    function attachAudioDiagnostics(el, name) {
        if (!el) return;
        el.addEventListener('error', (ev) => {
            console.warn(`Audio error (${name}):`, ev, { code: el.error && el.error.code, src: el.currentSrc });
        });
        el.addEventListener('stalled', () => console.debug(`Audio stalled (${name}) src=`, el.currentSrc));
        el.addEventListener('playing', () => {
            requestWakeLock();
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
        });
        el.addEventListener('pause', () => {
            // Wait slightly to ensure we didn't just cross-fade to the other audio element
            setTimeout(() => {
                if (activeAudio.paused) {
                    releaseWakeLock();
                    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
                }
            }, 100);
        });
    }
    attachAudioDiagnostics(audioEl, 'A');
    attachAudioDiagnostics(audioElB, 'B');

    let activeAudio = audioEl;   // currently playing
    let bufferAudio = audioElB;  // pre-loading next
    let audioCtx = null;
    let useWebAudio = true; // fallback to plain HTMLAudio if WebAudio routing fails
    let sourceNodeA = null;
    let sourceNodeB = null;
    let gainNodeA = null;
    let gainNodeB = null;
    const FADE_OUT_MS = 300; // fade duration in milliseconds

    function getAudioCtx() {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                console.warn("WebAudio not available, falling back to HTMLAudio.", e);
                useWebAudio = false;
                return null;
            }
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function ensureWebAudioRouting() {
        if (!useWebAudio) return;
        const ctx = getAudioCtx();
        if (!ctx) return;
        try {
            if (!sourceNodeA) {
                sourceNodeA = ctx.createMediaElementSource(audioEl);
                gainNodeA = ctx.createGain();
                sourceNodeA.connect(gainNodeA);
                gainNodeA.connect(ctx.destination);
            }
            if (!sourceNodeB) {
                sourceNodeB = ctx.createMediaElementSource(audioElB);
                gainNodeB = ctx.createGain();
                sourceNodeB.connect(gainNodeB);
                gainNodeB.connect(ctx.destination);
            }
        } catch (err) {
            // Some browsers or playback environments throw when creating MediaElementSource
            // (e.g., if one already exists or CORS issues). Disable WebAudio routing as a
            // graceful fallback so plain HTMLAudio playback still works.
            console.warn('Failed to initialize WebAudio routing, falling back to HTMLAudio:', err);
            useWebAudio = false;
            try {
                // cleanup partial nodes if any
                if (sourceNodeA) { try { sourceNodeA.disconnect(); } catch (e) { } sourceNodeA = null; }
                if (sourceNodeB) { try { sourceNodeB.disconnect(); } catch (e) { } sourceNodeB = null; }
                gainNodeA = null; gainNodeB = null;
            } catch (e) { /* ignore */ }
        }
    }

    function getActiveGain() {
        return (activeAudio === audioEl) ? gainNodeA : gainNodeB;
    }

    // Cancel any scheduled gain automation and restore full volume.
    // This is critical: linearRampToValueAtTime creates automation that
    // overrides direct .value assignments. You MUST cancel first.
    function resetGain(g) {
        if (!g || !audioCtx) return;
        g.gain.cancelScheduledValues(audioCtx.currentTime);
        g.gain.setValueAtTime(1, audioCtx.currentTime);
    }

    function swapAudioElements() {
        const tmp = activeAudio;
        activeAudio = bufferAudio;
        bufferAudio = tmp;
    }

    function resolveAudioUrl(audioObj) {
        return (audioObj.url.startsWith("http") || audioObj.url.startsWith("//")) ?
            (audioObj.url.startsWith("//") ? `https:${audioObj.url}` : audioObj.url) :
            `https://verses.quran.com/${audioObj.url}`;
    }

    function getRecitationChapterUrl(reciterId, chapterId, includeFullMarker = false) {
        let url = `https://api.quran.com/api/v4/recitations/${reciterId}/by_chapter/${chapterId}?per_page=300`;
        if (includeFullMarker) url += "&full=1";
        return url;
    }

    function getRecitationCacheNamesForReciter(reciterId, quranCacheNames) {
        const prefix = quranRecitationCachePrefix(reciterId);
        const legacyName = quranLegacyRecitationCache(reciterId);
        return quranCacheNames.filter(name => name === legacyName || name.startsWith(prefix));
    }

    function getRecitationSurahCacheMeta(reciterId, chapterId, cacheUrls) {
        const exactUrls = cacheUrls[quranRecitationCache(reciterId, chapterId)] || [];
        const legacyUrls = cacheUrls[quranLegacyRecitationCache(reciterId)] || [];
        const legacyPattern = `/recitations/${reciterId}/by_chapter/${chapterId}`;
        const exactFull = exactUrls.some(url => url.includes("full=1"));
        const legacyFull = legacyUrls.some(url => url.includes(legacyPattern) && url.includes("full=1"));
        const exactPartial = exactUrls.length > 0;
        const legacyPartial = legacyUrls.some(url => url.includes(legacyPattern));
        const isFull = exactFull || legacyFull;
        const isPart = !isFull && (exactPartial || legacyPartial);

        return { isFull, isPart };
    }

    async function hasAnyRecitationCacheForReciter(reciterId) {
        const names = await caches.keys();
        const prefix = quranRecitationCachePrefix(reciterId);
        const legacyName = quranLegacyRecitationCache(reciterId);
        return names.some(name => name === legacyName || name.startsWith(prefix));
    }

    async function fetchRecitationChapterAudio(reciterId, chapterId) {
        const requestUrl = getRecitationChapterUrl(reciterId, chapterId);

        const cache = await caches.open(quranRecitationCache(reciterId, chapterId));
        const cachedResponse = await cache.match(requestUrl)
            || await cache.match(getRecitationChapterUrl(reciterId, chapterId, true))
            || await caches.match(requestUrl)
            || await caches.match(getRecitationChapterUrl(reciterId, chapterId, true));

        if (cachedResponse) {
            const data = await cachedResponse.json();
            const files = data.audio_files || [];
            if (chapterId === 1 && files.length > 0) {
                bismillahAudioData = { ...files[0], reciterId };
            }
            return files;
        }

        const response = await fetch(requestUrl);
        if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);

        await cache.put(requestUrl, response.clone());

        const data = await response.json();
        const files = data.audio_files || [];
        if (chapterId === 1 && files.length > 0) {
            bismillahAudioData = { ...files[0], reciterId };
        }
        return files;
    }

    async function ensureBismillahAudioData(reciterId) {
        if (bismillahAudioData && bismillahAudioData.reciterId === reciterId) return bismillahAudioData;

        try {
            await fetchRecitationChapterAudio(reciterId, 1);
        } catch (e) {
            console.warn("Failed to fetch Bismillah:", e);
        }

        if (bismillahAudioData && bismillahAudioData.reciterId === reciterId) return bismillahAudioData;
        return null;
    }

    async function cacheSurahRecitation(reciterId, chapterId, options = {}) {
        const { audioFiles = null, ensureFatihah = true, onlyIfMissing = false } = options;
        const queueKey = `recitation-${reciterId}-${chapterId}`;
        if (backgroundDownloadQueue.has(queueKey)) return;

        backgroundDownloadQueue.add(queueKey);
        try {
            const cache = await caches.open(quranRecitationCache(reciterId, chapterId));
            const fullUrl = getRecitationChapterUrl(reciterId, chapterId, true);

            if (onlyIfMissing) {
                const existing = await cache.match(fullUrl);
                if (existing) return;
            }

            if (ensureFatihah && chapterId !== 1 && !await hasAnyRecitationCacheForReciter(reciterId)) {
                await cacheSurahRecitation(reciterId, 1, { ensureFatihah: false, onlyIfMissing: true });
            }

            const files = audioFiles || await fetchRecitationChapterAudio(reciterId, chapterId);
            if (!files.length) return;

            if (chapterId === 1) {
                bismillahAudioData = { ...files[0], reciterId };
            }

            const results = await Promise.all(
                files.map(async file => {
                    try {
                        const url = resolveAudioUrl(file);
                        const resp = await fetch(url);
                        if (resp && (resp.status === 200 || resp.type === "opaque")) {
                            await cache.put(url, resp);
                            return true;
                        }
                    } catch (e) {
                    }
                    return false;
                })
            );

            if (results.every(Boolean)) {
                try {
                    const cachedMetaData = await cache.match(getRecitationChapterUrl(reciterId, chapterId));
                    if (cachedMetaData) {
                        await cache.put(fullUrl, cachedMetaData.clone());
                    } else {
                        const fullResp = await fetch(fullUrl);
                        if (fullResp && fullResp.ok) {
                            await cache.put(fullUrl, fullResp.clone());
                        }
                    }
                } catch (e) {
                    console.warn("Failed to cache fullUrl metadata:", e);
                }
            }
        } finally {
            backgroundDownloadQueue.delete(queueKey);
        }
    }

    // Determine the next index that will be played after the given index,
    // respecting repetition, range mode, etc. Returns -1 if nothing follows.
    function getNextPreloadIndex(index) {
        // If repeating this ayah, next playback is the same file (no preload benefit)
        if (currentAyahPlayCount < ayahRepeatTarget) return index;

        if (isRangeMode) {
            if (index < rangeEndIndex) return index + 1;
            // End of range: loops back or stops
            if (rangeSetTarget === 0 || currentRangeSetCount < rangeSetTarget) return rangeStartIndex;
            return -1;
        }

        if (index < audioFilesData.length - 1) return index + 1;
        return -1; // end of chapter
    }

    function preloadNext(currentIndex) {
        const nextIdx = getNextPreloadIndex(currentIndex);
        if (nextIdx === -1 || nextIdx === currentIndex || !audioFilesData[nextIdx]) return;
        const url = resolveAudioUrl(audioFilesData[nextIdx]);
        if (bufferAudio.getAttribute('data-preloaded-url') === url) return; // already loaded
        bufferAudio.src = url;
        bufferAudio.load();
        bufferAudio.setAttribute('data-preloaded-url', url);
    }

    // State
    let chaptersData = [];
    let currentChapterId = null;
    let continueNextSurah = false;
    let currentVersesData = [];
    let audioFilesData = [];
    let currentPlayingIndex = -1;
    let currentPlaybackSpeed = 1;
    let ayahRepeatTarget = 1;
    let currentAyahPlayCount = 0;
    let bismillahAudioData = null;
    let isBismillahPlaying = false;
    let isTajweedExamplePlaying = false;

    // Range Recitation State
    let isRangeMode = false;
    let rangeStartIndex = -1;
    let rangeEndIndex = -1;
    let rangeSetTarget = 1; // 0 for unlimited
    let currentRangeSetCount = 1;

    // Pagination State
    let pagesData = {};
    let availablePages = [];
    let currentPageNum = null;
    let selectedVerseIndex = null;
    let tafsirIds = []; // Dynamic from JSON
    let isOverlayManuallyMoved = false;
    let isTafsirVisible = localStorage.getItem("isTafsirVisible") !== "false"; // Default to true
    let allResourcesData = null; // Store for name lookups

    // Settings Elements
    const autoplayToggle = document.getElementById("autoplay-toggle");
    const overlay = document.getElementById("verse-action-overlay");
    const overlayKey = document.getElementById("overlay-verse-key");
    const overlayPlay = document.getElementById("overlay-play-btn");
    const overlayCopy = document.getElementById("overlay-copy-btn");
    const overlayClose = document.getElementById("overlay-close-btn");
    const overlayBookmark = document.getElementById("overlay-bookmark-btn");
    const overlayTafsirBtn = document.getElementById("overlay-tafsir-btn");
    const overlayTafsirContainer = document.getElementById("overlay-tafsir-container");
    const overlayTafsirSelect = document.getElementById("overlay-tafsir-select");
    const overlayTafsirContent = document.getElementById("overlay-tafsir-content");

    // Settings State
    const defaultSettings = {
        script: "uthmani_tajweed", // uthmani, indopak, imlaei, uthmani_tajweed
        translation: ["149", "57"], // Array of resource IDs (Default: Bridges and Transliteration)
        readingMode: "page", // list, page
        reciter: "7", // 7 = Mishary
        arabicSize: "2.2",
        transSize: "1.0"
    };

    let userSettings;
    try {
        userSettings = JSON.parse(localStorage.getItem("quranSettings")) || defaultSettings;
    } catch (e) {
        console.warn('Corrupted quranSettings in localStorage, resetting to defaults:', e);
        localStorage.removeItem("quranSettings");
        userSettings = { ...defaultSettings };
    }

    // Backward compatibility for single translation string
    if (typeof userSettings.translation === 'string') {
        userSettings.translation = (userSettings.translation === 'none') ? [] : [userSettings.translation];
    }

    // ── Font Config (loaded from quran-fonts.json) ────────
    let fontsConfig = [];

    function getFontConfig(id) {
        return fontsConfig.find(f => f.id === id) || null;
    }
    function getActiveApiScript() {
        var cfg = getFontConfig(userSettings.script);
        return cfg ? cfg.apiScript : userSettings.script;
    }
    function getActiveCssClass() {
        var cfg = getFontConfig(userSettings.script);
        return cfg ? cfg.cssClass : userSettings.script;
    }
    function isActiveTajweed() {
        return getActiveApiScript() === "uthmani_tajweed";
    }
    // Strip characters that could break out of CSS strings or rules
    function cssSafe(str) {
        return String(str).replace(/['"\\;{}]/g, '');
    }
    function applyActiveFont() {
        var cfg = getFontConfig(userSettings.script);
        if (cfg) {
            document.documentElement.style.setProperty('--active-quran-font', cssSafe(cfg.fontFamily));
        }
    }

    // Dynamically load fonts & populate script select from quran-fonts.json
    async function loadQuranFonts() {
        try {
            const res = await fetch("../data/quran-fonts.json");
            if (!res.ok) throw new Error('Font config HTTP ' + res.status);
            const data = await res.json();
            fontsConfig = data.fonts || [];

            // Inject @font-face rules (deduplicate by family name)
            var fontFaceCSS = '';
            var seenFamilies = {};
            fontsConfig.forEach(function (font) {
                (font.fontFaces || []).forEach(function (ff) {
                    if (seenFamilies[ff.family]) return;
                    seenFamilies[ff.family] = true;
                    var srcParts = ff.sources.map(function (s) {
                        return "url('" + cssSafe(s.url) + "') format('" + cssSafe(s.format) + "')";
                    }).join(',\n    ');
                    fontFaceCSS += '@font-face {\n  font-family: \'' + cssSafe(ff.family) + '\';\n  src: ' + srcParts + ';\n  font-weight: normal;\n  font-style: normal;\n}\n';
                });
            });
            var styleEl = document.getElementById('quran-dynamic-fonts') || document.createElement('style');
            styleEl.id = 'quran-dynamic-fonts';
            styleEl.textContent = fontFaceCSS;
            document.head.appendChild(styleEl);

            // Populate script select
            var sel = document.getElementById("script-select");
            sel.innerHTML = "";
            fontsConfig.forEach(function (font) {
                var opt = document.createElement("option");
                opt.value = font.id;
                opt.textContent = font.label;
                sel.appendChild(opt);
            });

            sel.value = userSettings.script;
            applyActiveFont();
        } catch (err) {
            console.error("Failed to load quran fonts:", err);
        }
    }

    // Initialize Settings UI
    document.getElementById("arabic-size").value = userSettings.arabicSize;
    document.getElementById("translation-size").value = userSettings.transSize;

    updateFontSizes();
    loadQuranFonts();

    // Dynamically populate reciter select from reciters.json
    async function loadReciters() {
        try {
            const res = await fetch("../data/reciters.json");
            if (!res.ok) throw new Error('Reciters HTTP ' + res.status);
            const data = await res.json();
            const recitations = data.recitations || [];

            // Build display name and sort alphabetically
            const items = recitations.map(r => ({
                id: r.id,
                name: r.style ? `${r.reciter_name} (${r.style})` : r.reciter_name
            })).sort((a, b) => a.name.localeCompare(b.name));

            const sel = document.getElementById("reciter-select");
            sel.innerHTML = "";
            items.forEach(item => {
                const opt = document.createElement("option");
                opt.value = item.id;
                opt.textContent = item.name;
                sel.appendChild(opt);
            });

            sel.value = userSettings.reciter;
            populateReciterMenu();
        } catch (err) {
            console.error("Failed to load reciters:", err);
        }
    }
    loadReciters();

    // Dynamic Resources Loading
    async function fetchQuranResources() {
        try {
            const response = await fetch("../data/quran-resources.json");
            const data = await response.json();
            allResourcesData = data;

            const transCheckboxList = document.getElementById("translation-checkbox-list");
            overlayTafsirSelect.innerHTML = "";
            transCheckboxList.innerHTML = "";
            tafsirIds = [];

            data.categories.forEach(cat => {
                const group = document.createElement("optgroup");
                group.label = cat.label;

                if (!cat.isTafsir || cat.isBriefTafsir) {
                    const header = document.createElement("div");
                    header.className = "trans-group-header";
                    header.style = "font-weight: 700; font-size: 0.8rem; color: var(--primary-green); margin-top: 15px; margin-bottom: 5px; text-transform: uppercase;";
                    header.textContent = cat.label;
                    transCheckboxList.appendChild(header);
                }

                cat.resources.forEach(res => {
                    const option = document.createElement("option");
                    option.value = res.id;
                    option.textContent = res.name;
                    group.appendChild(option);

                    if (cat.isTafsir) {
                        tafsirIds.push(res.id.toString());
                    }

                    if (!cat.isTafsir || cat.isBriefTafsir) {
                        const item = document.createElement("label");
                        item.className = "trans-checkbox-item";
                        const isChecked = userSettings.translation.includes(res.id.toString());
                        item.innerHTML = `
                            <input type="checkbox" value="${escapeHTML(String(res.id))}" class="trans-checkbox" ${isChecked ? 'checked' : ''}>
                            <span class="trans-checkbox-label">${escapeHTML(res.name)}</span>
                        `;
                        transCheckboxList.appendChild(item);
                    }
                });
                overlayTafsirSelect.appendChild(group);
            });

            // Re-apply saved selection after populating
            const savedTafsir = localStorage.getItem("lastSelectedTafsir");
            if (savedTafsir && [...overlayTafsirSelect.options].some(o => o.value === savedTafsir)) {
                overlayTafsirSelect.value = savedTafsir;
            } else {
                // First time: use first in the list
                if (overlayTafsirSelect.options.length > 0) {
                    overlayTafsirSelect.selectedIndex = 0;
                    localStorage.setItem("lastSelectedTafsir", overlayTafsirSelect.value);
                }
            }
        } catch (error) {
            console.error("Failed to load Quran resources:", error);
        }
    }
    function getResourceName(id) {
        if (!allResourcesData) return `ID: ${id}`;
        for (const cat of allResourcesData.categories) {
            const res = cat.resources.find(r => r.id.toString() === id.toString());
            if (res) return res.name;
        }
        return `ID: ${id}`;
    }

    function isResourceArabic(id) {
        if (!allResourcesData) return false;
        // Check all categories that might contain Arabic content (labels containing 'arabic')
        return allResourcesData.categories.some(cat =>
            cat.label.toLowerCase().includes("arabic") &&
            cat.resources.some(r => r.id.toString() === id.toString())
        );
    }

    // Translation Settings Modal Logic
    const transModal = document.getElementById("translation-modal-overlay");
    const closeTransBtn = document.getElementById("close-trans-settings-btn");
    const applyTransBtn = document.getElementById("apply-trans-btn");

    function showTranslationModal() {
        // Sync checkboxes with current userSettings.translation
        const checkboxes = document.querySelectorAll(".trans-checkbox");
        checkboxes.forEach(cb => {
            const isChecked = userSettings.translation.includes(cb.value.toString());
            cb.checked = isChecked;
            const item = cb.closest('.trans-checkbox-item');
            if (item) {
                item.style.order = isChecked ? "-1" : "0";
            }
        });

        // Sync slider current value
        const sz = document.getElementById("translation-size");
        if (sz) {
            sz.value = userSettings.transSize;
            const val = document.getElementById("tr-size-val");
            if (val) val.textContent = userSettings.transSize;
        }

        transModal.classList.add("active");
    }

    if (closeTransBtn) {
        closeTransBtn.addEventListener("click", () => transModal.classList.remove("active"));
    }

    if (transModal) {
        transModal.addEventListener("click", (e) => {
            if (e.target === transModal) transModal.classList.remove("active");
        });
    }

    if (applyTransBtn) {
        applyTransBtn.addEventListener("click", () => {
            const checkedBoxes = document.querySelectorAll(".trans-checkbox:checked");
            const selectedIds = Array.from(checkedBoxes).map(cb => cb.value.toString());

            userSettings.translation = selectedIds;
            saveSettings();

            transModal.classList.remove("active");
        });
    }

    // Delegate listener for dynamic trans-settings-trigger buttons
    versesContainer.addEventListener("click", (e) => {
        const trigger = e.target.closest(".trans-settings-trigger");
        if (trigger) {
            e.stopPropagation();
            showTranslationModal();
        }
    });

    fetchQuranResources();

    // 1. Fetch & Render Chapters
    async function fetchChapters() {
        document.getElementById("loading-list").style.display = "block";
        surahListContainer.innerHTML = "";

        try {
            const response = await fetch("../data/quran-chapters.json");
            if (!response.ok) throw new Error('Chapters HTTP ' + response.status);
            const data = await response.json();

            chaptersData = data.chapters;
            renderChapters(chaptersData);
        } catch (error) {
            console.error("Failed to fetch chapters:", error);
            surahListContainer.innerHTML = "<p>Error loading Surahs. Please check your connection.</p>";
        } finally {
            document.getElementById("loading-list").style.display = "none";
        }
    }

    function renderChapters(chapters) {
        surahListContainer.innerHTML = "";
        chapters.forEach(chapter => {
            const card = document.createElement("div");
            card.className = "surah-card";
            const revelationInfo = chapter.revelation_place === "makkah" ? "Makki" : "Madani";
            card.innerHTML = `
                <div class="surah-number">${parseInt(chapter.id)}</div>
                <div class="surah-info">
                    <h3 class="surah-name-en">${escapeHTML(chapter.name_simple)} <span class="surah-name-ar">${escapeHTML(chapter.name_arabic)}</span></h3>
                    <div class="surah-verses">${escapeHTML(chapter.translated_name.name)} • ${parseInt(chapter.verses_count)} Verses • <span class="revelation-type">${revelationInfo}</span></div>
                </div>
            `;
            card.addEventListener("click", () => openSurah(chapter));
            surahListContainer.appendChild(card);
        });
    }

    // 2. Search
    searchInput.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = chaptersData.filter(c =>
            c.name_simple.toLowerCase().includes(query) ||
            c.name_arabic.includes(query) ||
            c.translated_name.name.toLowerCase().includes(query) ||
            c.id.toString() === query
        );
        renderChapters(filtered);
    });

    bismillahDiv.addEventListener("click", () => {
        playBismillah();
    });

    async function playBismillah() {
        await ensureBismillahAudioData(userSettings.reciter);

        if (!bismillahAudioData) return;

        ensureWebAudioRouting();
        isBismillahPlaying = true;
        currentPlayingIndex = -1;

        const audioUrl = resolveAudioUrl(bismillahAudioData);
        activeAudio.src = audioUrl;
        activeAudio.playbackRate = currentPlaybackSpeed;
        resetGain(getActiveGain());
        activeAudio.play().catch(e => console.error("Playback failed:", e));

        // Pre-load the first verse into the buffer
        if (audioFilesData.length > 0) {
            const firstIdx = (isRangeMode && rangeStartIndex !== -1) ? rangeStartIndex : 0;
            if (audioFilesData[firstIdx]) {
                bufferAudio.src = resolveAudioUrl(audioFilesData[firstIdx]);
                bufferAudio.load();
                bufferAudio.setAttribute('data-preloaded-url', resolveAudioUrl(audioFilesData[firstIdx]));
            }
        }

        playIcon.className = "mdi mdi-pause";
        currentAyahSpan.textContent = "Bismillah";
        audioPlayer.style.display = "flex";

        const reciterName = document.getElementById("current-reciter-name")?.textContent || "Quran Reciter";
        updateMediaSessionMetadata("Bismillah", reciterName);

        removeAllHighlight();
    }

    // 3. Open Surah
    async function openSurah(chapter, loadLastPage = false, targetPage = null, targetVerseKey = null) {
        currentChapterId = chapter.id;
        currentSurahTitle.textContent = `${chapter.id}. ${chapter.name_simple} (${chapter.name_arabic})`;

        // Bismillah visibility is now handled by goToPage dynamically per page.
        bismillahDiv.style.display = "none";

        // Reset Audio
        resetAudio();

        listView.classList.remove("active");
        readerView.classList.add("active");

        await loadVersesAndAudio(chapter.id, loadLastPage, targetPage, targetVerseKey);
    }

    document.getElementById("back-to-list").addEventListener("click", () => {
        resetAudio();
        readerView.classList.remove("active");
        listView.classList.add("active");
    });

    // 4. Fetch Verses & Audio
    async function loadVersesAndAudio(chapterId, loadLastPage = false, targetPage = null, targetVerseKey = null) {
        versesContainer.innerHTML = "";
        const loader = document.getElementById("loading-verses");
        loader.style.display = "block";

        let allVerses = [];
        let page = 1;
        let totalPages = 1;

        const scriptField = `text_${getActiveApiScript()}`;

        try {
            // Separate translations and brief tafsirs
            const selectedTranslations = [];
            const selectedBriefTafsirs = [];
            userSettings.translation.forEach(id => {
                if (tafsirIds.includes(id.toString())) {
                    selectedBriefTafsirs.push(id);
                } else {
                    selectedTranslations.push(id);
                }
            });

            // We use pagination loop to get all verses of a chapter if it exceeds per_page limit
            do {
                let url = `https://api.quran.com/api/v4/verses/by_chapter/${chapterId}?language=en&words=false&fields=${scriptField},hizb_number,rub_el_hizb_number,juz_number&page=${page}&per_page=50`;

                if (selectedTranslations.length > 0) {
                    url += `&translations=${selectedTranslations.join(',')}`;
                }

                let response;
                try {
                    const cachedRes = await caches.match(url);
                    if (cachedRes) {
                        response = cachedRes;
                    } else {
                        response = await fetch(url);
                        if (!response.ok) throw new Error('Verses HTTP ' + response.status);
                    }
                } catch (err) {
                    // Offline fallback: try to load the text-only version if we have translations selected but offline
                    if (selectedTranslations.length > 0) {
                        const fallbackUrl = `https://api.quran.com/api/v4/verses/by_chapter/${chapterId}?language=en&words=false&fields=${scriptField},hizb_number,rub_el_hizb_number,juz_number&page=${page}&per_page=50`;
                        let fbRes = await caches.match(fallbackUrl);
                        if (!fbRes) {
                            try {
                                fbRes = await fetch(fallbackUrl);
                            } catch (fbErr) {
                                throw err; // Re-throw original error if fallback fetch also fails
                            }
                        }
                        if (!fbRes || !fbRes.ok) throw err; // Re-throw original error if fallback also fails
                        response = fbRes;
                        console.log("Using offline fallback (text only for script " + scriptField + ")");
                    } else {
                        throw err;
                    }
                }
                const data = await response.json();

                allVerses = allVerses.concat(data.verses);
                totalPages = data.pagination.total_pages;
                page++;

                // Render incrementally for perceived performance
                if (page === 2) {
                    renderVerses(allVerses);
                    loader.style.display = "none";
                }
            } while (page <= totalPages);

            // Trigger background caching for full Quran text of this script
            backgroundCacheFullScript(getActiveApiScript());

            // OFFLINE RECOVERY: If some translations are missing (because the combined URL was a cache miss),
            // try to fetch and merge them individually from the single-resource URLs used by the storage manager.
            if (selectedTranslations.length > 0) {
                const missingIds = selectedTranslations.filter(id => {
                    // Check if any verse is missing this translation
                    return !allVerses.every(v => v.translations && v.translations.some(t => t.resource_id.toString() === id.toString()));
                });

                if (missingIds.length > 0) {
                    console.log("Offline: Attempting granular recovery for translation IDs:", missingIds);
                    for (const transId of missingIds) {
                        try {
                            let recPage = 1;
                            let recTotalPages = 1;
                            let chapterTrans = [];
                            do {
                                // Match the storage manager canonical URL (all scripts)
                                const allScripts = quranScriptsList.map(s => `text_${s.id}`).join(',');
                                const url = `https://api.quran.com/api/v4/verses/by_chapter/${chapterId}?language=en&words=false&fields=${allScripts},hizb_number,rub_el_hizb_number,juz_number&page=${recPage}&per_page=50&translations=${transId}`;
                                let resp = await caches.match(url);
                                if (!resp) {
                                    resp = await fetch(url);
                                }
                                if (!resp.ok) break;
                                const data = await resp.json();
                                if (data && data.verses) {
                                    chapterTrans = chapterTrans.concat(data.verses);
                                    recTotalPages = data.pagination.total_pages;
                                    recPage++;
                                } else break;
                            } while (recPage <= recTotalPages);

                            if (chapterTrans.length > 0) {
                                allVerses.forEach(verse => {
                                    const match = chapterTrans.find(v => v.id === verse.id);
                                    if (match && match.translations && match.translations.length > 0) {
                                        if (!verse.translations) verse.translations = [];
                                        // Avoid duplicates
                                        if (!verse.translations.some(t => t.resource_id.toString() === transId.toString())) {
                                            verse.translations.push(match.translations[0]);
                                        }
                                    }
                                });
                            }
                        } catch (e) {
                            console.warn(`Individual translation recovery failed for ${transId}:`, e);
                        }
                    }
                    // Final re-render after attempting recovery
                    renderVerses(allVerses);
                }
            }

            // Fetch and Merge Brief Tafsirs
            if (selectedBriefTafsirs.length > 0) {
                for (const tafsirId of selectedBriefTafsirs) {
                    try {
                        let tafPage = 1;
                        let tafTotalPages = 1;
                        let chapterTafsirs = [];

                        do {
                            const tafUrl = `https://api.quran.com/api/v4/tafsirs/${tafsirId}/by_chapter/${chapterId}?page=${tafPage}&per_page=100`;
                            let tafRes = await caches.match(tafUrl);
                            if (!tafRes) {
                                tafRes = await fetch(tafUrl);
                            }
                            if (tafRes.ok) {
                                const tafData = await tafRes.json();
                                if (tafData && tafData.tafsirs) {
                                    chapterTafsirs = chapterTafsirs.concat(tafData.tafsirs);
                                    tafTotalPages = tafData.pagination.total_pages;
                                    tafPage++;
                                } else {
                                    break;
                                }
                            } else {
                                break;
                            }
                        } while (tafPage <= tafTotalPages);

                        if (chapterTafsirs.length > 0) {
                            allVerses.forEach(verse => {
                                const match = chapterTafsirs.find(t => t.verse_key === verse.verse_key);
                                if (match && match.text) {
                                    if (!verse.translations) verse.translations = [];
                                    verse.translations.push({
                                        resource_id: parseInt(tafsirId),
                                        text: match.text
                                    });
                                }
                            });
                        }
                    } catch (e) {
                        console.error(`Error fetching tafsir ${tafsirId}:`, e);
                    }
                }
                // Re-render after merging ALL tafsirs
                renderVerses(allVerses);
            }

            currentVersesData = allVerses;

            // Group verses by page_number
            pagesData = {};
            currentVersesData.forEach((verse, index) => {
                verse.globalIndex = index; // Store global index for audio sync
                const pNum = verse.page_number;
                if (!pagesData[pNum]) pagesData[pNum] = [];
                pagesData[pNum].push(verse);
            });

            availablePages = Object.keys(pagesData).map(Number).sort((a, b) => a - b);

            // If targetVerseKey is provided but targetPage isn't, find it from verses
            if (targetVerseKey && !targetPage) {
                const targetVerse = allVerses.find(v => v.verse_key === targetVerseKey);
                if (targetVerse) {
                    targetPage = targetVerse.page_number;
                }
            }

            if (availablePages.length > 0) {
                paginationControls.style.display = "flex";
                let initialPage;
                if (targetPage && availablePages.includes(Number(targetPage))) {
                    initialPage = Number(targetPage);
                } else {
                    initialPage = loadLastPage ? availablePages[availablePages.length - 1] : availablePages[0];
                }
                goToPage(initialPage, targetVerseKey);
            } else {
                paginationControls.style.display = "none";
            }

            loader.style.display = "none";

            // Fetch Audio Layout for the chapter asynchronously
            fetchAudioData(chapterId);

        } catch (error) {
            console.error("Error loading verses:", error);
            versesContainer.innerHTML = "<p>Failed to load verses. You might be offline.</p>";
            loader.style.display = "none";
        }
    }

    async function fetchAudioData(chapterId) {
        try {
            await ensureBismillahAudioData(userSettings.reciter);
            audioFilesData = await fetchRecitationChapterAudio(userSettings.reciter, chapterId);

            // Trigger background caching for full surah
            backgroundCacheSurah(userSettings.reciter, chapterId, audioFilesData);

            // Always show audio player bar so user can switch reciters or see offline status
            audioPlayer.style.display = "flex";
        } catch (error) {
            console.error("Error loading audio files:", error);
            audioFilesData = []; // Ensure it's explicitly marked as unavailable
            audioPlayer.style.display = "flex"; // Still show bar for reciter toggle
        } finally {
            updateAudioButtonsVisibility();
        }
    }

    async function backgroundCacheSurah(reciterId, chapterId, audioFiles) {
        if (!audioFiles || audioFiles.length === 0) return;
        try {
            await cacheSurahRecitation(reciterId, chapterId, { audioFiles, onlyIfMissing: true });
        } catch (e) {
            console.warn("Background surah cache failed:", e);
        }
    }

    function updateAudioButtonsVisibility() {
        const hasAudio = audioFilesData && audioFilesData.length > 0;

        // List mode buttons
        document.querySelectorAll(".play-verse-btn").forEach(btn => {
            btn.style.display = hasAudio ? "inline-flex" : "none";
        });

        // Mushaf mode overlay button (if currently active)
        if (overlayPlay) {
            overlayPlay.style.display = hasAudio ? "flex" : "none";
        }

        // Toggle player controls visibility
        const audioControls = document.querySelector(".npi-row-top-right");
        const nowPlayingInfo = document.getElementById("now-playing-info");
        const offlineMsg = document.getElementById("audio-offline-msg");

        if (audioControls) audioControls.style.visibility = hasAudio ? "visible" : "hidden";
        if (nowPlayingInfo) nowPlayingInfo.style.display = hasAudio ? "block" : "none";
        if (offlineMsg) offlineMsg.style.display = hasAudio ? "none" : "block";
    }

    function goToPage(pageNum, targetVerseKey = null) {
        if (!pagesData[pageNum]) return;

        currentPageNum = pageNum;
        currentPageSpan.textContent = pageNum;

        // Bismillah should only show on the first page of surahs (except for Al-Fatihah (1) and At-Tawbah (9))
        const isFirstPageOfSurah = (pageNum === availablePages[0]);
        const showBismillah = isFirstPageOfSurah && (currentChapterId !== 1 && currentChapterId !== 9);
        bismillahDiv.style.display = showBismillah ? "block" : "none";

        const currentIndex = availablePages.indexOf(pageNum);

        // Handle cross-surah button states
        const chapterIdx = chaptersData.findIndex(c => c.id === currentChapterId);
        prevPageBtn.disabled = (currentIndex <= 0 && chapterIdx <= 0);
        nextPageBtn.disabled = (currentIndex >= availablePages.length - 1 && chapterIdx >= chaptersData.length - 1);

        renderVerses(pagesData[pageNum], targetVerseKey);
        updatePaginationMetadata(pagesData[pageNum]);

        // Scroll to top of verses
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function updatePaginationMetadata(verses) {
        if (!verses || !verses.length) return;

        const juzEnEl = document.getElementById("pagination-juz-en");
        const hizbEnEl = document.getElementById("pagination-hizb-en");
        const juzArEl = document.getElementById("pagination-juz-ar");
        const hizbArEl = document.getElementById("pagination-hizb-ar");

        if (!juzEnEl || !hizbEnEl || !juzArEl || !hizbArEl) return;

        const last = verses[verses.length - 1];

        // Juz Info
        juzEnEl.textContent = `Juz ${last.juz_number}`;
        juzArEl.textContent = `الجزء ${toArabicIndic(last.juz_number)}`;

        // Hizb Info
        function getHizbParts(v) {
            const h = v.hizb_number;
            const r = v.rub_el_hizb_number;
            const relRub = ((r - 1) % 4) + 1;
            const quarterEn = ["", "1/4 ", "1/2 ", "3/4 "];
            const quarterAr = ["", "١/٤ ", "١/٢ ", "٣/٤ "];
            const enPrefix = quarterEn[relRub - 1] || "";
            const arPrefix = quarterAr[relRub - 1] || "";
            return {
                en: `${enPrefix}Hizb ${h}`,
                ar: `${arPrefix}حزب ${toArabicIndic(h)}`
            };
        }

        const hizbParts = getHizbParts(last);
        hizbEnEl.textContent = hizbParts.en;
        hizbArEl.textContent = hizbParts.ar;
    }

    prevPageBtn.addEventListener("click", () => {
        const idx = availablePages.indexOf(currentPageNum);
        if (idx > 0) {
            goToPage(availablePages[idx - 1]);
        } else {
            // First page, go to prev chapter
            const chapterIdx = chaptersData.findIndex(c => c.id === currentChapterId);
            if (chapterIdx > 0) {
                openSurah(chaptersData[chapterIdx - 1], true);
            }
        }
    });

    nextPageBtn.addEventListener("click", () => {
        const idx = availablePages.indexOf(currentPageNum);
        if (idx < availablePages.length - 1) {
            goToPage(availablePages[idx + 1]);
        } else {
            // Last page, go to next chapter
            const chapterIdx = chaptersData.findIndex(c => c.id === currentChapterId);
            if (chapterIdx < chaptersData.length - 1) {
                openSurah(chaptersData[chapterIdx + 1]);
            }
        }
    });

    document.querySelector(".page-info").addEventListener("click", () => {
        const jumpModal = document.getElementById("jump-modal-overlay");
        const jumpInput = document.getElementById("jump-page-input");
        jumpInput.value = currentPageNum;
        jumpModal.classList.add("active");
        setTimeout(() => jumpInput.focus(), 100);
    });

    document.getElementById("close-jump-btn").addEventListener("click", () => {
        document.getElementById("jump-modal-overlay").classList.remove("active");
    });

    document.getElementById("jump-modal-overlay").addEventListener("click", (e) => {
        if (e.target === document.getElementById("jump-modal-overlay")) {
            e.target.classList.remove("active");
        }
    });

    const confirmJump = () => {
        const jumpModal = document.getElementById("jump-modal-overlay");
        const jumpInput = document.getElementById("jump-page-input");
        const pageNum = parseInt(jumpInput.value);

        if (isNaN(pageNum) || pageNum < 1 || pageNum > 604) {
            alert("Please enter a valid page number between 1 and 604.");
            return;
        }

        jumpModal.classList.remove("active");

        const chapter = chaptersData.find(c => pageNum >= c.pages[0] && pageNum <= c.pages[1]);
        if (chapter) {
            if (chapter.id === currentChapterId) {
                goToPage(pageNum);
            } else {
                openSurah(chapter, false, pageNum);
            }
        }
    };

    document.getElementById("confirm-jump-btn").addEventListener("click", confirmJump);
    document.getElementById("jump-page-input").addEventListener("keypress", (e) => {
        if (e.key === "Enter") confirmJump();
    });

    // 6. Swipe Gestures for Page Navigation
    let touchStartX = 0;
    let touchEndX = 0;
    let touchStartY = 0;
    let touchEndY = 0;

    readerView.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    readerView.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;

        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;

        // Require significant horizontal movement (>100px) and must be mostly horizontal
        if (Math.abs(deltaX) > 100 && Math.abs(deltaX) > Math.abs(deltaY)) {
            if (deltaX < 0) {
                // Swipe Left -> Prev Page (since icons and buttons were reversed for RTL)
                if (!prevPageBtn.disabled) prevPageBtn.click();
            } else {
                // Swipe Right -> Next Page (since icons and buttons were reversed for RTL)
                if (!nextPageBtn.disabled) nextPageBtn.click();
            }
        }
    }, { passive: true });

    function renderVerses(verses, targetVerseKey = null) {
        versesContainer.innerHTML = "";

        // Reset reader scroll to top
        const scrollContent = document.getElementById('reader-scroll-content');
        if (scrollContent) scrollContent.scrollTop = 0;

        const scriptField = `text_${getActiveApiScript()}`;
        const scriptClass = `script-${getActiveCssClass()}`;
        const isMushafMode = userSettings.readingMode === "page";

        if (isMushafMode) {
            versesContainer.classList.add("mushaf-mode");
            hideVerseActionOverlay(); // Clear any existing overlay state when rendering a new page
        } else {
            versesContainer.classList.remove("mushaf-mode");
        }

        verses.forEach((verse) => {
            const index = verse.globalIndex;
            const verseDiv = document.createElement("div");
            verseDiv.className = `verse-container`;
            if (targetVerseKey && verse.verse_key === targetVerseKey) {
                verseDiv.classList.add("selected");
                selectedVerseIndex = index;
                setTimeout(() => {
                    verseDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            }
            verseDiv.id = `verse-${verse.verse_key.replace(':', '-')}`;

            const arabicText = verse[scriptField] || "";
            // Fix global quran tajweed mapping for Amiri font (U+0672 to Dagger Alef U+0670)
            let finalArabicText = (isActiveTajweed())
                ? arabicText.replace(/\u0672/g, "\u0670")
                : arabicText;

            // Sanitize API HTML to prevent XSS while preserving tajweed/formatting spans
            finalArabicText = sanitizeHTML(finalArabicText);

            // Handle Verse Ornament (End of Ayah)
            // If API already has <span class=end> (or class="end" after sanitization), we replace it.
            // Otherwise we extract the number from verse_key and add it.
            const vNumber = toArabicIndic(verse.verse_number);
            const ayahMarker = `<span class="ayah-number">${vNumber}</span>`;

            if (finalArabicText.includes('class="end"') || finalArabicText.includes('class=end')) {
                finalArabicText = finalArabicText.replace(/<span class=?"?end"?>.*?<\/span>/, ayahMarker);
            } else {
                finalArabicText += `${ayahMarker}`;
            }

            // Handle Multi-Translations
            let translationsHtml = "";
            if (userSettings.translation.length > 0 && verse.translations) {
                // Determine order based on userSettings.translation
                userSettings.translation.forEach(resId => {
                    const trans = verse.translations.find(t => t.resource_id.toString() === resId.toString());
                    if (trans) {
                        const resName = getResourceName(resId);
                        const isArabic = isResourceArabic(resId);
                        const dirAttr = isArabic ? 'dir="rtl"' : 'dir="ltr"';
                        const alignStyle = isArabic ? 'style="text-align: right;"' : '';

                        translationsHtml += `<div class="verse-translation-item" ${dirAttr} ${alignStyle}>
                            <div class="trans-text">${sanitizeHTML(trans.text)}</div>
                            <div class="trans-res-name">— ${escapeHTML(resName)}</div>
                        </div>`;
                    }
                });
            }

            const translationDisplay = (userSettings.translation.length === 0) ? 'display:none;' : '';

            // Check if this verse is bookmarked (to set initial icon)
            const isBookmarked = getBookmarks().some(b => b.verseKey === verse.verse_key);
            const bmIcon = isBookmarked ? "mdi-bookmark" : "mdi-bookmark-outline";

            verseDiv.innerHTML = `
                <div class="verse-header">
                    <div style="display: flex; align-items: center;">
                        <span class="verse-number-badge">${escapeHTML(verse.verse_key)}</span>
                        <button class="badge-settings-btn trans-settings-trigger" title="Translation Settings">
                            <i class="mdi mdi-cog-outline"></i>
                        </button>
                    </div>
                    <div class="verse-actions">
                        <button class="bookmark-verse-btn" title="Bookmark Ayah"><i class="mdi ${escapeHTML(bmIcon)}"></i></button>
                        <button class="copy-verse-btn" title="Copy Ayah"><i class="mdi mdi-content-copy"></i></button>
                        <button class="play-verse-btn" style="${audioFilesData && audioFilesData.length > 0 ? 'display: inline-flex;' : 'display: none;'}" title="Play Ayah" data-index="${parseInt(index, 10)}"><i class="mdi mdi-play-circle-outline"></i></button>
                        <button class="tafsir-verse-btn" title="View Tafsir"><i class="mdi mdi-translate"></i></button>
                    </div>
                </div>
                <div class="verse-arabic ${escapeHTML(scriptClass)}" style="font-size: ${escapeHTML(String(userSettings.arabicSize))}rem;">${finalArabicText}</div>
                <div class="verse-translation" style="font-size: ${escapeHTML(String(userSettings.transSize))}rem; ${translationDisplay}">${translationsHtml}</div>
            `;

            verseDiv.querySelector(".bookmark-verse-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                const added = toggleBookmark(verse.verse_key);
                e.currentTarget.querySelector("i").className = `mdi ${added ? 'mdi-bookmark' : 'mdi-bookmark-outline'}`;
            });

            verseDiv.querySelector(".tafsir-verse-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                showVerseOverlay(index, verseDiv, verse.verse_key, true); // true = hide actions row
            });

            verseDiv.querySelector(".copy-verse-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                copyVerse(verse.verse_key, e);
            });

            verseDiv.querySelector(".play-verse-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                playVerse(index);
            });

            // In mushaf mode, make the whole container or text clickable
            if (isMushafMode) {
                verseDiv.addEventListener("click", (e) => {
                    e.stopPropagation();
                    showVerseOverlay(index, verseDiv, verse.verse_key, false); // false = show actions row
                });
            }

            versesContainer.appendChild(verseDiv);
        });
    }

    // 5. Audio Logic
    function resetAudio() {
        audioEl.pause();
        audioEl.currentTime = 0;
        audioElB.pause();
        audioElB.currentTime = 0;
        activeAudio = audioEl;
        bufferAudio = audioElB;
        bufferAudio.removeAttribute('data-preloaded-url');
        playIcon.className = "mdi mdi-play";
        currentPlayingIndex = -1;
        isBismillahPlaying = false;
        removeAllHighlight();
        audioPlayer.style.display = "none";
        stopRangeMode();
    }

    function playVerse(index, isRepeat = false) {
        if (!audioFilesData || index >= audioFilesData.length || index < 0) return;

        ensureWebAudioRouting();

        if (!isRepeat) {
            currentAyahPlayCount = 1;
        }

        // Ensure we are on the correct page before playing
        const targetPage = currentVersesData[index].page_number;
        if (targetPage !== currentPageNum) {
            goToPage(targetPage);
        }

        currentPlayingIndex = index;
        const audioObj = audioFilesData[index];
        const audioUrl = resolveAudioUrl(audioObj);

        // Check if the buffer audio already has this URL pre-loaded
        if (bufferAudio.getAttribute('data-preloaded-url') === audioUrl) {
            // Swap: the pre-loaded buffer becomes active
            activeAudio.pause();
            swapAudioElements();
        } else {
            // No pre-load available, load into current active
            activeAudio.src = audioUrl;
        }

        resetGain(getActiveGain());
        activeAudio.playbackRate = currentPlaybackSpeed;
        activeAudio.play().catch(e => console.error("Playback failed:", e));

        // Pre-load the next verse into the now-free buffer element
        bufferAudio.removeAttribute('data-preloaded-url');
        preloadNext(index);

        playIcon.className = "mdi mdi-pause";
        currentAyahSpan.textContent = audioObj.verse_key;

        const reciterName = document.getElementById("current-reciter-name")?.textContent || "Quran Reciter";
        updateMediaSessionMetadata(`Ayah ${audioObj.verse_key}`, reciterName);

        hideVerseActionOverlay();
        highlightVerse(index);
    }

    async function loadOverlayTafsir() {
        if (selectedVerseIndex === null) return;
        const currentVerse = currentVersesData[selectedVerseIndex];
        const verseKey = currentVerse.verse_key;
        const resourceId = overlayTafsirSelect.value;

        // 1. Check if we already have it in memory (from list view)
        if (currentVerse.translations) {
            const match = currentVerse.translations.find(t => t.resource_id.toString() === resourceId.toString());
            if (match) {
                const isArabic = isResourceArabic(resourceId);
                overlayTafsirContent.style.direction = isArabic ? "rtl" : "ltr";
                overlayTafsirContent.style.textAlign = isArabic ? "right" : "left";
                overlayTafsirContent.innerHTML = sanitizeHTML(match.text);
                setTimeout(updateOverlayPosition, 50);
                return;
            }
        }

        overlayTafsirContent.innerHTML = '<div class="loader" style="width:20px; height:20px; margin:20px auto; border-width: 2px;"></div>';

        try {
            // 2. Fetch from network/cache
            let url;
            const isTafsir = tafsirIds.includes(resourceId.toString());
            if (isTafsir) {
                const parts = verseKey.split(':');
                url = `https://api.quran.com/api/v3/chapters/${parts[0]}/verses/${parts[1]}/tafsirs/${resourceId}`;
            } else {
                url = `https://api.quran.com/api/v4/verses/by_key/${verseKey}?translations=${resourceId}`;
            }

            let response;
            try {
                const cachedRes = await caches.match(url);
                if (cachedRes) {
                    response = cachedRes;
                } else {
                    response = await fetch(url);
                    if (response.status === 404) {
                        overlayTafsirContent.innerHTML = isTafsir 
                            ? "No tafsir content available for this Ayah." 
                            : "No translation found for this Ayah.";
                        setTimeout(updateOverlayPosition, 50);
                        return;
                    }
                    if (!response.ok) throw new Error("Fetch failed");
                }
            } catch (fetchErr) {
                // 3. OFFLINE PROXY: If per-verse fetch fails, try extracting it from the chapter-page cache
                console.log("Overlay: Offline fallback search for", verseKey);
                const parts = verseKey.split(':');
                const chId = parts[0];
                const vNum = parseInt(parts[1]);

                let fallbackUrl;
                if (isTafsir) {
                    const tafPage = Math.ceil(vNum / 100); // Storage manager uses per_page=100 for tafsirs
                    fallbackUrl = `https://api.quran.com/api/v4/tafsirs/${resourceId}/by_chapter/${chId}?page=${tafPage}&per_page=100`;
                } else {
                    const transPage = Math.ceil(vNum / 50); // Storage manager uses per_page=50 for translations
                    const allScripts = quranScriptsList.map(s => `text_${s.id}`).join(',');
                    fallbackUrl = `https://api.quran.com/api/v4/verses/by_chapter/${chId}?language=en&words=false&fields=${allScripts},hizb_number,rub_el_hizb_number,juz_number&page=${transPage}&per_page=50&translations=${resourceId}`;
                }

                let fbRes = await caches.match(fallbackUrl);
                if (!fbRes) {
                    try {
                        fbRes = await fetch(fallbackUrl);
                    } catch (fbFetchErr) {
                        throw fetchErr; // Re-throw original error if offline fallback also fails
                    }
                }
                response = fbRes;
                if (!response || response.status === 404) {
                    overlayTafsirContent.innerHTML = isTafsir 
                        ? "No tafsir content available for this Ayah." 
                        : "No translation found for this Ayah.";
                    setTimeout(updateOverlayPosition, 50);
                    return;
                }
                if (!response.ok) throw fetchErr; // Give up

                const pageData = await response.json();
                let matchContent = null;

                if (isTafsir && pageData.tafsirs) {
                    const match = pageData.tafsirs.find(t => t.verse_key === verseKey);
                    if (match) matchContent = match.text;
                } else if (!isTafsir && pageData.verses) {
                    const match = pageData.verses.find(v => v.verse_key === verseKey);
                    if (match && match.translations && match.translations.length > 0) {
                        matchContent = match.translations[0].text;
                    }
                }

                if (matchContent) {
                    const isArabic = isResourceArabic(resourceId);
                    overlayTafsirContent.style.direction = isArabic ? "rtl" : "ltr";
                    overlayTafsirContent.style.textAlign = isArabic ? "right" : "left";
                    overlayTafsirContent.innerHTML = sanitizeHTML(matchContent);
                    setTimeout(updateOverlayPosition, 50);
                    return;
                }

                overlayTafsirContent.innerHTML = isTafsir 
                    ? "No tafsir content available for this Ayah." 
                    : "No translation found for this Ayah.";
                setTimeout(updateOverlayPosition, 50);
                return;
            }

            const data = await response.json();

            const isArabic = isResourceArabic(resourceId);
            overlayTafsirContent.style.direction = isArabic ? "rtl" : "ltr";
            overlayTafsirContent.style.textAlign = isArabic ? "right" : "left";

            if (isTafsir) {
                // v3 structure: { tafsir: { text: "..." } } or { tafsirs: [ { text: "..." } ] }
                if (data.tafsir && data.tafsir.text) {
                    overlayTafsirContent.innerHTML = sanitizeHTML(data.tafsir.text);
                } else if (data.tafsirs && data.tafsirs.length > 0) {
                    overlayTafsirContent.innerHTML = sanitizeHTML(data.tafsirs[0].text);
                } else {
                    overlayTafsirContent.innerHTML = "No tafsir content available for this Ayah.";
                }
            } else {
                // v4 structure: { verse: { translations: [ { text: "..." } ] } }
                if (data.verse && data.verse.translations && data.verse.translations.length > 0) {
                    overlayTafsirContent.innerHTML = sanitizeHTML(data.verse.translations[0].text);
                } else {
                    overlayTafsirContent.innerHTML = "No translation found for this Ayah.";
                }
            }
            // Wait a tiny bit for DOM update before re-positioning
            setTimeout(updateOverlayPosition, 50);
        } catch (error) {
            console.error("Failed to fetch content:", error);
            overlayTafsirContent.innerHTML = "Error loading content. Please check your connection.";
        }
    }

    function updateOverlayPosition() {
        if (!overlay.classList.contains("active") || selectedVerseIndex === null || isOverlayManuallyMoved) return;
        const element = document.querySelector(`.verse-container#verse-${currentVersesData[selectedVerseIndex].verse_key.replace(':', '-')}`);
        if (!element) return;

        const rect = element.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();

        // Horizontal center
        const left = rect.left + (rect.width / 2) - (overlayRect.width / 2);
        // Above the element
        const top = rect.top - overlayRect.height - 10;

        overlay.style.top = `${Math.max(10, top)}px`;
        overlay.style.left = `${Math.max(10, Math.min(window.innerWidth - overlayRect.width - 10, left))}px`;
    }

    function showVerseOverlay(index, element, verseKey, hideActionsRow = false) {
        if (selectedVerseIndex === index) {
            hideVerseActionOverlay();
            return;
        }

        // Clear any previous selection
        document.querySelectorAll(".verse-container.selected").forEach(el => el.classList.remove("selected"));

        selectedVerseIndex = index;
        element.classList.add("selected");

        overlayKey.textContent = `Ayah ${verseKey}`;
        overlay.classList.add("active");

        // Hide/Show actions row
        if (hideActionsRow) {
            overlay.classList.add("hide-actions");
        } else {
            overlay.classList.remove("hide-actions");
        }

        // Handle Audio Availability
        const hasAudio = audioFilesData && audioFilesData.length > 0;
        overlayPlay.style.display = hasAudio ? "flex" : "none";

        // Update bookmark icon state
        const isBookmarked = getBookmarks().some(b => b.verseKey === verseKey);
        const bmIcon = overlayBookmark.querySelector("i");
        bmIcon.className = isBookmarked ? "mdi mdi-bookmark" : "mdi mdi-bookmark-outline";

        // Position overlay above the verse
        setTimeout(updateOverlayPosition, 0);

        overlayPlay.onclick = () => {
            playVerse(index);
        };
        overlayClose.onclick = () => {
            hideVerseActionOverlay();
        };
        overlayBookmark.onclick = () => {
            toggleBookmark(verseKey);
            const isNowBookmarked = getBookmarks().some(b => b.verseKey === verseKey);
            overlayBookmark.querySelector("i").className = isNowBookmarked ? "mdi mdi-bookmark" : "mdi mdi-bookmark-outline";
        };
        overlayCopy.onclick = (e) => {
            copyVerse(verseKey, e);
        };

        // Ensure Tafsir/Translation view respects visibility state
        if (isTafsirVisible || hideActionsRow) { // Force show if specifically clicked in list mode
            overlayTafsirContainer.style.display = "flex";
            overlayTafsirContainer.classList.add("active");
            overlayTafsirBtn.classList.add("active");
            loadOverlayTafsir();
        } else {
            overlayTafsirContainer.style.display = "none";
            overlayTafsirContainer.classList.remove("active");
            overlayTafsirBtn.classList.remove("active");
        }

        // Listen for changes
        overlayTafsirSelect.onchange = () => {
            localStorage.setItem("lastSelectedTafsir", overlayTafsirSelect.value);
            loadOverlayTafsir();
        };

        // Existing Tafsir Toggle Logic
        overlayTafsirBtn.onclick = (e) => {
            e.stopPropagation();
            const isVisible = overlayTafsirContainer.style.display === "flex";
            if (isVisible) {
                overlayTafsirContainer.style.display = "none";
                overlayTafsirContainer.classList.remove("active");
                overlayTafsirBtn.classList.remove("active");
                isTafsirVisible = false;
                localStorage.setItem("isTafsirVisible", "false");
                // Reset size to original compact form
                overlay.style.width = "";
                overlay.style.height = "";
            } else {
                overlayTafsirContainer.style.display = "flex";
                overlayTafsirContainer.classList.add("active");
                overlayTafsirBtn.classList.add("active");
                isTafsirVisible = true;
                localStorage.setItem("isTafsirVisible", "true");
                loadOverlayTafsir();
            }
            // Re-position after state change
            setTimeout(updateOverlayPosition, 50);
        };
    }

    function hideVerseActionOverlay() {
        overlay.classList.remove("active");
        overlayTafsirContainer.classList.remove("active");
        selectedVerseIndex = null;
        // Reset manual position on close
        isOverlayManuallyMoved = false;
        overlay.style.top = "";
        overlay.style.left = "";
        overlay.style.transform = "";
        document.querySelectorAll(".verse-container.selected").forEach(el => el.classList.remove("selected"));
    }

    // Draggable Logic
    let isDraggingOverlay = false;
    let dragStartX, dragStartY;
    let overlayInitialX, overlayInitialY;

    const overlayHeader = overlay.querySelector(".menu-header");
    overlayHeader.addEventListener("mousedown", dragStart);
    document.addEventListener("mousemove", dragMove);
    document.addEventListener("mouseup", dragEnd);

    // Touch support
    overlayHeader.addEventListener("touchstart", (e) => dragStart(e.touches[0]), { passive: true });
    document.addEventListener("touchmove", (e) => dragMove(e.touches[0]), { passive: true });
    document.addEventListener("touchend", dragEnd, { passive: true });

    function dragStart(e) {
        isDraggingOverlay = true;
        isOverlayManuallyMoved = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        const rect = overlay.getBoundingClientRect();
        overlayInitialX = rect.left;
        overlayInitialY = rect.top;
        overlay.style.transition = "none"; // Disable transitions while dragging
    }

    function dragMove(e) {
        if (!isDraggingOverlay) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        overlay.style.left = `${overlayInitialX + dx}px`;
        overlay.style.top = `${overlayInitialY + dy}px`;
        overlay.style.bottom = "auto";
        overlay.style.right = "auto";
        overlay.style.transform = "none";
    }

    function dragEnd() {
        if (!isDraggingOverlay) return;
        isDraggingOverlay = false;
        overlay.style.transition = ""; // Re-enable transitions
    }

    // ── Gapless "ended" handler ─────────────────────────
    // We install it on BOTH audio elements so it fires regardless of which one is active.
    function onAudioEnded() {
        // Ignore events from the non-active element
        if (this !== activeAudio) return;

        if (isTajweedExamplePlaying) {
            isTajweedExamplePlaying = false;
            playIcon.className = "mdi mdi-play";
            return;
        }

        if (isBismillahPlaying) {
            isBismillahPlaying = false;
            // If range mode active, start from range start instead of 0
            if (isRangeMode && rangeStartIndex !== -1) {
                playVerse(rangeStartIndex);
            } else {
                playVerse(0); // Start the actual verses
            }
            return;
        }

        // Ayah Repetition Logic (Per Verse)
        if (currentAyahPlayCount < ayahRepeatTarget) {
            currentAyahPlayCount++;
            playVerse(currentPlayingIndex, true);
            return;
        }

        // Range Recitation Logic
        if (isRangeMode) {
            if (currentPlayingIndex < rangeEndIndex) {
                // Next verse in range
                playVerse(currentPlayingIndex + 1);
            } else {
                // Reached end of range
                if (rangeSetTarget === 0 || currentRangeSetCount < rangeSetTarget) {
                    currentRangeSetCount++;
                    console.log(`Range Repeat: Set ${currentRangeSetCount} of ${rangeSetTarget || 'Unlimited'}`);
                    playVerse(rangeStartIndex);
                } else {
                    // Range complete
                    console.log("Range Recitation complete");
                    stopRangeMode();
                    playIcon.className = "mdi mdi-play";
                    removeAllHighlight();
                    currentPlayingIndex = -1;
                }
            }
            return;
        }

        if (currentPlayingIndex < audioFilesData.length - 1) {
            playVerse(currentPlayingIndex + 1);
        } else {
            // Chapter finished
            if (continueNextSurah) {
                const chapterIdx = chaptersData.findIndex(c => c.id === currentChapterId);
                if (chapterIdx < chaptersData.length - 1) {
                    const nextChapter = chaptersData[chapterIdx + 1];
                    openSurah(nextChapter).then(() => {
                        // After loading the new chapter, playBismillah or playVerse(0)
                        if (bismillahAudioData && nextChapter.id !== 1 && nextChapter.id !== 9) {
                            playBismillah();
                        } else {
                            playVerse(0);
                        }
                    });
                    return;
                }
            }

            playIcon.className = "mdi mdi-play";
            removeAllHighlight();
            currentPlayingIndex = -1;
        }
    }
    audioEl.addEventListener("ended", onAudioEnded);
    audioElB.addEventListener("ended", onAudioEnded);

    // ── Micro fade-out near end of each ayah ──────────
    // Monitors the active audio element and applies a 150ms gain ramp to zero
    // just before the track ends, preventing the abrupt signal cutoff.
    function onAudioTimeUpdate() {
        if (this !== activeAudio) return;
        if (!audioCtx || !this.duration || this.paused) return;
        const remaining = this.duration - this.currentTime;
        const fadeSeconds = FADE_OUT_MS / 1000;
        const g = getActiveGain();
        if (!g) return;
        if (remaining <= fadeSeconds && remaining > 0 && g.gain.value > 0.01) {
            // Must set current value first, then schedule ramp (Web Audio spec)
            g.gain.cancelScheduledValues(audioCtx.currentTime);
            g.gain.setValueAtTime(g.gain.value, audioCtx.currentTime);
            g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + remaining);
        }
    }
    audioEl.addEventListener("timeupdate", onAudioTimeUpdate);
    audioElB.addEventListener("timeupdate", onAudioTimeUpdate);

    function stopRangeMode() {
        isRangeMode = false;
        document.getElementById("range-toggle-btn").classList.remove("active");
    }

    if (autoplayToggle) {
        autoplayToggle.addEventListener("click", () => {
            continueNextSurah = !continueNextSurah;
            autoplayToggle.classList.toggle("active", continueNextSurah);
            autoplayToggle.querySelector("i").className = continueNextSurah ? "mdi mdi-playlist-check" : "mdi mdi-playlist-play";
        });
    }

    const speedToggle = document.getElementById("speed-toggle");
    const speedMenu = document.getElementById("speed-menu");
    const speedValSpan = document.getElementById("speed-val");
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

    if (speedToggle && speedMenu) {
        // Create menu items
        speeds.forEach(speed => {
            const item = document.createElement("div");
            item.className = `speed-option ${speed === currentPlaybackSpeed ? 'active' : ''}`;
            item.textContent = speed + "x";
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                currentPlaybackSpeed = speed;
                activeAudio.playbackRate = speed;
                bufferAudio.playbackRate = speed;
                if (speedValSpan) speedValSpan.textContent = speed + "x";

                // Update active state in UI
                document.querySelectorAll("#speed-menu .speed-option").forEach(opt => {
                    opt.classList.toggle("active", parseFloat(opt.textContent) === speed);
                });

                speedMenu.classList.remove("active");
            });
            speedMenu.appendChild(item);
        });

        // Close menu when clicking outside
        document.addEventListener("click", () => {
            speedMenu.classList.remove("active");
            repeatMenu.classList.remove("active");
            const recM = document.getElementById("reciter-menu");
            if (recM) recM.classList.remove("active");
        });
    }

    const repeatToggle = document.getElementById("repeat-toggle");
    const repeatMenu = document.getElementById("repeat-menu");
    const repeatValSpan = document.getElementById("repeat-val");
    const repeatCounts = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    if (repeatToggle && repeatMenu) {
        repeatCounts.forEach(count => {
            const item = document.createElement("div");
            item.className = `speed-option ${count === ayahRepeatTarget ? 'active' : ''}`;
            item.textContent = count + "x";
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                ayahRepeatTarget = count;
                if (repeatValSpan) repeatValSpan.textContent = count + "x";

                // Update active state in repeat menu UI
                document.querySelectorAll("#repeat-menu .speed-option").forEach(opt => {
                    opt.classList.toggle("active", parseInt(opt.textContent) === count);
                });

                repeatMenu.classList.remove("active");
            });
            repeatMenu.appendChild(item);
        });

        repeatToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            speedMenu.classList.remove("active");
            document.getElementById("reciter-menu")?.classList.remove("active");
            repeatMenu.classList.toggle("active");
        });

        speedToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            repeatMenu.classList.remove("active");
            document.getElementById("reciter-menu")?.classList.remove("active");
            speedMenu.classList.toggle("active");
        });
    }

    // Range Recitation UI Logic
    const rangeToggleBtn = document.getElementById("range-toggle-btn");
    const rangeModal = document.getElementById("range-modal-overlay");
    const closeRangeBtn = document.getElementById("close-range-btn");
    const startRangeBtn = document.getElementById("start-range-btn");
    const rangeStartInput = document.getElementById("range-start-verse");
    const rangeEndInput = document.getElementById("range-end-verse");
    const rangeSetRepeatSelect = document.getElementById("range-set-repeat");
    const rangeVerseDisplay = document.getElementById("range-verse-repeat-display");
    const rangeSpeedDisplay = document.getElementById("range-speed-display");

    if (rangeToggleBtn) {
        rangeToggleBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (isRangeMode) {
                // If already in range mode, clicking toggle just opens settings to modify or stop?
                // Actually, let's just open the modal.
            }

            // Set default values based on current surah and state
            const chapter = chaptersData.find(c => c.id === currentChapterId);
            if (chapter) {
                rangeStartInput.max = chapter.verses_count;
                rangeEndInput.max = chapter.verses_count;

                if (!isRangeMode) {
                    rangeStartInput.value = 1;
                    rangeEndInput.value = chapter.verses_count;
                }
            }

            // Sync displays
            rangeVerseDisplay.textContent = ayahRepeatTarget + "x";
            rangeSpeedDisplay.textContent = currentPlaybackSpeed + "x";

            rangeModal.classList.add("active");
        });
    }

    if (closeRangeBtn) {
        closeRangeBtn.addEventListener("click", () => {
            rangeModal.classList.remove("active");
        });
    }

    if (rangeModal) {
        rangeModal.addEventListener("click", (e) => {
            if (e.target === rangeModal) rangeModal.classList.remove("active");
        });
    }

    if (startRangeBtn) {
        startRangeBtn.addEventListener("click", () => {
            const startV = parseInt(rangeStartInput.value);
            const endV = parseInt(rangeEndInput.value);
            const setRep = parseInt(rangeSetRepeatSelect.value);

            if (isNaN(startV) || isNaN(endV) || startV < 1 || endV < startV) {
                alert("Please enter a valid range of verses.");
                return;
            }

            // Find indices
            rangeStartIndex = currentVersesData.findIndex(v => v.verse_number === startV);
            rangeEndIndex = currentVersesData.findIndex(v => v.verse_number === endV);

            if (rangeStartIndex === -1 || rangeEndIndex === -1) {
                alert("Selected verses not found in current Surah.");
                return;
            }

            // Enter Range Mode
            isRangeMode = true;
            rangeSetTarget = setRep;
            currentRangeSetCount = 1;
            rangeToggleBtn.classList.add("active");
            rangeModal.classList.remove("active");

            console.log(`Starting Range Recitation: Verses ${startV}-${endV}, Set Repeats: ${setRep || 'Unlimited'}`);

            // Start playing from first verse in range
            playVerse(rangeStartIndex);
        });
    }

    // ── Reciter Quick-Switch in Audio Player ────────────
    const reciterToggle = document.getElementById("reciter-toggle");
    const reciterMenu = document.getElementById("reciter-menu");
    const reciterSelectEl = document.getElementById("reciter-select");

    function populateReciterMenu() {
        if (!reciterToggle || !reciterMenu || !reciterSelectEl) return;
        // Clear any previous menu items (keep header)
        const header = reciterMenu.querySelector(".menu-header");
        reciterMenu.innerHTML = "";
        if (header) reciterMenu.appendChild(header);

        Array.from(reciterSelectEl.options).forEach(opt => {
            const item = document.createElement("div");
            item.className = "speed-option";
            item.textContent = opt.textContent;
            item.setAttribute("data-reciter-id", opt.value);
            if (opt.value === userSettings.reciter) item.classList.add("active");
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                userSettings.reciter = opt.value;
                reciterSelectEl.value = opt.value;
                saveSettings();
                reciterMenu.classList.remove("active");
            });
            reciterMenu.appendChild(item);
        });

        // Show current reciter name as tooltip AND in the bottom row
        const sel = reciterSelectEl.options[reciterSelectEl.selectedIndex];
        if (sel) {
            reciterToggle.title = sel.textContent;
            const nameEl = document.getElementById("current-reciter-name");
            if (nameEl) nameEl.textContent = sel.textContent;
        }
    }

    if (reciterToggle && reciterMenu && reciterSelectEl) {
        reciterToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            speedMenu.classList.remove("active");
            repeatMenu.classList.remove("active");
            reciterMenu.classList.toggle("active");
        });
    }

    playPauseBtn.addEventListener("click", () => {
        if (activeAudio.paused) {
            if (currentPlayingIndex === -1 && !isBismillahPlaying) {
                if (bismillahAudioData && (currentChapterId !== 1 && currentChapterId !== 9)) {
                    playBismillah();
                } else {
                    playVerse(0); // Start from beginning
                }
            } else {
                resetGain(getActiveGain());
                activeAudio.play();
                playIcon.className = "mdi mdi-pause";
            }
        } else {
            activeAudio.pause();
            playIcon.className = "mdi mdi-play";
        }
    });

    prevBtn.addEventListener("click", () => {
        if (currentPlayingIndex > 0) {
            bufferAudio.removeAttribute('data-preloaded-url'); // invalidate pre-load on manual nav
            playVerse(currentPlayingIndex - 1);
        }
    });

    nextBtn.addEventListener("click", () => {
        if (currentPlayingIndex < audioFilesData.length - 1) {
            playVerse(currentPlayingIndex + 1);
        }
    });

    function highlightVerse(index) {
        removeAllHighlight();
        if (!currentVersesData || index >= currentVersesData.length) return;

        const verseKey = currentVersesData[index].verse_key.replace(':', '-');
        const element = document.getElementById(`verse-${verseKey}`);
        if (element) {
            element.classList.add("playing");
            // Auto scroll to element smoothly
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function removeAllHighlight() {
        document.querySelectorAll(".verse-container.playing").forEach(el => {
            el.classList.remove("playing");
        });
    }

    // 6. Settings Logic
    function openSettings() {
        settingsModal.classList.add("active");
    }

    function closeSettingsModal() {
        settingsModal.classList.remove("active");
    }

    if (settingsBtn) settingsBtn.addEventListener("click", openSettings);
    if (readerSettingsBtn) readerSettingsBtn.addEventListener("click", openSettings);
    closeSettings.addEventListener("click", closeSettingsModal);
    settingsModal.addEventListener("click", (e) => {
        if (e.target === settingsModal) closeSettingsModal();
    });

    const clearAllCacheGlobalBtn = document.getElementById("storage-clear-all");
    if (clearAllCacheGlobalBtn) clearAllCacheGlobalBtn.addEventListener("click", () => clearQuranCache());

    // Initial update of cache size
    setTimeout(updateCacheSizeDisplay, 1000);

    function updateTajweedButtonVisibility() {
        if (readerTajweedBtn) {
            readerTajweedBtn.style.display = isActiveTajweed() ? "flex" : "none";
            // If we are not in tajweed script, close the legend if open
            if (!isActiveTajweed()) {
                readerTajweedGuide.classList.remove("active");
                readerTajweedBtn.classList.remove("active");
                const chevron = document.getElementById("tajweed-chevron");
                if (chevron) chevron.className = "mdi mdi-chevron-up";
                setTimeout(() => {
                    if (!readerTajweedGuide.classList.contains("active")) {
                        readerTajweedGuide.style.display = "none";
                    }
                }, 300);
            }
        }
    }

    // ── Storage & Offline Logic ─────────────────────────────

    async function getCacheInfo() {
        if (!('caches' in window)) return { totalSize: 0, cacheNames: [], cacheUrls: {} };
        const allNames = await caches.keys();
        const quranNames = allNames.filter(n => n.startsWith(QURAN_CACHE_PREFIX));
        let totalSize = 0;
        const cacheUrls = {};

        for (const name of quranNames) {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            cacheUrls[name] = keys.map(r => r.url);
            for (const request of keys) {
                const response = await cache.match(request);
                if (response) {
                    try {
                        const cl = response.headers.get('Content-Length');
                        if (cl) {
                            totalSize += parseInt(cl, 10) || 0;
                        } else {
                            const blob = await response.blob();
                            totalSize += blob.size;
                        }
                    } catch (e) { }
                }
            }
        }
        return { totalSize, cacheNames: quranNames, cacheUrls };
    }

    async function updateCacheSizeDisplay() {
        if (!storageTotalSize) return;
        const info = await getCacheInfo();
        const sizeInMB = (info.totalSize / (1024 * 1024)).toFixed(1);
        storageTotalSize.textContent = `${sizeInMB} MB`;
    }

    function compareStorageItemsByStatus(a, b) {
        if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
        return a.name.localeCompare(b.name);
    }

    function getTranslationCacheMeta(translationId, cacheUrls) {
        const transUrls = cacheUrls[quranTranslationCache(translationId)] || [];
        let fullSurahs = 0;
        let partSurahs = 0;

        if (chaptersData && chaptersData.length > 0) {
            chaptersData.forEach(ch => {
                const pages = Math.ceil(ch.verses_count / 50);
                let pagesFound = 0;
                for (let p = 1; p <= pages; p++) {
                    if (transUrls.some(urlString => {
                        try {
                            const u = new URL(urlString);
                            const pathPattern = `/api/v4/verses/by_chapter/${ch.id}`;
                            if (!u.pathname.endsWith(pathPattern)) return false;
                            const params = u.searchParams;
                            if (params.get("page") !== p.toString()) return false;
                            if (params.get("per_page") !== "50") return false;
                            const translationsParam = params.get("translations");
                            if (!translationsParam) return false;
                            const ids = translationsParam.split(',');
                            return ids.includes(translationId.toString());
                        } catch (e) {
                            return false;
                        }
                    })) {
                        pagesFound++;
                    }
                }
                if (pagesFound === pages) fullSurahs++;
                else if (pagesFound > 0) partSurahs++;
            });
        }

        const isFull = fullSurahs === 114;
        const isPart = !isFull && (fullSurahs > 0 || partSurahs > 0);

        return {
            isFull,
            isPart,
            fullSurahs,
            partSurahs,
            sortRank: isFull ? 0 : (isPart ? 1 : 2)
        };
    }

    function getTafsirCacheMeta(tafsirId, cacheUrls) {
        const tafUrls = cacheUrls[quranTafsirCache(tafsirId)] || [];
        let fullSurahs = 0;
        let partSurahs = 0;

        if (chaptersData && chaptersData.length > 0) {
            chaptersData.forEach(ch => {
                const pages = Math.ceil(ch.verses_count / 100);
                let pagesFound = 0;
                for (let p = 1; p <= pages; p++) {
                    if (tafUrls.some(urlString => {
                        try {
                            const u = new URL(urlString);
                            const pathPattern = `/api/v4/tafsirs/${tafsirId}/by_chapter/${ch.id}`;
                            if (!u.pathname.endsWith(pathPattern)) return false;
                            const params = u.searchParams;
                            if (params.get("page") !== p.toString()) return false;
                            if (params.get("per_page") !== "100") return false;
                            return true;
                        } catch (e) {
                            return false;
                        }
                    })) {
                        pagesFound++;
                    }
                }
                if (pagesFound === pages) fullSurahs++;
                else if (pagesFound > 0) partSurahs++;
            });
        }

        const isFull = fullSurahs === 114;
        const isPart = !isFull && (fullSurahs > 0 || partSurahs > 0);

        return {
            isFull,
            isPart,
            fullSurahs,
            partSurahs,
            sortRank: isFull ? 0 : (isPart ? 1 : 2)
        };
    }

    function getSimpleResourceSortMeta(type, resource, cacheUrls) {
        if (type === "translation") {
            return getTranslationCacheMeta(resource.id, cacheUrls);
        } else if (type === "tafsir") {
            return getTafsirCacheMeta(resource.id, cacheUrls);
        }
        return {
            isFull: false,
            isPart: false,
            sortRank: 2
        };
    }

    function getRecitationSortMeta(resource, cacheUrls) {
        let fullCount = 0;
        let partCount = 0;

        for (let i = 1; i <= 114; i++) {
            const status = getRecitationSurahCacheMeta(resource.id, i, cacheUrls);

            if (status.isFull) fullCount++;
            else if (status.isPart) partCount++;
        }

        const isFull = fullCount === 114;
        const isPart = !isFull && (fullCount > 0 || partCount > 0);

        return {
            fullCount,
            partCount,
            isFull,
            isPart,
            sortRank: isFull ? 0 : (isPart ? 1 : 2)
        };
    }

    function getTextScriptSortMeta(script, cacheUrls) {
        const textUrls = cacheUrls[quranTextCache(script.id)] || [];
        let fullSurahs = 0;
        let partSurahs = 0;

        if (chaptersData && chaptersData.length > 0) {
            chaptersData.forEach(ch => {
                const pages = Math.ceil(ch.verses_count / 50);
                let pagesFound = 0;
                for (let p = 1; p <= pages; p++) {
                    if (textUrls.some(urlString => {
                        try {
                            const u = new URL(urlString);
                            const pathPattern = `/api/v4/verses/by_chapter/${ch.id}`;
                            if (!u.pathname.endsWith(pathPattern)) return false;
                            const params = u.searchParams;
                            if (params.get("page") !== p.toString()) return false;
                            if (params.get("per_page") !== "50") return false;
                            if (params.has("translations")) return false;
                            const fields = params.get("fields") || "";
                            return fields.split(',').includes(`text_${script.id}`);
                        } catch (e) {
                            return false;
                        }
                    })) {
                        pagesFound++;
                    }
                }
                if (pagesFound === pages) fullSurahs++;
                else if (pagesFound > 0) partSurahs++;
            });
        }

        const isFull = fullSurahs === 114;
        const isPart = !isFull && (fullSurahs > 0 || partSurahs > 0);

        return {
            textUrls,
            fullSurahs,
            partSurahs,
            isFull,
            isPart,
            sortRank: isFull ? 0 : (isPart ? 1 : 2)
        };
    }

    async function isResourceCached(pattern, cachedUrls) {
        return cachedUrls.some(url => url.includes(pattern));
    }

    async function renderStoragePanel() {
        if (!panelStorage) return;

        const cacheInfo = await getCacheInfo();
        const quranCacheNames = cacheInfo.cacheNames;
        const cacheUrls = cacheInfo.cacheUrls;

        // Update Stats
        const sizeInMB = (cacheInfo.totalSize / (1024 * 1024)).toFixed(1);
        storageTotalSize.textContent = `${sizeInMB} MB`;

        // 1. Reciters
        renderResourceList(storageRecitersList, await fetchRecitersList(), "recitation", quranCacheNames, cacheUrls);

        // 2. Translations & Tafsirs
        if (!allResourcesData) await fetchQuranResources();

        const translations = [];
        const transliterations = [];
        const tafsirs = [];
        allResourcesData.categories.forEach(cat => {
            cat.resources.forEach(res => {
                const item = { id: res.id, name: res.name };
                if (cat.isTafsir) {
                    tafsirs.push(item);
                } else if (cat.label === "Transliteration") {
                    transliterations.push(item);
                } else {
                    translations.push(item);
                }
            });
        });

        renderResourceList(storageTranslationsList, translations, "translation", quranCacheNames, cacheUrls);
        renderResourceList(storageTransliterationsList, transliterations, "translation", quranCacheNames, cacheUrls);
        renderResourceList(storageTafsirsList, tafsirs, "tafsir", quranCacheNames, cacheUrls);

        // 3. Quran Text Scripts
        renderQuranTextList(storageTextList, quranCacheNames, cacheUrls);
    }

    async function fetchRecitersList() {
        try {
            const res = await fetch("../data/reciters.json");
            const data = await res.json();
            return data.recitations.map(r => ({
                id: r.id,
                name: r.style ? `${r.reciter_name} (${r.style})` : r.reciter_name
            })).sort((a, b) => a.name.localeCompare(b.name));
        } catch (e) { return []; }
    }

    function renderResourceList(container, resources, type, quranCacheNames, cacheUrls) {
        if (!container) return;

        // Special rendering for recitations
        if (type === "recitation") {
            renderRecitationList(container, resources, quranCacheNames, cacheUrls);
            return;
        }

        const sortedResources = resources.map(res => ({
            ...res,
            ...getSimpleResourceSortMeta(type, res, cacheUrls)
        })).sort(compareStorageItemsByStatus);

        container.innerHTML = "";
        sortedResources.forEach(res => {
            const row = document.createElement("div");
            row.className = "storage-item-row";

            const isCached = res.isFull;
            const isPart = res.isPart;

            if (isCached) {
                row.classList.add("is-full-cached");
            } else if (isPart) {
                row.classList.add("is-part-cached");
            }

            const statusText = isCached ? '<span style="color:var(--primary-green)">Cached</span>' :
                isPart ? `<span style="color:var(--primary-amber)">Partially Cached (${res.fullSurahs}/114)</span>` :
                    'Not cached';

            row.innerHTML = `
                <div class="storage-item-info">
                    <div class="storage-item-name">${escapeHTML(res.name)}</div>
                    <div class="storage-item-meta">${statusText}</div>
                </div>
                <div class="storage-item-actions">
                    ${isCached ? "" : `<button class="storage-action-btn dl-btn" data-id="${res.id}" data-type="${type}" title="Download"><i class="mdi mdi-cloud-download-outline"></i></button>`}
                    <button class="storage-action-btn delete del-btn" data-id="${res.id}" data-type="${type}" title="Delete"><i class="mdi mdi-trash-can-outline"></i></button>
                </div>
            `;

            row.querySelector(".dl-btn")?.addEventListener("click", () => handleDownloadAction(row, res, type));
            row.querySelector(".del-btn")?.addEventListener("click", () => handleDeleteAction(row, res, type));

            container.appendChild(row);
        });
    }

    function renderRecitationList(container, resources, quranCacheNames, cacheUrls) {
        container.innerHTML = "";
        const sortedResources = resources.map(res => ({
            ...res,
            ...getRecitationSortMeta(res, cacheUrls)
        })).sort(compareStorageItemsByStatus);

        sortedResources.forEach(res => {
            const group = document.createElement("div");
            group.className = "storage-item-group";
            group.id = `storage-group-reciter-${res.id}`;

            const isFullReciter = res.isFull;

            if (isFullReciter) {
                group.classList.add("is-full-cached");
            } else if (res.isPart) {
                group.classList.add("is-part-cached");
            }

            group.innerHTML = `
                <div class="storage-item-row group-header">
                    <div class="storage-item-info">
                        <div class="storage-item-name">${escapeHTML(res.name)}</div>
                        <div class="storage-item-meta">${res.fullCount}/114 Surahs Cached ${res.partCount > 0 ? `(${res.partCount} Partial)` : ''}</div>
                    </div>
                    <div class="storage-item-actions">
                        ${isFullReciter ? "" : `<button class="storage-action-btn dl-btn" title="Download All"><i class="mdi mdi-cloud-download-outline"></i></button>`}
                        <button class="storage-action-btn delete del-btn" title="Delete All"><i class="mdi mdi-trash-can-outline"></i></button>
                        <i class="mdi mdi-chevron-down group-chevron"></i>
                    </div>
                </div>
                <div class="group-content"></div>
            `;

            const header = group.querySelector(".group-header");
            const content = group.querySelector(".group-content");

            header.addEventListener("click", (e) => {
                if (e.target.closest(".storage-action-btn")) return;
                const isExpanded = group.classList.toggle("expanded");

                // Persist state
                let states;
                try { states = JSON.parse(localStorage.getItem("quran_storage_group_collapse") || "{}"); } catch (e) { states = {}; }
                states[group.id] = isExpanded;
                localStorage.setItem("quran_storage_group_collapse", JSON.stringify(states));

                if (isExpanded && content.innerHTML === "") {
                    renderReciterSurahs(content, res, cacheUrls);
                }
            });

            // Restore state
            let savedStates;
            try { savedStates = JSON.parse(localStorage.getItem("quran_storage_group_collapse") || "{}"); } catch (e) { savedStates = {}; }
            if (savedStates[group.id]) {
                group.classList.add("expanded");
                renderReciterSurahs(content, res, cacheUrls);
            }

            group.querySelector(".dl-btn")?.addEventListener("click", () => handleDownloadAction(group, res, "recitation"));
            group.querySelector(".del-btn")?.addEventListener("click", () => handleDeleteAction(group, res, "recitation"));

            container.appendChild(group);
        });
    }

    function renderReciterSurahs(container, reciter, cacheUrls) {
        if (!chaptersData) return;
        container.innerHTML = "";

        chaptersData.forEach(ch => {
            const item = document.createElement("div");
            item.className = "surah-cache-item";

            const status = getRecitationSurahCacheMeta(reciter.id, ch.id, cacheUrls);
            const isFull = status.isFull;
            const isPart = status.isPart;

            if (isFull) item.classList.add("is-full-cached");
            else if (isPart) item.classList.add("is-part-cached");

            item.innerHTML = `
                <div class="surah-cache-info">
                    <div class="surah-cache-name">${ch.id}. ${escapeHTML(ch.name_simple)}</div>
                    <div class="surah-cache-status">
                        ${isFull ? '<span style="color:var(--primary-green)">Fully Cached</span>' :
                    isPart ? '<span style="color:var(--primary-amber)">Partially Cached</span>' :
                        'Not cached'}
                    </div>
                </div>
                <div class="surah-cache-actions">
                    ${isFull ? "" : `<button class="surah-cache-btn dl-surah-btn" title="Download Full Surah"><i class="mdi mdi-cloud-download-outline"></i></button>`}
                    <button class="surah-cache-btn delete del-surah-btn" title="Delete"><i class="mdi mdi-trash-can-outline"></i></button>
                </div>
            `;

            item.querySelector(".dl-surah-btn")?.addEventListener("click", async () => {
                item.classList.add("downloading");
                try {
                    await downloadSurahRecitation(reciter.id, ch.id);
                    renderStoragePanel();
                } catch (e) { alert("Download failed"); }
                finally { item.classList.remove("downloading"); }
            });

            item.querySelector(".del-surah-btn")?.addEventListener("click", async () => {
                if (!confirm(`Delete cached audio for ${ch.name_simple}?`)) return;
                try {
                    await deleteSurahRecitation(reciter.id, ch.id);
                    renderStoragePanel();
                } catch (e) { alert("Delete failed"); }
            });

            container.appendChild(item);
        });
    }

    const quranScriptsList = [
        { id: "uthmani", name: "Madinah" },
        { id: "uthmani_tajweed", name: "Tajweed (Colored)" },
        { id: "indopak", name: "IndoPak" }
    ];

    function renderQuranTextList(container, quranCacheNames, cacheUrls) {
        if (!container) return;
        container.innerHTML = "";
        const sortedScripts = quranScriptsList.map(script => ({
            ...script,
            ...getTextScriptSortMeta(script, cacheUrls)
        })).sort(compareStorageItemsByStatus);

        sortedScripts.forEach(script => {
            const row = document.createElement("div");
            row.className = "storage-item-row";

            const isFull = script.isFull;
            const isPart = script.isPart;

            if (isFull) row.classList.add("is-full-cached");
            else if (isPart) row.classList.add("is-part-cached");

            const statusText = isFull ? '<span style="color:var(--primary-green)">Cached</span>' :
                isPart ? '<span style="color:var(--primary-amber)">Partially Cached</span>' :
                    'Not cached';

            row.innerHTML = `
                <div class="storage-item-info">
                    <div class="storage-item-name">${script.name}</div>
                    <div class="storage-item-meta">${statusText}</div>
                </div>
                <div class="storage-item-actions">
                    ${isFull ? "" : `<button class="storage-action-btn dl-btn" title="Download Full Script"><i class="mdi mdi-cloud-download-outline"></i></button>`}
                    <button class="storage-action-btn delete del-btn" title="Delete"><i class="mdi mdi-trash-can-outline"></i></button>
                </div>
            `;

            row.querySelector(".dl-btn")?.addEventListener("click", () => handleDownloadScript(script.id, script.name, row));
            row.querySelector(".del-btn")?.addEventListener("click", () => deleteQuranScript(script.id, script.name));

            container.appendChild(row);
        });
    }

    async function backgroundCacheFullScript(scriptId) {
        if (!chaptersData || chaptersData.length === 0) return;
        const queueKey = `full-script-${scriptId}`;
        if (backgroundDownloadQueue.has(queueKey)) return;

        backgroundDownloadQueue.add(queueKey);
        try {
            const cache = await caches.open(quranTextCache(scriptId));
            const apiField = `text_${scriptId}`;
            // Perform downloads in chunks (batches of surahs) to not overload
            const batchSize = 10;
            for (let i = 1; i <= 114; i += batchSize) {
                let promises = [];
                const urls = [];
                for (let j = i; j < i + batchSize && j <= 114; j++) {
                    const chapter = chaptersData.find(c => c.id === j);
                    if (!chapter) continue;
                    const versesCount = chapter.verses_count;
                    const pages = Math.ceil(versesCount / 50);
                    for (let p = 1; p <= pages; p++) {
                        const url = `https://api.quran.com/api/v4/verses/by_chapter/${j}?language=en&words=false&fields=${apiField},hizb_number,rub_el_hizb_number,juz_number&page=${p}&per_page=50`;
                        urls.push(url);
                        promises.push(fetch(url));
                    }
                }
                const responses = await Promise.all(promises);
                for (let idx = 0; idx < responses.length; idx++) {
                    const resp = responses[idx];
                    const url = urls[idx];
                    if (resp && resp.ok) {
                        await cache.put(url, resp.clone());
                    }
                }
            }
        } catch (e) {
            console.warn("Full script background cache failed", e);
        } finally {
            backgroundDownloadQueue.delete(queueKey);
            // Refresh storage panel if it's open to show new status
            if (settingsModal.classList.contains("active")) {
                renderStoragePanel();
            }
        }
    }

    async function handleDownloadScript(scriptId, label, row) {
        if (!confirm(`Download ${label} text for all 114 Surahs for offline use?`)) return;
        row.classList.add("downloading");
        try {
            const cache = await caches.open(quranTextCache(scriptId));
            const apiField = `text_${scriptId}`;
            // Perform downloads in chunks (batches of surahs) to not overload
            const batchSize = 10;
            for (let i = 1; i <= 114; i += batchSize) {
                let promises = [];
                const urls = [];
                for (let j = i; j < i + batchSize && j <= 114; j++) {
                    const chapter = chaptersData.find(c => c.id === j);
                    const versesCount = chapter ? chapter.verses_count : 100;
                    const pages = Math.ceil(versesCount / 50);
                    for (let p = 1; p <= pages; p++) {
                        const url = `https://api.quran.com/api/v4/verses/by_chapter/${j}?language=en&words=false&fields=${apiField},hizb_number,rub_el_hizb_number,juz_number&page=${p}&per_page=50`;
                        urls.push(url);
                        promises.push(fetch(url));
                    }
                }
                const responses = await Promise.all(promises);
                for (let idx = 0; idx < responses.length; idx++) {
                    const resp = responses[idx];
                    const url = urls[idx];
                    if (resp && resp.ok) {
                        await cache.put(url, resp.clone());
                    }
                }
            }
            alert(`${label} text downloaded successfully.`);
        } catch (e) {
            console.error(e);
            alert(`Download of ${label} failed. Please check your connection.`);
        } finally {
            row.classList.remove("downloading");
            renderStoragePanel();
        }
    }

    async function deleteQuranScript(scriptId, label) {
        if (!confirm(`Delete cached ${label} text?`)) return;
        try {
            await caches.delete(quranTextCache(scriptId));
            renderStoragePanel();
            alert(`Deleted cached ${label} text.`);
        } catch (e) { alert("Delete failed."); }
    }

    async function downloadSurahRecitation(reciterId, chapterId) {
        await cacheSurahRecitation(reciterId, chapterId);
    }

    async function deleteSurahRecitation(reciterId, chapterId) {
        await caches.delete(quranRecitationCache(reciterId, chapterId));

        const cacheNames = await caches.keys();
        const legacyName = quranLegacyRecitationCache(reciterId);
        if (!cacheNames.includes(legacyName)) return;

        const legacyCache = await caches.open(legacyName);
        const keys = await legacyCache.keys();
        const apiPattern = `/recitations/${reciterId}/by_chapter/${chapterId}`;

        let audioUrls = [];
        try {
            const files = await fetchRecitationChapterAudio(reciterId, chapterId);
            audioUrls = files.map(file => resolveAudioUrl(file));
        } catch (e) {
        }

        for (const request of keys) {
            if (request.url.includes(apiPattern) || audioUrls.includes(request.url)) {
                await legacyCache.delete(request);
            }
        }
    }

    async function handleDownloadAction(row, res, type) {
        row.classList.add("downloading");
        try {
            if (type === "recitation") await downloadFullRecitation(res.id, res.name);
            else if (type === "translation") await downloadFullTranslation(res.id, res.name);
            else if (type === "tafsir") await downloadFullTafsir(res.id, res.name);

            renderStoragePanel(); // Refresh
        } catch (e) {
            console.error("Download failed", e);
            alert(`Download failed for ${res.name}. Check your connection.`);
        } finally {
            row.classList.remove("downloading");
        }
    }

    async function handleDeleteAction(row, res, type) {
        if (!confirm(`Delete all cached data for ${res.name}?`)) return;

        try {
            if (type === "recitation") {
                const cacheNames = await caches.keys();
                const reciterCacheNames = getRecitationCacheNamesForReciter(res.id, cacheNames);
                await Promise.all(reciterCacheNames.map(cacheName => caches.delete(cacheName)));
            } else {
                let cacheName;
                if (type === "translation") cacheName = quranTranslationCache(res.id);
                else if (type === "tafsir") cacheName = quranTafsirCache(res.id);

                if (cacheName) {
                    await caches.delete(cacheName);
                }
            }
            renderStoragePanel();
            alert(`Deleted all cached data for ${res.name}.`);
        } catch (e) {
            alert("Clear failed.");
        }
    }

    // Removed downloadAllQuranText in favor of handleDownloadScript per scipt type

    async function downloadFullRecitation(id, name) {
        for (let i = 1; i <= 114; i++) {
            await cacheSurahRecitation(id, i);
        }
    }

    async function downloadFullTranslation(id, name) {
        const cache = await caches.open(quranTranslationCache(id));
        const scripts = ["uthmani", "uthmani_tajweed", "indopak"];
        const scriptFields = scripts.map(s => `text_${s}`).join(',');
        for (let i = 1; i <= 114; i++) {
            const chapter = chaptersData.find(c => c.id === i);
            const pages = Math.ceil((chapter ? chapter.verses_count : 100) / 50);
            for (let p = 1; p <= pages; p++) {
                const url = `https://api.quran.com/api/v4/verses/by_chapter/${i}?language=en&words=false&fields=${scriptFields},hizb_number,rub_el_hizb_number,juz_number&page=${p}&per_page=50&translations=${id}`;
                const resp = await fetch(url);
                if (resp && resp.ok) {
                    await cache.put(url, resp.clone());
                }
            }
        }
    }

    async function downloadFullTafsir(id, name) {
        const cache = await caches.open(quranTafsirCache(id));
        for (let i = 1; i <= 114; i++) {
            const chapter = chaptersData.find(c => c.id === i);
            const totalVerses = chapter ? chapter.verses_count : 100;
            const pages = Math.ceil(totalVerses / 100);
            for (let p = 1; p <= pages; p++) {
                const url = `https://api.quran.com/api/v4/tafsirs/${id}/by_chapter/${i}?page=${p}&per_page=100`;
                const resp = await fetch(url);
                if (resp && resp.ok) {
                    await cache.put(url, resp.clone());
                }
            }
        }
    }

    async function clearQuranCache() {
        if (!confirm("Clear ALL cached Quran content (All reciters, translations, and text)?")) return;
        try {
            const names = await caches.keys();
            await Promise.all(names.filter(n => n.startsWith(QURAN_CACHE_PREFIX)).map(n => caches.delete(n)));

            renderStoragePanel();
            alert("Quran cache cleared successfully.");
        } catch (e) {
            console.error("Clear failed", e);
            alert("Clear failed.");
        }
    }

    function saveSettings() {
        userSettings = {
            script: document.getElementById("script-select").value, // font option id
            translation: userSettings.translation, // Handled by its own Apply button
            readingMode: userSettings.readingMode, // Preserved from toggle
            reciter: document.getElementById("reciter-select").value,
            arabicSize: document.getElementById("arabic-size").value,
            transSize: document.getElementById("translation-size").value,
        };
        localStorage.setItem("quranSettings", JSON.stringify(userSettings));
        applyActiveFont();
        updateFontSizes();
        updateTajweedButtonVisibility();
        updateReadingModeIcons();

        // Sync reciter quick-switch menu when reciter is changed from settings modal
        const _recMenu = document.getElementById("reciter-menu");
        if (_recMenu) {
            _recMenu.querySelectorAll(".speed-option").forEach(opt => {
                opt.classList.toggle("active", opt.getAttribute("data-reciter-id") === userSettings.reciter);
            });
        }
        const _recToggle = document.getElementById("reciter-toggle");
        if (_recToggle) {
            const _recSel = document.getElementById("reciter-select");
            const _selName = _recSel?.options[_recSel.selectedIndex]?.textContent || "Select Reciter";
            _recToggle.title = _selName;
            const _nameEl = document.getElementById("current-reciter-name");
            if (_nameEl) _nameEl.textContent = _selName;
        }

        // If in reader view, we must reload verses because script or translation changed
        // Optimization: If only reciter changed, just fetch new audio. If sizes changed, just DOM updates.
        // For simplicity, let's just reload verses and audio if reader is active.
        if (readerView.classList.contains("active") && currentChapterId) {
            resetAudio();
            loadVersesAndAudio(currentChapterId, false, currentPageNum);
        }
    }

    document.getElementById("script-select").addEventListener("change", saveSettings);

    const arSizeRange = document.getElementById("arabic-size");
    const trSizeRange = document.getElementById("translation-size");

    arSizeRange.addEventListener("input", (e) => {
        document.getElementById("ar-size-val").textContent = e.target.value;
        updateFontSizesFromDOM(e.target.value, trSizeRange.value);
    });
    arSizeRange.addEventListener("change", saveSettings);

    trSizeRange.addEventListener("input", (e) => {
        document.getElementById("tr-size-val").textContent = e.target.value;
        updateFontSizesFromDOM(arSizeRange.value, e.target.value);
    });
    trSizeRange.addEventListener("change", saveSettings);

    function updateFontSizesFromDOM(arSize, trSize) {
        document.querySelectorAll(".verse-arabic").forEach(el => el.style.fontSize = `${arSize}rem`);
        document.querySelectorAll(".verse-translation").forEach(el => el.style.fontSize = `${trSize}rem`);
    }

    function updateFontSizes() {
        document.getElementById("ar-size-val").textContent = userSettings.arabicSize;
        document.getElementById("tr-size-val").textContent = userSettings.transSize;
        updateFontSizesFromDOM(userSettings.arabicSize, userSettings.transSize);
    }



    function updateThemeIcons() {
        const isDark = document.documentElement.classList.contains("dark-mode");
        const iconClass = isDark ? "mdi-white-balance-sunny" : "mdi-weather-night";
        const title = isDark ? "Switch to Light Mode" : "Switch to Dark Mode";

        [readerThemeToggleBtn].forEach(btn => {
            if (btn) {
                const icon = btn.querySelector("i");
                if (icon) {
                    icon.className = `mdi ${iconClass}`;
                }
                btn.setAttribute("title", title);
            }
        });
    }

    // Theme Toggle Listeners
    if (readerThemeToggleBtn) {
        readerThemeToggleBtn.addEventListener("click", () => {
            window.toggleTheme();
            updateThemeIcons();
        });
    }

    function updateReadingModeIcons() {
        [modeToggleBtn, readerModeToggleBtn].forEach(btn => {
            if (!btn) return;
            const icon = btn.querySelector("i");
            if (!icon) return;

            const isPage = userSettings.readingMode === "page";
            // Show the icon of what it will BECOME after clicking (like theme toggle)
            icon.className = isPage ? "mdi mdi-view-list" : "mdi mdi-book-open-page-variant";
            const title = isPage ? "Switch to List Mode" : "Switch to Mushaf Mode";
            btn.setAttribute("title", title);
        });
    }

    [modeToggleBtn, readerModeToggleBtn].forEach(btn => {
        if (btn) {
            btn.addEventListener("click", () => {
                userSettings.readingMode = (userSettings.readingMode === "page") ? "list" : "page";
                saveSettings();
            });
        }
    });

    updateReadingModeIcons();

    window.addEventListener('storage', (e) => {
        if (e.key === 'darkMode') {
            updateThemeIcons();
        }
    });

    // ── Tab Switching ───────────────────────────────────
    const tabSurahs = document.getElementById("tab-surahs");
    const tabJuz = document.getElementById("tab-juz");
    const tabBookmarks = document.getElementById("tab-bookmarks");
    const tabStorage = document.getElementById("tab-storage");
    const panelSurahs = document.getElementById("panel-surahs");
    const panelJuz = document.getElementById("panel-juz");
    const panelBookmarks = document.getElementById("panel-bookmarks");
    const panelStorage = document.getElementById("panel-storage");

    function switchTab(activeTab, activePanel) {
        [tabSurahs, tabJuz, tabBookmarks, tabStorage].forEach(t => {
            if (t) {
                t.classList.remove("active");
                t.setAttribute("aria-selected", "false");
            }
        });
        [panelSurahs, panelJuz, panelBookmarks, panelStorage].forEach(p => {
            if (p) p.classList.remove("active");
        });
        activeTab.classList.add("active");
        activeTab.setAttribute("aria-selected", "true");
        activePanel.classList.add("active");
    }

    tabSurahs.addEventListener("click", () => switchTab(tabSurahs, panelSurahs));
    tabJuz.addEventListener("click", () => {
        switchTab(tabJuz, panelJuz);
        if (!document.querySelector(".juz-block")) buildJuzPanel();
    });
    tabBookmarks.addEventListener("click", () => {
        switchTab(tabBookmarks, panelBookmarks);
        renderBookmarksPanel();
    });
    if (tabStorage) {
        tabStorage.addEventListener("click", () => {
            switchTab(tabStorage, panelStorage);
            renderStoragePanel();
        });
    }

    // Toggle collapsible sections in storage panel
    document.addEventListener("click", (e) => {
        const header = e.target.closest(".storage-section-header.clickable");
        if (header) {
            const section = header.closest(".storage-section");
            if (section) {
                const isCollapsed = section.classList.toggle("collapsed");
                // Persist state
                let states;
                try { states = JSON.parse(localStorage.getItem("quran_storage_collapse") || "{}"); } catch (e) { states = {}; }
                states[section.id] = isCollapsed;
                localStorage.setItem("quran_storage_collapse", JSON.stringify(states));
            }
        }
    });

    function applyStorageCollapseStates() {
        let states;
        try { states = JSON.parse(localStorage.getItem("quran_storage_collapse") || "{}"); } catch (e) { states = {}; }
        Object.keys(states).forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.toggle("collapsed", states[id] !== false);
            }
        });
    }

    // Call state restoration
    applyStorageCollapseStates();

    // ── Bookmarks ────────────────────────────────────────
    const BOOKMARKS_KEY = "quran_bookmarks";

    function getBookmarks() {
        try {
            return JSON.parse(localStorage.getItem(BOOKMARKS_KEY)) || [];
        } catch { return []; }
    }

    function saveBookmarks(bookmarks) {
        localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
    }

    function toggleBookmark(verseKey) {
        let bookmarks = getBookmarks();
        const exists = bookmarks.findIndex(b => b.verseKey === verseKey);

        let added = false;
        if (exists !== -1) {
            // Remove bookmark
            bookmarks.splice(exists, 1);
            added = false;
        } else {
            // Find verse data for enrichment
            const [chapterId, verseNum] = verseKey.split(":").map(Number);
            const chapter = chaptersData.find(c => c.id === chapterId);
            const verse = currentVersesData.find(v => v.verse_key === verseKey);

            const bookmark = {
                verseKey,
                chapterId,
                verseNumber: verseNum,
                surahName: chapter ? chapter.name_simple : `Surah ${chapterId}`,
                surahArabic: chapter ? chapter.name_arabic : "",
                juzNumber: verse ? verse.juz_number : null,
                pageNumber: verse ? verse.page_number : null,
                timestamp: Date.now()
            };
            bookmarks.unshift(bookmark); // Most recent first
            added = true;
        }

        saveBookmarks(bookmarks);

        // Update Mushaf overlay icon if it's currently showing this verse
        if (overlay.classList.contains("active") && overlayKey.textContent.includes(verseKey)) {
            const bmIcon = overlayBookmark.querySelector("i");
            if (bmIcon) bmIcon.className = added ? "mdi mdi-bookmark" : "mdi mdi-bookmark-outline";
        }

        return added;
    }

    async function copyVerse(verseKey, e) {
        const scriptField = `text_${getActiveApiScript()}`;
        const verse = currentVersesData.find(v => v.verse_key === verseKey);
        if (!verse) return;

        const [chapterId, verseNum] = verseKey.split(':');
        const chapter = chaptersData.find(c => c.id === Number(chapterId));

        let arabic = verse[scriptField] || "";
        arabic = arabic.replace(/<[^>]*>?/gm, '').trim();

        const surahInfo = chapter ? `${chapter.name_simple} (${chapter.name_arabic})` : `Surah ${chapterId}`;
        const copyText = `${arabic}\n\n[Quran ${surahInfo}, Verse ${verseNum}]`;

        try {
            await navigator.clipboard.writeText(copyText);

            // Feedback UI update
            if (e && e.currentTarget) {
                const btn = e.currentTarget;
                const icon = btn.querySelector("i");
                if (icon) {
                    const originalClass = icon.className;
                    icon.className = "mdi mdi-check";
                    setTimeout(() => {
                        if (icon) icon.className = originalClass;
                    }, 2000);
                }
            }
        } catch (err) {
            console.error('Failed to copy: ', err);
        }
    }

    function renderBookmarksPanel() {
        const container = document.getElementById("bookmark-list-container");
        const bookmarks = getBookmarks();

        if (bookmarks.length === 0) {
            container.innerHTML = `<div class="bookmark-empty"><i class="mdi mdi-bookmark-outline"></i>No bookmarks yet.<br>Select a verse in Mushaf mode to bookmark it.</div>`;
            return;
        }

        container.innerHTML = "";
        bookmarks.forEach((bm, idx) => {
            const card = document.createElement("div");
            card.className = "bookmark-card";

            const dateStr = new Date(bm.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
            const juzStr = bm.juzNumber ? ` · Juz ${parseInt(bm.juzNumber)}` : "";
            const pageStr = bm.pageNumber ? ` · Page ${parseInt(bm.pageNumber)}` : "";

            card.innerHTML = `
                <div class="bookmark-icon"><i class="mdi mdi-bookmark"></i></div>
                <div class="bookmark-info">
                    <div class="bookmark-surah">${escapeHTML(bm.surahName)} ${bm.surahArabic ? '(' + escapeHTML(bm.surahArabic) + ')' : ''}</div>
                    <div class="bookmark-meta">Ayah ${escapeHTML(bm.verseKey)}${juzStr}${pageStr} · ${escapeHTML(dateStr)}</div>
                </div>
                <button class="bookmark-delete" title="Remove Bookmark" data-idx="${idx}"><i class="mdi mdi-delete-outline"></i></button>
            `;

            // Navigate to the bookmarked verse
            card.querySelector(".bookmark-info").addEventListener("click", () => {
                navigateToBookmark(bm);
            });
            card.querySelector(".bookmark-icon").addEventListener("click", () => {
                navigateToBookmark(bm);
            });

            // Delete bookmark
            card.querySelector(".bookmark-delete").addEventListener("click", (e) => {
                e.stopPropagation();
                let bms = getBookmarks();
                bms.splice(idx, 1);
                saveBookmarks(bms);
                renderBookmarksPanel();
            });

            container.appendChild(card);
        });
    }

    async function navigateToBookmark(bm) {
        const chapter = chaptersData.find(c => c.id === bm.chapterId);
        if (!chapter) return;
        await openSurah(chapter, false, bm.pageNumber || null, bm.verseKey);
    }

    // ── Juz / Hizb / Quarter – Dynamic from API ─────────
    function dedup(arr, key) {
        const seen = new Set();
        return arr.filter(item => {
            if (seen.has(item[key])) return false;
            seen.add(item[key]);
            return true;
        }).sort((a, b) => a[key] - b[key]);
    }

    function getFirstVerseKey(verseMapping) {
        const chapters = Object.keys(verseMapping).map(Number).sort((a, b) => a - b);
        const firstChapter = chapters[0];
        const range = verseMapping[firstChapter];
        const firstVerse = range.split("-")[0];
        return `${firstChapter}:${firstVerse}`;
    }

    async function buildJuzPanel() {
        const container = document.getElementById("juz-list-container");
        container.innerHTML = '<div class="loader"></div>';

        try {
            const resp = await fetch("../data/quran-juz.json");
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            const data = await resp.json();

            const juzs = dedup(data.juzs || [], "juz_number");
            const hizbs = dedup(data.hizbs || [], "hizb_number");
            const rubs = dedup(data.rub_el_hizbs || [], "rub_el_hizb_number");

            container.innerHTML = "";

            juzs.forEach(juz => {
                const juzNum = juz.juz_number;
                const juzVerseKey = getFirstVerseKey(juz.verse_mapping);

                // Each Juz has 2 Hizbs
                const juzHizbs = hizbs.filter(h =>
                    h.hizb_number === (juzNum - 1) * 2 + 1 ||
                    h.hizb_number === (juzNum - 1) * 2 + 2
                );

                const block = document.createElement("div");
                block.className = "juz-block";

                const header = document.createElement("div");
                header.className = "juz-header";
                header.innerHTML = `
                    <div class="juz-header-left">
                        <div class="juz-badge">${parseInt(juzNum, 10)}</div>
                        <div class="juz-title-text">Juz ${parseInt(juzNum, 10)}</div>
                    </div>
                    <div class="juz-header-right">
                        <div class="juz-title-ar">الجزء ${toArabicIndic(parseInt(juzNum, 10))}</div>
                        <i class="mdi mdi-chevron-down juz-chevron"></i>
                    </div>`;
                header.addEventListener("click", () => block.classList.toggle("open"));

                const children = document.createElement("div");
                children.className = "juz-children";

                juzHizbs.forEach(h => {
                    const hNum = h.hizb_number;
                    const hizbVerseKey = getFirstVerseKey(h.verse_mapping);

                    // Each Hizb has 4 Rub al-Hizb quarters
                    const hizbRubs = rubs.filter(r =>
                        r.rub_el_hizb_number >= (hNum - 1) * 4 + 1 &&
                        r.rub_el_hizb_number <= hNum * 4
                    );

                    const hBlock = document.createElement("div");
                    hBlock.className = "hizb-block";

                    const hHeader = document.createElement("div");
                    hHeader.className = "hizb-header";
                    hHeader.innerHTML = `
                        <div class="hizb-title">Hizb ${parseInt(hNum, 10)}</div>
                        <div class="hizb-header-right">
                            <span class="hizb-title-ar">حزب ${toArabicIndic(parseInt(hNum, 10))}</span>
                            <i class="mdi mdi-chevron-down hizb-chevron"></i>
                        </div>`;
                    hHeader.addEventListener("click", (e) => {
                        e.stopPropagation();
                        hBlock.classList.toggle("open");
                    });

                    const hChildren = document.createElement("div");
                    hChildren.className = "hizb-children";

                    const quarterLabelsAr = ["بداية الحزب", "¼ حزب", "½ حزب", "¾ حزب"];
                    const quarterLabelsEn = ["Start", "¼ Hizb", "½ Hizb", "¾ Hizb"];

                    hizbRubs.forEach((r, idx) => {
                        const rubVerseKey = getFirstVerseKey(r.verse_mapping);
                        const row = document.createElement("div");
                        row.className = "quarter-row";
                        row.innerHTML = `
                            <div class="quarter-label-left">
                                <div class="quarter-title">${escapeHTML(quarterLabelsEn[idx] || "")}</div>
                                <span class="quarter-page-badge">${escapeHTML(rubVerseKey)}</span>
                            </div>
                            <span class="quarter-label-ar">${escapeHTML(quarterLabelsAr[idx] || "")}</span>`;
                        row.addEventListener("click", () => navigateToVerse(rubVerseKey));
                        hChildren.appendChild(row);
                    });

                    hBlock.appendChild(hHeader);
                    hBlock.appendChild(hChildren);
                    children.appendChild(hBlock);
                });

                block.appendChild(header);
                block.appendChild(children);
                container.appendChild(block);
            });

        } catch (err) {
            console.error("Failed to build Juz panel:", err);
            container.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:20px;">Failed to load Juz data. Please check your connection.</p>';
        }
    }

    async function navigateToVerse(verseKey) {
        if (!chaptersData.length) return;
        const chapterNum = parseInt(verseKey.split(":")[0]);
        const chapter = chaptersData.find(c => c.id === chapterNum);
        if (!chapter) return;

        try {
            const resp = await fetch(`https://api.quran.com/api/v4/verses/by_key/${verseKey}?fields=page_number`);
            const data = await resp.json();
            const page = data.verse.page_number;
            openSurah(chapter, false, page);
        } catch (err) {
            console.error("Page lookup failed, opening chapter:", err);
            openSurah(chapter);
        }
    }

    // Initial Load
    updateThemeIcons();
    fetchChapters();

    // Tajweed Button Click Handlers
    readerTajweedBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = readerTajweedGuide.classList.contains("active");
        const chevron = document.getElementById("tajweed-chevron");

        if (isOpen) {
            readerTajweedGuide.classList.remove("active");
            readerTajweedBtn.classList.remove("active");
            if (chevron) chevron.className = "mdi mdi-chevron-up";
            setTimeout(() => { if (!readerTajweedGuide.classList.contains("active")) readerTajweedGuide.style.display = "none"; }, 300);
        } else {
            readerTajweedGuide.style.display = "flex";
            setTimeout(() => {
                readerTajweedGuide.classList.add("active");
                readerTajweedBtn.classList.add("active");
                if (chevron) chevron.className = "mdi mdi-chevron-down";
            }, 10);
        }
    };

    // -- Tajweed Example Playback --
    async function playTajweedExample(verseKey) {
        if (!verseKey) return;

        currentAyahSpan.textContent = `Example: ${verseKey}`;
        audioPlayer.style.display = "flex";

        try {
            isTajweedExamplePlaying = true;
            const [chapterId, verseNum] = verseKey.split(':');
            // Fetch recitation audio for this specific verse
            const apiUrl = `https://api.quran.com/api/v4/recitations/${userSettings.reciter}/by_chapter/${chapterId}?per_page=1&page=${verseNum}`;
            const response = await fetch(apiUrl);
            const data = await response.json();

            if (data.audio_files && data.audio_files.length > 0) {
                const audioObj = data.audio_files[0];
                const audioUrl = resolveAudioUrl(audioObj);

                activeAudio.src = audioUrl;
                activeAudio.playbackRate = currentPlaybackSpeed;
                resetGain(getActiveGain());
                activeAudio.play().catch(e => console.error("Playback failed:", e));

                playIcon.className = "mdi mdi-pause";

                // Clear any highlights in the main reader since this is just an example
                removeAllHighlight();
                isBismillahPlaying = false;
                currentPlayingIndex = -1;
            }
        } catch (error) {
            console.error("Failed to play Tajweed example:", error);
        }
    }

    // Attach listener for buttons inside the legend grid (Event Delegation)
    const tajweedHeader = document.getElementById("tajweed-guide-header");
    if (tajweedHeader) {
        tajweedHeader.onclick = (e) => {
            e.stopPropagation();
            readerTajweedBtn.click(); // Reuse the toggle logic
        };
    }

    readerTajweedGuide.addEventListener("click", (e) => {
        const btn = e.target.closest(".tajweed-example-play");
        if (btn) {
            e.stopPropagation();
            const verseKey = btn.getAttribute("data-verse");
            playTajweedExample(verseKey);
            return;
        }

        const link = e.target.closest(".tajweed-verse-link");
        if (link) {
            e.stopPropagation();
            const verseKey = link.getAttribute("data-verse");
            if (verseKey) {
                const [chapterId, verseNum] = verseKey.split(':');
                const chapter = chaptersData.find(c => c.id === parseInt(chapterId));
                if (chapter) {
                    readerTajweedGuide.classList.remove("active");
                    readerTajweedBtn.classList.remove("active");
                    const chevron = document.getElementById("tajweed-chevron");
                    if (chevron) chevron.className = "mdi mdi-chevron-up";
                    setTimeout(() => { readerTajweedGuide.style.display = "none"; }, 300);
                    openSurah(chapter, false, null, verseKey);
                }
            }
        }
    });

    // Close Tajweed guide if clicking outside
    document.addEventListener("click", (e) => {
        if (readerTajweedGuide.classList.contains("active")) {
            if (!readerTajweedBtn.contains(e.target) && !readerTajweedGuide.contains(e.target)) {
                readerTajweedGuide.classList.remove("active");
                readerTajweedBtn.classList.remove("active");
                const chevron = document.getElementById("tajweed-chevron");
                if (chevron) chevron.className = "mdi mdi-chevron-up";
                setTimeout(() => { readerTajweedGuide.style.display = "none"; }, 300);
            }
        }
    });

    async function loadTajweedRules() {
        const grid = document.getElementById("tajweed-legend-grid");
        if (!grid) return;

        try {
            const response = await fetch("../data/tajweed-rules.json");
            const rules = await response.json();

            grid.innerHTML = ""; // Clear existing

            rules.forEach(rule => {
                const item = document.createElement("div");
                item.className = "tajweed-legend-item";

                let examplesHtml = "";
                if (rule.examples && Array.isArray(rule.examples)) {
                    rule.examples.forEach(ex => {
                        examplesHtml += `
                            <div class="tajweed-example-box">
                                <div class="tajweed-example-content">
                                    <span class="tajweed-example-ar verse-arabic script-uthmani_tajweed">${sanitizeHTML(ex.arabic)}</span>
                                    <div class="tajweed-example-actions">
                                        <button class="play-example-btn tajweed-example-play" data-verse="${escapeHTML(ex.verse)}" title="Listen Example">
                                            <i class="mdi mdi-play"></i>
                                        </button>
                                        <span class="tajweed-verse-link" data-verse="${escapeHTML(ex.verse)}">[${escapeHTML(ex.verse)}]</span>
                                    </div>
                                </div>
                            </div>`;
                    });
                }

                item.innerHTML = `
                    <div class="tajweed-col">
                        <div class="tajweed-title">
                            <div class="tajweed-dot" style="background:${escapeHTML(rule.dotColor)};"></div>
                            ${escapeHTML(rule.title)} / <span class="ar-tajweed-title">${escapeHTML(rule.arTitle)}</span>
                        </div>
                        <div class="tajweed-desc">
                            <div class="ar-tajweed-desc">${escapeHTML(rule.arDescription)}</div>
                            <div class="en-tajweed-desc">${escapeHTML(rule.description)}</div>
                        </div>
                        <span class="tajweed-example-label">Examples / الأمثلة:</span>
                        ${examplesHtml}
                    </div>
                `;
                grid.appendChild(item);
            });
        } catch (error) {
            console.error("Error loading Tajweed rules:", error);
            grid.innerHTML = "<div style='color:red; padding:10px;'>Error loading Tajweed Rules.</div>";
        }
    }

    loadTajweedRules();
    updateTajweedButtonVisibility();
});
