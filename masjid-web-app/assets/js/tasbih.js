(function () {
    let count = 0;
    let target = 33;
    let totalToday = parseInt(localStorage.getItem('masjid_tasbih_total_today')) || 0;
    let totalCycles = parseInt(localStorage.getItem('masjid_tasbih_total_cycles')) || 0;
    let vibrationEnabled = localStorage.getItem('masjid_tasbih_vibrate') !== 'false';

    const countDisplay = document.getElementById('main-count');
    const targetDisplay = document.getElementById('count-target-display');
    const tasbihBtn = document.getElementById('tasbih-btn');
    const resetBtn = document.getElementById('reset-btn');
    const vibrationBtn = document.getElementById('vibration-btn');
    const dhikrChips = document.querySelectorAll('.dhikr-chip');
    const progressCircle = document.getElementById('progress-indicator');
    const totalTodayDisplay = document.getElementById('total-today');
    const totalCyclesDisplay = document.getElementById('total-cycles');
    // Header Display
    const dhikrEnDisplay = document.getElementById('dhikr-en');
    const dhikrArDisplay = document.getElementById('dhikr-ar');

    function init() {
        countDisplay.textContent = count;
        targetDisplay.textContent = `Target: ${target}`;
        totalTodayDisplay.textContent = totalToday;
        totalCyclesDisplay.textContent = totalCycles;

        // Show vibration for Chromium-based mobile, Safari, or Native App
        if (!window.isVibrationSupported) {
            vibrationBtn.style.display = 'none';
            vibrationEnabled = false;
        } else {
            updateVibrationUI();
        }

        updateProgress();
    }

    function updateProgress() {
        const r = 46;
        const c = 2 * Math.PI * r;

        progressCircle.style.strokeDasharray = `${c} ${c}`;
        const offset = c - (count / target) * c;
        progressCircle.style.strokeDashoffset = isNaN(offset) ? c : offset;

        // Visual feedback if target reached
        if (count >= target) {
            tasbihBtn.style.borderColor = 'var(--primary-gold)';
            countDisplay.style.color = 'var(--primary-gold)';
        } else {
            tasbihBtn.style.borderColor = 'rgba(var(--primary-green-rgb), 0.1)';
            countDisplay.style.color = 'var(--primary-green)';
        }
    }

    // Removed local triggerVibrate, using global window.triggerVibrate

    function increment() {
        count++;
        totalToday++;

        // Stronger vibration on target completion
        if (vibrationEnabled) {
            if (count % target === 0) {
                window.triggerVibrate([100, 50, 100]);
            } else {
                window.triggerVibrate(25);
            }
        }

        if (count > target) {
            // Started a new cycle
            count = 1;
            totalCycles++;
        } else if (count === target) {
            // Target reached
            totalCycles++;
        }

        countDisplay.textContent = count;
        totalTodayDisplay.textContent = totalToday;
        totalCyclesDisplay.textContent = totalCycles;

        localStorage.setItem('masjid_tasbih_total_today', totalToday);
        localStorage.setItem('masjid_tasbih_total_cycles', totalCycles);

        updateProgress();
    }

    // Removed local createRipple, using global window.createRipple

    tasbihBtn.addEventListener('pointerdown', (e) => {
        // Only trigger on primary button (left-click or touch)
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        window.createRipple(e);
        increment();
    });

    resetBtn.addEventListener('click', () => {
        if (confirm('Reset current count?')) {
            count = 0;
            countDisplay.textContent = count;
            updateProgress();
        }
    });

    vibrationBtn.addEventListener('click', () => {
        vibrationEnabled = !vibrationEnabled;
        localStorage.setItem('masjid_tasbih_vibrate', vibrationEnabled);
        updateVibrationUI();

        // Test vibration
        if (vibrationEnabled) {
            window.triggerVibrate(50);
        }
    });

    function updateVibrationUI() {
        const icon = vibrationBtn.querySelector('i');
        if (vibrationEnabled) {
            vibrationBtn.classList.add('active');
            if (icon) icon.className = 'mdi mdi-vibrate';
        } else {
            vibrationBtn.classList.remove('active');
            if (icon) icon.className = 'mdi mdi-vibrate-off';
        }
    }

    dhikrChips.forEach(chip => {
        chip.addEventListener('click', () => {
            dhikrChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            // Update Header Display
            const enText = chip.childNodes[0].textContent.trim();
            const arText = chip.getAttribute('data-arabic');

            dhikrEnDisplay.textContent = enText;
            dhikrArDisplay.textContent = arText;

            // Reset count for new selection
            count = 0;
            countDisplay.textContent = count;

            const newTarget = parseInt(chip.getAttribute('data-goal'));
            if (!isNaN(newTarget)) {
                target = newTarget;
                targetDisplay.textContent = `Target: ${target}`;
                // Keep current count but update progress bar for new goal
                updateProgress();
            }
        });
    });

    init();
})();
