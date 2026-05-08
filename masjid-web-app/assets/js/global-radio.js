/**
 * Global Radio Manager
 * Lives in index.html and persists audio playback across page navigations.
 */
window.GlobalRadio = {
    audio: null,
    playerBar: null,
    playerTitle: null,
    playerImg: null,
    playerStatus: null,
    mainPlayIcon: null,
    volumeSlider: null,
    volumeIcon: null,
    currentStationIndex: -1,
    previousVolume: 1,

    init: function() {
        this.audio = document.getElementById('global-radio-player');
        this.playerBar = document.getElementById('global-player-bar');
        this.playerTitle = document.getElementById('global-player-title');
        this.playerImg = document.getElementById('global-player-img');
        this.playerStatus = document.getElementById('global-player-status');
        this.mainPlayIcon = document.getElementById('global-main-play-icon');
        this.volumeSlider = document.getElementById('global-volume-slider');
        this.volumeIcon = document.getElementById('global-volume-icon');

        if (!this.audio || !this.playerBar) return;

        this.setupListeners();
    },

    setupListeners: function() {
        var self = this;

        this.audio.addEventListener('playing', function() {
            self.playerStatus.textContent = 'Playing';
            self.notifyIframe('playing');
        });

        this.audio.addEventListener('waiting', function() {
            self.playerStatus.textContent = 'Buffering...';
        });

        this.audio.addEventListener('error', function() {
            self.playerStatus.textContent = 'Error occurred';
            self.mainPlayIcon.className = 'mdi mdi-play';
            self.notifyIframe('error');
        });

        this.audio.addEventListener('pause', function() {
            self.notifyIframe('pause');
        });

        this.volumeSlider.addEventListener('input', function(e) {
            var vol = parseFloat(e.target.value);
            self.audio.volume = vol;
            self.updateVolumeIcon(vol);
        });
    },

    updateVolumeIcon: function(vol) {
        if (vol === 0) {
            this.volumeIcon.className = 'mdi mdi-volume-off volume-icon';
        } else if (vol < 0.5) {
            this.volumeIcon.className = 'mdi mdi-volume-medium volume-icon';
        } else {
            this.volumeIcon.className = 'mdi mdi-volume-high volume-icon';
        }
    },

    playStation: function(index, station) {
        if (this.currentStationIndex === index) {
            this.togglePlayback();
            return;
        }

        // Stop and reset current stream
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();

        this.currentStationIndex = index;

        // Update player bar UI (textContent is XSS-safe)
        this.playerTitle.textContent = station.name;
        this.playerImg.src = station.logo;
        this.playerBar.classList.add('visible');
        this.playerStatus.textContent = 'Loading...';
        this.mainPlayIcon.className = 'mdi mdi-pause';

        // Start playback
        var self = this;
        // Workaround for Android MediaPlayer: HTTP redirects from HTTPS are blocked.
        // We downgrade radiojar.com streams to HTTP initially when on Native.
        var streamUrl = station.url;
        if (window.Capacitor && window.Capacitor.isNativePlatform() && streamUrl.includes('radiojar.com')) {
            streamUrl = streamUrl.replace('https://', 'http://');
        }

        this.audio.src = streamUrl;
        this.audio.play().catch(function(e) {
            console.error('Playback failed:', e);
            self.playerStatus.textContent = 'Error - tap to retry';
            self.mainPlayIcon.className = 'mdi mdi-play';
        });

        this.notifyIframe('playing');
    },

    togglePlayback: function(e) {
        if (e) e.stopPropagation();
        if (this.currentStationIndex === -1) return;

        var self = this;
        if (this.audio.paused) {
            this.audio.play().catch(function(err) {
                console.error('Resume failed:', err);
                self.playerStatus.textContent = 'Error - tap to retry';
            });
            this.mainPlayIcon.className = 'mdi mdi-pause';
            this.playerStatus.textContent = 'Playing';
        } else {
            this.audio.pause();
            this.mainPlayIcon.className = 'mdi mdi-play';
            this.playerStatus.textContent = 'Paused';
        }
    },

    toggleMute: function() {
        if (this.audio.volume > 0) {
            this.previousVolume = this.audio.volume;
            this.audio.volume = 0;
            this.volumeSlider.value = 0;
            this.updateVolumeIcon(0);
        } else {
            this.audio.volume = this.previousVolume;
            this.volumeSlider.value = this.previousVolume;
            this.updateVolumeIcon(this.previousVolume);
        }
    },

    closeRadio: function() {
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
        this.playerBar.classList.remove('visible');
        this.currentStationIndex = -1;
        this.notifyIframe('close');
    },

    notifyIframe: function(event) {
        try {
            var iframe = document.getElementById('main-iframe');
            if (iframe && iframe.contentWindow && typeof iframe.contentWindow.handleGlobalRadioEvent === 'function') {
                iframe.contentWindow.handleGlobalRadioEvent(event);
            }
        } catch (e) {
            // Cross-origin iframe — silently ignore
        }
    }
};

window.addEventListener('DOMContentLoaded', function() {
    window.GlobalRadio.init();
});
