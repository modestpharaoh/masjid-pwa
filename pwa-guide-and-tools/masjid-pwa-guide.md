# Masjid PWA Customization Guide

This guide explains how to customize this progressive web application (PWA) for your specific Masjid. The application is designed to be "agnostic," meaning all masjid-specific data is centralized in configuration files and standard asset locations.

## Overview

The **Masjid PWA** is a high-performance, premium web application designed to serve as a digital hub for any Masjid. It combines modern UI/UX with essential Islamic features, providing a seamless experience across mobile, tablet, and desktop devices.

### Key Features
- 🕋 **Dynamic Prayer Times**: Real-time Adhan and Iqamah tracking with automated countdowns and congregation alerts.
- 📅 **Interactive Timetables**: Full yearly prayer schedules with support for multiple Jumuah shifts and automatic seasonal adjustments.
- 📖 **Digital Quran**: A full-featured Quran reader with multi-language translations and high-quality audio recitations.
- 📻 **Quran Radio**: 24/7 streaming Quran radio service integrated directly into the sidebar.
- 🧭 **Qiblah Finder**: A real-time, browser-based Qiblah compass for accurate prayer direction.
- 📍 **Nearby Masjids**: Interactive map to help community members find local prayer spaces and services.
- 📢 **Smart Notifications**: Overlay system for urgent announcements, events, and community news.
- 🤖 **AI Chatbot**: A contextualized AI assistant capable of answering questions about the Masjid, prayer times, and basic Islamic knowledge.
- 🌓 **Celestial Tracking**: Dynamic sun and moon positioning based on the Masjid's specific GPS coordinates.
- 🌤️ **Weather Forecast**: Real-time local weather updates and forecasts powered by the Masjid's geolocation.
- 📱 **PWA Ready**: Fully installable as an app on iOS, Android, and Desktop with offline caching capabilities.


## 1. Core Configuration (`assets/js/config.js`)

The `config.js` file is the brain of the application. It contains all branding, feature toggles, and external links.

### Branding & Identity
| Variable | Description | If Empty? |
| :--- | :--- | :--- |
| `masjidName` | The short name (e.g., "MASJID"). | Shows "MASJID" |
| `masjidFullTitle` | The formal full name of the Masjid. | Shows short name |
| `masjidSite` | The display URL (e.g., "masjid.com"). | Shows "masjid.com" |
| `masjidBaseUrl` | The actual website URL. | Links will not work |
| `masjidDescription` | Paragraph for the About page. | Shows a generic fallback |
| `masjidFeatures` | Array of features for About page. | Hides "What We Do" section |

### Location & Contact
| Variable | Description | If Empty? |
| :--- | :--- | :--- |
| `masjidAddress` | Physical address. | Hidden on contact page |
| `showGoogleMap` | If `true`, the Contact page builds a Google Maps embed URL from `masjidAddress`. | Map hidden if false or address is empty |
| `masjidPhone` | Contact phone number. | Hidden on contact page |
| `masjidEmail` | Contact email address. | Hidden on contact page |
| `masjidLat` / `masjidLng` | Coordinates for calculations. | **Required** for Sun/Moon |

### Donation & Bank Details
| Variable | Description | If Empty? |
| :--- | :--- | :--- |
| `masjidDonationMessage` | Appeal text on donation page. | Shows generic fallback |
| `masjidBank...` | (Name, IBAN, BIC, Account Name) | Hides entire Bank section if **any** of the 4 are missing |
| `masjidBankAccountNumber` | Optional account number. | Hidden if empty |
| `masjidDonationSumUpUrl` | SumUp link. | Hides SumUp tab |
| `masjidDonationPayPalUrl` | PayPal link. | Hides PayPal tab |

> [!NOTE]
> If both SumUp and PayPal URLs are empty, the entire "Online Donations" section will be hidden.

### Social Media
| Variable | Description | If Empty? |
| :--- | :--- | :--- |
| `masjidSocialLinks` | Object with platform URLs. | Individual icons are hidden |

### Technical Settings
| Variable | Description |
| :--- | :--- |
| `masjidCapacitorHostname` | Used for Android/iOS app detection (usually your domain). |
| `masjidLogo` | Filename of your logo in `assets/images/logos/`. |
| `masjidBuildingImage` | Filename of your building illustration in `assets/images/backgrounds/`. |

### Feature Toggles
You can enable or disable entire modules (Quran, Qiblah, Radio, etc.) by setting their `enable...` switches to `true` or `false`.

---

## 2. Prayer Times Data (`assets/data/`)

### `prayers-schedule.json`
Contains the **Adhan** (start times) for the entire year. The file is split into two main sections to handle the extra day in leap years:

- **Structure**: `{"standard": { ... }, "leap": { ... }}`
- **`standard`**: Data for a normal 365-day year (February has 28 days).
- **`leap`**: Data for a 366-day leap year (February has 29 days).
- **Data Format**: `{"Month": {"Day": [[H, M], [H, M] ... ]}}`
  - The inner array follows the order: `[Fajr, Sunrise, Zuhr, Asr, Maghrib, Isha]`.
  - All times are in **24-hour format**.

The application automatically detects the current year type and loads the corresponding schedule to ensure accuracy on February 29th.

### `ramadan-schedule.json`
Contains the Ramadan timetable as an array, one object per Ramadan day. Common fields are:

- `ramadan`: Ramadan day number as a string.
- `weekday`, `day`, `month`: Gregorian display date.
- `fajr_start_fast`, `sunrise`, `dhuhr`, `asr`, `maghrib_iftar`, `isha`: 24-hour time strings.

### `iqamah-settings.json`
Defines the **Iqamah** (congregation) times. The system supports multiple scheduling blocks that automatically switch based on the date.

- **`startDate`**: (YYYY-MM-DD) The date when this specific schedule block becomes active.
- **`description`**: A human-readable label for the schedule (e.g., "Ramadan Schedule" or "Summer Time").
- **`fajr`, `zuhr`, `asr`, `maghrib`, `isha`**: Each prayer supports two calculation types:
  - **Offset (`offset`)**: Calculates time relative to the Adhan.
    - Example: `{"type": "offset", "value": 15}` means 15 minutes after Adhan.
  - **Fixed (`fixed`)**: Uses a specific time regardless of the Adhan.
    - Example: `{"type": "fixed", "value": "19:45"}` means exactly 7:45 PM.
  - **Maghrib (`maghrib`)**: (Exclusive to Isha) Sets Isha congregation to follow immediately after Maghrib congregation.
    - Example: `{"type": "maghrib"}` means Isha Iqamah is the same as Maghrib Iqamah.
- **`jumuah`**: An array of strings representing the start times for Jumuah prayer shifts.
  - Example: `["13:15", "14:15"]` (supports as many shifts as needed).
- **`hijriOffset`**: (Integer) Manually adjust the Hijri date display for this period (e.g., `-1`, `0`, `+1`).

#### Example Configuration Entry:
```json
{
    "startDate": "2026-03-29",
    "description": "British Summer Time (BST)",
    "fajr": { "type": "offset", "value": 20 },
    "zuhr": { "type": "fixed", "value": "13:30" },
    "asr": { "type": "offset", "value": 15 },
    "maghrib": { "type": "offset", "value": 5 },
    "isha": { "type": "maghrib" },
    "jumuah": ["13:15", "14:15"],
    "hijriOffset": 0
}
```

---

## 3. Map & Community (`assets/data/nearby-masjids.json`)

Customize the "Nearby Masjids" list by adding other local prayer spaces.
- **`name`**: Display name of the masjid.
- **`address`**: Physical address for identification.
- **`category`**: Grouping/Location label (e.g., "Nearby (Dublin 15)").
- **`websites`**: An array of official website URLs for that masjid.
- **`prayer_times_...`**: (Optional) Link to their specific prayer schedule (`api`, `url`, or `page`).

#### Example Entry:
```json
{
    "name": "Second Masjid Example",
    "address": "456 Example Road, Example Town, EX2 4GH",
    "category": "Vicinity",
    "websites": ["https://example-masjid-2.com"],
    "prayer_times_url": "https://example-masjid-2.com/prayers"
}
```

---

## 4. Notifications (`assets/data/notifications.json`)

Notifications are rotating announcement cards used by the web/PWA display and TV-style layouts. Each item can include:

- `message`: Main announcement text. New lines are supported.
- `startDate` / `endDate`: Active date range in `YYYY-MM-DD`.
- `duration`: Seconds to show the message.
- `important`: Boolean for priority styling.
- `fontSize`: Size level from `1` to `3`.
- `qrLink`: Optional URL used for generated QR code display.
- `hide-in-portrait`: Optional boolean to hide on portrait layouts.
- `tv-only`: Optional boolean to show only on TV/display modes.
- `image`: Optional image path used by the runtime, but the PWA Builder intentionally does not edit images for notifications.

Example:

```json
{
  "message": "Please silence your mobile phone.",
  "startDate": "2026-03-19",
  "endDate": "2100-01-01",
  "duration": 5,
  "important": false,
  "fontSize": 3,
  "hide-in-portrait": true,
  "tv-only": true
}
```

---

## 5. PWA Builder (`pwa-guide-and-tools/pwa-builder.py`)

The easiest way to produce a customized package is the local zero-dependency builder.

### Start The Portal

```bash
cd pwa-guide-and-tools
python3 pwa-builder.py --port 8080
```

Open `http://localhost:8080`.

### Builder Workflow

1. Fill Branding, Location, Feature Toggles, Donation, Social, Manifest, schedules, iqamah, notifications, and nearby masjids.
2. Click **Save Info** to persist lightweight settings in `pwa-builder-state.json`.
3. Click **Build & Download .tar.gz** to create and download a deployable archive.
4. Click **Build only .tar.gz** to generate the archive without browser download.
5. Click **Test PWA** to rebuild the local preview and open `/pwa/`.
6. Click **Reset temp build** to remove the local build workspace and generated archives.

### Builder Files

- `pwa-builder-state.json`: lightweight saved portal settings. Large schedules and image binaries are not stored here.
- `custom-prayers-schedule.json`: custom full-year schedule, written beside `pwa-builder.py` when enabled.
- `custom-ramadan-schedule.json`: custom Ramadan schedule, written beside `pwa-builder.py` when enabled.
- `custom-masjid-logo.(svg|png|webp)`: custom logo uploaded or placed beside `pwa-builder.py`.
- `custom-masjid-building.(svg|png|webp)`: custom building image uploaded or placed beside `pwa-builder.py`.
- `pwa-build-workspace/masjid-pwa/`: local customized preview directory.
- `*-pwa.tar.gz`: generated deployment archive.

### Custom Images

Enable **Use custom logo** or **Use custom building image** before uploading. The builder accepts `svg`, `png`, and `webp`, saves the file beside `pwa-builder.py`, copies it into the correct PWA asset directory during build, and updates `config.js` with the matching filename. If the checkbox is enabled but no saved/uploaded custom file exists, Save/Build will fail with a clear error.

### Schedules

Full-year and Ramadan schedules have compact form editors plus JSON mode. When a custom schedule is enabled, the builder writes it to `custom-prayers-schedule.json` or `custom-ramadan-schedule.json`. Use **Use original** to switch back to the source schedule with confirmation.

---

## 6. SEO & PWA Manifest (`index.html` & `manifest.json`)

To ensure your Masjid App is easily discoverable and installs correctly on devices:

### Web App Manifest (`manifest.json`)
The `manifest.json` file controls how your app appears when installed on a user's phone or desktop.
1. Update `"name"` and `"short_name"` to your Masjid's name.
2. Update `"description"` to reflect your community.
3. Update `"theme_color"` and `"background_color"` to match your branding.

### SEO Metadata (`index.html`)
While the app updates its title dynamically, search engine crawlers prefer hardcoded metadata. Open `index.html` and customize:
- `<title>`
- `<meta name="description" ...>`
- `<meta property="og:title" ...>`
- `<meta property="og:description" ...>`

---

## 7. Visual Assets (Replacement Checklist)

Replace these files with your own versions to brand the app. **Keep the filenames identical** or update them in `config.js`.

### Logos & Masjid Building Image
To preserve the original repository assets, it is recommended to create your own files and update the filenames in `config.js`:

- **Logo**: Create `assets/images/logos/custom-masjid-logo.(png|svg|webp)` and set `masjidLogoPath` in `config.js`.
- **Building Image**: Create `assets/images/custom-masjid-building.(png|svg|webp)` and set `masjidBuildingImagePath` in `config.js`.

> [!TIP]
> Using custom filenames prevents your changes from being accidentally overwritten during future code updates.

### Icons & App Badges (Optional)
Replace the files inside `assets/icons/`:
- `icon_x128.png` ... `icon_x512.png`
- `maskable_icon_x128.png` ... `maskable_icon_x512.png`
- `favicon.png` & `favicon.ico`
- `apple-touch-icon.png`

---

## 8. Deployment & Hosting

The application is a static web app and can be hosted on any standard HTTP server.

### General Steps
1. Update `version.js` to trigger a service worker update for your users.
2. Update `service_worker.js` if you have added or removed any local assets.
3. Upload the entire contents of the `masjid-web-app/` directory to your server's public root (e.g., `/var/www/html`).

---

### Server Configuration Examples

#### Nginx Configuration
Add this to your site configuration to ensure correct routing and security:
```nginx
server {
    listen 80;
    server_name your-masjid-domain.com;
    root /var/www/masjid-web-app;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cross-Origin and CORS Headers
    add_header Access-Control-Allow-Origin "*";
    add_header Cross-Origin-Resource-Policy "cross-origin";

    # Security Headers (CSP)
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://maps.googleapis.com; script-src-attr 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; img-src 'self' data: blob: https://maps.googleapis.com https://maps.gstatic.com; connect-src 'self' https://api.open-meteo.com https://fonts.googleapis.com https://fonts.gstatic.com https://api.quran.com https://*.quran.com https://maps.googleapis.com https://*.sentry.io https://geolocation-db.com https://text.pollinations.ai; font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com; media-src 'self' blob: *; frame-src 'self' https://www.google.com https://maps.google.com https://pay.sumup.com; object-src 'none'; upgrade-insecure-requests;";
}
```

#### Apache (`.htaccess`)
Create a `.htaccess` file in your root directory:
```apache
# Enable Routing
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]

# Cross-Origin and CORS Headers
Header set Access-Control-Allow-Origin "*"
Header set Cross-Origin-Resource-Policy "cross-origin"

# Content Security Policy
Header set Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://maps.googleapis.com; script-src-attr 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; img-src 'self' data: blob: https://maps.googleapis.com https://maps.gstatic.com; connect-src 'self' https://api.open-meteo.com https://fonts.googleapis.com https://fonts.gstatic.com https://api.quran.com https://*.quran.com https://maps.googleapis.com https://*.sentry.io https://geolocation-db.com https://text.pollinations.ai; font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com; media-src 'self' blob: *; frame-src 'self' https://www.google.com https://maps.google.com https://pay.sumup.com; object-src 'none'; upgrade-insecure-requests;"
```

---

### Security & Cross-Origin (CORS) Requirements

The application interacts with several external services. If you use a strict Content Security Policy (CSP), ensure the following domains are whitelisted:

| Service | Domains | Purpose |
| :--- | :--- | :--- |
| **Weather** | `api.open-meteo.com` | Real-time weather data |
| **Quran API** | `api.quran.com`, `*.quran.com` | Quranic verses and audio |
| **Google Maps** | `maps.googleapis.com`, `maps.gstatic.com` | Interactive maps and geolocation |
| **Fonts** | `fonts.googleapis.com`, `fonts.gstatic.com` | Google Fonts |
| **Icons** | `cdn.jsdelivr.net` | Material Design Icons (CSS) |
| **Donations** | `pay.sumup.com` | SumUp payment iframe |
| **AI Chatbot** | `text.pollinations.ai` | AI response engine |
| **Analytics** | `*.sentry.io` | Error tracking and performance |
| **Geo IP** | `geolocation-db.com` | Automatic location detection |

