class CelestialSystem {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this._lastWeatherCode = null;
        this._settingsCache = { showCelestial: true, showWeatherAnimation: true, showWeatherStats: true };
        this._settingsCacheTime = 0;
        this._fetchingWeather = false;
        this._lastWeatherFetchAttempt = 0;
        this._themeOverride = false;
        this.initDOM();

        // Expose instance for debugging/manual testing
        window.celestial = this;
        try {
            if (window.parent && window.parent !== window) {
                window.parent.celestial = this;
            }
        } catch (e) {
            // Ignore cross-origin errors if they occur
        }

        // Initial fetch on page load — uses cache if still fresh
        this.fetchWeather(false);

        // Only bind these once per page lifecycle — stored on window to survive instance re-creation
        if (!window._celestialListenersAttached) {
            window._celestialListenersAttached = true;

            // 1. When the user returns to this tab after it was in the background,
            //    immediately check if the cache is stale and refresh if needed.
            document.addEventListener('visibilitychange', () => {
                const inst = window.celestial;
                if (!inst) return;
                if (document.visibilityState === 'visible' && !inst._fetchingWeather) {
                    const cachedTime = localStorage.getItem("masjid_weather_cache_time");
                    const age = cachedTime ? (Date.now() - parseInt(cachedTime)) : Infinity;
                    if (age > 30 * 60 * 1000) {
                        inst.fetchWeather(true);
                    } else {
                        // Cache is still fresh — just re-render from cache to ensure UI is current
                        try {
                            const w = JSON.parse(localStorage.getItem("masjid_weather_cache") || "");
                            if (w) inst.updateWeatherStats(w.temperature_2m, w.relative_humidity_2m, w.wind_speed_10m);
                        } catch (e) { }
                    }
                }
            });

            // 2. When another tab/window fetches fresh weather and updates localStorage,
            //    immediately update this tab's UI without waiting for its own fetch.
            window.addEventListener('storage', (e) => {
                const inst = window.celestial;
                if (!inst) return;
                if (e.key === 'masjid_weather_cache' && e.newValue) {
                    try {
                        const w = JSON.parse(e.newValue);
                        inst._lastWeatherCode = null; // force re-render
                        inst.applyWeather(w.weather_code);
                        inst.updateWeatherStats(w.temperature_2m, w.relative_humidity_2m, w.wind_speed_10m);
                    } catch (e) { }
                }
            });
        }
    }

    setSkyTheme(theme) {
        this._themeOverride = true;
        this.skyLayer.style.opacity = "1";
        const path = this.arcSvg.querySelector("path");

        if (theme === 'day') {
            this.skyLayer.style.background = "var(--sky-day)";
            document.body.classList.remove("night-mode", "twilight-mode");
            if (path) path.setAttribute("stroke-opacity", "0.2");
            console.log("Sky theme overridden to: DAY");
        } else if (theme === 'twilight') {
            this.skyLayer.style.background = "var(--sky-twilight)";
            document.body.classList.remove("night-mode");
            document.body.classList.add("twilight-mode");
            if (path) path.setAttribute("stroke-opacity", "0.15");
            console.log("Sky theme overridden to: TWILIGHT");
        } else if (theme === 'night') {
            this.skyLayer.style.background = "var(--sky-night)";
            document.body.classList.add("night-mode");
            document.body.classList.remove("twilight-mode");
            if (path) path.setAttribute("stroke-opacity", "0.05");
            console.log("Sky theme overridden to: NIGHT");
        } else if (theme === 'reset') {
            this._themeOverride = false;
            console.log("Sky theme override cleared. Resuming automatic updates.");
        }
    }

    initDOM() {
        if (!document.querySelector(".sky-layer")) {
            // Create sky layer
            this.skyLayer = document.createElement("div");
            this.skyLayer.className = "sky-layer";

            // Create celestial bodies container
            this.bodiesContainer = document.createElement("div");
            this.bodiesContainer.className = "celestial-bodies";

            // Arc
            this.arcSvg = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "svg",
            );
            this.arcSvg.setAttribute("class", "celestial-arc");
            this.arcSvg.setAttribute("viewBox", "0 0 100 100");
            this.arcSvg.setAttribute("preserveAspectRatio", "none");
            this.arcSvg.innerHTML =
                '<path d="M 90 95 A 40 80 0 0 0 10 95" stroke="var(--primary-gold)" stroke-opacity="0.15" stroke-width="0.3" fill="none" />';
            this.bodiesContainer.appendChild(this.arcSvg);

            // Sun
            this.sun = document.createElement("div");
            this.sun.className = "celestial-sun";

            // Moon
            this.moon = document.createElement("div");
            this.moon.className = "celestial-moon";

            this.bodiesContainer.appendChild(this.sun);
            this.bodiesContainer.appendChild(this.moon);

            // Building silhouette layer
            this.buildingLayer = document.createElement("div");
            this.buildingLayer.className = "building-layer";

            // Weather layer for rain/clouds/snow
            this.weatherContainer = document.createElement("div");
            this.weatherContainer.className = "weather-layer";

            // Append these exactly behind the main header content
            this.container.prepend(this.buildingLayer);
            this.container.prepend(this.weatherContainer);
            this.container.prepend(this.bodiesContainer);
            this.container.prepend(this.skyLayer);
        } else {
            this.skyLayer = document.querySelector(".sky-layer");
            this.bodiesContainer = document.querySelector(".celestial-bodies");
            this.sun = document.querySelector(".celestial-sun");
            this.moon = document.querySelector(".celestial-moon");
            this.buildingLayer = document.querySelector(".building-layer");
            this.weatherContainer = document.querySelector(".weather-layer");
        }
    }

    update(now, sunrise, sunset) {
        if (!sunrise || !sunset) return;

        // Throttle localStorage reads to every 5 seconds to reduce main-thread blocking
        const tickMs = Date.now();
        if (tickMs - this._settingsCacheTime > 5000) {
            this._settingsCache = {
                showCelestial: localStorage.getItem("showCelestial") !== "false",
                showWeatherAnimation: localStorage.getItem("showWeatherAnimation") !== "false",
                showWeatherStats: localStorage.getItem("showWeatherStats") !== "false"
            };
            this._settingsCacheTime = tickMs;

            // Check if weather cache is stale (>30 min). Driven by the clock's 1s tick
            // rather than setInterval, which is throttled by browsers in iframes/background tabs.
            if (!this._fetchingWeather) {
                const cachedTime = localStorage.getItem("masjid_weather_cache_time");
                const cacheAge = cachedTime ? (tickMs - parseInt(cachedTime)) : Infinity;
                if (cacheAge > 30 * 60 * 1000) {
                    this.fetchWeather(true);
                }
            }
        }
        const { showCelestial, showWeatherAnimation, showWeatherStats } = this._settingsCache;

        if (!showCelestial) {
            this.bodiesContainer.style.display = "none";
            this.skyLayer.style.display = "none";
            this.weatherContainer.style.display = "none";
            document.body.classList.remove("night-mode");
            document.body.classList.remove("twilight-mode");
        } else {
            this.bodiesContainer.style.display = "block";
            this.skyLayer.style.display = "block";
            this.weatherContainer.style.display = showWeatherAnimation ? "block" : "none";
        }

        const stats = document.getElementById('weather-stats');
        if (stats) {
            stats.style.display = showWeatherStats ? "flex" : "none";
        }

        if (!showCelestial) return;

        let isDay = false;
        let dayProgress = 0;
        let nightProgress = 0;

        const nowMs = now.getTime();
        const sunriseMs = sunrise.getTime();
        const sunsetMs = sunset.getTime();

        if (nowMs >= sunriseMs && nowMs <= sunsetMs) {
            isDay = true;
            dayProgress = (nowMs - sunriseMs) / (sunsetMs - sunriseMs);
            dayProgress = Math.max(0, Math.min(1, dayProgress));
        } else {
            isDay = false;

            if (nowMs < sunriseMs) {
                // Morning before sunrise
                let prevSunset = new Date(sunset);
                prevSunset.setDate(prevSunset.getDate() - 1);
                nightProgress =
                    (nowMs - prevSunset.getTime()) / (sunriseMs - prevSunset.getTime());
            } else {
                // Evening after sunset
                let nextSunrise = new Date(sunrise);
                nextSunrise.setDate(nextSunrise.getDate() + 1);
                nightProgress = (nowMs - sunsetMs) / (nextSunrise.getTime() - sunsetMs);
            }
            // Clamp and handle potential NaN from division by zero or invalid dates
            nightProgress = isFinite(nightProgress) ? Math.max(0, Math.min(1, nightProgress)) : 0;
        }

        this.updateSkyTheme(dayProgress, nightProgress, isDay);
        this.updateSunPosition(dayProgress, isDay);
        this.updateMoon(now, nightProgress, isDay);
    }

    updateSkyTheme(dayProgress, nightProgress, isDay) {
        if (this._themeOverride) return;
        if (isDay) {
            if (dayProgress < 0.1 || dayProgress > 0.9) {
                // Twilight/Golden hour
                this.skyLayer.style.background = "var(--sky-twilight)";
                this.skyLayer.style.opacity = "1";
                document.body.classList.remove("night-mode");
                document.body.classList.add("twilight-mode");
            } else {
                // Mid day
                this.skyLayer.style.background = "var(--sky-day)";
                this.skyLayer.style.opacity = "1";
                document.body.classList.remove("night-mode");
                document.body.classList.remove("twilight-mode");
                // Make arc more visible in day
                const path = this.arcSvg.querySelector("path");
                if (path) path.setAttribute("stroke-opacity", "0.2");
            }
        } else {
            // Night
            this.skyLayer.style.background = "var(--sky-night)";
            this.skyLayer.style.opacity = "1";
            document.body.classList.add("night-mode");
            document.body.classList.remove("twilight-mode");
            // Less visible at night
            const path = this.arcSvg.querySelector("path");
            if (path) path.setAttribute("stroke-opacity", "0.05");
        }
    }

    updateSunPosition(dayProgress, isDay) {
        if (isDay) {
            this.sun.style.opacity = "0.8";
            const angle = dayProgress * Math.PI;
            const x = 50 + 40 * Math.cos(angle);
            const y = 95 - 80 * Math.sin(angle);

            this.sun.style.left = `${x}%`;
            this.sun.style.top = `${y}%`;
        } else {
            this.sun.style.opacity = "0";
        }
    }

    updateMoon(now, nightProgress, isDay) {
        if (!isDay) {
            this.moon.style.opacity = "0.8";
            const angle = nightProgress * Math.PI;
            const x = 50 + 40 * Math.cos(angle);
            const y = 95 - 80 * Math.sin(angle);

            this.moon.style.left = `${x}%`;
            this.moon.style.top = `${y}%`;

            const phase = this.getMoonPhase(now);
            this.renderMoonPhase(phase);
        } else {
            this.moon.style.opacity = "0";
        }
    }

    getMoonPhase(date) {
        if (!date || isNaN(date.getTime())) return 0;
        const lp = 2551442.87690416; // 29.530588853 days in seconds
        const new_moon = new Date(1970, 0, 7, 20, 35, 0).getTime() / 1000;
        const phase = ((date.getTime() / 1000 - new_moon) % lp) / lp;
        // Ensure positive phase
        return phase < 0 ? phase + 1 : phase;
    }

    renderMoonPhase(phase) {
        let icon = "mdi-moon-new";
        if (phase < 0.03 || phase > 0.97) icon = "mdi-moon-new";
        else if (phase < 0.22) icon = "mdi-moon-waxing-crescent";
        else if (phase < 0.28) icon = "mdi-moon-first-quarter";
        else if (phase < 0.47) icon = "mdi-moon-waxing-gibbous";
        else if (phase < 0.53) icon = "mdi-moon-full";
        else if (phase < 0.72) icon = "mdi-moon-waning-gibbous";
        else if (phase < 0.78) icon = "mdi-moon-last-quarter";
        else icon = "mdi-moon-waning-crescent";

        // Use createElement to avoid any innerHTML injection risk
        const i = document.createElement('i');
        i.className = `mdi ${icon}`;
        this.moon.innerHTML = '';
        this.moon.appendChild(i);
    }

    async fetchWeather(forceRefresh = false) {
        const CACHE_KEY = "masjid_weather_cache";
        const CACHE_TIME_KEY = "masjid_weather_cache_time";
        const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

        const now = Date.now();
        const cachedData = localStorage.getItem(CACHE_KEY);
        const cachedTime = localStorage.getItem(CACHE_TIME_KEY);

        // On initial page load, serve from cache if still fresh
        if (!forceRefresh && cachedData && cachedTime && (now - parseInt(cachedTime)) < CACHE_DURATION) {
            try {
                const data = JSON.parse(cachedData);
                this.applyWeather(data.weather_code);
                this.updateWeatherStats(data.temperature_2m, data.relative_humidity_2m, data.wind_speed_10m);
                return;
            } catch (e) {
                console.error("Failed to parse cached weather data:", e);
            }
        }

        // Guard against concurrent fetches and too-frequent retry attempts (e.g. from failed requests when cache is stale)
        // Fixed: now waits at least 5 minutes between attempts to avoid hitting rate limits when the API is down
        if (this._fetchingWeather || (now - this._lastWeatherFetchAttempt < 5 * 60 * 1000)) {
            if (forceRefresh && cachedData) {
                try {
                    const data = JSON.parse(cachedData);
                    this.applyWeather(data.weather_code);
                    this.updateWeatherStats(data.temperature_2m, data.relative_humidity_2m, data.wind_speed_10m);
                } catch (e) {
                    // Ignore parse errors
                }
            }
            return;
        }
        this._lastWeatherFetchAttempt = now;
        this._fetchingWeather = true;
        try {
            // Use config from global or parent scope to avoid hardcoded coordinates
            const config = (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : null) ||
                (function () { try { return window.parent.APP_CONFIG; } catch (e) { return null; } })();

            const lat = config ? config.masjidLat : -33.8481338;
            const lon = config ? config.masjidLng : 150.7668252;
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&_t=${now}`);
            if (!res.ok) throw new Error("Weather API unreachable");

            const contentType = res.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                throw new Error("API returned non-JSON response");
            }

            const data = await res.json();
            const current = data.current;
            if (!current) throw new Error("Invalid weather data structure");

            // Store fresh data in cache
            localStorage.setItem(CACHE_KEY, JSON.stringify(current));
            localStorage.setItem(CACHE_TIME_KEY, now.toString());

            // Reset dedup so animation always re-renders after a forced refresh
            if (forceRefresh) this._lastWeatherCode = null;

            this.applyWeather(current.weather_code);
            this.updateWeatherStats(current.temperature_2m, current.relative_humidity_2m, current.wind_speed_10m);
        } catch (e) {
            console.error("Weather fetch failed:", e);
            // If fetch fails, use expired cache as fallback
            if (cachedData) {
                try {
                    const data = JSON.parse(cachedData);
                    this.applyWeather(data.weather_code);
                    this.updateWeatherStats(data.temperature_2m, data.relative_humidity_2m, data.wind_speed_10m);
                } catch (parseErr) { }
            }
        } finally {
            this._fetchingWeather = false;
        }
    }

    updateWeatherStats(temp, humidity, wind) {
        if (!this.container) return;

        let stats = document.getElementById('weather-stats');
        if (!stats) {
            stats = document.createElement('div');
            stats.id = 'weather-stats';
            stats.className = 'weather-stats';
            this.container.appendChild(stats);
        }

        // Guard: only render if values are valid numbers (API fields may be missing/renamed)
        if (!isFinite(temp) || !isFinite(humidity) || !isFinite(wind)) return;

        const tempRounded = Math.round(temp);
        const windRounded = Math.round(wind);
        const humRounded = Math.round(humidity);

        // Use textContent for data nodes to eliminate any injection surface
        stats.innerHTML = '';
        const items = [
            { icon: 'mdi-thermometer', text: `${tempRounded}\u00b0C` },
            { icon: 'mdi-water-percent', text: `${humRounded}%` },
            { icon: 'mdi-weather-windy', text: `${windRounded}km/h` }
        ];
        items.forEach(({ icon, text }) => {
            const div = document.createElement('div');
            div.className = 'stat-item';
            const i = document.createElement('i');
            i.className = `mdi ${icon}`;
            div.appendChild(i);
            div.appendChild(document.createTextNode(` ${text}`));
            stats.appendChild(div);
        });
    }

    applyWeather(code) {
        if (!this.weatherContainer || !this.skyLayer) return;

        // Skip DOM rebuild if weather code hasn't changed
        if (code === this._lastWeatherCode) return;
        this._lastWeatherCode = code;

        // Hide first so the browser compositor can release animation layers before clearing
        this.weatherContainer.style.display = 'none';
        this.skyLayer.classList.remove('weather-cloudy', 'weather-rain', 'weather-snow');
        this.weatherContainer.innerHTML = '';

        // Check if weather animation is disabled or celestial system is disabled
        if (localStorage.getItem("showWeatherAnimation") === "false" || localStorage.getItem("showCelestial") === "false") {
            return;
        }

        if ([1, 2, 3, 45, 48].includes(code)) {
            this.skyLayer.classList.add('weather-cloudy');
            this.createClouds();
        } else if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
            this.skyLayer.classList.add('weather-rain');
            this.createRain();
        } else if ([71, 73, 75, 77, 85, 86].includes(code)) {
            this.skyLayer.classList.add('weather-snow');
            this.createSnow();
        } else if ([95, 96, 99].includes(code)) {
            this.skyLayer.classList.add('weather-rain');
            this.createRain();
            this.createLightning();
        }
    }

    createClouds() {
        for (let i = 0; i < 6; i++) {
            const cloud = document.createElement('div');
            cloud.className = 'weather-cloud';
            cloud.style.top = `${Math.random() * 40}%`;
            cloud.style.left = `${Math.random() * 100}%`;
            cloud.style.animationDuration = `${40 + Math.random() * 60}s`;
            cloud.style.animationDelay = `-${Math.random() * 40}s`;
            // Simple SVG Cloud
            cloud.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.5,17.5L6.5,17.5C4.57,17.5 3,15.93 3,14C3,12.23 4.31,10.77 6.03,10.55C6.54,8.5 8.35,7 10.5,7C12.87,7 14.86,8.65 15.35,10.85C15.55,10.71 15.77,10.61 16,10.53C16.89,10.21 17.92,10.35 18.66,10.97C19.46,11.66 19.81,12.7 19.64,13.72C19.47,14.77 18.65,15.65 17.6,15.91C17.27,15.97 16.94,16 16.61,16H16.5C16.5,16.83 15.83,17.5 15,17.5H6.5Z" /></svg>';
            this.weatherContainer.appendChild(cloud);
        }
    }

    createRain() {
        for (let i = 0; i < 40; i++) {
            const drop = document.createElement('div');
            drop.className = 'weather-drop';
            drop.style.left = `${Math.random() * 100}%`;
            drop.style.animationDuration = `${0.6 + Math.random() * 0.4}s`;
            drop.style.animationDelay = `${Math.random() * 2}s`;
            this.weatherContainer.appendChild(drop);
        }
    }

    createSnow() {
        for (let i = 0; i < 50; i++) {
            const flake = document.createElement('div');
            flake.className = 'weather-flake';
            flake.style.left = `${Math.random() * 100}%`;
            flake.style.animationDuration = `${4 + Math.random() * 6}s`;
            flake.style.animationDelay = `${Math.random() * 5}s`;
            flake.innerHTML = '&#10052;'; // Snowflake
            this.weatherContainer.appendChild(flake);
        }
    }

    createLightning() {
        const lightning = document.createElement('div');
        lightning.className = 'weather-lightning';
        this.weatherContainer.appendChild(lightning);
    }
}
window.CelestialSystem = CelestialSystem;
