/**
 * Quran Radio Logic
 * Fetches radio channels from JSON and interacts with GlobalRadio in the parent window.
 */

const radioList = document.getElementById('radio-list');
let stations = [];

/**
 * Sanitize a string for safe HTML insertion (incl. attribute context).
 * Escapes all 5 HTML entities so values are safe inside attributes too.
 */
function escapeHTML(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Update UI for a specific radio card
 */
function updateCardUI(index, isActive, isPlaying) {
    const card = document.getElementById('radio-' + index);
    if (!card) return;
    const btnIcon = card.querySelector('.play-btn i');

    if (isActive) {
        card.classList.add('active');
    } else {
        card.classList.remove('active', 'is-playing');
    }

    if (isPlaying) {
        card.classList.add('is-playing');
        if (btnIcon) btnIcon.className = 'mdi mdi-pause';
    } else {
        card.classList.remove('is-playing');
        if (btnIcon) btnIcon.className = 'mdi mdi-play';
    }
}

/**
 * Sync all card visuals with the current GlobalRadio state
 */
function syncWithGlobalState() {
    if (!window.parent || !window.parent.GlobalRadio) return;

    const gr = window.parent.GlobalRadio;
    const index = gr.currentStationIndex;
    const isPlaying = gr.audio && !gr.audio.paused && gr.audio.src;

    stations.forEach(function(_, i) { updateCardUI(i, false, false); });
    if (index !== -1) {
        updateCardUI(index, true, !!isPlaying);
    }
}

/**
 * Handle card click via event delegation
 */
function handleCardClick(e) {
    const card = e.target.closest('.radio-card');
    if (!card) return;

    const index = parseInt(card.id.replace('radio-', ''), 10);
    if (isNaN(index) || !stations[index]) return;

    if (window.parent && window.parent.GlobalRadio) {
        var station = stations[index];
        var stationForParent = {
            name: station.name,
            location: station.location,
            url: station.url,
            logo: station.logo.replace('../icons/', 'assets/icons/')
        };
        window.parent.GlobalRadio.playStation(index, stationForParent);
    }
}

/**
 * Render station list into the DOM
 */
function renderStations() {
    if (!stations.length) {
        radioList.innerHTML = '<p style="text-align:center; padding: 20px;">No stations found.</p>';
        return;
    }

    radioList.innerHTML = stations.map(function(station, index) {
        var safeName = escapeHTML(station.name);
        var safeLocation = escapeHTML(station.location);
        var safeLogo = escapeHTML(station.logo);

        return '<div class="radio-card" id="radio-' + index + '">' +
            '<div class="radio-info">' +
                '<div class="radio-icon-wrapper">' +
                    '<img src="' + safeLogo + '" class="radio-logo" alt="' + safeName + '" onerror="this.onerror=null;this.src=\'../icons/favicon.png\'">' +
                '</div>' +
                '<div class="radio-details">' +
                    '<span class="radio-name">' + safeName + '</span>' +
                    '<span class="radio-location">' + safeLocation + '</span>' +
                    '<div class="playing-animation">' +
                        '<div class="bar"></div>' +
                        '<div class="bar"></div>' +
                        '<div class="bar"></div>' +
                        '<div class="bar"></div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<button class="play-btn" aria-label="Play ' + safeName + '">' +
                '<i class="mdi mdi-play"></i>' +
            '</button>' +
        '</div>';
    }).join('');

    syncWithGlobalState();
}

/**
 * Fetch radio stations from JSON file
 */
async function initRadio() {
    try {
        var response = await fetch('../data/radio-channels.json');
        if (!response.ok) throw new Error('Failed to load radio data');
        stations = await response.json();
        renderStations();
    } catch (error) {
        console.error('Init error:', error);
        radioList.innerHTML = '<p style="text-align:center; padding: 20px; color: red;">Error loading radio channels.</p>';
    }
}

/**
 * Callback invoked by parent GlobalRadio to sync iframe UI
 */
window.handleGlobalRadioEvent = function(event) {
    if (event === 'close') {
        stations.forEach(function(_, i) { updateCardUI(i, false, false); });
    } else {
        syncWithGlobalState();
    }
};

// Delegated click listener
radioList.addEventListener('click', handleCardClick);

// Init
initRadio();
