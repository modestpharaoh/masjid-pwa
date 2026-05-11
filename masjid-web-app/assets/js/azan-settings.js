document.addEventListener("DOMContentLoaded", function () {
  const settingsList = document.getElementById("settings-list");
  const saveStatus = document.getElementById("save-status");

  const prayers = [
    { name: "Fajr", icon: "mdi-theme-light-dark" },
    { name: "Zuhr", icon: "mdi-white-balance-sunny" },
    { name: "Asr", icon: "mdi-weather-sunny" },
    { name: "Maghrib", icon: "mdi-weather-sunset-down" },
    { name: "Isha", icon: "mdi-weather-night" },
  ];
  const validNotificationTypes = ["azan", "beep", "silent"];

  // Platform check - Specifically targeting Android TV for defaults
  const ua = navigator.userAgent.toLowerCase();
  const isAndroidTV = ua.includes('masjid-tv') || (
    (window.Capacitor && window.Capacitor.getPlatform() === 'android') && (
      ua.includes('tv') ||
      ua.includes('leanback') ||
      ua.includes('largescreen') ||
      !ua.includes('mobile')
    )
  );

  // Default settings
  const defaultSettings = {};
  prayers.forEach((p) => {
    // Default to Beep enabled on Android TV, disabled Azan on others
    if (isAndroidTV) {
      defaultSettings[p.name.toLowerCase()] = { enabled: true, type: "beep" };
    } else {
      defaultSettings[p.name.toLowerCase()] = { enabled: false, type: "azan" };
    }
  });

  // Load settings from localStorage
  const storedSettings = localStorage.getItem("azanSettings");
  let settings = defaultSettings;
  try { if (storedSettings) settings = JSON.parse(storedSettings); } catch (e) { settings = defaultSettings; }

  // Persist defaults on first run for Android TV
  if (isAndroidTV && storedSettings === null) {
    localStorage.setItem("azanSettings", JSON.stringify(defaultSettings));
  }

  // Ensure all prayers exist in settings (in case new ones were added)
  prayers.forEach((p) => {
    if (!settings[p.name.toLowerCase()]) {
      settings[p.name.toLowerCase()] = { enabled: false, type: "azan" };
      return;
    }

    if (!validNotificationTypes.includes(settings[p.name.toLowerCase()].type)) {
      settings[p.name.toLowerCase()].type = "azan";
    }
  });

  function showSaveStatus() {
    saveStatus.classList.add("show");
    setTimeout(() => {
      saveStatus.classList.remove("show");
    }, 2000);
  }

  function saveSettings() {
    localStorage.setItem("azanSettings", JSON.stringify(settings));
    showSaveStatus();
  }

  let sharedAudioCtx = null;
  function getAudioContext() {
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return sharedAudioCtx;
  }

  let currentAudio = null;
  let currentOscillator = null;
  let currentGainNode = null;
  let currentTestButton = null;

  function stopCurrentTest() {
    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    if (currentOscillator) {
      try {
        currentOscillator.onended = null;
        currentOscillator.stop();
      } catch (e) { }
      currentOscillator = null;
    }
    if (currentGainNode) {
      try {
        currentGainNode.disconnect();
      } catch (e) { }
      currentGainNode = null;
    }
    if (currentTestButton) {
      currentTestButton.textContent = "Test";
      currentTestButton.classList.remove("stop-btn");
      currentTestButton = null;
    }
  }

  // Release AudioContext and stop playing audio on page unload
  window.addEventListener('pagehide', function () {
    stopCurrentTest();
    if (sharedAudioCtx && sharedAudioCtx.state !== 'closed') {
      sharedAudioCtx.close().catch(function () { });
      sharedAudioCtx = null;
    }
  });

  function playBeep(btn) {
    stopCurrentTest();
    const audioCtx = getAudioContext();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = "sine";
    // C5 note, very pleasant and soft
    oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime);

    // Smooth envelope to prevent "clicking" noise and sound like a soft ping
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);

    currentOscillator = oscillator;
    currentGainNode = gainNode;
    currentTestButton = btn;
    btn.textContent = "Stop";
    btn.classList.add("stop-btn");

    oscillator.start();
    oscillator.onended = () => {
      if (currentTestButton === btn) {
        btn.textContent = "Test";
        btn.classList.remove("stop-btn");
        currentTestButton = null;
        currentOscillator = null;
      }
    };

    setTimeout(() => {
      try {
        oscillator.stop();
      } catch (e) { }
    }, 500);
  }

  function playAzan(prayerName, btn) {
    stopCurrentTest();
    const fileName =
      prayerName.toLowerCase() === "fajr"
        ? "fajr-mashari.mp3"
        : "azan-makka.mp3";
    const audio = new Audio(`../media/${fileName}`);
    currentAudio = audio;
    currentTestButton = btn;
    btn.textContent = "Stop";
    btn.classList.add("stop-btn");

    audio.play().catch((e) => {
      console.error("Autoplay blocked or file missing", e);
      stopCurrentTest();
      alert(
        "Could not play audio. Please ensure you have interacted with the page once and the file exists.",
      );
    });

    audio.onended = () => {
      stopCurrentTest();
    };

    audio.onerror = () => {
      stopCurrentTest();
    };
  }

  function renderSettings() {
    settingsList.innerHTML = "";
    prayers.forEach((p) => {
      const key = p.name.toLowerCase();
      const config = settings[key];
      const azanLabel = p.name === "Fajr" ? "Fajr Azan" : "Makka Azan";

      const div = document.createElement("div");
      div.className = "prayer-setting";
      div.innerHTML = `
                <div class="prayer-info">
                    <i class="mdi ${p.icon} mdi-24px" style="color: var(--primary-green)"></i>
                    <span class="prayer-name">${p.name}</span>
                </div>
                <div class="controls">
                    <select id="type-${key}">
                        <option value="azan" ${config.type === "azan" ? "selected" : ""}>${azanLabel}</option>
                        <option value="beep" ${config.type === "beep" ? "selected" : ""}>Beep</option>
                        <option value="silent" ${config.type === "silent" ? "selected" : ""}>Silent</option>
                    </select>
                    <button class="test-btn" id="test-${key}">Test</button>
                    <label class="switch">
                        <input type="checkbox" id="enable-${key}" ${config.enabled ? "checked" : ""}>
                        <span class="slider"></span>
                    </label>
                </div>
            `;

      settingsList.appendChild(div);

      // Add event listeners
      const enableToggle = div.querySelector(`#enable-${key}`);
      const typeSelect = div.querySelector(`#type-${key}`);
      const testBtn = div.querySelector(`#test-${key}`);

      function syncTestButtonState() {
        const isSilent = typeSelect.value === "silent";
        if (isSilent && currentTestButton === testBtn) {
          stopCurrentTest();
        }

        testBtn.disabled = isSilent;
        testBtn.textContent = isSilent ? "N/A" : "Test";
        testBtn.classList.toggle("stop-btn", false);
        testBtn.title = isSilent ? "Silent notifications do not play audio" : "";
      }

      syncTestButtonState();

      enableToggle.addEventListener("change", (e) => {
        // Always save the setting immediately — never block on permission
        settings[key].enabled = e.target.checked;
        saveSettings();

        // Android TV uses in-app JS audio flow (web-style), no native permission dependency.
        if (isAndroidTV) {
          updatePermissionStatus();
          return;
        }

        // Request notification permission in the background when enabling
        if (e.target.checked && typeof PrayerNotification !== 'undefined') {
          PrayerNotification.requestPermission().then(function (granted) {
            if (!granted) {
              // Show a non-blocking warning — but do NOT revert the toggle.
              // The setting is saved so it will trigger audio when the app is open.
              // Native notifications simply won't fire if permission is denied.
              console.warn('Notification permission not granted for ' + key);
              updatePermissionStatus();
              return;
            }

            updatePermissionStatus();
          }).catch(function () {
            updatePermissionStatus();
          });
        } else {
          updatePermissionStatus();
        }
      });

      typeSelect.addEventListener("change", (e) => {
        settings[key].type = e.target.value;
        saveSettings();
        stopCurrentTest();
        syncTestButtonState();
      });

      testBtn.addEventListener("click", () => {
        if (typeSelect.value === "silent") {
          return;
        }

        if (currentTestButton === testBtn) {
          stopCurrentTest();
          return;
        }

        if (typeSelect.value === "azan") {
          playAzan(p.name, testBtn);
        } else {
          playBeep(testBtn);
        }
      });
    });
  }
  renderSettings();

  // Android TV remote navigation can fail inside iframes with custom controls.
  // Provide deterministic up/down traversal for focusable settings controls.
  function setupTvRemoteNavigation() {
    if (!isAndroidTV) return;

    function getFocusableControls() {
      const selector = [
        "button",
        "select",
        "input[type='checkbox']",
        "input[type='range']"
      ].join(",");

      return Array.from(document.querySelectorAll(selector)).filter((el) => {
        if (el.disabled) return false;
        if (el.closest("[aria-hidden='true']")) return false;
        if (el.offsetParent === null) return false;
        return true;
      });
    }

    function moveFocus(step) {
      const controls = getFocusableControls();
      if (controls.length === 0) return;

      const active = document.activeElement;
      let index = controls.indexOf(active);
      if (index === -1) {
        index = step > 0 ? -1 : 0;
      }

      const nextIndex = Math.min(Math.max(index + step, 0), controls.length - 1);
      const target = controls[nextIndex];
      if (!target) return;

      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveFocus(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveFocus(-1);
      }
    });

    // Ensure remote navigation starts from a valid control in this page.
    requestAnimationFrame(() => {
      const controls = getFocusableControls();
      if (controls.length > 0 && document.activeElement === document.body) {
        controls[0].focus({ preventScroll: true });
      }
    });
  }
  setupTvRemoteNavigation();

  // Notification Permission Status Indicator
  function updatePermissionStatus() {
    const statusEl = document.getElementById('notif-permission-status');
    if (!statusEl) return;

    if (isAndroidTV) {
      statusEl.innerHTML = '<i class="mdi mdi-television-classic"></i> Android TV uses in-app audio alerts while this page is open';
      statusEl.className = 'notif-permission-status granted';
      return;
    }

    if (typeof PrayerNotification === 'undefined') {
      statusEl.innerHTML = '<i class="mdi mdi-bell-off-outline"></i> Notifications not supported';
      statusEl.className = 'notif-permission-status denied';
      return;
    }

    // Show cached state immediately (prevents blank on Capacitor iframe timeout)
    const cached = localStorage.getItem('masjid_notif_permission_granted');
    if (cached === 'true') {
      statusEl.innerHTML = '<i class="mdi mdi-bell-check-outline"></i> Notifications enabled';
      statusEl.className = 'notif-permission-status granted';
    } else if (cached === 'false') {
      statusEl.innerHTML = '<i class="mdi mdi-bell-off-outline"></i> Notifications not enabled';
      statusEl.className = 'notif-permission-status denied';
    } else {
      statusEl.innerHTML = '<i class="mdi mdi-bell-outline"></i> Enable a prayer to set up notifications';
      statusEl.className = 'notif-permission-status denied';
    }

    // Then try to refresh from the live API (may timeout on Capacitor iframe)
    PrayerNotification.hasPermission().then(function (granted) {
      if (!granted) {
        statusEl.innerHTML = '<i class="mdi mdi-bell-off-outline"></i> Notifications not enabled';
        statusEl.className = 'notif-permission-status denied';
        return;
      }

      if (PrayerNotification.isCapacitor && PrayerNotification.hasExactAlarmPermission) {
        PrayerNotification.hasExactAlarmPermission().then(function (exactGranted) {
          if (exactGranted) {
            statusEl.innerHTML = '<i class="mdi mdi-bell-check-outline"></i> Notifications enabled';
            statusEl.className = 'notif-permission-status granted';
          } else {
            statusEl.innerHTML = '<i class="mdi mdi-timer-alert-outline"></i> Notifications enabled, but exact alarms are off and alerts may be delayed';
            statusEl.className = 'notif-permission-status denied';
          }
        }).catch(function () {
          statusEl.innerHTML = '<i class="mdi mdi-bell-check-outline"></i> Notifications enabled';
          statusEl.className = 'notif-permission-status granted';
        });
        return;
      }

      statusEl.innerHTML = '<i class="mdi mdi-bell-check-outline"></i> Notifications enabled';
      statusEl.className = 'notif-permission-status granted';
    }).catch(function () {
      // Keep cached state on error
    });
  }
  updatePermissionStatus();

  // Beep at Iqamah/Jumuah Toggle
  const beepEventToggle = document.getElementById("beep-event-toggle");
  const testBeepBtn = document.getElementById("test-beep-event");

  if (beepEventToggle) {
    const beepEventStored = localStorage.getItem("beepAtIqamahJumuah");
    if (beepEventStored === null) {
      beepEventToggle.checked = isAndroidTV;
      localStorage.setItem("beepAtIqamahJumuah", isAndroidTV);
    } else {
      beepEventToggle.checked = beepEventStored === "true";
    }

    beepEventToggle.addEventListener("change", (e) => {
      localStorage.setItem("beepAtIqamahJumuah", e.target.checked);
      showSaveStatus();
    });
  }

  if (testBeepBtn) {
    testBeepBtn.addEventListener("click", () => {
      if (currentTestButton === testBeepBtn) {
        stopCurrentTest();
        return;
      }
      playBeep(testBeepBtn);
    });
  }

  // Dark Mode Toggle
  const darkModeToggle = document.getElementById("dark-mode-toggle");
  if (darkModeToggle) {
    const darkModeStored = localStorage.getItem("darkMode");
    if (darkModeStored === null) {
      darkModeToggle.checked = isAndroidTV;
      localStorage.setItem("darkMode", isAndroidTV);
      if (isAndroidTV) document.documentElement.classList.add("dark-mode");
    } else {
      darkModeToggle.checked = darkModeStored === "true";
    }

    darkModeToggle.addEventListener("change", (e) => {
      window.toggleTheme(e.target.checked);
      showSaveStatus();
    });
  }

  // Celestial toggle setting
  const celestialToggle = document.getElementById("celestial-toggle");
  const weatherAnimationGroup = document.getElementById("weather-animation-setting-group");
  const weatherAnimationToggle = document.getElementById("weather-animation-toggle");
  const weatherStatsToggle = document.getElementById("weather-stats-toggle");

  if (celestialToggle && weatherAnimationToggle && weatherStatsToggle) {
    // Default to true if not set
    const showCelestialEnv = localStorage.getItem("showCelestial");
    const showWeatherAnimationEnv = localStorage.getItem("showWeatherAnimation");
    const showWeatherStatsEnv = localStorage.getItem("showWeatherStats");

    celestialToggle.checked = showCelestialEnv === null || showCelestialEnv === "true";
    weatherAnimationToggle.checked = showWeatherAnimationEnv === null || showWeatherAnimationEnv === "true";
    weatherStatsToggle.checked = showWeatherStatsEnv === null || showWeatherStatsEnv === "true";

    // Weather Animation is only available if Celestial is on
    const updateWeatherVisibility = () => {
      if (weatherAnimationGroup) {
        weatherAnimationGroup.style.display = celestialToggle.checked ? "flex" : "none";
      }
    };
    updateWeatherVisibility();

    celestialToggle.addEventListener("change", (e) => {
      localStorage.setItem("showCelestial", e.target.checked);
      updateWeatherVisibility();
      showSaveStatus();
    });

    weatherAnimationToggle.addEventListener("change", (e) => {
      localStorage.setItem("showWeatherAnimation", e.target.checked);
      showSaveStatus();
    });

    weatherStatsToggle.addEventListener("change", (e) => {
      localStorage.setItem("showWeatherStats", e.target.checked);
      showSaveStatus();
    });
  }

  // Seconds toggle setting
  const secondsToggle = document.getElementById("seconds-toggle");
  if (secondsToggle) {
    const showSecondsEnv = localStorage.getItem("showClockSeconds");
    // Default to true
    secondsToggle.checked = showSecondsEnv === null || showSecondsEnv === "true";

    secondsToggle.addEventListener("change", (e) => {
      localStorage.setItem("showClockSeconds", e.target.checked);
      showSaveStatus();
    });
  }

  // Full Screen Iqamah Settings
  const iqamahToggle = document.getElementById("iqamah-fullscreen-toggle");
  const iqamahRange = document.getElementById("iqamah-range");
  const iqamahVal = document.getElementById("iqamah-duration-val");

  if (iqamahToggle && iqamahRange && iqamahVal) {
    const showIqamahEnv = localStorage.getItem("showIqamahFullscreen");
    const durationEnv = localStorage.getItem("iqamahFullscreenDuration");

    // Default to true on Android TV if not set
    if (showIqamahEnv === null) {
      iqamahToggle.checked = isAndroidTV;
      localStorage.setItem("showIqamahFullscreen", isAndroidTV);
    } else {
      iqamahToggle.checked = showIqamahEnv === "true";
    }

    let iqDuration;
    if (durationEnv) {
      iqDuration = parseInt(durationEnv, 10);
    } else {
      iqDuration = isAndroidTV ? 300 : 120;
      localStorage.setItem("iqamahFullscreenDuration", iqDuration);
    }

    if (isNaN(iqDuration) || iqDuration < 15) iqDuration = 15;
    if (iqDuration > 600) iqDuration = 600;

    iqamahRange.value = iqDuration;
    iqamahVal.textContent = iqDuration;

    iqamahToggle.addEventListener("change", (e) => {
      localStorage.setItem("showIqamahFullscreen", e.target.checked);
      showSaveStatus();
    });

    iqamahRange.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      iqamahVal.textContent = val;
      localStorage.setItem("iqamahFullscreenDuration", val);
      showSaveStatus();
    });
  }

  // Full Screen Jumuah Settings
  const jumuahToggle = document.getElementById("jumuah-fullscreen-toggle");
  const jumuahRange = document.getElementById("jumuah-range");
  const jumuahVal = document.getElementById("jumuah-duration-val");

  if (jumuahToggle && jumuahRange && jumuahVal) {
    const showJumuahEnv = localStorage.getItem("showJumuahFullscreen");
    const durationEnv = localStorage.getItem("jumuahFullscreenDuration");

    // Default to true on Android TV if not set
    if (showJumuahEnv === null) {
      jumuahToggle.checked = isAndroidTV;
      localStorage.setItem("showJumuahFullscreen", isAndroidTV);
    } else {
      jumuahToggle.checked = showJumuahEnv === "true";
    }

    let juDuration;
    if (durationEnv) {
      juDuration = parseInt(durationEnv, 10);
    } else {
      juDuration = isAndroidTV ? 25 : 1;
      localStorage.setItem("jumuahFullscreenDuration", juDuration);
    }

    if (isNaN(juDuration) || juDuration < 1) juDuration = 1;
    if (juDuration > 35) juDuration = 35;

    jumuahRange.value = juDuration;
    jumuahVal.textContent = juDuration;

    jumuahToggle.addEventListener("change", (e) => {
      localStorage.setItem("showJumuahFullscreen", e.target.checked);
      showSaveStatus();
    });

    jumuahRange.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      jumuahVal.textContent = val;
      localStorage.setItem("jumuahFullscreenDuration", val);
      showSaveStatus();
    });
  }

  // Advanced Settings Actions
  const btnClearBasic = document.getElementById("btn-clear-basic");
  if (btnClearBasic) {
    btnClearBasic.addEventListener("click", () => {
      if (confirm("Are you sure you want to clear the basic cache? This will force a refresh of prayer times, events, and weather.")) {
        sessionStorage.clear();
        localStorage.removeItem("masjid_iqamah_settings_cache");
        localStorage.removeItem("masjid_iqamah_settings_cache_time");
        localStorage.removeItem("masjid_notify_cache");
        localStorage.removeItem("masjid_notify_cache_time");
        localStorage.removeItem("masjid_prayers_today");
        localStorage.removeItem("lastKnownJumuah");
        localStorage.removeItem("masjid_qr_cache");

        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith("masjid_prayer_times_year_") ||
            key.startsWith("masjid_posts_cache") ||
            key.startsWith("masjid_events_cache") ||
            key.startsWith("masjid_weather_cache"))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));

        alert("Basic cache cleared. The page will now reload.");
        window.location.reload();
      }
    });
  }

  const btnResetSettings = document.getElementById("btn-reset-settings");
  if (btnResetSettings) {
    btnResetSettings.addEventListener("click", () => {
      if (confirm("Are you sure you want to reset all settings? This will clear all your personal preferences and the basic cache. Quran data will not be affected.")) {
        localStorage.clear();
        sessionStorage.clear();
        alert("Settings reset. The page will now reload.");
        window.location.reload();
      }
    });
  }

  const btnFactoryReset = document.getElementById("btn-factory-reset");
  if (btnFactoryReset) {
    btnFactoryReset.addEventListener("click", () => {
      if (confirm("WARNING: This will completely factory reset the app. All storage, settings, offline data, and downloaded Quran media will be permanently deleted. Are you absolutely sure?")) {
        localStorage.clear();
        sessionStorage.clear();

        const clearCaches = ('caches' in window)
          ? caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
          : Promise.resolve();

        const unregisterSW = ('serviceWorker' in navigator)
          ? navigator.serviceWorker.getRegistrations().then(regs => Promise.all(regs.map(r => r.unregister())))
          : Promise.resolve();

        Promise.all([clearCaches, unregisterSW]).then(() => {
          alert("Factory reset complete. The page will now reload.");
          window.location.reload();
        }).catch(err => {
          console.error("Error during factory reset", err);
          alert("Factory reset finished with some errors. The page will now reload.");
          window.location.reload();
        });
      }
    });
  }
});
