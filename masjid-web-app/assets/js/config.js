/**
 * App Configuration Settings
 */

/**
 * MASJID_DATA: Customizable masjid-specific information.
 * These values can be modified to adapt the app for different masjids.
 */
const MASJID_DATA = () => ({
    // --- Masjid Name and Branding ---
    masjidName: "My Masjid",
    masjidFullTitle: "My Masjid Cultural Centre",
    masjidSite: "masjid.example.com",
    masjidBaseUrl: "https://masjid.example.com",
    // Use custom-masjid-logos.(svg|png|webp) instead of default (masjid-logo.png)
    // for a custom masjid logo
    masjidLogo: "custom-masjid-logo.png",
    // Use custom-masjid-building.(svg|png|webp) instead of default (masjid-building-optimized.svg)
    // for a custom masjid building image
    masjidBuildingImage: "custom-masjid-building.svg",

    // --- About page - customizable sections ---
    // masjidDescription: Paragraph displayed in about.html under " Our Story" section in about.html.
    //   - If empty, a generic masjid-focused fallback is displayed.
    masjidDescription: "Your masjid description goes here. This permanent worship space acts as a vital hub for daily prayers, educational services, and positive integration within the community.",
    // masjidFeatures: Array of objects shows as items under "What We Do" section in about.html
    //   - If the array is empty, the "What We Do" section is hidden in about.html.
    masjidFeatures: [
        {
            title: "Daily Prayers",
            description: "Our Masjid hosts the five daily prayers, providing a spiritual home for worship and reflection, with a dedicated space for women.",
            icon: "mdi-mosque"
        },
        {
            title: "Community Engagement",
            description: "We organize cultural events and outreach programs to build bridges and foster positive integration within the community.",
            icon: "mdi-account-group"
        }
    ],

    // --- Masjid location info  & contact details in contact.html page ---
    // masjidLat/masjidLng: Used for astronomical (sun/moon) and weather calculations in celestial.js
    masjidLat: 53.3498,
    masjidLng: -6.2603,
    // masjidTimeZone: Very important to get the prayer times right with DST correctly
    masjidTimeZone: "Europe/Dublin",
    // These fields are individually hidden in contact.html if left empty.
    masjidAddress: "123 Faith Street, Cityville, CV1 2BT",
    // showGoogleMap: If true and masjidAddress is provided, contact.html builds a Google Maps embed URL from the address.
    showGoogleMap: true,
    masjidPhone: "+00 123 456 789",
    masjidEmail: "info@example.com",

    // --- Donation & Bank Details ---
    // masjidDonationMessage: Displayed as the appeal text on the donation page. Generic fallback used if empty.
    masjidDonationMessage: "<strong>Your support matters.</strong><br>By contributing, you help create a welcoming space for prayer, learning, and kindness that serves the local community.",
    // --- Bank Transfer details: The entire section is hidden if any of these 4 fields are empty:
    masjidBankName: "Example Bank",
    masjidBankAccountName: "My Masjid Name",
    masjidBankIban: "IE00 EXAM 0000 0000 0000 00",
    masjidBankBic: "EXAMIE2D",
    // masjidBankAccountNumber: Optional. Hidden if empty.
    masjidBankAccountNumber: "00000000",
    // Online Donations: Iframe and external links.
    // Individual tabs (SumUp/PayPal) are hidden if their respective URL is empty.
    // If both are empty, the entire "Online Donations" section is hidden.
    masjidDonationSumUpUrl: "",
    masjidDonationPayPalUrl: "",

    // --- Social Media Links ---
    // Platforms supported: facebook, instagram, x, youtube, whatsapp, telegram
    // If a field is empty, the corresponding social media icon will not be displayed in the social-links.html page.
    masjidSocialLinks: {
        facebook: "",
        instagram: "",
        x: "",
        youtube: "",
        whatsapp: "",
        telegram: ""
    },

    // --- Feature Switches ---
    // Set to true to enable the corresponding page in the sidebar menu.
    enableRamadan: true,          // Ramadan Schedule
    enablePrayerTimesYear: true,  // Prayer Times Year view
    enableRadio: true,            // Quran Radio
    enableQuran: true,            // Quran Reader
    enableAzkar: true,            // Azkar collection
    enableTasbih: true,           // Digital Tasbih
    enableQiblah: true,           // Qiblah Compass
    enableSettings: true,         // Azan & App Settings
    enablePosts: true,            // Latest Posts (Blog)
    enableEvents: true,           // Upcoming Events
    enableDonation: true,         // Donation page
    enableAbout: true,            // About Us page
    enableContact: true,          // Contact Us page

    // --- Ramadan Features ---
    // Toggle the visibility of the Ramadan Animation in the prayer cards.
    // Note: This is only visible during the actual Ramadan month.
    showRamadanAnimation: true,
    // Number of days before Ramadan starts to show the Ramadan module/menu-item (0-30).
    ramadanDaysBefore: 5,
    // ramadanFeaturesCards: Array of objects shows as items under the footer in ramadan.html
    //   - If the array is empty, the footer section is hidden.
    ramadanFeaturesCards: [
        {
            title: "Prayer Times",
            description: "<ul><li><strong>Isha & Taraweeh:</strong> Isha prayer is fixed at 20:30, followed immediately by Taraweeh.</li><li><strong>Last 10 Nights (Qiyam/Tahajjud):</strong> Special late-night prayers from 23:30 – 00:30 nightly.</li><li><strong>Attendance:</strong> Taraweeh and Tahajjud are available for both men and women.</li></ul>",
            icon: "mdi-clock-outline"
        },
        {
            title: "Community & Support",
            description: "<ul><li><strong>Limited Capacity:</strong> Masjid space is limited. Attendance is on a first-come, first-served basis.</li><li><strong>Parking & Transport:</strong> Local attendees are strongly encouraged to walk. For those coming from a distance, please carpool with neighbors to accommodate limited parking.</li></ul>",
            icon: "mdi-car-multiple"
        }
    ],

    // --- Cache Settings ---
    // Shared caching duration for remote JSON configuration files (e.g. notifications.json, iqamah-settings.json)
    // means how long the web/app client will wait before checking for new updates from the server
    // for the above mentioned JSON files.
    cacheDurationTV: 2 * 60 * 60 * 1000, // 2 hours for Android TV displays
    cacheDurationWeb: 8 * 60 * 60 * 1000, // 8 hours for Mobile/Web PWA
    // Caching duration for the yearly prayer times table (localStorage)
    cacheDurationPrayerYear: 30 * 60 * 1000, // 30 minutes
    // Caching duration for generated QR codes (localStorage LRU)
    qrCacheDuration: 60 * 24 * 60 * 60 * 1000, // 60 days
    qrCodeColor: "#036737", // Default foreground color for QR codes
    qrBackgroundColor: "#CAF3DE", // Default background color for QR codes

    // --- Notification Settings ---
    // Duration of the "empty" gap between rotating notification messages (in seconds).
    // Affecting only landscape or wide screen modes.
    notificationGapDuration: 5,

    // --- Jumuah Settings ---
    // Fallback Jumuah times used if the API is unreachable 
    // and no cached Jumuah times are available in localStorage.
    // Each entry is an object: { time: "HH:MM:SS", label: "Men Only" | "Men & Women" | "" }
    // Labels are defined per-entry in iqamah-settings.json alongside each jumuah time.
    jumuahFallbackStandard: [{ time: "12:15:00", label: "Men & Women" }, { time: "13:15:00", label: "Men Only" }],
    jumuahFallbackDST: [{ time: "13:15:00", label: "Men Only" }, { time: "14:15:00", label: "Men & Women" }],

    // --- Isha Iqamah Settings ---
    // When Isha Iqamah type is set to 'maghrib' (combined prayers), 
    // it will be set to Maghrib Iqamah + this offset (in minutes).
    ishaIqamahOffsetFromMaghrib: 10,

    // --- Mobile App Settings ---
    // masjidCapacitorHostname: Used for internal routing in Capacitor/Android environments.
    masjidCapacitorHostname: "masjid-app",
});

const APP_CONFIG = {
    ...MASJID_DATA(),

    // static variables
    masjidLogoPath: `assets/images/logos/${MASJID_DATA().masjidLogo}`,
    masjidBuildingImagePath: `assets/images/backgrounds/${MASJID_DATA().masjidBuildingImage}`,

    // Detection for Capacitor Android platform
    isAndroid: (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android') ||
        (window.isAndroidApp),

    // Dynamic Base API URL based on platform
    get apiBaseUrl() {
        if (this.isAndroid) return this.masjidBaseUrl;
        return window.location.origin;
    },

    // Path to the JSON file containing dynamic Iqamah and Jumuah settings
    // This file is used to update the Iqamah and Jumuah times dynamically without 
    // the need to redeploy the app. Update this file and the app will automatically.
    // the fallback is assets/data/iqamah-settings.json
    get iqamahSettingsPath() {
        if (this.isAndroid) {
            return this.apiBaseUrl + "/wp-content/app-config/iqamah-settings.json";
        }
        return this.apiBaseUrl + "/wp-content/app-config/iqamah-settings.json";
    },

    // Path to the JSON file containing dynamic notifications
    // This file is used to update the notifications dynamically without 
    // the need to redeploy the app. Update this file and the app will automatically.
    // the fallback is assets/data/notifications.json
    get notificationPath() {
        if (this.isAndroid) {
            return this.apiBaseUrl + "/wp-content/app-config/notifications.json";
        }
        return this.apiBaseUrl + "/wp-content/app-config/notifications.json";
    },

    // Path to the WordPress Events API endpoint - If the masjid website has the events
    // You can disable the events feature by setting enableEvents to false in the MASJID_DATA object
    get eventsPath() {
        return this.apiBaseUrl + "/wp-json/tribe/events/v1/events";
    },

    // Path to the WordPress Posts API endpoint - If the masjid website has the posts
    // You can disable the posts feature by setting enablePosts to false in the MASJID_DATA object
    get postsPath() {
        return this.apiBaseUrl + "/wp-json/wp/v2/posts";
    },
};
