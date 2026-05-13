(function () {
    'use strict';

    // --- Constants ---
    const CACHE_KEY = `masjid_prayer_times_year_${new Date().getFullYear()}`;
    const CACHE_TS_KEY = `masjid_prayer_times_year_ts_${new Date().getFullYear()}`;
    const CACHE_DURATION = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.cacheDurationPrayerYear)
        ? APP_CONFIG.cacheDurationPrayerYear
        : 24 * 60 * 60 * 1000; // 1 day fallback
    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // --- State ---
    const now = new Date();
    const currentYear = now.getFullYear();
    let currentMonth = now.getMonth(); // 0-indexed
    let yearData = null; // array of 365/366 objects with { date, fajr, sunrise, dhuhr, asr, maghrib, isha }
    let isFallback = false;

    // --- DOM refs ---
    const tbody = document.getElementById('pt-body');
    const monthLabel = document.getElementById('pt-month-label');
    const prevBtn = document.getElementById('pt-prev');
    const nextBtn = document.getElementById('pt-next');
    const yearSpan = document.getElementById('pt-year');
    const fallbackBadge = document.getElementById('pt-fallback-badge');

    if (yearSpan) yearSpan.textContent = currentYear;

    // --- Helpers ---
    function isLeapYear(y) {
        return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function formatTime(h, m) {
        return pad2(h % 24) + ':' + pad2(m);
    }

    function trimTime(str) {
        // "06:43:00" -> "06:43"
        if (!str) return '';
        return str.substring(0, 5);
    }

    // Generic DST shift detection based on masjidTimeZone
    function getDSTShift(date) {
        try {
            const tz = (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.masjidTimeZone : 'Europe/Dublin') || 'Europe/Dublin';
            // Check at noon to avoid boundary issues during early morning transitions (1am/2am)
            const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
            const getOffset = (d) => {
                const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(d);
                const offsetStr = parts.find(p => p.type === 'timeZoneName').value;
                const match = offsetStr.match(/([+-])(\d{2}):(\d{2})/);
                return match ? (match[1] === '+' ? 1 : -1) * parseInt(match[2]) : 0;
            };
            const stdOffset = Math.min(getOffset(new Date(date.getFullYear(), 0, 1)), getOffset(new Date(date.getFullYear(), 6, 1)));
            return getOffset(checkDate) - stdOffset;
        } catch (e) { return 0; }
    }

    // --- Fetch Iqamah Settings ---
    function fetchIqamahSettings() {
        const CACHE_KEY = "masjid_iqamah_settings_cache";
        const CACHE_TIME_KEY = "masjid_iqamah_settings_cache_time";
        const PRIMARY_URL = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.iqamahSettingsPath : "";
        const FALLBACK_URL = "../data/iqamah-settings.json";
        const CACHE_DURATION = typeof APP_CONFIG !== 'undefined' && APP_CONFIG.cacheDurationWeb ? APP_CONFIG.cacheDurationWeb : 8 * 60 * 60 * 1000;

        const now = Date.now();
        const lastFetchTime = parseInt(localStorage.getItem(CACHE_TIME_KEY) || "0", 10);
        const cachedDataStr = localStorage.getItem(CACHE_KEY);

        let useCache = false;
        let parsedCache = null;

        if (cachedDataStr) {
            try {
                parsedCache = JSON.parse(cachedDataStr);
                if (Array.isArray(parsedCache) && now - lastFetchTime < CACHE_DURATION) {
                    useCache = true;
                }
            } catch (e) { }
        }

        if (useCache && parsedCache) {
            return Promise.resolve(parsedCache);
        }

        if (typeof APP_CONFIG !== 'undefined' && !APP_CONFIG.alternativeIqamahSettingsPath) {
            return fetch(FALLBACK_URL, { cache: 'no-store' })
                .then(res => res.json())
                .catch(() => []);
        }

        if (!PRIMARY_URL) {
            return fetch(FALLBACK_URL, { cache: 'no-store' })
                .then(res => res.json())
                .catch(() => []);
        }

        return fetch(`${PRIMARY_URL}?_t=${now}`, { cache: 'no-store' })
            .then(res => {
                if (!res.ok) throw new Error("HTTP " + res.status);
                return res.json();
            })
            .then(data => {
                if (!Array.isArray(data)) throw new Error("Invalid format");
                localStorage.setItem(CACHE_KEY, JSON.stringify(data));
                localStorage.setItem(CACHE_TIME_KEY, now.toString());
                return data;
            })
            .catch(err => {
                console.warn("Primary iqamah settings load failed:", err);
                if (parsedCache) return parsedCache;
                return fetch(FALLBACK_URL, { cache: 'no-store' })
                    .then(res => res.json())
                    .catch(() => []);
            });
    }

    function getActiveIqamahSettings(settingsArray, year, month, day) {
        if (!settingsArray || !settingsArray.length) return null;
        const localISODate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const sortedSettings = [...settingsArray].sort((a, b) => b.startDate.localeCompare(a.startDate));
        const activeSetting = sortedSettings.find(setting => setting.startDate <= localISODate);
        return activeSetting || sortedSettings[sortedSettings.length - 1];
    }

    function applyIqamahRule(baseTimeStr, rule, context) {
        if (!rule) return baseTimeStr;
        if (rule.type === 'fixed') {
            return rule.value;
        } else if (rule.type === 'offset') {
            const parts = baseTimeStr.split(":");
            const d = new Date(2000, 0, 1, parseInt(parts[0], 10), parseInt(parts[1], 10), 0);
            d.setMinutes(d.getMinutes() + rule.value);
            return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
        } else if (rule.type === 'maghrib') {
            if (context && context.maghrib_iqamah) {
                const parts = context.maghrib_iqamah.split(":");
                const d = new Date(2000, 0, 1, parseInt(parts[0], 10), parseInt(parts[1], 10), 0);
                const offset = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.ishaIqamahOffsetFromMaghrib !== undefined)
                    ? APP_CONFIG.ishaIqamahOffsetFromMaghrib
                    : 10;
                d.setMinutes(d.getMinutes() + offset);
                return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
            }
            return baseTimeStr;
        }
        return baseTimeStr;
    }

    // --- Parse and Generate Schedule ---
    function generateSchedule(scheduleJSON, iqamahSettings) {
        const key = isLeapYear(currentYear) ? 'leap' : 'standard';
        const yearSchedule = scheduleJSON[key];
        const result = [];

        for (let m = 1; m <= 12; m++) {
            const monthData = yearSchedule[String(m)];
            if (!monthData) continue;
            const daysInMonth = new Date(currentYear, m, 0).getDate();

            for (let d = 1; d <= daysInMonth; d++) {
                const dayArr = monthData[String(d)];
                if (!dayArr) continue;

                const dateObj = new Date(currentYear, m - 1, d);
                const offset = getDSTShift(dateObj);
                const dst = offset > 0;
                const dow = new Date(currentYear, m - 1, d).getDay();

                const activeSettings = getActiveIqamahSettings(iqamahSettings, currentYear, m, d) || {};

                const fBase = formatTime(dayArr[0][0] + offset, dayArr[0][1]);
                const zBase = formatTime(dayArr[2][0] + offset, dayArr[2][1]);
                const aBase = formatTime(dayArr[3][0] + offset, dayArr[3][1]);
                const mBase = formatTime(dayArr[4][0] + offset, dayArr[4][1]);
                const iBase = formatTime(dayArr[5][0] + offset, dayArr[5][1]);

                let jumuahFallback = dst ? (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.jumuahFallbackDST : [{time: "13:15", label: ""}, {time: "14:15", label: ""}]) : (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.jumuahFallbackStandard : [{time: "12:15", label: ""}, {time: "13:15", label: ""}]);
                let jTimes = activeSettings.jumuah || jumuahFallback;

                const hijriOffset = activeSettings.hijriOffset !== undefined ? activeSettings.hijriOffset : 0;
                const hijriDate = typeof getHijriDateFallback === 'function' ? getHijriDateFallback(new Date(currentYear, m - 1, d), hijriOffset) : "-";

                const localISODate = `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const scheduleChange = iqamahSettings && iqamahSettings.find(s => s.startDate === localISODate);
                const description = scheduleChange ? scheduleChange.description : null;

                const mJamah = applyIqamahRule(mBase, activeSettings.maghrib);
                result.push({
                    month: m,
                    day: d,
                    weekday: DAY_NAMES[dow],
                    dateStr: localISODate,
                    description: description,
                    hijri: hijriDate,
                    fajr: fBase,
                    fajr_iqamah: applyIqamahRule(fBase, activeSettings.fajr),
                    sunrise: formatTime(dayArr[1][0] + offset, dayArr[1][1]),
                    dhuhr: zBase,
                    dhuhr_iqamah: applyIqamahRule(zBase, activeSettings.zuhr),
                    asr: aBase,
                    asr_iqamah: applyIqamahRule(aBase, activeSettings.asr),
                    maghrib: mBase,
                    maghrib_iqamah: mJamah,
                    isha: iBase,
                    isha_iqamah: applyIqamahRule(iBase, activeSettings.isha, { maghrib_iqamah: mJamah }),
                    jumuah: jTimes
                });
            }
        }
        return result;
    }

    // --- Render month ---
    function renderMonth(monthIndex) {
        if (!yearData || !tbody || !monthLabel) return;
        const month1 = monthIndex + 1; // 1-indexed
        const todayDay = now.getDate();
        const todayMonth = now.getMonth() + 1;

        monthLabel.textContent = MONTH_NAMES[monthIndex] + ' ' + currentYear;

        const monthRows = yearData.filter(function (r) { return r.month === month1; });

        const fragment = document.createDocumentFragment();
        for (let i = 0, len = monthRows.length; i < len; i++) {
            var row = monthRows[i];

            // Add description row if this day starts a new schedule block
            if (row.description) {
                var trDesc = document.createElement('tr');
                trDesc.className = 'schedule-change-row';
                var tdDesc = document.createElement('td');
                tdDesc.colSpan = 8;
                // Build safely: icon node + escaped text node so that any HTML/JS in the
                // remote iqamah-settings.json description cannot inject markup.
                var descIcon = document.createElement('i');
                descIcon.className = 'mdi mdi-information-outline';
                tdDesc.appendChild(descIcon);
                tdDesc.appendChild(document.createTextNode(' ' + String(row.description)));
                trDesc.appendChild(tdDesc);
                fragment.appendChild(trDesc);
            }

            var tr = document.createElement('tr');

            // Highlight Friday
            if (row.weekday === 'Fri') {
                tr.className = 'friday-row';
            }
            // Highlight Today
            if (row.day === todayDay && month1 === todayMonth) {
                tr.className = (tr.className ? tr.className + ' ' : '') + 'today-row';
            }

            var tdDay = document.createElement('td');
            var small = document.createElement('small');
            small.style.opacity = '0.7';
            small.textContent = row.weekday;
            tdDay.appendChild(document.createTextNode(row.day));
            tdDay.appendChild(document.createElement('br'));
            tdDay.appendChild(small);

            tr.appendChild(tdDay);

            var tdHijri = document.createElement('td');
            tdHijri.style.fontSize = '0.9em';
            tdHijri.style.whiteSpace = 'nowrap';
            tdHijri.textContent = row.hijri;
            tr.appendChild(tdHijri);

            // Defense-in-depth: escape values from JSON in case schedule data
            // is ever compromised. Times normally look like "5:30".
            var esc = window.escapeHTML;

            // Fajr
            var tdFajr = document.createElement('td');
            tdFajr.innerHTML = `<div>${esc(row.fajr)}</div><div style="font-size: 0.85em; opacity: 0.8;">Iq: ${esc(row.fajr_iqamah)}</div>`;
            tr.appendChild(tdFajr);

            // Sunrise
            var tdSunrise = document.createElement('td');
            tdSunrise.textContent = row.sunrise;
            tr.appendChild(tdSunrise);

            // Zuhr / Jumuah
            var tdDhuhr = document.createElement('td');
            if (row.weekday === 'Fri') {
                var jumuahArr = row.jumuah || [];
                if (jumuahArr.length === 0) {
                    tdDhuhr.innerHTML = `<div><span style="color:#d32f2f;font-weight:600;">Not offered</span></div><div style="font-size: 0.75em; opacity: 0.6; margin-top: 2px;">(Dhuhr: ${esc(row.dhuhr)})</div>`;
                } else if (jumuahArr.length === 1) {
                    var timeStr = esc(typeof jumuahArr[0] === 'object' && jumuahArr[0] !== null ? jumuahArr[0].time : jumuahArr[0]);
                    tdDhuhr.innerHTML = `<div>Jumuah / ${timeStr}</div><div style="font-size: 0.75em; opacity: 0.6; margin-top: 2px;">(Dhuhr: ${esc(row.dhuhr)})</div>`;
                } else {
                    var jumuahStr = jumuahArr.map(function(entry) {
                        return esc(typeof entry === 'object' && entry !== null ? entry.time : entry);
                    }).join(' / ');
                    var jumuahStyle = jumuahArr.length >= 3 ? "font-size: 0.85em;" : "";
                    tdDhuhr.innerHTML = `<div style="${jumuahStyle}">${jumuahStr}</div><div style="font-size: 0.85em; opacity: 0.8;">Jumuah</div><div style="font-size: 0.75em; opacity: 0.6; margin-top: 2px;">(Dhuhr: ${esc(row.dhuhr)})</div>`;
                }
            } else {
                tdDhuhr.innerHTML = `<div>${esc(row.dhuhr)}</div><div style="font-size: 0.85em; opacity: 0.8;">Iq: ${esc(row.dhuhr_iqamah)}</div>`;
            }
            tr.appendChild(tdDhuhr);

            // Asr
            var tdAsr = document.createElement('td');
            tdAsr.innerHTML = `<div>${esc(row.asr)}</div><div style="font-size: 0.85em; opacity: 0.8;">Iq: ${esc(row.asr_iqamah)}</div>`;
            tr.appendChild(tdAsr);

            // Maghrib
            var tdMaghrib = document.createElement('td');
            tdMaghrib.innerHTML = `<div>${esc(row.maghrib)}</div><div style="font-size: 0.85em; opacity: 0.8;">Iq: ${esc(row.maghrib_iqamah)}</div>`;
            tr.appendChild(tdMaghrib);

            // Isha
            var tdIsha = document.createElement('td');
            tdIsha.innerHTML = `<div>${esc(row.isha)}</div><div style="font-size: 0.85em; opacity: 0.8;">Iq: ${esc(row.isha_iqamah)}</div>`;
            tr.appendChild(tdIsha);

            fragment.appendChild(tr);
        }

        tbody.innerHTML = '';
        tbody.appendChild(fragment);

        if (month1 === todayMonth) {
            var todayEl = tbody.querySelector('.today-row');
            if (todayEl) {
                todayEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }
    }

    // --- Navigation ---
    function goToPrevMonth() {
        currentMonth = (currentMonth - 1 + 12) % 12;
        renderMonth(currentMonth);
    }

    function goToNextMonth() {
        currentMonth = (currentMonth + 1) % 12;
        renderMonth(currentMonth);
    }

    if (prevBtn) prevBtn.addEventListener('click', goToPrevMonth);
    if (nextBtn) nextBtn.addEventListener('click', goToNextMonth);

    // Row highlighting on click
    if (tbody) {
        tbody.addEventListener('click', function (e) {
            const tr = e.target.closest('tr');
            if (tr && !tr.classList.contains('today-row')) {
                const isHighlighted = tr.classList.contains('highlighted-row');
                // Remove highlight from any other row
                tbody.querySelectorAll('.highlighted-row').forEach(row => row.classList.remove('highlighted-row'));
                // Only add if it wasn't highlighted before (acts as toggle)
                if (!isHighlighted) {
                    tr.classList.add('highlighted-row');
                }
            }
        });
    }

    // --- Data loading ---
    function isCacheValid() {
        var ts = localStorage.getItem(CACHE_TS_KEY);
        if (!ts) return false;
        return (Date.now() - parseInt(ts, 10)) < CACHE_DURATION;
    }

    function getCachedData() {
        try {
            var raw = localStorage.getItem(CACHE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* ignore */ }
        return null;
    }

    function setCachedData(data) {
        try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('masjid_prayer_times_year_') && key !== CACHE_KEY && key !== CACHE_TS_KEY) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));

            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
            localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
        } catch (e) { }
    }

    async function loadData() {
        if (isCacheValid()) {
            var cached = getCachedData();
            if (cached && cached.length > 0) {
                yearData = cached;
                renderMonth(currentMonth);
                window.dispatchEvent(new Event('prayerDataLoaded'));
                return;
            }
        }

        try {

            const [iqamahSettings, scheduleData] = await Promise.all([
                fetchIqamahSettings().catch(err => {
                    console.warn("[Debug] prayer-times: fetchIqamahSettings failed", err);
                    return [];
                }),
                fetch('../data/prayers-schedule.json', { cache: 'no-store' }).then(r => r.json())
                    .catch(err => {
                        console.error("[Debug] prayer-times: fetch prayers-schedule.json failed", err);
                        throw err;
                    })
            ]);



            yearData = generateSchedule(scheduleData, iqamahSettings || []);
            setCachedData(yearData);
            isFallback = false;
            renderMonth(currentMonth);
            window.dispatchEvent(new Event('prayerDataLoaded'));
        } catch (err) {
            console.error('Failed to load prayer schedule:', err);
            if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="padding: 20px; color: #d32f2f;">Error loading prayer times. Please try again later.</td></tr>';
            window.dispatchEvent(new Event('prayerDataLoaded'));
        }
    }

    // --- Init ---
    // Guard: if DOM is already ready (script loaded after DOMContentLoaded fired), run immediately;
    // otherwise wait for the event. Prevents data never loading when script is loaded lazily.
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', loadData);
    } else {
        loadData();
    }

    // Expose for export
    window.getYearlyPrayerData = function () { return yearData; };
})();
