const compass = document.getElementById('compass');
const kaabaIcon = document.getElementById('kaaba');
const enableBtn = document.getElementById('enableCompass');
const statusDisplay = document.getElementById('status-display');
const instructionText = document.getElementById('instruction-text');

const KAABA_COORDS = { lat: 21.4225, lon: 39.8262 };
let QIBLA_DEGREE = 114.1;

let smoothedHeading = null;
let latestHeading = null;
let animFrameId = null;
let isAbsolute = false;
let isCompassRunning = false; // Guard against duplicate rAF loops from multiple startCompass() calls

function updateUIAngle(angle) {
    QIBLA_DEGREE = angle;
    document.querySelector('.degree-text').textContent = `Qiblah: ${angle.toFixed(1)}° ${getCardinal(angle)}`;

    // Update static rotation if compass not running
    if (latestHeading === null) {
        document.getElementById('needle-box').style.transform = `rotate(${angle}deg)`;
        document.getElementById('kaaba').style.transform = `rotate(${-angle}deg)`;
    }
}

function getCardinal(angle) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const i = Math.round(angle / 22.5) % 16;
    return directions[i];
}

function calculateQibla(lat, lon) {
    const φ1 = lat * Math.PI / 180;
    const λ1 = lon * Math.PI / 180;
    const φ2 = KAABA_COORDS.lat * Math.PI / 180;
    const λ2 = KAABA_COORDS.lon * Math.PI / 180;

    const Δλ = λ2 - λ1;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
}

function normalize(angle) {
    return ((angle % 360) + 360) % 360;
}

function shortestDelta(from, to) {
    let diff = normalize(to) - normalize(from);
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return diff;
}

function handleOrientation(event) {
    if (event.webkitCompassHeading !== undefined) {
        latestHeading = event.webkitCompassHeading;
        isAbsolute = true;
    } else if (isAbsolute && event.absolute !== true) {
        return;
    } else if (event.absolute === true) {
        isAbsolute = true;
    }

    if (event.alpha !== null && event.webkitCompassHeading === undefined) {
        latestHeading = 360 - event.alpha;
    }

    if (animFrameId === null && latestHeading !== null) {
        animFrameId = requestAnimationFrame(updateCompass);
    }
}



function updateCompass() {
    if (latestHeading === null) {
        return;
    }

    if (smoothedHeading === null) {
        smoothedHeading = latestHeading;
    }

    const delta = shortestDelta(smoothedHeading, latestHeading);

    let smoothingStrength = 0.05;
    if (Math.abs(delta) > 10) {
        smoothingStrength = 0.25;
    } else if (Math.abs(delta) < 0.5) {
        smoothingStrength = 0.01;
    }

    smoothedHeading = normalize(smoothedHeading + delta * smoothingStrength);

    compass.style.transform = `rotate(${-smoothedHeading}deg)`;
    kaabaIcon.style.transform = `rotate(${smoothedHeading - QIBLA_DEGREE}deg)`;

    statusDisplay.textContent = isAbsolute ? 'Live Compass: Active (Absolute)' : 'Live Compass: Active (Relative)';
    statusDisplay.style.color = 'var(--primary-green)';
    instructionText.textContent = 'Follow the gold needle to find the Qiblah.';

    animFrameId = requestAnimationFrame(updateCompass);
}

const useLocationBtn = document.getElementById('useMyLocation');
if (useLocationBtn) {
    useLocationBtn.addEventListener('click', () => {
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by your browser');
            return;
        }

        const statusText = document.querySelector('.location-text');
        const originalText = statusText.textContent;
        statusText.textContent = 'Locating...';
        useLocationBtn.disabled = true;

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                const newAngle = calculateQibla(lat, lon);

                updateUIAngle(newAngle);

                // Attempt to get a better name via IP Geolocation (since we have no reverse geocoder key)
                fetchIPLocation(true);

                // Build via DOM nodes to avoid any XSS via instructionText content.
                var noteEl = document.querySelector('.page-note');
                noteEl.textContent = 'Calculated for your ';
                var strong = document.createElement('strong');
                strong.textContent = 'Actual Location';
                noteEl.appendChild(strong);
                noteEl.appendChild(document.createTextNode('. '));
                var span = document.createElement('span');
                span.id = 'instruction-text';
                span.textContent = (instructionText && instructionText.textContent) || '';
                noteEl.appendChild(span);
                useLocationBtn.style.display = 'none';
            },
            (error) => {
                // Fallback to IP-only if GPS fails
                fetchIPLocation(false);
                useLocationBtn.disabled = false;
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    });
}

if (enableBtn) {
    enableBtn.addEventListener('click', async () => {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const response = await DeviceOrientationEvent.requestPermission();
                if (response === 'granted') {
                    startCompass();
                } else {
                    alert('Permission to access sensors was denied.');
                }
            } catch (e) {
                console.error('Permission error:', e);
            }
        } else {
            startCompass();
        }
    });
}

function startCompass() {
    if (isCompassRunning) return; // Guard: only start one listener loop
    isCompassRunning = true;
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation', handleOrientation, true);
    if (enableBtn) enableBtn.classList.remove('show');

    // Clean up when leaving page
    window.addEventListener('pagehide', () => {
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
        window.removeEventListener('deviceorientation', handleOrientation, true);
        isCompassRunning = false;
    });
}

// Initialize with default angle
updateUIAngle(QIBLA_DEGREE);

// Better fallback: IP-based Geolocation
async function fetchIPLocation(isGPSActive = false) {
    try {
        // Using geolocation-db.com as it typically has more relaxed CORS for public use
        const response = await fetch('https://geolocation-db.com/json/');
        if (!response.ok) return;
        const data = await response.json();

        const locationStr = `${data.city || ''}${data.city && data.country_name ? ', ' : ''}${data.country_name || ''}`;

        if (isGPSActive) {
            // Coordinates from GPS, Name from IP
            if (locationStr) {
                document.querySelector('.location-text').textContent = locationStr + ' (Estimated)';
            }
        } else {
            // Everything from IP
            if (locationStr) {
                document.querySelector('.location-text').textContent = locationStr + ' (Estimated Location)';
            } else {
                document.querySelector('.location-text').textContent = 'Current Area (Estimated)';
            }

            if (data.latitude && data.longitude) {
                const lat = parseFloat(data.latitude);
                const lon = parseFloat(data.longitude);
                const newAngle = calculateQibla(lat, lon);
                updateUIAngle(newAngle);
                // Build via DOM nodes to avoid any XSS via instructionText content.
                var noteEl2 = document.querySelector('.page-note');
                noteEl2.textContent = 'Note: Using ';
                var strong2 = document.createElement('strong');
                strong2.textContent = 'Estimated Location';
                noteEl2.appendChild(strong2);
                noteEl2.appendChild(document.createTextNode(' based on your IP. '));
                var span2 = document.createElement('span');
                span2.id = 'instruction-text';
                span2.textContent = (instructionText && instructionText.textContent) || '';
                noteEl2.appendChild(span2);
                if (useLocationBtn) useLocationBtn.style.display = 'none';
            }
        }
    } catch (e) {
        console.log('IP Location fallback failed or blocked by ad-blocker');
        if (!isGPSActive) {
            alert('Unable to retrieve your location.');
            document.querySelector('.location-text').textContent = 'Dublin City, Ireland';
        }
    }
}

// Auto-start or show enable button
if (window.DeviceOrientationEvent) {
    if (typeof DeviceOrientationEvent.requestPermission !== 'function') {
        // Start automatically for non-iOS browsers
        startCompass();
    } else {
        // Show button for iOS/Browsers that require explicit permission
        if (enableBtn) enableBtn.classList.add('show');
    }
}
