(function () {
    const categoriesView = document.getElementById('categories-view');
    const detailView = document.getElementById('detail-view');
    const categoryGrid = document.getElementById('category-grid');
    const loading = document.getElementById('loading');

    // Elements for detail view
    const backBtn = document.getElementById('back-btn');
    const detailTitle = document.getElementById('detail-category-title');
    const progressIndicator = document.getElementById('progress-indicator');

    const zekrArabic = document.getElementById('zekr-arabic');
    const zekrTranslit = document.getElementById('zekr-transliteration');
    const zekrEnglish = document.getElementById('zekr-english');
    const zekrReference = document.getElementById('zekr-reference');
    const zekrCountNote = document.getElementById('zekr-count-note');

    const zekrContent = document.getElementById('zekr-content');
    const completionMessage = document.getElementById('completion-message');

    const actionBtn = document.getElementById('zekr-action-btn');
    const counterValDisplay = document.getElementById('counter-val');
    const counterTargetDisplay = document.getElementById('counter-target');
    const counterActionText = document.getElementById('counter-action-text');
    const counterActionIcon = document.getElementById('counter-action-icon');
    const progressCircle = document.getElementById('zekr-progress');

    const skipBtn = document.getElementById('skip-btn');
    const counterArea = document.getElementById('counter-area');
    const detailThemeToggle = document.getElementById('detail-theme-toggle-btn');
    const azkarSearch = document.getElementById('azkar-search');

    const translitToggleBtn = document.getElementById('translit-toggle');
    const translitToggleIcon = translitToggleBtn.querySelector('i');

    const englishToggleBtn = document.getElementById('english-toggle');
    const englishToggleIcon = englishToggleBtn.querySelector('i');

    const vibrationToggleBtn = document.getElementById('vibration-toggle');
    const vibrationToggleIcon = vibrationToggleBtn?.querySelector('i');

    const fontSizeDecBtn = document.getElementById('font-size-dec');
    const fontSizeIncBtn = document.getElementById('font-size-inc');
    const fontSizeLabel = document.getElementById('font-size-label');

    const FONT_SIZES = [
        { label: 'XS', value: '1.1rem' },
        { label: 'S', value: '1.4rem' },
        { label: 'M', value: '1.7rem' },
        { label: 'L', value: '2.1rem' },
        { label: 'XL', value: '2.6rem' },
    ];
    const DEFAULT_FONT_SIZE_INDEX = 2; // 'M'
    let currentFontSizeIndex = parseInt(localStorage.getItem('masjid_azkar_font_size') || DEFAULT_FONT_SIZE_INDEX, 10);
    if (isNaN(currentFontSizeIndex) || currentFontSizeIndex < 0 || currentFontSizeIndex >= FONT_SIZES.length) {
        currentFontSizeIndex = DEFAULT_FONT_SIZE_INDEX;
    }

    const TRANSLIT_SCALE = 0.56;  // translit relative to arabic size
    const ENGLISH_SCALE = 0.53;  // english relative to arabic size

    function applyFontSize() {
        const arabicRem = FONT_SIZES[currentFontSizeIndex].value;   // e.g. '1.7rem'
        const base = parseFloat(arabicRem);
        if (zekrArabic) zekrArabic.style.fontSize = arabicRem;
        if (zekrTranslit) zekrTranslit.style.fontSize = (base * TRANSLIT_SCALE).toFixed(2) + 'rem';
        if (zekrEnglish) zekrEnglish.style.fontSize = (base * ENGLISH_SCALE).toFixed(2) + 'rem';
        if (fontSizeLabel) fontSizeLabel.textContent = FONT_SIZES[currentFontSizeIndex].label;
        if (fontSizeDecBtn) fontSizeDecBtn.disabled = currentFontSizeIndex === 0;
        if (fontSizeIncBtn) fontSizeIncBtn.disabled = currentFontSizeIndex === FONT_SIZES.length - 1;
    }

    if (fontSizeDecBtn) {
        fontSizeDecBtn.addEventListener('click', () => {
            if (currentFontSizeIndex > 0) {
                currentFontSizeIndex--;
                localStorage.setItem('masjid_azkar_font_size', currentFontSizeIndex);
                applyFontSize();
            }
        });
    }

    if (fontSizeIncBtn) {
        fontSizeIncBtn.addEventListener('click', () => {
            if (currentFontSizeIndex < FONT_SIZES.length - 1) {
                currentFontSizeIndex++;
                localStorage.setItem('masjid_azkar_font_size', currentFontSizeIndex);
                applyFontSize();
            }
        });
    }

    let isTranslitEnabled = localStorage.getItem('masjid_azkar_translit') === 'true';
    let isEnglishEnabled = localStorage.getItem('masjid_azkar_english') !== 'false'; // Default to true
    let azkarData = null;
    let currentCategory = null;
    let currentZekrIndex = 0;
    let currentZekrCount = 0;
    let vibrationEnabled = localStorage.getItem('masjid_tasbih_vibrate') !== 'false';

    function updateDetailThemeIcon() {
        if (!detailThemeToggle) return;
        const isDark = document.documentElement.classList.contains('dark-mode');
        detailThemeToggle.querySelector('i').className = isDark ? 'mdi mdi-white-balance-sunny' : 'mdi mdi-weather-night';
    }

    if (detailThemeToggle) {
        detailThemeToggle.addEventListener('click', () => {
            if (window.toggleTheme) window.toggleTheme();
            updateDetailThemeIcon();
        });
    }

    window.addEventListener('storage', (e) => {
        if (e.key === 'theme') updateDetailThemeIcon();
    });

    // App Init
    function init() {
        updateTranslitToggleUI();
        updateEnglishToggleUI();
        updateDetailThemeIcon();
        applyFontSize();

        if (vibrationToggleBtn) {
            if (!window.isVibrationSupported) {
                vibrationToggleBtn.style.display = 'none';
                vibrationEnabled = false;
            } else {
                updateVibrationToggleUI();
            }
        }

        loadAzkarData();

        if (azkarSearch) {
            azkarSearch.addEventListener('input', () => {
                const query = azkarSearch.value.trim().toLowerCase();
                document.querySelectorAll('#category-grid .category-card').forEach(card => {
                    const text = (card.querySelector('.category-info h3')?.textContent || '').toLowerCase();
                    const arabic = (card.querySelector('.category-arabic-title')?.textContent || '').toLowerCase();
                    card.style.display = (!query || text.includes(query) || arabic.includes(query)) ? '' : 'none';
                });
            });
        }
    }

    // Load Data
    function loadAzkarData() {
        fetch('../data/azkar.json')
            .then(res => {
                if (!res.ok) throw new Error('Data not found');
                return res.json();
            })
            .then(data => {
                azkarData = data;
                renderCategories();
                loading.style.display = 'none';
            })
            .catch(err => {
                console.error("Failed to load Azkar data", err);
                loading.innerHTML = 'Failed to load Azkar data.';
            });
    }

    // List Rendering
    function renderCategories() {
        categoryGrid.innerHTML = '';
        if (!azkarData || !azkarData.categories) return;

        azkarData.categories.forEach(cat => {
            const card = document.createElement('div');
            card.className = 'category-card';

            // Fast UI interaction safely attached
            card.addEventListener('click', (e) => {
                if (window.createRipple) window.createRipple(e);
                setTimeout(() => openCategory(cat.id), 150);
            });

            card.innerHTML = `
                <div class="category-icon">
                    <i class="mdi ${window.escapeHTML(cat.icon)}"></i>
                </div>
                <div class="category-info">
                    <div class="category-titles">
                        <h3>${window.escapeHTML(cat.title)}</h3>
                        <h3 class="category-arabic-title">${window.escapeHTML(cat.arabicTitle || '')}</h3>
                    </div>
                    <p>${cat.azkar.length} items</p>
                </div>
            `;
            categoryGrid.appendChild(card);
        });
    }

    // Toggle logic
    translitToggleBtn.addEventListener('click', () => {
        isTranslitEnabled = !isTranslitEnabled;
        localStorage.setItem('masjid_azkar_translit', isTranslitEnabled);
        updateTranslitToggleUI();

        // Update detail view if it is active
        if (detailView.classList.contains('active') && currentCategory) {
            updateTranslitDisplay();
        }
    });

    englishToggleBtn.addEventListener('click', () => {
        isEnglishEnabled = !isEnglishEnabled;
        localStorage.setItem('masjid_azkar_english', isEnglishEnabled);
        updateEnglishToggleUI();

        // Update detail view if it is active
        if (detailView.classList.contains('active') && currentCategory) {
            updateEnglishDisplay();
        }
    });

    function updateTranslitToggleUI() {
        if (isTranslitEnabled) {
            translitToggleBtn.classList.add('active');
            translitToggleIcon.className = 'mdi mdi-toggle-switch';
        } else {
            translitToggleBtn.classList.remove('active');
            translitToggleIcon.className = 'mdi mdi-toggle-switch-off';
        }
    }

    function updateEnglishToggleUI() {
        if (isEnglishEnabled) {
            englishToggleBtn.classList.add('active');
            englishToggleIcon.className = 'mdi mdi-toggle-switch';
        } else {
            englishToggleBtn.classList.remove('active');
            englishToggleIcon.className = 'mdi mdi-toggle-switch-off';
        }
    }

    if (vibrationToggleBtn) {
        vibrationToggleBtn.addEventListener('click', () => {
            vibrationEnabled = !vibrationEnabled;
            localStorage.setItem('masjid_tasbih_vibrate', vibrationEnabled);
            updateVibrationToggleUI();

            if (vibrationEnabled && window.triggerVibrate) {
                window.triggerVibrate(50);
            }
        });
    }

    function updateVibrationToggleUI() {
        if (!vibrationToggleBtn) return;
        if (vibrationEnabled) {
            vibrationToggleBtn.classList.add('active');
            if (vibrationToggleIcon) vibrationToggleIcon.className = 'mdi mdi-vibrate';
        } else {
            vibrationToggleBtn.classList.remove('active');
            if (vibrationToggleIcon) vibrationToggleIcon.className = 'mdi mdi-vibrate-off';
        }
    }

    function updateTranslitDisplay() {
        if (isTranslitEnabled) {
            zekrTranslit.classList.add('show');
        } else {
            zekrTranslit.classList.remove('show');
        }
    }

    function updateEnglishDisplay() {
        if (isEnglishEnabled) {
            zekrEnglish.classList.add('show');
        } else {
            zekrEnglish.classList.remove('show');
        }
    }

    // Navigation logic
    window.backToCategories = function () {
        if (window.clearRipples) window.clearRipples(document.body);
        detailView.classList.remove('active');
        categoriesView.classList.add('active');
        currentCategory = null;
        document.title = 'Azkar';
        if (azkarSearch) {
            azkarSearch.value = '';
            document.querySelectorAll('#category-grid .category-card').forEach(card => card.style.display = '');
        }
    };

    backBtn.addEventListener('click', window.backToCategories);

    skipBtn.addEventListener('click', (e) => {
        if (window.createRipple) window.createRipple(e);
        if (window.triggerVibrate) window.triggerVibrate(25);
        nextZekr();
    });

    function openCategory(catId) {
        const catNode = azkarData.categories.find(c => c.id === catId);
        if (!catNode || !catNode.azkar.length) return;

        currentCategory = catNode;
        currentZekrIndex = 0;

        const fullTitle = `${catNode.title} ${catNode.arabicTitle || ''}`;
        detailTitle.innerHTML = `<span>${window.escapeHTML(catNode.title)}</span> <span class="detail-arabic-title">${window.escapeHTML(catNode.arabicTitle || '')}</span>`;
        document.title = `Azkar - ${fullTitle}`;
        categoriesView.classList.remove('active');
        detailView.classList.add('active');

        zekrContent.style.display = 'block';
        completionMessage.style.display = 'none';
        if (counterArea) counterArea.style.display = '';

        renderZekr();
    }

    function renderZekr() {
        const zekr = currentCategory.azkar[currentZekrIndex];

        // Setup Texts
        zekrArabic.textContent = zekr.arabic;
        zekrEnglish.textContent = zekr.english;
        zekrTranslit.textContent = zekr.transliteration;
        zekrReference.textContent = zekr.reference || '';
        zekrCountNote.textContent = zekr.count > 1 ? `(Repeat ${zekr.count} times)` : `(1 time)`;

        updateTranslitDisplay();
        updateEnglishDisplay();

        progressIndicator.textContent = `${currentZekrIndex + 1} / ${currentCategory.azkar.length}`;

        // Setup Counter
        currentZekrCount = 0;

        if (zekr.count > 1) {
            actionBtn.classList.remove('is-next');
            skipBtn.style.visibility = 'visible';

            counterValDisplay.style.display = 'block';
            counterTargetDisplay.style.display = 'block';
            counterActionText.style.display = 'none';
            counterActionIcon.style.display = 'none';

            counterValDisplay.textContent = currentZekrCount;
            counterTargetDisplay.textContent = `Target: ${zekr.count}`;
        } else {
            actionBtn.classList.add('is-next');
            skipBtn.style.visibility = 'hidden';

            counterValDisplay.style.display = 'none';
            counterTargetDisplay.style.display = 'none';
            counterActionText.style.display = 'block';
            counterActionIcon.style.display = 'block';

            counterActionText.textContent = 'Next';
        }

        updateActionProgress(zekr.count);

        // Reset Visual Styles
        actionBtn.style.borderColor = 'rgba(var(--primary-green-rgb), 0.1)';
        counterValDisplay.style.color = 'var(--primary-green)';
    }

    // Action button logic
    actionBtn.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (window.createRipple) window.createRipple(e);

        if (!currentCategory) return;
        const target = currentCategory.azkar[currentZekrIndex].count;

        // Prevent extra clicks while completing or advancing
        if (currentZekrCount >= target) return;

        currentZekrCount++;

        if (target > 1) {
            counterValDisplay.textContent = currentZekrCount;
            updateActionProgress(target);
        }

        // Vibrate rules
        if (vibrationEnabled && window.triggerVibrate) {
            if (currentZekrCount >= target) {
                window.triggerVibrate([100, 50, 100]); // Completion pulse
            } else {
                window.triggerVibrate(25); // Tick pulse
            }
        }

        if (currentZekrCount >= target) {
            actionBtn.style.borderColor = 'var(--primary-gold)';
            counterValDisplay.style.color = 'var(--primary-gold)';

            // Allow slight delay so user perceives completion before next
            setTimeout(() => {
                nextZekr();
            }, 300);
        }
    });

    function updateActionProgress(target) {
        const r = 46;
        const c = 2 * Math.PI * r;

        progressCircle.style.strokeDasharray = `${c} ${c}`;

        let offset = c;
        if (target > 1) {
            offset = c - (currentZekrCount / target) * c;
        } else {
            offset = 0; // Filled for "Next" mode
        }

        progressCircle.style.strokeDashoffset = isNaN(offset) ? c : offset;
    }

    function nextZekr() {
        if (currentZekrIndex + 1 < currentCategory.azkar.length) {
            currentZekrIndex++;
            renderZekr();
        } else {
            // Sequence finished
            zekrContent.style.display = 'none';
            completionMessage.style.display = 'flex';
            if (counterArea) counterArea.style.display = 'none';
        }
    }

    // Initialize
    init();
})();
