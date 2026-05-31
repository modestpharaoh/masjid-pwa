document.addEventListener("DOMContentLoaded", function () {
  const highlightColor = "#DB8D0D";
  const JumuahTextColor = "#036335";
  const defaultTextColor = "#717d7e";

  const fajrIqamahWait = 20;
  const zuhrIqamahWait = 20;
  const asrIqamahWait = 15;
  const maghribIqamahWait = 10;
  const ishaIqamahWait = 10;
  var ishaMaghribComb = false;
  var enableClockSeconds = localStorage.getItem("showClockSeconds") !== "false";
  let playedAzans = {};
  let tableRefreshTimeout;
  let iqamahFsTimeout = null;
  let shownIqamahs = {};
  let countdownInterval;
  const isAndroid = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.isAndroid : (window.Capacitor && window.Capacitor.getPlatform() === 'android');
  const ua = navigator.userAgent.toLowerCase();
  const isAndroidTV = ua.includes('masjid-tv') || (
    isAndroid && (
      ua.includes('tv') ||
      ua.includes('leanback') ||
      ua.includes('largescreen') ||
      !ua.includes('mobile')
    )
  );

  // Set defaults for Android TV on first run
  if (isAndroidTV) {
    if (localStorage.getItem("beepAtIqamahJumuah") === null) {
      localStorage.setItem("beepAtIqamahJumuah", "true");
    }

    // Default 5 prayers to Beep on Android TV
    if (localStorage.getItem("azanSettings") === null) {
      const defaultAzanSettings = {
        "fajr": { enabled: true, type: "beep" },
        "zuhr": { enabled: true, type: "beep" },
        "asr": { enabled: true, type: "beep" },
        "maghrib": { enabled: true, type: "beep" },
        "isha": { enabled: true, type: "beep" }
      };
      localStorage.setItem("azanSettings", JSON.stringify(defaultAzanSettings));
    }
    // darkMode is handled by theme-init.js
  }

  const arabicNames = {
    "fajr": "الفجر",
    "zuhr": "الظهر",
    "asr": "العصر",
    "maghrib": "المغرب",
    "isha": "العشاء",
    "jumuah": "الجمعة"
  };

  // Global dismiss listener for Iqamah full screen
  const dismissIqamahFs = (e) => {
    const fsOverlay = document.getElementById("iqamah-fullscreen");
    if (fsOverlay && fsOverlay.classList.contains("active")) {
      fsOverlay.classList.remove("active");
      if (iqamahFsTimeout) {
        clearTimeout(iqamahFsTimeout);
        iqamahFsTimeout = null;
      }
    }
  };

  // Audio System Initialization and Unlocking
  let sharedAudioCtx = null;
  function getAudioContext() {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return sharedAudioCtx;
  }

  const unlockAudio = () => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    // Play a silent buffer to prime the audio system
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.001);

    // One-time triggers
    document.removeEventListener("click", unlockAudio);
    document.removeEventListener("touchstart", unlockAudio);
    document.removeEventListener("keydown", unlockAudio);
    console.log("Audio system unlocked via user interaction");
  };

  // Release AudioContext on page unload to free system audio resources
  window.addEventListener('pagehide', function () {
    if (sharedAudioCtx && sharedAudioCtx.state !== 'closed') {
      sharedAudioCtx.close().catch(function () { });
      sharedAudioCtx = null;
    }
    if (activeAzanAudio) {
      activeAzanAudio.pause();
      activeAzanAudio.removeAttribute('src');
      activeAzanAudio.load();
      activeAzanAudio = null;
    }
  });

  document.addEventListener("click", dismissIqamahFs);
  document.addEventListener("touchstart", dismissIqamahFs);
  document.addEventListener("click", unlockAudio);
  document.addEventListener("touchstart", unlockAudio);
  document.addEventListener("keydown", unlockAudio);



  function playBeep() {
    const audioCtx = getAudioContext();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = 'sine';
    // C5 note, resonant and soft
    oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime);

    // Smooth volume fade (envelope) to avoid sharp popping/clicking
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);

    oscillator.start();
    setTimeout(() => {
      try {
        oscillator.stop();
        oscillator.disconnect();
        gainNode.disconnect();
      } catch (e) { }
    }, 500);
  }

  let activeAzanAudio = null;
  function playAzan(prayerName) {
    // Clean up previous audio to prevent memory leaks on long-running displays
    if (activeAzanAudio) {
      activeAzanAudio.pause();
      activeAzanAudio.removeAttribute('src');
      activeAzanAudio.load();
      activeAzanAudio = null;
    }
    const fileName = prayerName.toLowerCase() === 'fajr' ? 'fajr-mashari.mp3' : 'azan-makka.mp3';
    const audio = new Audio(`../media/${fileName}`);
    activeAzanAudio = audio;
    audio.addEventListener('ended', function () {
      audio.removeAttribute('src');
      audio.load();
      activeAzanAudio = null;
    });
    audio.play().catch(e => console.error("Autoplay blocked or file missing", e));
  }

  const formatTime = (timeStr) => {
    if (!timeStr) return "-";
    const [hours, minutes] = timeStr.split(":");
    return `${hours}:${minutes}`;
  };

  function formatCountdown(minutes) {
    if (minutes === null || isNaN(minutes)) return "-";
    if (minutes < 1) return `Less than a min`;
    const hrs = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    let result = "";
    if (hrs > 0) {
      result += `${hrs}h`;
      if (mins > 0) result += ` ${mins}m`;
    } else {
      result += `${mins}m`;
    }
    return result;
  }

  function dateToTimeString(date) {
    if (!date || !(date instanceof Date)) return "-";
    return date.getHours().toString().padStart(2, '0') + ":" + date.getMinutes().toString().padStart(2, '0');
  }


  // Extract time string from a jumuah entry (supports both {time, label} objects and plain strings)
  function getJumuahTime(entry) {
    return (typeof entry === 'object' && entry !== null) ? entry.time : entry;
  }

  function parsePrayerTimeToDate(timeStr, offsetDays = 0) {
    if (!timeStr) return null;
    const now = new Date();
    const [h, m, s] = timeStr.split(":").map(Number);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays, h, m, s || 0);
  }

  function formatLocalDate(date) {
    if (!date || !(date instanceof Date)) return "-";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function diffMinutes(date1, date2) {
    return Math.max(0, Math.floor((date2 - date1) / 60000) + 1);
  }

  function diffMSeconds(date1, date2) {
    return Math.max(0, date2 - date1);
  }

  function getAzanTime(startTime, iqamahTime, iqamahWaitTime) {
    var azanTime = startTime;
    if (diffMinutes(startTime, iqamahTime) > iqamahWaitTime + 11) {
      azanTime = new Date(iqamahTime);
      azanTime.setMinutes(iqamahTime.getMinutes() - 10);
    }
    return azanTime;
  }

  function getIshaAzanTime(startTime, iqamahTime, iqamahWaitTime, ishaMaghribComb, MaghribTime) {
    if (ishaMaghribComb) return MaghribTime;
    return getAzanTime(startTime, iqamahTime, iqamahWaitTime);
  }

  function getNextPrayer(ScheduleMap) {
    const now = new Date();
    for (const [key, value] of ScheduleMap) {
      if (value > now) return key;
    }
    return null;
  }

  function getActiveIqamahSettings(settingsArray, dateObj) {
    if (!settingsArray || !settingsArray.length) return null;
    const tzOffset = dateObj.getTimezoneOffset() * 60000;
    const localISODate = formatLocalDate(dateObj);
    const sortedSettings = [...settingsArray].sort((a, b) => b.startDate.localeCompare(a.startDate));
    const activeSetting = sortedSettings.find(setting => setting.startDate <= localISODate);
    return activeSetting || sortedSettings[sortedSettings.length - 1];
  }

  function applyIqamahRule(baseTimeStr, rule, context) {
    if (!rule) return baseTimeStr;
    if (rule.type === 'fixed') {
      return rule.value + ":00";
    } else if (rule.type === 'offset') {
      const [h, m] = baseTimeStr.split(":").map(Number);
      const d = new Date(2000, 0, 1, h, m, 0);
      const offset = parseInt(rule.value, 10);
      d.setMinutes(d.getMinutes() + (isNaN(offset) ? 0 : offset));
      return d.getHours().toString().padStart(2, '0') + ":" + d.getMinutes().toString().padStart(2, '0') + ":00";
    } else if (rule.type === 'maghrib') {
      if (context && context.maghribJamah) {
        const [h, m] = context.maghribJamah.split(":").map(Number);
        const d = new Date(2000, 0, 1, h, m, 0);
        const offset = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.ishaIqamahOffsetFromMaghrib !== undefined) 
          ? APP_CONFIG.ishaIqamahOffsetFromMaghrib 
          : 10;
        d.setMinutes(d.getMinutes() + offset);
        return d.getHours().toString().padStart(2, '0') + ":" + d.getMinutes().toString().padStart(2, '0') + ":00";
      }
      return baseTimeStr;
    }
    return baseTimeStr;
  }

  function fetchIqamahSettings() {
    const CACHE_KEY = "masjid_iqamah_settings_cache";
    const CACHE_TIME_KEY = "masjid_iqamah_settings_cache_time";
    const PRIMARY_URL = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.iqamahSettingsPath : "";
    const FALLBACK_URL = "../data/iqamah-settings.json";
    const CACHE_DURATION = typeof APP_CONFIG !== 'undefined' && APP_CONFIG.cacheDurationWeb ? (isAndroidTV ? APP_CONFIG.cacheDurationTV : APP_CONFIG.cacheDurationWeb) : 8 * 60 * 60 * 1000;

    const now = Date.now();
    const lastFetchTime = parseInt(localStorage.getItem(CACHE_TIME_KEY) || "0", 10);
    const cachedDataStr = localStorage.getItem(CACHE_KEY);

    let useCache = false;
    let parsedCache = null;

    if (cachedDataStr) {
      try {
        parsedCache = JSON.parse(cachedDataStr);
        if (Array.isArray(parsedCache)) {
          if (now - lastFetchTime < CACHE_DURATION) {
            useCache = true;
          }
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

  function fetchTodayPrayers() {


    return Promise.all([
      fetchIqamahSettings().catch(() => []),
      fetch("../data/prayers-schedule.json").then(res => res.json())
    ]).then(function ([iqamahSettings, localData]) {
      const now = new Date();
      const isLeapYear = (y) => ((y % 4 === 0) && (y % 100 !== 0)) || (y % 400 === 0);

      function getDayData(dateObj) {
        const yearKey = isLeapYear(dateObj.getFullYear()) ? "leap" : "standard";
        const schedule = localData[yearKey];

        // Generic DST shift detection based on masjidTimeZone
        const getDSTShift = (dt) => {
          try {
            const tz = (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.masjidTimeZone : 'Europe/Dublin') || 'Europe/Dublin';
            // Check at noon to avoid boundary issues during early morning transitions (1am/2am)
            const checkDate = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 12, 0, 0);
            const getOffset = (d) => {
              const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(d);
              const offsetStr = parts.find(p => p.type === 'timeZoneName').value;
              const match = offsetStr.match(/([+-])(\d{2}):(\d{2})/);
              return match ? (match[1] === '+' ? 1 : -1) * parseInt(match[2]) : 0;
            };
            const stdOffset = Math.min(getOffset(new Date(dt.getFullYear(), 0, 1)), getOffset(new Date(dt.getFullYear(), 6, 1)));
            return getOffset(checkDate) - stdOffset;
          } catch (e) { return 0; }
        };

        const dstOffsetParams = getDSTShift(dateObj);
        const isDST = dstOffsetParams > 0;

        const m = (dateObj.getMonth() + 1).toString();
        const d = dateObj.getDate().toString();
        const t = schedule[m][d];

        const formatHM = (arr) => ((arr[0] + dstOffsetParams) % 24).toString().padStart(2, '0') + ":" + arr[1].toString().padStart(2, '0') + ":00";

        const activeSettings = getActiveIqamahSettings(iqamahSettings, dateObj) || {};
        const fBase = formatHM(t[0]);
        const zBase = formatHM(t[2]);
        const aBase = formatHM(t[3]);
        const mBase = formatHM(t[4]);
        const iBase = formatHM(t[5]);

        const mJamah = applyIqamahRule(mBase, activeSettings.maghrib) || mBase;
        const hijriOffset = activeSettings.hijriOffset !== undefined ? activeSettings.hijriOffset : 0;

        return {
          d_date: formatLocalDate(dateObj),
          hijri_date_convert: typeof getHijriDateFallback === 'function' ? getHijriDateFallback(dateObj, hijriOffset) : "-",
          fajr_begins: fBase,
          fajr_jamah: applyIqamahRule(fBase, activeSettings.fajr) || fBase,
          sunrise: formatHM(t[1]),
          zuhr_begins: zBase,
          zuhr_jamah: applyIqamahRule(zBase, activeSettings.zuhr) || zBase,
          asr_mithl_1: aBase,
          asr_jamah: applyIqamahRule(aBase, activeSettings.asr) || aBase,
          maghrib_begins: mBase,
          maghrib_jamah: mJamah,
          isha_begins: iBase,
          isha_jamah: applyIqamahRule(iBase, activeSettings.isha, { maghribJamah: mJamah }) || iBase,
          jumuah: activeSettings.jumuah || (JSON.parse(localStorage.getItem("lastKnownJumuah") || "null")) || (isDST ? APP_CONFIG.jumuahFallbackDST : APP_CONFIG.jumuahFallbackStandard),
          iqamah_types: {
            fajr: (activeSettings.fajr && activeSettings.fajr.type) || 'offset',
            zuhr: (activeSettings.zuhr && activeSettings.zuhr.type) || 'offset',
            asr: (activeSettings.asr && activeSettings.asr.type) || 'offset',
            maghrib: (activeSettings.maghrib && activeSettings.maghrib.type) || 'offset',
            isha: (activeSettings.isha && activeSettings.isha.type) || 'offset'
          },
          isFallback: false
        };
      }

      const todayData = getDayData(now);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      todayData.tomorrow = getDayData(tomorrow);

      // Cache for chatbot/offline
      localStorage.setItem("masjid_prayers_today", JSON.stringify(todayData));
      if (todayData.jumuah && Array.isArray(todayData.jumuah)) {
        localStorage.setItem("lastKnownJumuah", JSON.stringify(todayData.jumuah));
      }


      return [todayData];
    })
      .catch(function (error) {
        console.error("Critical failure loading prayer data:", error);
        document.getElementById("prayer-cards").innerHTML = "<p style='color:#fff;text-align:center;padding:2vh'>Error loading prayer times.</p>";
        throw error;
      })
      .then(data => {
        if (!data) return;

        let activePrayerData = data[0];
        let isTomorrow = false;

        const prayers = [
          { name: "Fajr", key: "fajr", icon: "mdi-theme-light-dark" },
          { name: "Zuhr", key: "zuhr", icon: "mdi-white-balance-sunny" },
          { name: "Asr", key: "asr", icon: "mdi-weather-sunny" },
          { name: "Maghrib", key: "maghrib", icon: "mdi-weather-sunset-down" },
          { name: "Isha", key: "isha", icon: "mdi-weather-night" }
        ];

        function buildSchedule(prayerData, isTomorrowData) {
          if (prayerData.maghrib_jamah == prayerData.isha_jamah) { ishaMaghribComb = true; } else { ishaMaghribComb = false; }
          if (ishaMaghribComb) { prayerData.isha_jamah = prayerData.maghrib_jamah; }

          let offsetDays = isTomorrowData ? 1 : 0;
          let fajrTomorrowStr = (prayerData.tomorrow && prayerData.tomorrow.fajr_begins) ? prayerData.tomorrow.fajr_begins : data[0].fajr_begins;
          const fajrTomorrow = parsePrayerTimeToDate(fajrTomorrowStr, offsetDays + 1);

          let ishaData = prayerData;
          let ishaOffset = offsetDays;
          let ishaMaghribCombLocal = ishaMaghribComb;

          // If the schedule has shifted to tomorrow, but we are still before midnight (current day)
          if (isTomorrowData && new Date().getHours() >= 12) {
            ishaData = Object.assign({}, data[0]);
            ishaOffset = 0;
            ishaMaghribCombLocal = (ishaData.maghrib_jamah == ishaData.isha_jamah);
            if (ishaMaghribCombLocal) { ishaData.isha_jamah = ishaData.maghrib_jamah; }
          }

          const map = new Map();
          map.set("Fajr", parsePrayerTimeToDate(prayerData.fajr_begins, offsetDays));
          map.set("Fajr Azan", getAzanTime(parsePrayerTimeToDate(prayerData.fajr_begins, offsetDays), parsePrayerTimeToDate(prayerData.fajr_jamah, offsetDays), fajrIqamahWait));
          map.set("Fajr Iqamah", parsePrayerTimeToDate(prayerData.fajr_jamah, offsetDays));
          map.set("Sunrise", parsePrayerTimeToDate(prayerData.sunrise, offsetDays));
          map.set("Zuhr", parsePrayerTimeToDate(prayerData.zuhr_begins, offsetDays));
          map.set("Zuhr Azan", getAzanTime(parsePrayerTimeToDate(prayerData.zuhr_begins, offsetDays), parsePrayerTimeToDate(prayerData.zuhr_jamah, offsetDays), zuhrIqamahWait));
          map.set("Zuhr Iqamah", parsePrayerTimeToDate(prayerData.zuhr_jamah, offsetDays));
          map.set("Asr", parsePrayerTimeToDate(prayerData.asr_mithl_1, offsetDays));
          map.set("Asr Azan", getAzanTime(parsePrayerTimeToDate(prayerData.asr_mithl_1, offsetDays), parsePrayerTimeToDate(prayerData.asr_jamah, offsetDays), asrIqamahWait));
          map.set("Asr Iqamah", parsePrayerTimeToDate(prayerData.asr_jamah, offsetDays));
          map.set("Maghrib", parsePrayerTimeToDate(prayerData.maghrib_begins, offsetDays));
          map.set("Maghrib Azan", getAzanTime(parsePrayerTimeToDate(prayerData.maghrib_begins, offsetDays), parsePrayerTimeToDate(prayerData.maghrib_jamah, offsetDays), maghribIqamahWait));
          map.set("Maghrib Iqamah", parsePrayerTimeToDate(prayerData.maghrib_jamah, offsetDays));
          map.set("Isha", parsePrayerTimeToDate(ishaData.isha_begins, ishaOffset));
          map.set("Isha Azan", getIshaAzanTime(parsePrayerTimeToDate(ishaData.isha_begins, ishaOffset), parsePrayerTimeToDate(ishaData.isha_jamah, ishaOffset), ishaIqamahWait, ishaMaghribCombLocal, parsePrayerTimeToDate(ishaData.maghrib_begins, ishaOffset)));
          map.set("Isha Iqamah", parsePrayerTimeToDate(ishaData.isha_jamah, ishaOffset));
          map.set("Fajr Tomorrow", fajrTomorrow);
          return map;
        }

        let scheduleMap = buildSchedule(activePrayerData, isTomorrow);

        function createTables() {
          let nextPrayerKey = getNextPrayer(scheduleMap);

          if (nextPrayerKey === "Fajr Tomorrow" && !isTomorrow) {
            isTomorrow = true;
            activePrayerData = { ...data[0].tomorrow, jumuah: data[0].jumuah };
            // Ensure we don't copy today's hijri date for tomorrow's schedule

            if (!activePrayerData.d_date && data[0].d_date) {
              let tmrDate = new Date(data[0].d_date);
              tmrDate.setDate(tmrDate.getDate() + 1);
              activePrayerData.d_date = formatLocalDate(tmrDate);
            }

            if (activePrayerData.d_date) {
              const tmrObj = new Date(activePrayerData.d_date);
              activePrayerData.hijri_date_convert = typeof getHijriDateFallback === 'function' ? getHijriDateFallback(tmrObj) : "-";
            }

            scheduleMap = buildSchedule(activePrayerData, isTomorrow);
            nextPrayerKey = getNextPrayer(scheduleMap);
          }

          const activeDate = new Date(activePrayerData.d_date);
          let isFriday = activeDate.getDay() === 5;
          let isZuhrJumuahActive = false;

          if (isFriday) {
            const jumuahTimes = activePrayerData.jumuah || [];
            if (jumuahTimes.length > 0) {
              const lastJumuahTimeStr = getJumuahTime(jumuahTimes[jumuahTimes.length - 1]);
              const lastJumuahDate = parsePrayerTimeToDate(lastJumuahTimeStr, isTomorrow ? 1 : 0);
              const endTime = new Date(lastJumuahDate.getTime() + 35 * 60000);
              const sunriseTime = scheduleMap.get("Sunrise");
              const _now = new Date();
              if (_now >= sunriseTime && _now < endTime) {
                isZuhrJumuahActive = true;
              }
            }
          }

          // No longer back up innerHTML — weather data is read from cache on every rebuild
          // to ensure it always reflects the latest fetched conditions.

          // ========== HEADER ==========
          const headerDiv = document.getElementById("prayer-header");
          headerDiv.innerHTML = "";

          // Main header row: [Logo] [Weather] [Clock] [Next Prayer]
          const headerMain = document.createElement("div");
          headerMain.className = "header-main";

          // Identify orientation for dynamic weather placement
          const isPortrait = window.matchMedia("(orientation: portrait)").matches;

          // Logo (left — padded to clear menu button)
          const logoEl = document.createElement("div");
          logoEl.className = "header-logo";
          if (typeof window.getBrandLogoHTML === 'function') {
            logoEl.innerHTML = window.getBrandLogoHTML(true);
          } else {
            // Inline fallback: use DOM construction to avoid attribute injection
            const mUrl = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.masjidBaseUrl : "https://masjid.com";
            const mName = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.masjidName : "Masjid";
            const esc = window.escapeHTML || (s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
            const a = document.createElement('a');
            a.href = esc(mUrl);
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            const img = document.createElement('img');
            img.src = '../images/logos/masjid-logo.png';
            img.alt = mName + ' Logo';
            a.appendChild(img);
            logoEl.appendChild(a);
          }
          headerMain.appendChild(logoEl);

          // Weather Stats Container — always pulled fresh from cache, never from stale innerHTML
          const weatherStatsEl = document.createElement("div");
          weatherStatsEl.id = "weather-stats";
          weatherStatsEl.className = "weather-stats";

          // Position Weather Stats between logo and clock ONLY in landscape
          if (!isPortrait) {
            headerMain.appendChild(weatherStatsEl);
          }

          // Clock (center)
          const clockEl = document.createElement("div");
          clockEl.className = "header-clock";
          clockEl.id = "live-clock";
          headerMain.appendChild(clockEl);

          // Next prayer info (right)
          const nextInfoEl = document.createElement("div");
          nextInfoEl.className = "header-next-info";
          const nextLabelEl = document.createElement("div");
          nextLabelEl.className = "next-label";
          nextLabelEl.id = "next-prayer-name";
          let offlineWarning = "";
          if (!nextPrayerKey) {
            offlineWarning = `<span style="color: #d32f2f; font-size: 0.85em; display:block; margin-top:2px;">Data may be outdated</span>`;
          }
          nextLabelEl.innerHTML = nextPrayerKey ? `Next: <strong>${nextPrayerKey}</strong>` : offlineWarning || "-";
          const countdownEl = document.createElement("div");
          countdownEl.className = "next-countdown";
          countdownEl.id = "live-countdown";
          nextInfoEl.appendChild(nextLabelEl);
          nextInfoEl.appendChild(countdownEl);
          headerMain.appendChild(nextInfoEl);

          // Date row (stacked and bigger)
          // Always use data[0] instead of activePrayerData here so that the header date
          // stays fixed to the actual current day until midnight, even when the cards
          // show tomorrow's prayers after Isha.
          const dateRow = document.createElement("div");
          dateRow.className = "header-date-row";
          const todayDate = new Date(data[0].d_date);
          const formattedDate = todayDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          const hijriDate = data[0].hijri_date_convert || "-";
          const gregorianDiv = document.createElement("div");
          gregorianDiv.className = "gregorian-date";
          gregorianDiv.textContent = formattedDate;

          const hijriDiv = document.createElement("div");
          hijriDiv.className = "hijri-date";
          hijriDiv.textContent = hijriDate;

          // Portrait Flow: weather-stats -> gregorian -> hijri
          if (isPortrait) {
            dateRow.appendChild(weatherStatsEl);
          }

          dateRow.appendChild(gregorianDiv);
          // Always show the Hijri Date if a valid string is available (including locally computed fallbacks)
          if (data[0].hijri_date_convert && !data[0].hijri_date_convert.includes("Offline Data")) {
            dateRow.appendChild(hijriDiv);
          }

          headerDiv.appendChild(headerMain);
          headerDiv.appendChild(dateRow);

          // ========== PRAYER CARDS & JUMUAH ==========
          const cardsDiv = document.getElementById("prayer-cards");
          cardsDiv.innerHTML = "";

          // Order: Fajr, Sunrise, Zuhr, Asr, Maghrib, Isha
          const cardItems = [
            { type: "prayer", idx: 0 },
            { type: "sunrise" },
            { type: "prayer", idx: 1 },
            { type: "prayer", idx: 2 },
            { type: "prayer", idx: 3 },
            { type: "prayer", idx: 4 },
          ];

          cardItems.forEach(item => {
            if (item.type === "prayer") {
              const { name, key, icon } = prayers[item.idx];

              let isNext = false;
              if (isFriday && isZuhrJumuahActive) {
                isNext = (key === "zuhr");
              } else {
                isNext = nextPrayerKey && nextPrayerKey.toLowerCase().includes(key.toLowerCase());
              }

              const card = document.createElement("div");
              card.id = `card-${key}`;
              card.className = "p-card" + (isNext ? " p-card-active" : "");

              const prayerTime = dateToTimeString(scheduleMap.get(name));
              const azanTime = dateToTimeString(scheduleMap.get(name + " Azan"));
              const iqamahTime = dateToTimeString(scheduleMap.get(name + " Iqamah"));

              let azanDisplay = "";
              let subText = "";
              if (!activePrayerData.isFallback) {
                if (isFriday && key === "zuhr") {
                  if (azanTime !== prayerTime) {
                    azanDisplay = `<span class="azan-fixed">Azan:</span> <span id="azan-time-${key}" class="azan-fixed">${azanTime}</span>`;
                  }
                  subText = "";
                } else {
                  const iqType = (activePrayerData.iqamah_types && activePrayerData.iqamah_types[key]) || 'offset';
                  if (azanTime !== prayerTime && iqType !== 'maghrib') {
                    azanDisplay = `<span class="azan-fixed">Azan:</span> <span id="azan-time-${key}" class="azan-fixed">${azanTime}</span>`;
                  }

                  let iqLabel = '<span class="iq-prefix">IQ:</span>';
                  if (iqType === 'fixed') {
                    iqLabel = '<span class="iq-fixed">Fixed</span> <span class="iq-prefix">IQ:</span>';
                  } else if (iqType === 'maghrib') {
                    iqLabel = '<span class="iq-fixed">After Mgrb</span> <span class="iq-prefix">IQ:</span>';
                  }
                  subText = `<div class="p-card-sub" id="subtext-${key}"><span id="iqamah-time-${key}">${iqLabel} ${iqamahTime}</span></div>`;
                }
              }

              card.innerHTML = `
                <div class="p-card-left">
                  <i class="mdi ${icon} p-card-icon"></i>
                  <div class="p-card-name-container">
                    <span class="p-card-name">${name}</span>
                    ${azanDisplay ? `<div class="p-card-sub azan-sub">${azanDisplay}</div>` : ""}
                  </div>
                </div>
                <div class="p-card-right">
                  <div class="p-card-iqamah" id="prayer-time-${key}">${prayerTime}</div>
                  ${subText}
                </div>
              `;
              cardsDiv.appendChild(card);

            } else {
              // Sunrise card
              const isSunriseNext = (isFriday && isZuhrJumuahActive) ? false : (nextPrayerKey === "Sunrise");
              const card = document.createElement("div");
              card.id = "card-sunrise";
              card.className = "p-card p-card-sunrise" + (isSunriseNext ? " p-card-active" : "");
              card.innerHTML = `
                <div class="p-card-left">
                  <i class="mdi mdi-weather-sunset-up p-card-icon p-sunrise-icon"></i>
                  <span class="p-card-name">Sunrise</span>
                </div>
                <div class="p-card-right">
                  <div class="p-card-iqamah p-sunrise-time" id="time-sunrise">${formatTime(activePrayerData.sunrise)}</div>
                </div>
              `;
              cardsDiv.appendChild(card);
            }
          });

          // ========== JUMUAH (now inside cards container) ==========
          const jumuahArr = activePrayerData.jumuah || [];
          const row = document.createElement("div");
          row.className = "jumuah-row jumuah-count-" + (jumuahArr.length || 1);

          if (jumuahArr.length === 0) {
            const jCard = document.createElement("div");
            jCard.id = `card-jumuah-1`;
            jCard.className = "jumuah-card" + (isFriday && isZuhrJumuahActive ? " p-card-active" : "");
            jCard.innerHTML = `
              <div class="jumuah-row-1">
                <i class="mdi mdi-mosque jumuah-icon"></i>
                <span class="jumuah-label">Jumuah</span>
              </div>
              <div class="jumuah-row-2">
                <span class="jumuah-time" id="time-jumuah-1" style="color: #d32f2f; font-size: 1.2rem;">Not offered</span>
              </div>
              <div class="jumuah-row-3"></div>
            `;
            row.appendChild(jCard);
          } else {
            jumuahArr.forEach((entry, index) => {
              const jCard = document.createElement("div");
              const jumuahId = `jumuah-${index + 1}`;
              // Support both new object format {time, label} and legacy plain string format
              const time = (typeof entry === 'object' && entry !== null) ? entry.time : entry;
              const labelText = (typeof entry === 'object' && entry !== null && entry.label) ? `(${entry.label})` : "";
              const safeLabelText = String(labelText).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
              const labelHtml = safeLabelText ? `<div class="jumuah-sub-label">${safeLabelText}</div>` : "";
              jCard.id = `card-${jumuahId}`;
              jCard.className = "jumuah-card" + (isFriday && isZuhrJumuahActive ? " p-card-active" : "");
              jCard.innerHTML = `
                <div class="jumuah-row-1">
                  <i class="mdi mdi-mosque jumuah-icon"></i>
                  <span class="jumuah-label">Jumuah ${jumuahArr.length > 1 ? index + 1 : ""}</span>
                </div>
                <div class="jumuah-row-2">
                  <span class="jumuah-time" id="time-${jumuahId}">${formatTime(time)}</span>
                </div>
                <div class="jumuah-row-3">
                  ${labelHtml}
                </div>
              `;
              row.appendChild(jCard);
            });
          }
          cardsDiv.appendChild(row);

          // ========== LIVE CLOCK & COUNTDOWN ==========
          const now = new Date();
          let nextPrayerTime = scheduleMap.get(nextPrayerKey);
          let nextDiffMSeconds = nextPrayerTime ? Math.floor(diffMSeconds(now, nextPrayerTime)) : 0;

          if (!window.celestial) window.celestial = new CelestialSystem("prayer-header");
          else window.celestial.initDOM();

          // After every DOM rebuild, repopulate weather stats from cache immediately
          // This prevents the element from appearing empty between interval ticks
          try {
            const cachedWeather = localStorage.getItem("masjid_weather_cache");
            if (cachedWeather && window.celestial) {
              const w = JSON.parse(cachedWeather);
              window.celestial.updateWeatherStats(w.temperature_2m, w.relative_humidity_2m, w.wind_speed_10m);
            }
          } catch (e) { /* ignore parse errors */ }

          const prayerStrings = {};
          ["Fajr", "Zuhr", "Asr", "Maghrib", "Isha"].forEach(prayerName => {
            const pt = scheduleMap.get(prayerName);
            if (pt) prayerStrings[prayerName] = dateToTimeString(pt);
          });

          function updateTimeAndCountdown() {
            const now = new Date();
            const hh = now.getHours().toString().padStart(2, '0');
            const mm = now.getMinutes().toString().padStart(2, '0');
            const ss = now.getSeconds().toString().padStart(2, '0');

            // Day Change Detection
            const todayStr = formatLocalDate(now);

            // If it's midnight and we were in 'tomorrow mode', the 'tomorrow' is now 'today'.
            // We must reset the flag and refresh to ensure building the schedule uses correct offsets.
            if (isTomorrow && activePrayerData.d_date === todayStr) {
              isTomorrow = false;
              fetchTodayPrayers();
              return;
            }

            if (activePrayerData.d_date && activePrayerData.d_date !== todayStr && !isTomorrow) {
              const nowMs = Date.now();
              // Prevent infinite rapid retries if the API returns a stale date (e.g. at midnight)
              if (!window._lastDateChangeFetch || (nowMs - window._lastDateChangeFetch > 60000)) {

                window._lastDateChangeFetch = nowMs;
                fetchTodayPrayers();
              }
              return; // Wait for fetchTodayPrayers to rebuild everything
            }

            // Live Jumuah Status Check
            isZuhrJumuahActive = false;
            isFriday = now.getDay() === 5;
            if (isFriday) {
              const jumuahTimes = activePrayerData.jumuah || [];
              if (jumuahTimes.length > 0) {
                const lastJumuahTimeStr = getJumuahTime(jumuahTimes[jumuahTimes.length - 1]);
                const lastJumuahDate = parsePrayerTimeToDate(lastJumuahTimeStr, isTomorrow ? 1 : 0);
                const endTime = new Date(lastJumuahDate.getTime() + 35 * 60000);
                const sunriseTime = scheduleMap.get("Sunrise");
                if (now >= sunriseTime && now < endTime) {
                  isZuhrJumuahActive = true;
                }
              }
            }

            if (window.celestial) {
              const sr = scheduleMap.get("Sunrise");
              const mg = scheduleMap.get("Maghrib");
              window.celestial.update(now, sr, mg);
            }

            enableClockSeconds = localStorage.getItem("showClockSeconds") !== "false";
            const clockDiv = document.getElementById("live-clock");
            if (clockDiv) {
              const clockStr = enableClockSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
              if (clockDiv.textContent !== clockStr) {
                clockDiv.textContent = clockStr;
              }
            }

            // Update Iqamah Full Screen Clock and Dates
            const fsOverlay = document.getElementById("iqamah-fullscreen");
            if (fsOverlay && fsOverlay.classList.contains("active")) {
              const fsClock = document.getElementById("iqamah-fs-clock");
              const fsHijri = document.getElementById("iqamah-fs-hijri");
              const fsDate = document.getElementById("iqamah-fs-date");

              const iqClockStr = `${hh}:${mm}`;
              if (fsClock && fsClock.textContent !== iqClockStr) {
                fsClock.textContent = iqClockStr;
              }

              if (fsHijri) {
                const hDate = typeof getHijriDateFallback === 'function' ? getHijriDateFallback(now) : "";
                if (fsHijri.textContent !== hDate) fsHijri.textContent = hDate;
              }

              if (fsDate) {
                const dDate = now.toLocaleDateString('en-GB', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                });
                if (fsDate.textContent !== dDate) fsDate.textContent = dDate;
              }
            }

            // Live Next Prayer Update
            const updatedNextPrayer = getNextPrayer(scheduleMap);
            if (updatedNextPrayer && updatedNextPrayer !== nextPrayerKey) {
              nextPrayerKey = updatedNextPrayer;

              // If the next prayer is "Fajr Tomorrow" and we haven't switched yet,
              // trigger a full table rebuild immediately. This is critical on Android TV
              // where setTimeout chains (used by refreshTables) can be throttled or
              // broken during fullscreen overlays or device power-saving modes.
              if (nextPrayerKey === "Fajr Tomorrow" && !isTomorrow) {

                if (countdownInterval) clearInterval(countdownInterval);
                if (tableRefreshTimeout) clearTimeout(tableRefreshTimeout);

                nextTableIn = createTables();
                refreshTables();
                return;
              }

              const nextLabel = document.getElementById("next-prayer-name");
              if (nextLabel) {
                // Use textContent to avoid XSS from a crafted nextPrayerKey
                nextLabel.textContent = '';
                nextLabel.appendChild(document.createTextNode('Next: '));
                const strongEl = document.createElement('strong');
                strongEl.textContent = nextPrayerKey;
                nextLabel.appendChild(strongEl);
              }

              // Update highlights dynamically
              document.querySelectorAll(".p-card, .jumuah-card").forEach(c => c.classList.remove("p-card-active"));
              const pNext = nextPrayerKey.toLowerCase();

              if (isFriday && isZuhrJumuahActive && (pNext.includes("zuhr") || pNext.includes("jumuah"))) {
                const zuhrCard = document.getElementById("card-zuhr");
                if (zuhrCard) zuhrCard.classList.add("p-card-active");
                document.querySelectorAll(".jumuah-card").forEach(jc => jc.classList.add("p-card-active"));
              } else {
                prayers.forEach(p => {
                  if (pNext.includes(p.key.toLowerCase())) {
                    const card = document.getElementById(`card-${p.key}`);
                    if (card) card.classList.add("p-card-active");
                  }
                });
                if (pNext.includes("sunrise")) {
                  const card = document.getElementById("card-sunrise");
                  if (card) card.classList.add("p-card-active");
                }
              }
            }

            const countdownDiv = document.getElementById("live-countdown");
            if (countdownDiv && nextPrayerKey) {
              const npt = scheduleMap.get(nextPrayerKey);
              if (npt) {
                let diff = diffMinutes(now, npt);
                const newText = diff >= 0 ? formatCountdown(diff) : "-";
                if (countdownDiv.textContent !== newText) {
                  countdownDiv.textContent = newText;
                }
              } else {
                if (countdownDiv.textContent !== "-") countdownDiv.textContent = "-";
              }
            }

            // Azan Notification and Animations Check
            const timeNow = `${hh}:${mm}`;
            // Notification Check for Friday / Jumuah occurs here
            // isFriday is already declared above

            ["Fajr", "Zuhr", "Asr", "Maghrib", "Isha"].forEach(prayerName => {
              const key = prayerName.toLowerCase();

              // Notification Check
              if (prayerStrings[prayerName] && timeNow === prayerStrings[prayerName]) {
                const playKey = `${prayerName}-${now.getDate()}`;
                if (!playedAzans[playKey]) {
                  playedAzans[playKey] = true;
                  let settings = {};
                  try { settings = JSON.parse(localStorage.getItem('azanSettings') || '{}'); } catch (e) { settings = {}; }
                  const config = settings[prayerName.toLowerCase()];
                  if (config && config.enabled) {
                    // On Capacitor (Android): scheduled notification handles sound natively.
                    // On Web: play audio via JS + show a visual (silent) browser notification.
                    const useNativeNotification = typeof PrayerNotification !== 'undefined' && PrayerNotification.isCapacitor && !isAndroidTV;

                    if (!useNativeNotification) {
                      // Web/PWA: play audio via JavaScript
                      if (config.type === 'azan') {
                        playAzan(prayerName);
                      } else if (config.type === 'beep') {
                        playBeep();
                      }

                      // Show a silent visual browser notification
                      if (typeof PrayerNotification !== 'undefined') {
                        PrayerNotification.sendWebNotification(
                          '🕌 ' + prayerName + ' Prayer Time',
                          'It is time for ' + prayerName + ' prayer.',
                          { prayerKey: prayerName.toLowerCase() }
                        );
                      }
                    }
                    // On Android, no JS audio — the native notification fires with azan/beep sound
                  }
                }
              }


              // Animation Check
              const cardEl = document.getElementById(`card-${key}`);
              if (cardEl) {
                const bkTime = scheduleMap.get(prayerName) ? dateToTimeString(scheduleMap.get(prayerName)) : null;
                const azTime = scheduleMap.get(prayerName + " Azan") ? dateToTimeString(scheduleMap.get(prayerName + " Azan")) : null;
                const iqTime = scheduleMap.get(prayerName + " Iqamah") ? dateToTimeString(scheduleMap.get(prayerName + " Iqamah")) : null;

                // Animate card on Azan, Prayer Begins, AND Iqamah time
                const isAzanOrBeginsOrIqamah = (timeNow === bkTime || timeNow === azTime || timeNow === iqTime);
                if (isAzanOrBeginsOrIqamah !== cardEl.classList.contains("anim-event-card")) {
                  cardEl.classList.toggle("anim-event-card", isAzanOrBeginsOrIqamah);
                }

                // Animate Azan text specifically if it's different from the prayer begin time
                const azanTextEl = document.getElementById(`azan-time-${key}`);
                if (azanTextEl) {
                  const isAzanTime = (timeNow === azTime);
                  if (isAzanTime !== azanTextEl.classList.contains("anim-iqamah-text")) {
                    azanTextEl.classList.toggle("anim-iqamah-text", isAzanTime);
                  }
                }

                // Animate Iqamah text
                const iqamahEl = document.getElementById(`iqamah-time-${key}`);
                if (iqamahEl) {
                  const isIqamahTime = (timeNow === iqTime);
                  if (isIqamahTime !== iqamahEl.classList.contains("anim-iqamah-text")) {
                    iqamahEl.classList.toggle("anim-iqamah-text", isIqamahTime);
                  }
                }

                // Animate the main prayer time
                const prayerTimeEl = document.getElementById(`prayer-time-${key}`);
                if (prayerTimeEl) {
                  const isMainPrayerTime = (timeNow === bkTime);
                  if (isMainPrayerTime !== prayerTimeEl.classList.contains("anim-iqamah-text")) {
                    prayerTimeEl.classList.toggle("anim-iqamah-text", isMainPrayerTime);
                  }
                }

                // Full Screen Iqamah Display
                if (timeNow === iqTime) {
                  const fsKey = `${key}-${now.getDate()}`;
                  if (!shownIqamahs[fsKey]) {
                    const showIqEnv = localStorage.getItem("showIqamahFullscreen");
                    const isIqEnabled = showIqEnv === "true" || (showIqEnv === null && isAndroid);
                    if (isIqEnabled) {
                      shownIqamahs[fsKey] = true;
                      const defaultDur = isAndroid ? "300" : "120";
                      const duration = Math.min(600, Math.max(15, parseInt(localStorage.getItem("iqamahFullscreenDuration") || defaultDur, 10)));
                      const fsOverlay = document.getElementById("iqamah-fullscreen");
                      const nameEl = document.getElementById("iqamah-fs-prayer-name");
                      const arabicEl = document.getElementById("iqamah-fs-prayer-arabic");
                      if (fsOverlay && nameEl) {
                        nameEl.textContent = `Jama’ah for ${prayerName}`;
                        if (arabicEl) arabicEl.textContent = `صلاة الجماعة - ${arabicNames[key] || ""}`;
                        if (iqamahFsTimeout) clearTimeout(iqamahFsTimeout);
                        fsOverlay.classList.add("active");
                        iqamahFsTimeout = setTimeout(() => {
                          fsOverlay.classList.remove("active");
                          iqamahFsTimeout = null;
                        }, duration * 1000);
                      }
                    }
                  }

                  // Beep at Iqamah time
                  const playKeyIq = `iq-beep-${key}-${now.getDate()}`;
                  if (!playedAzans[playKeyIq]) {
                    playedAzans[playKeyIq] = true;
                    const beepEnabled = localStorage.getItem("beepAtIqamahJumuah") === "true";
                    if (beepEnabled) playBeep();
                  }
                }
              }
            });

            // Jumuah Animations - Only on Fridays
            if (isFriday && activePrayerData.jumuah && activePrayerData.jumuah.length > 0) {
              activePrayerData.jumuah.forEach((entry, index) => {
                const jStr = dateToTimeString(parsePrayerTimeToDate(getJumuahTime(entry)));
                const jCardEl = document.getElementById(`card-jumuah-${index + 1}`);
                if (jCardEl) {
                  const isJumuahTime = (timeNow === jStr);
                  if (isJumuahTime !== jCardEl.classList.contains("anim-event-card")) {
                    jCardEl.classList.toggle("anim-event-card", isJumuahTime);
                  }

                  const jTimeEl = document.getElementById(`time-jumuah-${index + 1}`);
                  if (jTimeEl) {
                    if (isJumuahTime !== jTimeEl.classList.contains("anim-iqamah-text")) {
                      jTimeEl.classList.toggle("anim-iqamah-text", isJumuahTime);
                    }
                  }

                  // Full Screen Jumuah Display
                  if (timeNow === jStr) {
                    const fsKey = `jumuah-${index}-${now.getDate()}`;
                    if (!shownIqamahs[fsKey]) {
                      const showJuEnv = localStorage.getItem("showJumuahFullscreen");
                      const isJuEnabled = showJuEnv === "true" || (showJuEnv === null && isAndroid);
                      if (isJuEnabled) {
                        shownIqamahs[fsKey] = true;
                        const defaultDur = isAndroid ? "25" : "1";
                        const durationMin = Math.min(35, Math.max(1, parseInt(localStorage.getItem("jumuahFullscreenDuration") || defaultDur, 10)));
                        const fsOverlay = document.getElementById("iqamah-fullscreen");
                        const nameEl = document.getElementById("iqamah-fs-prayer-name");
                        const arabicEl = document.getElementById("iqamah-fs-prayer-arabic");
                        if (fsOverlay && nameEl) {
                          nameEl.textContent = `Jumuah Khutbah ${index + 1}`;
                          if (arabicEl) arabicEl.textContent = `خطبة الجمعة ${index + 1}`;
                          if (iqamahFsTimeout) clearTimeout(iqamahFsTimeout);
                          fsOverlay.classList.add("active");
                          iqamahFsTimeout = setTimeout(() => {
                            fsOverlay.classList.remove("active");
                            iqamahFsTimeout = null;
                          }, durationMin * 60 * 1000);
                        }
                      }
                    }

                    // Beep at Jumuah time
                    const playKeyJu = `ju-beep-${index}-${now.getDate()}`;
                    if (!playedAzans[playKeyJu]) {
                      playedAzans[playKeyJu] = true;
                      const beepEnabled = localStorage.getItem("beepAtIqamahJumuah") === "true";
                      if (beepEnabled) playBeep();
                    }
                  }
                }
              });
            }

            // Sunrise Animation
            const sunriseEl = document.getElementById("card-sunrise");
            if (sunriseEl) {
              const srTime = scheduleMap.get("Sunrise") ? dateToTimeString(scheduleMap.get("Sunrise")) : null;
              const isSunrise = (timeNow === srTime);
              if (isSunrise !== sunriseEl.classList.contains("anim-event-card")) {
                sunriseEl.classList.toggle("anim-event-card", isSunrise);
              }
            }
          }

          if (countdownInterval) clearInterval(countdownInterval);
          updateTimeAndCountdown();
          countdownInterval = setInterval(updateTimeAndCountdown, 1000);

          // Add Ramadan Decorations if applicable
          if (typeof checkAndAddRamadanDecorations === 'function') {
            checkAndAddRamadanDecorations();
          }

          // Load and display notifications (landscape only)
          loadNotifications();

          return nextDiffMSeconds;
        }

        if (tableRefreshTimeout) {
          clearTimeout(tableRefreshTimeout);
        }

        let nextTableIn = createTables();

        // Schedule native notifications once per fetch (not on every table refresh)
        schedulePrayerNotifications(scheduleMap, prayers);

        function refreshTables() {
          // Apply fallback delay if data shows no valid future times
          const delay = nextTableIn > 0 ? nextTableIn : 60000;

          tableRefreshTimeout = setTimeout(() => {
            nextTableIn = createTables();
            refreshTables();
          }, Math.max(1000, delay));
        }
        refreshTables();
      })
      .catch(error => {
        console.error("Prayer load error:", error);
        console.error("[Debug] Prayer load error stack:", error.stack || error.message);
        const cardsEl = document.getElementById("prayer-cards");
        if (cardsEl) cardsEl.innerHTML = "<p style='color:#fff;text-align:center;padding:2vh'>Error loading prayer times.</p>";
      });
  }

  function checkAndAddRamadanDecorations() {
    if (!APP_CONFIG.showRamadanAnimation) return;

    const now = new Date();
    const hijriDate = typeof getHijriDateFallback === 'function' ? getHijriDateFallback(now) : "";

    if (hijriDate && hijriDate.includes("Ramadan")) {
      const cardContainer = document.getElementById("prayer-cards");
      const pageContainer = document.querySelector(".prayer-page");
      if (!cardContainer || !pageContainer) return;

      // Clear existing decorations from both potential containers
      document.querySelectorAll(".ramadan-decor-container").forEach(el => el.remove());

      const isLandscape = window.innerWidth > window.innerHeight;
      const decorCount = isLandscape ? 6 : 4;

      // In portrait, attach to page top. In landscape, attach to cards panel.
      const container = isLandscape ? cardContainer : pageContainer;

      for (let i = 0; i < decorCount; i++) {
        const isFanos = i % 2 === 0;

        // Create wrapper container
        const containerElem = document.createElement("div");
        containerElem.className = "ramadan-decor-container";

        // Add dangling string
        const stringElem = document.createElement("div");
        stringElem.className = "decor-string";

        let stringHeight = 0;
        if (isLandscape) {
          // In landscape, strings are shorter (5vh to 45vh of card container)
          stringHeight = 5 + Math.random() * 40;
          stringElem.style.height = `${stringHeight}vh`;
        } else {
          // In portrait, strings start from top of page and go till middle of cards (~50-80vh)
          stringHeight = 40 + Math.random() * 35;
          stringElem.style.height = `${stringHeight}vh`;
        }
        containerElem.appendChild(stringElem);

        // Add the decoration itself
        const decorElem = document.createElement("div");
        decorElem.className = `ramadan-decor ${isFanos ? 'fanos-decor' : 'crescent-decor'}`;

        // Use createElement instead of innerHTML for better security practice
        const imgElem = document.createElement("img");
        imgElem.src = isFanos ? '../images/backgrounds/fanos.svg' : '../images/backgrounds/crescent.svg';
        imgElem.alt = "Ramadan Decor";
        imgElem.style.width = "100%";
        imgElem.style.height = "auto";
        decorElem.appendChild(imgElem);

        containerElem.appendChild(decorElem);

        // Positioning and Animation
        let leftBase = 0;
        if (isLandscape) {
          // In landscape, avoid the far right (80% width)
          leftBase = (i + 0.3) * (80 / decorCount);
        } else {
          // In portrait, use full width
          leftBase = (i + 0.5) * (100 / decorCount);
        }
        const randomOffset = (Math.random() - 0.5) * 8;
        containerElem.style.left = `${leftBase + randomOffset}%`;

        // Reset top as they hang from the container top
        containerElem.style.top = `0`;

        const duration = 5 + Math.random() * 3;
        const delay = Math.random() * -duration;
        containerElem.style.animationDuration = `${duration}s`;
        containerElem.style.animationDelay = `${delay}s`;

        container.appendChild(containerElem);
      }
    }
  }

  // ========== NOTIFICATION SYSTEM ==========
  // ========== QR CODE CACHE AND GENERATOR ==========
  const QR_CACHE_KEY = "masjid_qr_cache";
  async function generateAndCacheQR(qrLink) {
    if (!qrLink || typeof qrLink !== 'string') return null;

    // Load cache
    let qrCache = {};
    try {
      qrCache = JSON.parse(localStorage.getItem(QR_CACHE_KEY) || "{}");
    } catch (e) { qrCache = {}; }

    const now = Date.now();
    const CACHE_DURATION = typeof APP_CONFIG !== 'undefined' && APP_CONFIG.qrCacheDuration ? APP_CONFIG.qrCacheDuration : 7 * 24 * 60 * 60 * 1000;

    // Check if we have a valid cached version
    if (qrCache[qrLink] && (now - qrCache[qrLink].timestamp < CACHE_DURATION)) {
      qrCache[qrLink].lastAccessed = now;
      localStorage.setItem(QR_CACHE_KEY, JSON.stringify(qrCache));
      return qrCache[qrLink].dataUrl;
    }

    // Generator using qrcode-generator
    return new Promise((resolve) => {
      try {
        if (typeof qrcode === 'undefined') {
          console.warn('QR code library not loaded.');
          return resolve(null);
        }

        // Use error correction level 'H' to allow logo overlay
        const qr = qrcode(0, 'H');
        qr.addData(qrLink);
        qr.make();

        // moduleCount gives the dimension of the QR. Scale it up.
        const cellSize = 10;
        const margin = 20;
        const size = qr.getModuleCount() * cellSize + margin * 2;

        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Draw background
        ctx.fillStyle = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.qrBackgroundColor) ? APP_CONFIG.qrBackgroundColor : '#CAF3DE';
        ctx.fillRect(0, 0, size, size);

        // Draw QR cells
        ctx.fillStyle = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.qrCodeColor) ? APP_CONFIG.qrCodeColor : '#036737';
        for (let row = 0; row < qr.getModuleCount(); row++) {
          for (let col = 0; col < qr.getModuleCount(); col++) {
            if (qr.isDark(row, col)) {
              ctx.fillRect(col * cellSize + margin, row * cellSize + margin, cellSize, cellSize);
            }
          }
        }

        const actualLogoName = typeof MASJID_DATA !== 'undefined' ? MASJID_DATA().masjidLogo : 'masjid-logo.png';
        const logoPath = `../images/logos/${actualLogoName}`;

        const logoImg = new Image();
        logoImg.onload = () => {
          // Logo size: 25% of QR code to ensure it's readable but QR is still scanable
          const logoSize = size * 0.25;
          const x = (size - logoSize) / 2;
          const y = (size - logoSize) / 2;

          // Draw background for logo (padding 10px)
          ctx.fillStyle = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.qrBackgroundColor) ? APP_CONFIG.qrBackgroundColor : '#CAF3DE';
          ctx.fillRect(x - 10, y - 10, logoSize + 20, logoSize + 20);

          // Draw logo
          ctx.drawImage(logoImg, x, y, logoSize, logoSize);

          try {
            saveToCacheAndResolve(canvas.toDataURL('image/png'));
          } catch (e) {
            console.warn("Canvas tainted. Returning without logo or generating raw QR", e);
            resolve(null);
          }
        };
        logoImg.onerror = () => {
          console.warn('Failed to load logo for QR code');
          try {
            saveToCacheAndResolve(canvas.toDataURL('image/png'));
          } catch (e) {
            resolve(null);
          }
        };
        logoImg.src = logoPath;

      } catch (e) {
        console.error('Failed to generate QR code', e);
        resolve(null);
      }

      function saveToCacheAndResolve(dataUrl) {
        qrCache[qrLink] = { dataUrl: dataUrl, timestamp: now, lastAccessed: now };

        // Eviction logic (keep max 20 items to prevent QuotaExceededError)
        const keys = Object.keys(qrCache);
        if (keys.length > 20) {
          keys.sort((a, b) => qrCache[b].lastAccessed - qrCache[a].lastAccessed); // Descending
          const newCache = {};
          for (let i = 0; i < 20; i++) {
            newCache[keys[i]] = qrCache[keys[i]];
          }
          qrCache = newCache;
        }

        try {
          localStorage.setItem(QR_CACHE_KEY, JSON.stringify(qrCache));
        } catch (e) {
          console.warn("localStorage quota exceeded for QR cache", e);
        }
        resolve(dataUrl);
      }
    });
  }
  let notifRotationInterval = null;
  let notifTransitionTimeout = null;
  let autoOpenTimeout = null; // Track auto-open timeout to prevent leaks
  let cachedNotifications = null;
  let notifFetchPromise = null;

  function loadNotifications() {
    if (cachedNotifications !== null) {
      renderNotifications(cachedNotifications);
      return;
    }

    if (notifFetchPromise) return;

    const CACHE_KEY = "masjid_notify_cache";
    const CACHE_TIME_KEY = "masjid_notify_cache_time";
    const PRIMARY_URL = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.notificationPath : "";
    const FALLBACK_URL = "../data/notifications.json";
    // Use shared cache duration from config.js if available
    const CACHE_DURATION = typeof APP_CONFIG !== 'undefined' && APP_CONFIG.cacheDurationWeb
      ? (isAndroidTV ? APP_CONFIG.cacheDurationTV : APP_CONFIG.cacheDurationWeb)
      : (isAndroidTV ? 2 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000);

    const now = Date.now();
    const lastFetchTime = parseInt(localStorage.getItem(CACHE_TIME_KEY) || "0", 10);
    const cachedDataStr = localStorage.getItem(CACHE_KEY);
    let expiredCacheValid = false;
    let parsedCache = null;

    if (cachedDataStr) {
      try {
        parsedCache = JSON.parse(cachedDataStr);
        if (Array.isArray(parsedCache)) {
          if (now - lastFetchTime < CACHE_DURATION) {
            cachedNotifications = parsedCache;
            renderNotifications(cachedNotifications);
            return;
          } else {
            expiredCacheValid = true;
          }
        }
      } catch (e) {
        parsedCache = null;
      }
    }

    if (typeof APP_CONFIG !== 'undefined' && !APP_CONFIG.alternativeNotificationsPath) {
      notifFetchPromise = fetch(FALLBACK_URL, { cache: 'no-store' })
        .then(function (response) { return response.json(); })
        .then(function (data) {
          cachedNotifications = data;
          renderNotifications(data);
        })
        .catch(function () { renderNotifications([]); });
      return;
    }

    if (!PRIMARY_URL) {
      notifFetchPromise = fetch(FALLBACK_URL, { cache: 'no-store' })
        .then(function (response) { return response.json(); })
        .then(function (data) {
          cachedNotifications = data;
          renderNotifications(data);
        })
        .catch(function () { renderNotifications([]); });
      return;
    }

    const fetchUrl = `${PRIMARY_URL}?_t=${now}`;

    notifFetchPromise = fetch(fetchUrl, { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!Array.isArray(data)) throw new Error('Invalid data format');
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(CACHE_TIME_KEY, now.toString());
        cachedNotifications = data;
        renderNotifications(data);
      })
      .catch(function (err) {
        console.warn('Primary notifications load failed:', err);
        if (expiredCacheValid && parsedCache) {
          console.log('Using expired cached notifications');
          cachedNotifications = parsedCache;
          renderNotifications(parsedCache);
          return;
        }

        console.log('Falling back to local notifications');
        return fetch(FALLBACK_URL, { cache: 'no-store' })
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then(function (localData) {
            if (!Array.isArray(localData)) {
              cachedNotifications = [];
            } else {
              cachedNotifications = localData;
            }
            renderNotifications(cachedNotifications);
          })
          .catch(function (fallbackErr) {
            console.warn('Fallback notifications load failed:', fallbackErr);
            cachedNotifications = [];
            renderNotifications([]);
          });
      })
      .finally(function () {
        notifFetchPromise = null;
      });
  }

  async function renderNotifications(data) {
    const headerEl = document.getElementById('prayer-header');
    if (!headerEl) return;

    // Clear existing rotation interval to prevent leaks
    if (notifRotationInterval) {
      clearTimeout(notifRotationInterval);
      notifRotationInterval = null;
    }
    if (notifTransitionTimeout) {
      clearTimeout(notifTransitionTimeout);
      notifTransitionTimeout = null;
    }
    if (autoOpenTimeout) {
      clearTimeout(autoOpenTimeout);
      autoOpenTimeout = null;
    }

    // Cleanup stale messages from read notifications
    var storedReadNotifsStr = localStorage.getItem('masjid_read_notifications');
    var readNotifs = [];
    try {
      if (storedReadNotifsStr) readNotifs = JSON.parse(storedReadNotifsStr);
      if (!Array.isArray(readNotifs)) readNotifs = [];
    } catch (e) { readNotifs = []; }

    if (readNotifs.length > 0 && Array.isArray(data)) {
      var allDataHashes = data.map(function (item) {
        if (!item || !item.message || !item.startDate || !item.endDate) return '';
        return (item.message + '|' + item.startDate + '|' + item.endDate).replace(/\s+/g, '');
      }).filter(Boolean);

      var initialLen = readNotifs.length;
      var cleanReadNotifs = readNotifs.filter(function (hash) { return allDataHashes.indexOf(hash) !== -1; });
      if (cleanReadNotifs.length !== initialLen) {
        localStorage.setItem('masjid_read_notifications', JSON.stringify(cleanReadNotifs));
        readNotifs = cleanReadNotifs;
      }
    }

    // Filter messages valid for today's date
    var now = new Date();
    var todayStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');

    var validMessages = [];
    var DEFAULT_DURATION = 30; // seconds
    for (var i = 0; i < data.length; i++) {
      var item = data[i];
      // Validate structure
      if (!item || typeof item.message !== 'string' ||
        typeof item.startDate !== 'string' ||
        typeof item.endDate !== 'string') continue;
      // Validate date format (YYYY-MM-DD)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.endDate)) continue;
      // Check date range
      if (todayStr >= item.startDate && todayStr <= item.endDate) {

        // Check tv-only constraint (must be Android TV and in landscape mode)
        if (item['tv-only'] && (!isAndroidTV || window.innerHeight >= window.innerWidth)) {
          continue;
        }

        var dur = (typeof item.duration === 'number' && isFinite(item.duration))
          ? Math.min(300, Math.max(5, item.duration))
          : DEFAULT_DURATION;
        var fSize = (typeof item.fontSize === 'number' && [1, 2, 3].includes(item.fontSize)) ? item.fontSize : 2;
        var msgObj = { text: item.message, duration: dur, important: !!item.important, fontSize: fSize, image: item.image || null, qrLink: item.qrLink || null, hideInPortrait: !!item['hide-in-portrait'], startDate: item.startDate, endDate: item.endDate };
        if (item.qrLink) {
          var qrImage = await generateAndCacheQR(item.qrLink);
          if (qrImage) {
            msgObj.image = qrImage;
          }
        }
        validMessages.push(msgObj);
      }
    }

    // Shared utility: only accept image URLs whose scheme is safe (http, https,
    // protocol-relative or root-relative paths, or data:image/*). Returns null if unsafe.
    function safeImageSrc(raw) {
      if (!raw || typeof raw !== 'string') return null;
      var url = raw.trim();
      if (url === '') return null;
      var lower = url.toLowerCase();
      if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return null;
      if (lower.startsWith('data:') && !lower.startsWith('data:image/')) return null;
      var schemeOk = lower.startsWith('http://') || lower.startsWith('https://') ||
        lower.startsWith('//') || lower.startsWith('/') || lower.startsWith('./') ||
        lower.startsWith('../') || lower.startsWith('data:image/');
      // Allow bare relative paths like "images/foo.png"
      if (!schemeOk && !/^[a-z0-9._\-]+(?:\/|$)/i.test(url)) return null;
      return url;
    }

    // Shared utility: escape HTML (incl. quotes) and linkify URLs.
    // SECURITY: All 5 HTML entities are escaped so that URLs can never break out
    // of the href="..." attribute. The URL char class also rejects raw quotes for
    // defense in depth.
    function formatMsg(text) {
      if (!text) return "";
      var escaped = String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      return escaped.replace(/(https?:\/\/|www\.)?([\w-]+\.[\w]{2,})(\/[^\s<>"']*)?/gi, function (match, protocol) {
        var url = protocol ? match : 'https://' + match;
        // The matched URL is already in HTML-escaped form (no raw <, >, ", '),
        // so it is safe to interpolate inside the href attribute.
        return '<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">' + match + '</a>';
      });
    }

    // Remove existing landscape container if no valid messages
    var existing = document.getElementById('notifications-container');
    var container = null;

    if (validMessages.length === 0) {
      if (existing) existing.remove();
      // Do not return here so we can create/update the empty bell icon
    } else {
      // Build landscape container if it doesn't exist
      container = existing;
      if (!container) {
        container = document.createElement('div');
        container.className = 'notifications-container';
        container.id = 'notifications-container';

        var starRight = document.createElement('div');
        starRight.className = 'notif-star-right';
        container.appendChild(starRight);

        var imgEl = document.createElement('img');
        imgEl.className = 'notif-image';
        imgEl.id = 'notif-image';
        imgEl.style.display = 'none';
        container.appendChild(imgEl);

        var iconEl = document.createElement('i');
        iconEl.className = 'mdi mdi-bell-outline notif-icon';
        container.appendChild(iconEl);

        var textEl = document.createElement('span');
        textEl.className = 'notif-text';
        textEl.id = 'notif-text';
        container.appendChild(textEl);

        headerEl.appendChild(container);
      }
    }

    // Auto-fit function to handle large text on constrained TV screens
    function autoFitText() {
      var t = document.getElementById('notif-text');
      var c = document.getElementById('notifications-container');
      if (!t || !c) return;

      var star = c.querySelector('.notif-star-right');

      t.style.fontSize = '';
      requestAnimationFrame(function () {
        if (star) star.style.display = 'none';

        var currentSize = parseFloat(window.getComputedStyle(t).fontSize);
        if (isNaN(currentSize)) {
          if (star) star.style.display = '';
          return;
        }
        var loops = 0;
        // Check for scrollHeight exceeding clientHeight. Added +1 margin for subpixel precision
        while (
          (t.scrollHeight > Math.ceil(t.clientHeight) + 1 ||
            c.scrollHeight > Math.ceil(c.clientHeight) + 1) &&
          currentSize > 12 &&
          loops < 30
        ) {
          currentSize -= 1;
          t.style.fontSize = currentSize + 'px';
          loops++;
        }

        if (star) star.style.display = '';
      });
    }

    // ---- Portrait Mode FAB & Modal ----
    var fabExisting = document.getElementById('notif-fab-button');
    if (!fabExisting) {
      var fabBtn = document.createElement('div');
      fabBtn.id = 'notif-fab-button';
      document.body.appendChild(fabBtn);

      var modalOverlay = document.createElement('div');
      modalOverlay.id = 'notif-modal-overlay';
      modalOverlay.className = 'notif-modal-overlay';

      var modalContent = document.createElement('div');
      modalContent.className = 'notif-modal-content';

      var modalHeader = document.createElement('div');
      modalHeader.className = 'notif-modal-header';
      modalHeader.innerHTML = '<div class="notif-modal-title"><i class="mdi mdi-bell-outline"></i> Announcements</div>' +
        '<button class="notif-modal-close" id="notif-modal-close"><i class="mdi mdi-close-circle-outline"></i></button>';

      var modalList = document.createElement('div');
      modalList.className = 'notif-modal-list';
      modalList.id = 'notif-modal-list';

      modalContent.appendChild(modalHeader);
      modalContent.appendChild(modalList);
      modalOverlay.appendChild(modalContent);
      document.body.appendChild(modalOverlay);

      fabBtn.addEventListener('click', function () {
        var list = document.getElementById('notif-modal-list');
        if (list && list.children.length > 0) {
          // Show all messages when manually clicked
          var cards = list.querySelectorAll('.notif-modal-card');
          for (var i = 0; i < cards.length; i++) cards[i].style.display = '';
          modalOverlay.classList.add('open');
        }
      });
      document.getElementById('notif-modal-close').addEventListener('click', function () {
        modalOverlay.classList.remove('open');
      });
      modalOverlay.addEventListener('click', function (e) {
        if (e.target === modalOverlay) modalOverlay.classList.remove('open');
      });
      fabExisting = fabBtn;
    }

    // Update FAB and Modal List Content
    var modalList = document.getElementById('notif-modal-list');
    if (modalList) {
      modalList.innerHTML = '';
      var hasImportant = false;
      var portraitCount = 0;

      var newlyDiscoveredNotifs = false;

      for (var k = 0; k < validMessages.length; k++) {
        var msg = validMessages[k];
        if (msg.hideInPortrait) continue;

        var msgHash = (msg.text + '|' + msg.startDate + '|' + msg.endDate).replace(/\s+/g, '');
        var isNewMsg = !readNotifs.includes(msgHash);

        if (isNewMsg) {
          newlyDiscoveredNotifs = true;
          readNotifs.push(msgHash);
        }

        portraitCount++;
        if (msg.important) hasImportant = true;
        var card = document.createElement('div');
        card.className = 'notif-modal-card' + (msg.important ? ' important' : '') + (isNewMsg ? ' notif-is-new' : ' notif-is-old');

        var iconOrImgHtml = '';
        var validatedImg = safeImageSrc(msg.image);
        if (validatedImg) {
          var safeImgUrl = String(validatedImg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
          if (msg.qrLink) {
            var safeQrLink = String(msg.qrLink).replace(/"/g, '&quot;');
            iconOrImgHtml = '<a href="' + safeQrLink + '" target="_blank" rel="noopener noreferrer"><img src="' + safeImgUrl + '" class="notif-modal-card-image" style="cursor:pointer;" /></a>';
          } else {
            iconOrImgHtml = '<img src="' + safeImgUrl + '" class="notif-modal-card-image" />';
          }
        } else if (!msg.image) {
          iconOrImgHtml = msg.important ? '<i class="mdi mdi-alert-decagram notif-modal-card-icon"></i>' : '';
        }

        card.innerHTML = '<div class="notif-modal-card-top">' + iconOrImgHtml + '<div class="notif-modal-card-text">' + formatMsg(msg.text) + '</div></div>';
        modalList.appendChild(card);
      }

      if (newlyDiscoveredNotifs) {
        localStorage.setItem('masjid_read_notifications', JSON.stringify(readNotifs));
      }

      if (portraitCount > 0) {
        fabExisting.className = 'notif-fab-button has-notif';
        fabExisting.innerHTML = '<i class="mdi mdi-bell-ring"></i>';
      } else {
        fabExisting.className = 'notif-fab-button';
        fabExisting.innerHTML = '<i class="mdi mdi-bell-outline"></i>';
      }

      var isPortraitDevice = (!isAndroidTV) && (window.innerHeight >= window.innerWidth);
      if (newlyDiscoveredNotifs && portraitCount > 0 && isPortraitDevice) {
        var cards = modalList.querySelectorAll('.notif-is-old');
        for (var i = 0; i < cards.length; i++) cards[i].style.display = 'none';

        autoOpenTimeout = setTimeout(function () {
          var modalOverlayObj = document.getElementById('notif-modal-overlay');
          if (modalOverlayObj) modalOverlayObj.classList.add('open');
          autoOpenTimeout = null;
        }, 500);
      }
    }

    if (validMessages.length === 0) return;

    // Set initial message
    var textEl = document.getElementById('notif-text');
    var notifIcon = container.querySelector('.notif-icon');
    var imgEl = document.getElementById('notif-image');

    if (textEl) {
      var initialMsg = validMessages[0];
      textEl.innerHTML = formatMsg(initialMsg.text);
      textEl.className = 'notif-text text-size-' + (initialMsg.fontSize || 2);

      var initialSafeImg = safeImageSrc(initialMsg.image);
      if (initialSafeImg) {
        if (imgEl) {
          imgEl.src = initialSafeImg;
          imgEl.style.display = 'block';
        }
        if (notifIcon) notifIcon.style.display = 'none';
      } else {
        if (imgEl) imgEl.style.display = 'none';
        // Only show icon if it's an important notification, hide for normal ones
        if (notifIcon) notifIcon.style.display = initialMsg.important ? 'block' : 'none';
      }

      if (initialMsg.important) {
        container.classList.add('important');
        if (notifIcon) notifIcon.className = 'mdi mdi-alert-decagram notif-icon';
      } else {
        container.classList.remove('important');
        if (notifIcon) notifIcon.className = 'mdi mdi-bell-outline notif-icon';
      }
      autoFitText();
    }

    // Rotate messages using chained setTimeout (supports per-message duration)
    if (validMessages.length > 1) {
      var currentIndex = 0;

      function triggerNextNotification(skipGap = false) {
        if (!textEl || !document.body.contains(textEl)) {
          if (notifRotationInterval) {
            clearTimeout(notifRotationInterval);
            notifRotationInterval = null;
          }
          return;
        }
        if (notifRotationInterval) clearTimeout(notifRotationInterval);
        if (notifTransitionTimeout) clearTimeout(notifTransitionTimeout);

        if (skipGap) {
          showNext();
          return;
        }

        if (imgEl) imgEl.classList.add('notif-fade-out');
        textEl.classList.add('notif-fade-out');
        container.style.transition = 'opacity 0.4s ease';
        container.style.opacity = '0';

        notifTransitionTimeout = setTimeout(function () {
          // Clear current content during gap
          textEl.innerHTML = "";
          if (imgEl) imgEl.style.display = 'none';
          if (notifIcon) notifIcon.style.display = 'none';
          container.classList.remove('important');

          var gapMs = (typeof APP_CONFIG.notificationGapDuration === 'number') ? APP_CONFIG.notificationGapDuration * 1000 : 5000;
          notifTransitionTimeout = setTimeout(showNext, gapMs);
        }, 400);

        function showNext() {
          currentIndex = (currentIndex + 1) % validMessages.length;
          var currentMsg = validMessages[currentIndex];
          textEl.innerHTML = formatMsg(currentMsg.text);

          textEl.classList.remove('text-size-1', 'text-size-2', 'text-size-3');
          textEl.classList.add('text-size-' + (currentMsg.fontSize || 2));

          var currentSafeImg = safeImageSrc(currentMsg.image);
          if (currentSafeImg) {
            if (imgEl) {
              imgEl.src = currentSafeImg;
              imgEl.style.display = 'block';
            }
            if (notifIcon) notifIcon.style.display = 'none';
          } else {
            if (imgEl) imgEl.style.display = 'none';
            if (notifIcon) notifIcon.style.display = currentMsg.important ? 'block' : 'none';
          }

          if (currentMsg.important) {
            container.classList.add('important');
            if (notifIcon) notifIcon.className = 'mdi mdi-alert-decagram notif-icon';
          } else {
            container.classList.remove('important');
            if (notifIcon) notifIcon.className = 'mdi mdi-bell-outline notif-icon';
          }

          autoFitText();
          container.style.opacity = '1';
          if (imgEl) imgEl.classList.remove('notif-fade-out');
          textEl.classList.remove('notif-fade-out');
          scheduleNextNotification();
        }
      }

      function scheduleNextNotification() {
        var currentDuration = validMessages[currentIndex].duration * 1000;
        notifRotationInterval = setTimeout(triggerNextNotification, currentDuration);
      }

      scheduleNextNotification();

      if (container) {
        container.style.cursor = 'pointer';
        container.onclick = function (e) {
          if (e.target.tagName && e.target.tagName.toLowerCase() === 'a') return;
          triggerNextNotification(true);
        };
      }
    }
  }

  // Schedule native prayer notifications (Capacitor / Android)
  // Sound is handled natively via notification channels — no JS audio needed.
  function schedulePrayerNotifications(scheduleMap, prayers) {
    if (typeof PrayerNotification === 'undefined') return;
    if (!PrayerNotification.isCapacitor) return;
    if (isAndroidTV) return;

    const azanSettingsRaw = localStorage.getItem('azanSettings');
    let azanSettings = {};
    try {
      azanSettings = azanSettingsRaw ? JSON.parse(azanSettingsRaw) : {};
    } catch (e) {
      console.error('Invalid azanSettings in localStorage:', e);
      return;
    }

    const toSchedule = [];
    prayers.forEach(function (p) {
      const key = p.key || p.name.toLowerCase();
      const config = azanSettings[key];
      if (!config || !config.enabled) return;

      const prayerTime = scheduleMap.get(p.name);
      if (!prayerTime) return;

      toSchedule.push({
        key: key,
        name: p.name,
        time: prayerTime,
        type: config.type  // 'azan', 'beep', or 'silent' — used to pick the right channel
      });
    });

    if (toSchedule.length > 0) {
      // Only cancel and reschedule if we have new notifications to schedule
      PrayerNotification.cancelAll().then(function () {
        return PrayerNotification.scheduleAll(toSchedule);
      }).catch(function (e) {
        console.warn('Failed to cancel/reschedule notifications:', e);
      });
    } else {
      // If no notifications to schedule, still ensure channels exist for future use
      PrayerNotification.ensureChannels().catch(function (e) {
        console.warn('Channel initialization failed:', e);
      });
    }
  }

  fetchTodayPrayers();

  // Initialize notification channels early for Capacitor to reduce scheduling delays
  if (typeof PrayerNotification !== 'undefined' && PrayerNotification.isCapacitor && !isAndroidTV && PrayerNotification.ensureChannels) {
    PrayerNotification.ensureChannels().catch(function (e) {
      console.warn('Early channel initialization failed:', e);
    });
  }

  let midnightRefreshTimeout = null;
  function refreshPrayersAtMidnight() {
    playedAzans = {};
    shownIqamahs = {};
    cachedNotifications = null; // Re-fetch notifications to re-evaluate date ranges
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const timeUntilMidnight = nextMidnight - now;
    // Clear any previous midnight timeout to prevent stacking
    if (midnightRefreshTimeout) clearTimeout(midnightRefreshTimeout);
    midnightRefreshTimeout = setTimeout(() => {
      fetchTodayPrayers();
      refreshPrayersAtMidnight();
    }, timeUntilMidnight);
  }
  refreshPrayersAtMidnight();

  let resizeTimeout;
  window.addEventListener("resize", () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      // Dynamic placement logic for weather stats on resize/rotation
      const stats = document.getElementById("weather-stats");
      if (stats) {
        const isPortrait = window.matchMedia("(orientation: portrait)").matches;
        const dateRow = document.querySelector(".header-date-row");
        const hMain = document.querySelector(".header-main");

        if (isPortrait && dateRow && stats.parentElement !== dateRow) {
          dateRow.prepend(stats); // Move to top of date row
        } else if (!isPortrait && hMain && stats.parentElement !== hMain) {
          const clock = document.getElementById("live-clock");
          hMain.insertBefore(stats, clock); // Move between logo and clock
        }
      }

      if (typeof checkAndAddRamadanDecorations === 'function') {
        checkAndAddRamadanDecorations();
      }
      loadNotifications();
    }, 200);
  });

  // Global exposure for console simulation
  window.simulateOverlay = {
    iqamah: function (prayerName, key) {
      const fsOverlay = document.getElementById("iqamah-fullscreen");
      const nameEl = document.getElementById("iqamah-fs-prayer-name");
      const arabicEl = document.getElementById("iqamah-fs-prayer-arabic");
      const arabicNames = { fajr: "الفجر", zuhr: "الظهر", asr: "العصر", maghrib: "المغرب", isha: "العشاء" };

      if (fsOverlay && nameEl) {
        nameEl.textContent = `Jama’ah for ${prayerName}`;
        if (arabicEl) arabicEl.textContent = `صلاة الجماعة - ${arabicNames[(key || "").toLowerCase()] || ""}`;

        if (iqamahFsTimeout) clearTimeout(iqamahFsTimeout);
        fsOverlay.classList.add("active");
        console.log(`Overlay opened for ${prayerName}. Click anywhere to dismiss.`);
      } else {
        console.warn("Iqamah overlay elements not found in the DOM.");
      }
    },
    jumuah: function (index) {
      const fsOverlay = document.getElementById("iqamah-fullscreen");
      const nameEl = document.getElementById("iqamah-fs-prayer-name");
      const arabicEl = document.getElementById("iqamah-fs-prayer-arabic");

      if (fsOverlay && nameEl) {
        nameEl.textContent = `Jumuah Khutbah ${index}`;
        if (arabicEl) arabicEl.textContent = `خطبة الجمعة ${index}`;

        if (iqamahFsTimeout) clearTimeout(iqamahFsTimeout);
        fsOverlay.classList.add("active");
        console.log(`Overlay opened for Jumuah ${index}.`);
      } else {
        console.warn("Iqamah overlay elements not found in the DOM.");
      }
    },
    close: function () {
      const fsOverlay = document.getElementById("iqamah-fullscreen");
      if (fsOverlay && fsOverlay.classList.contains("active")) {
        fsOverlay.classList.remove("active");
        if (iqamahFsTimeout) {
          clearTimeout(iqamahFsTimeout);
          iqamahFsTimeout = null;
        }
        console.log("Overlay closed.");
      }
    }
  };
});
