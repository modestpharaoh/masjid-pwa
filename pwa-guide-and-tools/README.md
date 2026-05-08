# Masjid PWA Builder

A powerful customization and build tool for the Masjid PWA. It provides both a user-friendly web interface and a flexible command-line interface for headless builds.

## Features

- **Interactive Portal**: Customize branding, features, and schedules via a local web server.
- **Headless Builds**: Automate the build process using saved states.
- **Version Management**: Easily override or increment patch numbers from the CLI.
- **Custom Data Support**: Seamlessly integrates custom prayer schedules, iqamah settings, and notifications.

---

## Interactive Portal Mode

To run the interactive web interface, start the script and open the provided URL in your browser:

```bash
python3 pwa-builder.py [--port 8080]
```

Default port is `8080`. The portal allows you to:
- Set Masjid name, contact info, and SEO metadata.
- Toggle features (Quran, Radio, Azkar, etc.).
- Upload custom logos and building images.
- Manage Iqamah and Ramadan configurations.
- Download the final customized PWA as a `.tar.gz` archive.

---

## Headless CLI Mode

The CLI mode is ideal for quick updates and automation. It uses the current saved state from `pwa-builder-state.json`.

### Commands

| Command | Short | Description |
| :--- | :--- | :--- |
| `python3 pwa-builder.py --status` | `-s` | Shows current version and workspace status. |
| `python3 pwa-builder.py --build` | `-b` | Performs a build using the current saved state. |
| `--build --increment-patch` | `-b -i` | Increments patch number, then builds. |
| `--build --patch <N>` | `-b -p <N>` | Sets specific patch number, then builds. |
| `python3 pwa-builder.py --help` | `-h` | Shows the help message with all options. |

### Build Outputs
- **Workspace**: `pwa-build-workspace/masjid-pwa/`
- **Archive**: `[masjid-name]-pwa.tar.gz` (generated in the script directory)

---

## Examples

### 1. Check current build status
```bash
python3 pwa-builder.py --status
```

### 2. Quick update with incremented version
```bash
python3 pwa-builder.py --build --increment-patch
```

### 3. Build with a specific version number
If your current version is `9.7.10` and you want to jump to `9.7.15`:
```bash
python3 pwa-builder.py --build --patch 15
```

---

## Technical Details

- **State Persistence**: All settings are saved in `pwa-builder-state.json`.
- **Custom Files**: The builder looks for the following files in its directory:
  - `custom-masjid-logo.png` / `.svg`
  - `custom-masjid-building.svg`
  - `custom-prayers-schedule.json`
  - `custom-iqamah-schedule.json`
  - `custom-notifications.json`
  - `custom-nearby-masjids.json`
- **Dependencies**: Requires Python 3.6+. No external libraries needed.
