/**
 * Prayer Export Module
 *
 * Architecture: This script runs INSIDE an iframe (prayer-times.html).
 * It generates the CSV/PDF data, then delegates the actual file-save
 * to the PARENT window via postMessage. The parent window (index.html)
 * has direct access to the Capacitor bridge and handles:
 *   - Native Android: Filesystem.writeFile → Share.share
 *   - Browser / PWA: Blob + <a download>
 *
 * If running standalone (not in an iframe), it falls back to direct
 * browser download.
 */
(function () {
    var parentConfig = (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : null) || 
                       (window.parent && window.parent.APP_CONFIG) || 
                       { masjidName: "Masjid", masjidFullTitle: "Masjid" };

    var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    // Cached logo as base64 data URL (pre-converted via canvas at init).
    // This avoids canvas-taint failures on Android WebView with file:// images.
    var cachedLogoDataUrl = null;

    function getYearData() {
        if (typeof window.getYearlyPrayerData === 'function') {
            return window.getYearlyPrayerData();
        }
        return null;
    }

    /**
     * Send export data to the parent window for saving.
     * Falls back to in-page download if not in an iframe.
     */
    function requestExport(filename, data, mimeType) {
        var isInIframe = false;
        try {
            isInIframe = window.self !== window.top;
        } catch (e) {
            isInIframe = true; // cross-origin — assume iframe
        }

        if (isInIframe) {
            // Delegate to parent window which has Capacitor access
            window.parent.postMessage({
                type: 'masjid-export-file',
                filename: filename,
                data: data,
                mimeType: mimeType
            }, window.location.origin);
        } else {
            // Standalone page — direct browser download
            directBrowserDownload(filename, data, mimeType);
        }
    }

    /**
     * Fallback: direct in-page browser download (works in real browsers, not Android WebView).
     */
    function directBrowserDownload(filename, data, mimeType) {
        var blob;
        var objectUrl = null;

        try {
            if (mimeType === 'application/pdf') {
                // data is a base64 data URI — decode it
                var commaIdx = data.indexOf(',');
                var b64 = commaIdx !== -1 ? data.substring(commaIdx + 1) : data;
                var binaryString = atob(b64);
                var bytes = new Uint8Array(binaryString.length);
                for (var i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                blob = new Blob([bytes], { type: mimeType });
            } else {
                blob = new Blob([data], { type: mimeType });
            }

            objectUrl = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } finally {
            if (objectUrl) {
                setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 500);
            }
        }
    }

    // --- CSV Export ---
    function exportToCSV() {
        var data = getYearData();
        if (!data || data.length === 0) {
            alert('Prayer data not loaded yet. Please wait.');
            return;
        }

        var year = new Date().getFullYear();
        var csv = '"' + parentConfig.masjidName + ' Yearly Prayer Timetable - ' + year + '"\n';
        csv += 'Month,Day,Weekday,Fajr,Sunrise,Dhuhr,Asr,Maghrib,Isha,Hijri\n';

        function escapeCSV(val) {
            var str = String(val);
            // Prevent CSV Injection (DDE attacks)
            if (/^[=\-+\@]/.test(str)) str = "'" + str;
            if (/[,"\n\r]/.test(str)) str = '"' + str.replace(/"/g, '""') + '"';
            return str;
        }

        data.forEach(function (row) {
            csv += [
                String(row.month).padStart(2, '0'),
                String(row.day).padStart(2, '0'),
                row.weekday,
                row.fajr,
                row.sunrise,
                row.dhuhr,
                row.asr,
                row.maghrib,
                row.isha,
                row.hijri
            ].map(escapeCSV).join(',') + '\n';
        });

        requestExport(parentConfig.masjidName + '_Prayer_Times_' + year + '.csv', csv, 'text/csv;charset=utf-8;');
    }

    // --- PDF Export (using jsPDF + AutoTable) ---
    function exportToPDF() {
        var data = getYearData();
        if (!data || data.length === 0) {
            alert('Prayer data not loaded yet. Please wait.');
            return;
        }

        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF('p', 'mm', 'a4');
        var year = new Date().getFullYear();

        var primaryGreen = [16, 185, 129];
        var primaryGold = [219, 141, 13];

        function drawHeader(targetDoc) {
            if (cachedLogoDataUrl) {
                try {
                    targetDoc.addImage(cachedLogoDataUrl, 'PNG', 10, 8, 18, 18);
                } catch (e) { console.warn('PDF logo embed failed:', e); }
            }

            targetDoc.setFont('helvetica', 'bold');
            targetDoc.setFontSize(18);
            targetDoc.setTextColor(primaryGreen[0], primaryGreen[1], primaryGreen[2]);
            targetDoc.text('Prayer Timetable', 32, 18);

            targetDoc.setFontSize(11);
            targetDoc.setFont('helvetica', 'normal');
            targetDoc.setTextColor(100);
            targetDoc.text(parentConfig.masjidFullTitle + ' - ' + year, 32, 25);
        }

        // Helper: extract a display string from a Jumuah entry.
        // Supports both the new object format {time, label} and legacy plain strings.
        function jumuahEntryStr(entry) {
            if (!entry) return '';
            if (typeof entry === 'object' && entry !== null) {
                // Trim seconds if present (e.g. "13:15:00" → "13:15")
                var t = String(entry.time || '').substring(0, 5);
                var l = entry.label ? ' (' + entry.label + ')' : '';
                return t + l;
            }
            // Legacy plain string — trim to HH:MM
            return String(entry).substring(0, 5);
        }

        for (var m = 0; m < 12; m++) {
            if (m > 0) doc.addPage();
            drawHeader(doc);

            var monthRows = data.filter(function (r) { return r.month === (m + 1); });
            var tableBody = [];
            monthRows.forEach(function (r) {
                if (r.description) {
                    tableBody.push([{
                        content: r.description.toUpperCase(),
                        colSpan: 8,
                        styles: {
                            halign: 'center',
                            fillColor: [252, 248, 237],
                            textColor: primaryGold,
                            fontStyle: 'bold',
                            fontSize: 6.5
                        }
                    }]);
                }

                // Build Jumuah cell: each entry on its own line, with label if present.
                // Falls back gracefully when jumuah is empty or not offered.
                var dhuhrCell;
                if (r.weekday === 'Fri') {
                    var jArr = Array.isArray(r.jumuah) ? r.jumuah : [];
                    if (jArr.length === 0) {
                        dhuhrCell = 'Not offered (Jumuah)\n' + r.dhuhr + ' (Dhuhr)';
                    } else {
                        dhuhrCell = jArr.map(jumuahEntryStr).join('\n') + '\n' + r.dhuhr + ' (Dhuhr)';
                    }
                } else {
                    dhuhrCell = r.dhuhr + (r.dhuhr_iqamah ? ' (IQ: ' + r.dhuhr_iqamah + ')' : '');
                }

                tableBody.push([
                    r.day + ' ' + r.weekday,
                    r.hijri,
                    r.fajr + (r.fajr_iqamah ? ' (IQ: ' + r.fajr_iqamah + ')' : ''),
                    r.sunrise,
                    dhuhrCell,
                    r.asr + (r.asr_iqamah ? ' (IQ: ' + r.asr_iqamah + ')' : ''),
                    r.maghrib + (r.maghrib_iqamah ? ' (IQ: ' + r.maghrib_iqamah + ')' : ''),
                    r.isha + (r.isha_iqamah ? ' (IQ: ' + r.isha_iqamah + ')' : '')
                ]);
            });

            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(primaryGold[0], primaryGold[1], primaryGold[2]);
            doc.text(MONTH_NAMES[m], 15, 33);

            doc.autoTable({
                startY: 37,
                head: [['Date', 'Hijri', 'Fajr', 'Sunrise', 'Dhuhr/Jummah', 'Asr', 'Maghrib', 'Isha']],
                body: tableBody,
                theme: 'striped',
                headStyles: { fillColor: primaryGreen, textColor: 255, halign: 'center', fontSize: 8.5 },
                bodyStyles: { fontSize: 7, halign: 'center' },
                columnStyles: {
                    0: { halign: 'left', fontStyle: 'bold' },
                    1: { fontSize: 6 }
                },
                margin: { horizontal: 10 },
                styles: { font: 'helvetica' },
                didParseCell: function (cellData) {
                    if (cellData.section === 'body') {
                        var firstCellText = cellData.row.cells[0].text[0];
                        if (firstCellText && firstCellText.indexOf('Fri') !== -1) {
                            cellData.cell.styles.fillColor = [254, 243, 224]; // Light Orange
                        }
                    }
                }
            });

            // Add disclaimer directly under table
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(150);
            doc.text('* Note: Iqamah times are subject to change. The Hijri date is estimated and may not be completely accurate.', 10, doc.lastAutoTable.finalY + 5);
        }

        var pageCount = doc.internal.getNumberOfPages();
        for (var i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150);
            doc.text('Generated by ' + parentConfig.masjidName + ' APP', 105, 290, { align: 'center' });
            doc.text('Page ' + i + ' of ' + pageCount, 190, 290, { align: 'right' });
        }

        // Output as base64 data URI for transfer via postMessage
        var pdfDataUri = doc.output('datauristring');
        requestExport(parentConfig.masjidName + '_Prayer_Timetable_' + year + '.pdf', pdfDataUri, 'application/pdf');
    }

    /**
     * Convert an <img> element to a base64 PNG data URL via canvas.
     * Returns null on failure (e.g. image not loaded, tainted canvas).
     */
    function imgToDataUrl(imgEl) {
        try {
            if (!imgEl || !imgEl.naturalWidth) return null;
            var canvas = document.createElement('canvas');
            canvas.width = imgEl.naturalWidth;
            canvas.height = imgEl.naturalHeight;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(imgEl, 0, 0);
            return canvas.toDataURL('image/png');
        } catch (e) {
            console.warn('Logo canvas conversion failed:', e);
            return null;
        }
    }

    // --- Attach Listeners ---
    document.addEventListener('DOMContentLoaded', function () {
        // Pre-cache logo as base64 for reliable PDF embedding on all platforms
        var logoImg = document.querySelector('.page-brand img');
        if (logoImg) {
            if (logoImg.complete && logoImg.naturalWidth > 0) {
                cachedLogoDataUrl = imgToDataUrl(logoImg);
            } else {
                logoImg.addEventListener('load', function () {
                    cachedLogoDataUrl = imgToDataUrl(logoImg);
                });
            }
        }

        var pdfBtn = document.getElementById('export-pdf');
        var csvBtn = document.getElementById('export-csv');

        if (pdfBtn) pdfBtn.addEventListener('click', exportToPDF);
        if (csvBtn) csvBtn.addEventListener('click', exportToCSV);
    });
})();
