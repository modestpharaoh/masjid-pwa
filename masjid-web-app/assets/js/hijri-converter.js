/**
 * Fallback mechanism to convert a Gregorian Date to a Hijri Date.
 * Uses the built-in Intl.DateTimeFormat API to format the date according to the Islamic calendar.
 */
const hijriMonths = [
    "Muharram", "Safar", "Rabi' al-Awwal", "Rabi' al-Thani",
    "Jumada al-Awwal", "Jumada al-Akhirah", "Rajab", "Sha'ban",
    "Ramadan", "Shawwal", "Dhu al-Qi'dah", "Dhu al-Hijjah"
];

let cachedHijriFormatter = null;

function getHijriDateFallback(date, explicitOffset = 0) {
    if (!date) {
        date = new Date();
    } else if (!(date instanceof Date)) {
        date = new Date(date);
    }

    // Check if date is valid
    if (isNaN(date.getTime())) {
        console.warn("Invalid date passed to getHijriDateFallback");
        return "-";
    }

    try {
        // Apply the explicit offset if it exists, clamping it between -3 and 3 days.
        let offset = explicitOffset || 0;
        offset = Math.max(-3, Math.min(3, offset));
        if (offset !== 0) {
            date = new Date(date);
            date.setDate(date.getDate() + offset);
        }

        // Use numeric parts to avoid locale-specific name issues on some Android versions.
        if (!cachedHijriFormatter) {
            const options = {
                day: 'numeric',
                month: 'numeric',
                year: 'numeric'
            };

            try {
                // Priority 1: Umalqura with numeric parts
                cachedHijriFormatter = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', options);
            } catch (e) {
                try {
                    // Priority 2: Standard Islamic with numeric parts
                    cachedHijriFormatter = new Intl.DateTimeFormat('en-u-ca-islamic-nu-latn', options);
                } catch (e2) {
                    try {
                        // Priority 3: Modern options object fallback
                        cachedHijriFormatter = new Intl.DateTimeFormat('en-GB', { ...options, calendar: 'islamic-umalqura' });
                    } catch (e3) {
                        // Last resort
                        cachedHijriFormatter = new Intl.DateTimeFormat('en-GB-u-ca-islamic', options);
                    }
                }
            }
        }

        // Use formatToParts for maximum control and to bypass "BC" or "September" string bugs.
        const parts = cachedHijriFormatter.formatToParts(date);
        let d = "", m = "", y = "";

        parts.forEach(part => {
            if (part.type === 'day') d = part.value;
            if (part.type === 'month') m = part.value;
            if (part.type === 'year') y = part.value;
        });

        const monthIdx = parseInt(m, 10) - 1;
        if (monthIdx >= 0 && monthIdx < 12) {
            return `${d} ${hijriMonths[monthIdx]} ${y}`;
        }

        // Final fallback if parsing failed
        let hijriDateStr = cachedHijriFormatter.format(date);
        return hijriDateStr.replace(/ AH$/, '').replace(/ BC$/, '').trim();
    } catch (e) {
        console.warn("Intl.DateTimeFormat for Islamic calendar not supported", e);
        return "Offline Data (API Unreachable)";
    }
}

// Ensure it's globally available for other scripts
window.getHijriDateFallback = getHijriDateFallback;
