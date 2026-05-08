/**
 * Export Handler (Parent-side)
 *
 * This script runs in the PARENT window (index.html) and listens for
 * 'masjid-export-file' postMessage events from iframe pages.
 *
 * On native Android (Capacitor): writes file to cache → triggers Share dialog.
 * On browser / PWA: creates Blob → triggers <a download>.
 */
(function () {
    'use strict';

    // Allowed MIME types to prevent misuse of the export handler
    var ALLOWED_MIME_TYPES = [
        'text/csv;charset=utf-8;',
        'application/pdf'
    ];

    // Max filename length to prevent abuse
    var MAX_FILENAME_LENGTH = 128;

    /**
     * Safe UTF-8 to Base64 encoder (replaces deprecated unescape).
     */
    function utf8ToBase64(str) {
        var encoder = new TextEncoder();
        var bytes = encoder.encode(str);
        var binary = '';
        for (var i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Extract base64 payload from a data URI string.
     * Returns the raw base64 content after the comma, or the original string.
     */
    function extractBase64(dataUri) {
        var commaIdx = dataUri.indexOf(',');
        return commaIdx !== -1 ? dataUri.substring(commaIdx + 1) : dataUri;
    }

    /**
     * Handle file export via Capacitor native (Filesystem + Share) or browser download.
     */
    async function handleFileExport(filename, data, mimeType) {
        var isNative = window.Capacitor &&
            typeof window.Capacitor.isNativePlatform === 'function' &&
            window.Capacitor.isNativePlatform();

        if (isNative) {
            await handleNativeExport(filename, data, mimeType);
        } else {
            handleBrowserExport(filename, data, mimeType);
        }
    }

    /**
     * Native Android export: write to cache/exports/ directory, then trigger Share dialog.
     * Files are placed in exports/ subdirectory to match FileProvider's scoped path.
     */
    async function handleNativeExport(filename, data, mimeType) {
        try {
            if (!window.Capacitor || !window.Capacitor.Plugins) {
                throw new Error('Capacitor Plugins not available');
            }

            var Filesystem = window.Capacitor.Plugins.Filesystem;
            var Share = window.Capacitor.Plugins.Share;

            if (!Filesystem) throw new Error('Filesystem plugin not available');
            if (!Share) throw new Error('Share plugin not available');

            var base64Data;
            if (mimeType === 'application/pdf') {
                base64Data = extractBase64(data);
            } else {
                base64Data = utf8ToBase64(data);
            }

            // Write to exports/ subdirectory (must match FileProvider's cache-path in file_paths.xml)
            var exportPath = 'exports/' + filename;

            var writeResult = await Filesystem.writeFile({
                path: exportPath,
                data: base64Data,
                directory: 'CACHE',
                recursive: true
            });

            await Share.share({
                title: filename,
                url: writeResult.uri,
                dialogTitle: 'Save or Share Timetable'
            });

        } catch (err) {
            console.error('Native export failed:', err);
            alert('Export failed: ' + (err.message || 'Unknown error'));
        }
        // Note: Android OS manages CACHE directory cleanup automatically.
    }

    /**
     * Browser / PWA export: create Blob and trigger download via anchor element.
     */
    function handleBrowserExport(filename, data, mimeType) {
        var objectUrl = null;
        try {
            var blob;
            if (mimeType === 'application/pdf') {
                var b64 = extractBase64(data);
                var binaryString = atob(b64);
                var bytes = new Uint8Array(binaryString.length);
                for (var j = 0; j < binaryString.length; j++) {
                    bytes[j] = binaryString.charCodeAt(j);
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
            // Always revoke the Object URL to prevent memory leak
            if (objectUrl) {
                setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 500);
            }
        }
    }

    /**
     * Validate and sanitize an incoming export message.
     * Returns a sanitized object or null if invalid.
     */
    function validateExportMessage(msg) {
        if (!msg || msg.type !== 'masjid-export-file') return null;

        // Verify required fields exist and are strings
        if (typeof msg.filename !== 'string' || !msg.filename) return null;
        if (typeof msg.data !== 'string' || !msg.data) return null;
        if (typeof msg.mimeType !== 'string' || !msg.mimeType) return null;

        // Whitelist MIME types
        if (ALLOWED_MIME_TYPES.indexOf(msg.mimeType) === -1) {
            console.warn('Export blocked: disallowed MIME type:', msg.mimeType);
            return null;
        }

        // Sanitize filename: strip path separators to prevent directory traversal
        var safeName = msg.filename.replace(/[\/\\]/g, '_');
        // Remove null bytes (path traversal via null byte injection)
        safeName = safeName.replace(/\0/g, '');
        // Enforce length limit
        if (safeName.length > MAX_FILENAME_LENGTH) {
            safeName = safeName.substring(0, MAX_FILENAME_LENGTH);
        }
        // Ensure filename is not empty after sanitization
        if (!safeName) return null;

        return {
            filename: safeName,
            data: msg.data,
            mimeType: msg.mimeType
        };
    }

    // Listen for export requests from iframes
    window.addEventListener('message', function (event) {
        // Only accept messages from our own origin (same-origin iframes)
        if (event.origin !== window.location.origin) return;

        var validated = validateExportMessage(event.data);
        if (!validated) return;

        handleFileExport(validated.filename, validated.data, validated.mimeType);
    });
})();
