#!/usr/bin/env python3
"""
Masjid PWA Builder - A local web portal for customizing the Masjid PWA.
Usage: 
  python3 pwa-builder.py [--port 8080]           (Runs the interactive web portal)
  python3 pwa-builder.py --build, -b             (Headless build using current saved state)
  python3 pwa-builder.py --build --increment-patch, -i (Increment patch number then build)
  python3 pwa-builder.py --build --patch, -p <N>  (Set specific patch number then build)
  python3 pwa-builder.py --status, -s            (Show current version and status)
  python3 pwa-builder.py --help, -h              (Show this help message)
Requires: Python 3.6+ (no external dependencies).
"""
import html as html_mod
import http.server
import base64
import io
import json
import mimetypes
import os
import re
import shutil
import socketserver
import sys
import tarfile
from datetime import datetime
from urllib.parse import parse_qs, unquote, urlparse

# --- Configuration ---
PORT = int(sys.argv[sys.argv.index('--port') + 1]) if '--port' in sys.argv else 8080
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'masjid-web-app'))
HTML_FILE = os.path.join(SCRIPT_DIR, 'pwa-builder.html')
STATE_FILE = os.path.join(SCRIPT_DIR, 'pwa-builder-state.json')
BUILD_ROOT = os.path.join(SCRIPT_DIR, 'pwa-build-workspace')
BUILD_DIR = os.path.join(BUILD_ROOT, 'masjid-pwa')
CUSTOM_PRAYERS_FILE = os.path.join(SCRIPT_DIR, 'custom-prayers-schedule.json')
CUSTOM_IQAMAH_FILE = os.path.join(SCRIPT_DIR, 'custom-iqamah-schedule.json')
CUSTOM_NOTIFICATIONS_FILE = os.path.join(SCRIPT_DIR, 'custom-notifications.json')
CUSTOM_NEARBY_FILE = os.path.join(SCRIPT_DIR, 'custom-nearby-masjids.json')

MAX_REQUEST_BYTES = 25 * 1024 * 1024
MAX_ARCHIVE_DOWNLOAD_BYTES = 200 * 1024 * 1024  # 200 MB guard for in-memory archive download
MULTILINE_STRING_KEYS = {'masjidDescription', 'masjidDonationMessage'}
ALLOWED_IMAGE_EXTENSIONS = ('svg', 'png', 'webp')
STATE_EXCLUDED_KEYS = {
    'masjidLogo', 'masjidBuildingImage',
    'masjidLogoUploadData', 'masjidLogoUploadName',
    'masjidBuildingUploadData', 'masjidBuildingUploadName',
    'prayersSchedule',
    'iqamahSettings', 'notificationsData', 'nearbyMasjids',
    # We allow masjidFeatures and ramadanFeaturesCards to be in the state file
    # so the session state is preserved correctly.
    'featureTitle', 'featureIcon', 'featureDescription',
    'rfTitle', 'rfIcon', 'rfDescription',
}

# These key lists are kept at module level only for persist/state filtering.
# The build_app_config_json function uses its own local copies.
SOCIAL_KEYS = ['facebook', 'instagram', 'x', 'youtube', 'whatsapp', 'telegram']

SOURCE_DATA_FILES = {
    'prayers': os.path.join('assets', 'data', 'prayers-schedule.json'),
    'ramadan': os.path.join('assets', 'data', 'ramadan-schedule.json'),
    'iqamah': os.path.join('assets', 'data', 'iqamah-settings.json'),
    'notifications': os.path.join('assets', 'data', 'notifications.json'),
    'nearby': os.path.join('assets', 'data', 'nearby-masjids.json'),
}


def read_text(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def write_text(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)


def read_json_file(path, fallback=None):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def write_json_file(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(value, f, indent=2, ensure_ascii=False)
        f.write('\n')


def load_state():
    return read_json_file(STATE_FILE, {}) or {}


def save_state(params):
    persist_external_inputs(params)
    state = {k: v for k, v in params.items() if k not in STATE_EXCLUDED_KEYS}
    write_json_file(STATE_FILE, state)


def bool_param(params, key):
    return params.get(key) in (True, 'true', 'on', '1', 1)


def escape_js_string(value):
    value = str(value)
    value = value.replace('\\', '\\\\')
    value = value.replace('"', '\\"')
    value = value.replace('\n', '\\n')
    value = value.replace('\r', '')
    return value

def is_enabled(params, key):
    return bool_param(params, key)


def plain_text(value):
    return re.sub(r'\s+', ' ', str(value or '').replace('<br>', ' ')).strip()


def build_app_config_json(params):
    """Build the app-config JSON dict from builder params.
    Maps flat social keys (social_facebook, etc.) to nested masjidSocialLinks,
    and ensures all feature toggles are proper booleans.
    """
    FEATURE_KEYS = [
        'enableRamadan', 'enablePrayerTimesYear', 'enableRadio', 'enableQuran',
        'enableAzkar', 'enableTasbih', 'enableQiblah', 'enableSettings',
        'enablePosts', 'enableEvents', 'enableDonation', 'enableAbout',
        'enableContact', 'showRamadanAnimation', 'showGoogleMap'
    ]
    _SOCIAL_KEYS = ['facebook', 'instagram', 'x', 'youtube', 'whatsapp', 'telegram']
    STRING_KEYS = [
        'masjidName', 'masjidFullTitle', 'masjidSite', 'masjidBaseUrl',
        'masjidDescription', 'masjidLogo', 'masjidBuildingImage',
        'masjidAddress', 'masjidPhone', 'masjidEmail',
        'masjidTimeZone', 'masjidCapacitorHostname',
        'masjidDonationMessage',
        'masjidBankName', 'masjidBankAccountName', 'masjidBankIban',
        'masjidBankBic', 'masjidBankAccountNumber',
        'masjidDonationSumUpUrl', 'masjidDonationPayPalUrl',
        'alternativeIqamahSettingsPath', 'alternativeNotificationsPath',
        'masjidEventsPath', 'masjidPostsPath'
    ]
    NUMBER_KEYS = ['masjidLat', 'masjidLng', 'ishaIqamahOffsetFromMaghrib', 'ramadanDaysBefore']
    ARRAY_KEYS = ['masjidFeatures', 'ramadanFeaturesCards']

    config = {}

    # String keys
    for key in STRING_KEYS:
        val = params.get(key)
        if val is not None:
            config[key] = str(val)

    # Number keys
    for key in NUMBER_KEYS:
        val = params.get(key)
        if val is not None:
            try:
                config[key] = float(val)
            except (TypeError, ValueError):
                config[key] = 0

    # Boolean feature keys
    for key in FEATURE_KEYS:
        val = params.get(key)
        if val is not None:
            config[key] = bool_param(params, key)

    # Social links -> nested object
    social_links = {}
    has_social = False
    for key in _SOCIAL_KEYS:
        val = params.get(f'social_{key}')
        if val is not None:
            social_links[key] = str(val)
            has_social = True
    if has_social:
        config['masjidSocialLinks'] = social_links

    # Array keys (masjidFeatures, ramadanFeaturesCards)
    for key in ARRAY_KEYS:
        raw = params.get(key)
        if raw is not None:
            if isinstance(raw, str):
                raw = raw.strip()
                if raw:
                    parsed = json.loads(raw)
                    if isinstance(parsed, list):
                        config[key] = parsed
            elif isinstance(raw, list):
                config[key] = raw

    return config


def write_app_config_json(build_dir, params):
    """Write the resolved app config as assets/data/app-config.json in the build output."""
    config = build_app_config_json(params)
    config_path = os.path.join(build_dir, 'assets', 'data', 'app-config.json')
    write_json_file(config_path, config)
    return config


def inject_config_into_js(build_dir, config_obj):
    """Inject the resolved config into config.js by replacing the _LOADED_CONFIG placeholder.
    This is a single string replacement — no regex-patching of individual keys.
    """
    config_path = os.path.join(build_dir, 'assets', 'js', 'config.js')
    content = read_text(config_path)
    json_str = json.dumps(config_obj, ensure_ascii=False)
    content = content.replace(
        'const _LOADED_CONFIG = {};',
        f'const _LOADED_CONFIG = {json_str};'
    )
    write_text(config_path, content)


def update_manifest(content, params):
    """Update manifest.json with branding info."""
    manifest = json.loads(content)

    name = params.get('masjidFullTitle', '')
    short = params.get('masjidName', '')
    desc = plain_text(params.get('masjidDescription', ''))
    theme = params.get('themeColor', '#C4D56B')
    bg = params.get('backgroundColor', '#C4D56B')

    if name:
        manifest['name'] = f"{name} Prayers Web App"
    if short:
        manifest['short_name'] = f"{short} Prayers"
    if desc:
        manifest['description'] = desc[:200]
    if theme:
        manifest['theme_color'] = theme
    if bg:
        manifest['background_color'] = bg

    return json.dumps(manifest, indent=2, ensure_ascii=False) + '\n'


def update_index_html(content, params):
    """Update SEO metadata in index.html."""
    name = params.get('masjidName', 'Masjid')
    full = params.get('masjidFullTitle', name)
    desc = plain_text(params.get('masjidDescription', ''))
    # quote=True ensures " is escaped to &quot; for safe injection into HTML attributes
    safe_name = html_mod.escape(str(name), quote=True)
    safe_full = html_mod.escape(str(full), quote=True)
    safe_desc = html_mod.escape(str(desc)[:200], quote=True) if desc else f"{safe_full} Prayers Web App"

    content = re.sub(r'<title>.*?</title>', f'<title>{safe_name} Prayers</title>', content)
    content = re.sub(
        r'<meta\s+name="description"\s+content="[^"]*"',
        f'<meta name="description" content="{safe_desc}"',
        content
    )
    content = re.sub(
        r'<meta\s+property="og:title"\s+content="[^"]*"',
        f'<meta property="og:title" content="{safe_full} Prayers"',
        content
    )
    content = re.sub(
        r'<meta\s+property="og:description"\s+content="[^"]*"',
        f'<meta property="og:description" content="{safe_desc}"',
        content
    )
    return content


def update_version_js(content, params):
    """Set the custom build version using the original major.minor and user patch."""
    explicit_version = str(params.get('appVersion', '')).strip()
    version_base = str(params.get('appVersionBase', '')).strip()
    version_patch = str(params.get('appVersionPatch', '')).strip()

    if explicit_version:
        version = explicit_version
    elif version_base and re.fullmatch(r'\d+', version_patch):
        version = f'{version_base}.{version_patch}'
    else:
        original = parse_semver(current_version())
        version = current_version() if original else '1.0.0'
    suffix = ' // Custom build generated by PWA Builder'

    header = [
        '// This file is the Single Source of Truth for the app version.',
        '// Update the version here and it will propagate to the UI and Service Worker automatically.',
    ]
    return '\n'.join(header) + f'\nconst APP_VERSION = "{escape_js_string(version)}";{suffix}\n'


def parse_semver(version):
    match = re.match(r'^(\d+)\.(\d+)\.(\d+)', str(version or '').strip())
    if not match:
        return None
    return {
        'major': int(match.group(1)),
        'minor': int(match.group(2)),
        'patch': int(match.group(3)),
        'base': f'{match.group(1)}.{match.group(2)}',
        'version': f'{match.group(1)}.{match.group(2)}.{match.group(3)}',
    }


def validate_and_parse_json(raw_value, label):
    if raw_value is None or str(raw_value).strip() == '':
        return None
    try:
        return json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise ValueError(f'{label} JSON is invalid: {exc.msg}') from exc


def validate_prayers_schedule(value):
    if value is None:
        return None
    if not isinstance(value, dict) or not isinstance(value.get('standard'), dict) or not isinstance(value.get('leap'), dict):
        raise ValueError('Full year schedule must be an object with standard and leap objects.')
    return value


def validate_list(value, label):
    if value is None:
        return None
    if not isinstance(value, list):
        raise ValueError(f'{label} must be a JSON array.')
    return value


def write_custom_data_files(build_dir, params):
    """Write user-imported JSON data files into the custom build."""
    data_dir = os.path.join(build_dir, 'assets', 'data')

    prayers = validate_prayers_schedule(validate_and_parse_json(params.get('prayersSchedule'), 'Full year schedule'))
    if prayers is not None:
        write_json_file(os.path.join(data_dir, 'prayers-schedule.json'), prayers)

    iqamah = validate_list(validate_and_parse_json(params.get('iqamahSettings'), 'Iqamah settings'), 'Iqamah settings')
    if iqamah is not None:
        write_json_file(os.path.join(data_dir, 'iqamah-settings.json'), iqamah)

    notifications = validate_list(validate_and_parse_json(params.get('notificationsData'), 'Notifications'), 'Notifications')
    if notifications is not None:
        write_json_file(os.path.join(data_dir, 'notifications.json'), notifications)

    nearby = validate_list(validate_and_parse_json(params.get('nearbyMasjids'), 'Nearby masjids'), 'Nearby masjids')
    if nearby is not None:
        write_json_file(os.path.join(data_dir, 'nearby-masjids.json'), nearby)


def custom_asset_path(filename_prefix, ext):
    return os.path.join(SCRIPT_DIR, f'{filename_prefix}.{ext}')


def find_custom_asset(filename_prefix):
    for ext in ALLOWED_IMAGE_EXTENSIONS:
        path = custom_asset_path(filename_prefix, ext)
        if os.path.isfile(path):
            return path, f'{filename_prefix}.{ext}'
    return None, None


def write_uploaded_image(params, field_prefix, filename_prefix):
    data_url = str(params.get(f'{field_prefix}Data', '')).strip()
    original_name = str(params.get(f'{field_prefix}Name', '')).strip()
    if not data_url:
        return None

    ext = os.path.splitext(original_name)[1].lower().lstrip('.')
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValueError(f'{field_prefix} upload must be one of: svg, png, webp.')

    if ',' in data_url:
        data_url = data_url.split(',', 1)[1]
    try:
        binary = base64.b64decode(data_url, validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise ValueError(f'{field_prefix} upload data is invalid.') from exc

    for old_ext in ALLOWED_IMAGE_EXTENSIONS:
        old_path = custom_asset_path(filename_prefix, old_ext)
        if os.path.exists(old_path):
            os.remove(old_path)

    target_path = custom_asset_path(filename_prefix, ext)
    with open(target_path, 'wb') as f:
        f.write(binary)
    return f'{filename_prefix}.{ext}'


def persist_custom_image(params, enabled_key, field_prefix, filename_prefix):
    if not bool_param(params, enabled_key):
        return None
    uploaded_filename = write_uploaded_image(params, field_prefix, filename_prefix)
    if uploaded_filename:
        return uploaded_filename
    _, existing_filename = find_custom_asset(filename_prefix)
    if existing_filename:
        return existing_filename
    raise ValueError(f'{filename_prefix}.(svg|png|webp) is required when custom image is enabled.')


def persist_external_inputs(params):
    logo_filename = persist_custom_image(params, 'useCustomLogo', 'masjidLogoUpload', 'custom-masjid-logo')
    if logo_filename:
        params['masjidLogo'] = logo_filename
    else:
        params['masjidLogo'] = 'masjid-logo.png'

    building_filename = persist_custom_image(params, 'useCustomBuildingImage', 'masjidBuildingUpload', 'custom-masjid-building')
    if building_filename:
        params['masjidBuildingImage'] = building_filename
    else:
        params['masjidBuildingImage'] = 'masjid-building-optimized.svg'

    persist_custom_schedule(params, 'useCustomPrayersSchedule', 'prayersSchedule', CUSTOM_PRAYERS_FILE, 'Full year schedule', validate_prayers_schedule)

    # Always persist iqamah, notifications, nearby to their own JSON files
    persist_json_data(params, 'iqamahSettings', CUSTOM_IQAMAH_FILE, 'Iqamah settings')
    persist_json_data(params, 'notificationsData', CUSTOM_NOTIFICATIONS_FILE, 'Notifications')
    persist_json_data(params, 'nearbyMasjids', CUSTOM_NEARBY_FILE, 'Nearby masjids')


def persist_custom_schedule(params, enabled_key, data_key, path, label, validator):
    if not bool_param(params, enabled_key):
        params[data_key] = ''
        return
    raw = str(params.get(data_key, '')).strip()
    if raw:
        value = validator(validate_and_parse_json(raw, label))
        write_json_file(path, value)
        params[data_key] = json.dumps(value, ensure_ascii=False)
        return
    if os.path.isfile(path):
        params[data_key] = read_text(path)
        return
    raise ValueError(f'{label} custom file is required when custom schedule is enabled.')


def persist_json_data(params, data_key, path, label):
    """Always persist JSON list data to its own file (not inline in state)."""
    raw = str(params.get(data_key, '')).strip()
    if raw:
        value = validate_list(validate_and_parse_json(raw, label), label)
        if value is not None:
            write_json_file(path, value)
            params[data_key] = json.dumps(value, ensure_ascii=False)
            return
    if os.path.isfile(path):
        params[data_key] = read_text(path)
        return
    params[data_key] = ''


def copy_custom_images_to_build(build_dir, params):
    if bool_param(params, 'useCustomLogo'):
        source, filename = find_custom_asset('custom-masjid-logo')
        if not source:
            raise ValueError('custom-masjid-logo.(svg|png|webp) is required when custom logo is enabled.')
        target = os.path.join(build_dir, 'assets', 'images', 'logos', filename)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copyfile(source, target)
        params['masjidLogo'] = filename

    if bool_param(params, 'useCustomBuildingImage'):
        source, filename = find_custom_asset('custom-masjid-building')
        if not source:
            raise ValueError('custom-masjid-building.(svg|png|webp) is required when custom building image is enabled.')
        target = os.path.join(build_dir, 'assets', 'images', 'backgrounds', filename)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copyfile(source, target)
        params['masjidBuildingImage'] = filename


def safe_archive_name(params):
    raw_name = str(params.get('masjidName', 'masjid')).lower().replace(' ', '-')
    safe_name = re.sub(r'[^a-zA-Z0-9-]', '', raw_name) or 'masjid'
    version = str(params.get('appVersion', '1.0.0'))
    return f'{safe_name}-pwa-v{version}.tar.gz'


def create_archive(build_dir, archive_path):
    with tarfile.open(archive_path, mode='w:gz') as tar:
        tar.add(build_dir, arcname='masjid-pwa')


def generate_pwa(params):
    """Copy source, apply customizations, write archive, return metadata."""
    if not os.path.isdir(SOURCE_DIR):
        raise FileNotFoundError(f'Source directory not found: {SOURCE_DIR}')

    os.makedirs(BUILD_ROOT, exist_ok=True)
    if os.path.isdir(BUILD_DIR):
        shutil.rmtree(BUILD_DIR)

    shutil.copytree(SOURCE_DIR, BUILD_DIR, ignore=shutil.ignore_patterns(
        '.git', '.gitignore', 'DOCS', '__pycache__', '*.pyc'
    ))

    persist_external_inputs(params)
    copy_custom_images_to_build(BUILD_DIR, params)

    # Write app-config.json and inject into config.js
    app_config = write_app_config_json(BUILD_DIR, params)
    inject_config_into_js(BUILD_DIR, app_config)

    manifest_path = os.path.join(BUILD_DIR, 'manifest.json')
    manifest_content = update_manifest(read_text(manifest_path), params)
    write_text(manifest_path, manifest_content)

    index_path = os.path.join(BUILD_DIR, 'index.html')
    index_content = update_index_html(read_text(index_path), params)
    write_text(index_path, index_content)

    version_path = os.path.join(BUILD_DIR, 'version.js')
    version_content = update_version_js(read_text(version_path), params)
    write_text(version_path, version_content)

    write_custom_data_files(BUILD_DIR, params)

    archive_name = safe_archive_name(params)
    archive_path = os.path.join(SCRIPT_DIR, archive_name)
    create_archive(BUILD_DIR, archive_path)

    archive_size = os.path.getsize(archive_path)
    return {
        'archive_path': archive_path,
        'archive_name': archive_name,
        'archive_size': archive_size,
        'build_dir': BUILD_DIR,
        'preview_url': f'http://localhost:{PORT}/pwa/',
    }


def get_source_json(kind):
    rel_path = SOURCE_DATA_FILES.get(kind)
    if not rel_path:
        raise FileNotFoundError('Unknown source JSON.')
    path = os.path.join(SOURCE_DIR, rel_path)
    return read_json_file(path, None)


def read_app_config_defaults():
    """Read default feature arrays from assets/data/app-config.json."""
    config_path = os.path.join(SOURCE_DIR, 'assets', 'data', 'app-config.json')
    config = read_json_file(config_path, {})
    return {
        'masjidFeatures': config.get('masjidFeatures', []),
        'ramadanFeaturesCards': config.get('ramadanFeaturesCards', []),
    }


def current_version():
    version_path = os.path.join(SOURCE_DIR, 'version.js')
    try:
        content = read_text(version_path)
    except FileNotFoundError:
        return ''
    match = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', content)
    return match.group(1) if match else ''


def collect_defaults():
    original_version = current_version()
    version_parts = parse_semver(original_version) or {'base': '1.0', 'patch': 0, 'version': original_version}
    saved_state = load_state()
    saved_version = parse_semver(saved_state.get('appVersion'))
    defaults = {
        'appVersionDefault': original_version,
        'appVersionBase': version_parts['base'],
        'appVersionPatch': saved_version['patch'] if saved_version else version_parts['patch'],
        'customLogoFilename': find_custom_asset('custom-masjid-logo')[1],
        'customBuildingFilename': find_custom_asset('custom-masjid-building')[1],
        'customPrayersData': read_json_file(CUSTOM_PRAYERS_FILE, None),
        'customIqamahData': read_json_file(CUSTOM_IQAMAH_FILE, None),
        'customNotificationsData': read_json_file(CUSTOM_NOTIFICATIONS_FILE, None),
        'customNearbyData': read_json_file(CUSTOM_NEARBY_FILE, None),
        'sourceFiles': {
            key: f'/export/{key}'
            for key in SOURCE_DATA_FILES
        },
    }
    for key in SOURCE_DATA_FILES:
        defaults[f'{key}Data'] = get_source_json(key)

    # Read features from app-config.json (no more regex parsing of config.js)
    app_config_defaults = read_app_config_defaults()
    defaults['masjidFeatures'] = app_config_defaults.get('masjidFeatures', [])
    defaults['ramadanFeaturesCards'] = app_config_defaults.get('ramadanFeaturesCards', [])

    return defaults


_html_cache: bytes | None = None


def _safe_filename(name: str) -> str:
    """Strip characters that could inject CRLF headers from a Content-Disposition filename."""
    return re.sub(r'[\r\n";]', '_', name)


class PWABuilderHandler(http.server.BaseHTTPRequestHandler):
    """HTTP request handler for the PWA Builder portal."""

    def log_message(self, format, *args):
        sys.stderr.write(f"[PWA Builder] {self.address_string()} - {format % args}\n")

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ('/', '/index.html'):
            self._serve_html()
            return
        if path == '/favicon.png':
            # Try build workspace first, then fall back to source
            workspace_favicon = os.path.join(BUILD_DIR, 'assets', 'icons', 'favicon.png')
            source_favicon = os.path.join(SOURCE_DIR, 'assets', 'icons', 'favicon.png')
            favicon_path = workspace_favicon if os.path.isfile(workspace_favicon) else source_favicon
            self._serve_file_if_exists(favicon_path, 'image/png')
            return
        if path == '/health':
            archives = [f for f in os.listdir(SCRIPT_DIR) if f.endswith('.tar.gz')]
            latest = max(archives, key=lambda f: os.path.getmtime(os.path.join(SCRIPT_DIR, f))) if archives else None
            self._send_json(200, {
                'status': 'ok',
                'source': SOURCE_DIR,
                'stateFile': STATE_FILE,
                'buildDir': BUILD_DIR,
                'archive': os.path.join(SCRIPT_DIR, latest) if latest else None,
            })
            return
        if path == '/state':
            self._send_json(200, {'state': load_state(), 'defaults': collect_defaults()})
            return
        if path.startswith('/export/'):
            self._serve_export(path.rsplit('/', 1)[-1])
            return
        if path == '/download/archive':
            self._serve_archive()
            return
        if path == '/pwa' or path.startswith('/pwa/'):
            self._serve_pwa(path)
            return
        if path.startswith('/pwa-build-workspace/'):
            # Serve static assets from build workspace (e.g. favicon referenced in builder HTML)
            rel = path[len('/pwa-build-workspace/'):].strip('/')
            full = os.path.abspath(os.path.join(BUILD_ROOT, rel))
            root = os.path.abspath(BUILD_ROOT)
            if not (full == root or full.startswith(root + os.sep)):
                self.send_error(403)
                return
            if not os.path.isfile(full):
                # Fall back to source PWA directory for pre-build assets
                source_rel = rel.replace('masjid-pwa/', '', 1) if rel.startswith('masjid-pwa/') else rel
                full = os.path.abspath(os.path.join(SOURCE_DIR, source_rel))
                source_root = os.path.abspath(SOURCE_DIR)
                if not (full == source_root or full.startswith(source_root + os.sep)):
                    self.send_error(403)
                    return
                if not os.path.isfile(full):
                    self.send_error(404)
                    return
            ct = mimetypes.guess_type(full)[0] or 'application/octet-stream'
            self._send_file(full, ct)
            return

        self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == '/clean-build':
                self._clean_build()
                return
            if parsed.path == '/clean-archives':
                self._clean_archives()
                return
            if parsed.path == '/reset-all':
                self._reset_all()
                return
            params = self._read_params()
            if parsed.path == '/save':
                save_state(params)
                self._send_json(200, {'ok': True, 'stateFile': STATE_FILE})
                return
            if parsed.path == '/build':
                self._handle_build(params)
                return
            self.send_error(404)
        except ValueError as e:
            self._send_json(400, {'error': str(e)})
        except FileNotFoundError as e:
            self._send_json(500, {'error': str(e)})
        except Exception as e:
            self._send_json(500, {'error': f'Build failed: {str(e)}'})

    def _read_params(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            raise ValueError('Empty request body')
        if content_length > MAX_REQUEST_BYTES:
            raise ValueError('Request too large')

        raw = self.rfile.read(content_length).decode('utf-8')
        content_type = self.headers.get('Content-Type', '')
        if 'application/json' in content_type:
            params = json.loads(raw)
            if not isinstance(params, dict):
                raise ValueError('Request JSON must be an object.')
            return params

        raw_params = parse_qs(raw, keep_blank_values=True)
        return {k: v[0] for k, v in raw_params.items()}

    def _handle_build(self, params):
        if not str(params.get('masjidName', '')).strip():
            self._send_json(400, {'error': 'Masjid Name is required'})
            return
        if not str(params.get('masjidBaseUrl', '')).strip():
            self._send_json(400, {'error': 'Base URL is required'})
            return

        save_state(params)
        meta = generate_pwa(params)
        mode = params.get('buildMode', 'download')
        keep_temp = is_enabled(params, 'keepTempDir')
        keep_archive = is_enabled(params, 'keepArchive')

        if mode == 'build':
            if not keep_archive:
                self._remove_archive_files(meta['archive_path'])
            if not keep_temp and os.path.isdir(BUILD_DIR):
                shutil.rmtree(BUILD_DIR, ignore_errors=True)
            self._send_json(200, {
                'ok': True,
                'message': 'Build complete.',
                'archive': meta['archive_name'] if keep_archive else None,
                'archivePath': meta['archive_path'] if keep_archive else None,
                'buildDir': meta['build_dir'] if keep_temp else None,
                'previewUrl': meta['preview_url'] if keep_temp else None,
            })
            return

        with open(meta['archive_path'], 'rb') as f:
            tar_data = f.read()

        if not keep_archive:
            self._remove_archive_files(meta['archive_path'])
        if not keep_temp and os.path.isdir(BUILD_DIR):
            shutil.rmtree(BUILD_DIR, ignore_errors=True)

        self.send_response(200)
        self.send_header('Content-Type', 'application/gzip')
        # Sanitize archive name to prevent CRLF header injection
        safe_archive_name = _safe_filename(meta['archive_name'])
        self.send_header('Content-Disposition', f'attachment; filename="{safe_archive_name}"')
        self.send_header('Content-Length', str(len(tar_data)))
        self.send_header('X-Preview-Url', meta['preview_url'] if keep_temp else '')
        self.end_headers()
        self.wfile.write(tar_data)

    def _remove_archive_files(self, archive_path):
        if archive_path and os.path.exists(archive_path):
            os.remove(archive_path)

    def _clean_build(self):
        self._clean_build_files_only()
        self._send_json(200, {'ok': True, 'message': 'Local temp build directory was deleted.'})

    def _clean_archives(self):
        count = 0
        for f in os.listdir(SCRIPT_DIR):
            if f.endswith('.tar.gz'):
                try:
                    os.remove(os.path.join(SCRIPT_DIR, f))
                    count += 1
                except OSError:
                    pass
        self._send_json(200, {'ok': True, 'message': f'Deleted {count} old archive files.'})

    def _reset_all(self):
        self._clean_build_files_only()
        for filename in (
            'custom-masjid-logo.svg', 'custom-masjid-logo.png', 'custom-masjid-logo.webp',
            'custom-masjid-building.svg', 'custom-masjid-building.png', 'custom-masjid-building.webp',
            'custom-prayers-schedule.json',
            'custom-iqamah-schedule.json', 'custom-notifications.json', 'custom-nearby-masjids.json',
            'pwa-builder-state.json',
        ):
            path = os.path.join(SCRIPT_DIR, filename)
            if os.path.exists(path):
                os.remove(path)
        self._send_json(200, {'ok': True, 'message': 'All local builder state, custom data, temp builds, and archives were reset.'})

    def _clean_build_files_only(self):
        shutil.rmtree(BUILD_ROOT, ignore_errors=True)

    def _serve_html(self):
        global _html_cache
        try:
            if _html_cache is None:
                _html_cache = read_text(HTML_FILE).encode('utf-8')
            data = _html_cache
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b'Error: pwa-builder.html not found alongside pwa-builder.py')

    def _serve_export(self, kind):
        data = get_source_json(kind)
        if data is None:
            self.send_error(404)
            return
        pretty = json.dumps(data, indent=2, ensure_ascii=False).encode('utf-8')
        filename = os.path.basename(SOURCE_DATA_FILES[kind])
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.send_header('Content-Length', str(len(pretty)))
        self.end_headers()
        self.wfile.write(pretty)

    def _serve_archive(self):
        # Find the latest generated archive in the script directory
        archives = [f for f in os.listdir(SCRIPT_DIR) if f.endswith('.tar.gz')]
        if not archives:
            self.send_error(404, 'No archive has been built yet.')
            return

        # Get the newest one by modification time
        latest = max(archives, key=lambda f: os.path.getmtime(os.path.join(SCRIPT_DIR, f)))
        path = os.path.join(SCRIPT_DIR, latest)
        # Guard against reading an unexpectedly huge archive into memory
        archive_size = os.path.getsize(path)
        if archive_size > MAX_ARCHIVE_DOWNLOAD_BYTES:
            self.send_error(500, 'Archive too large to serve in-memory.')
            return
        self._send_file(path, 'application/gzip', latest)

    def _serve_file_if_exists(self, path, content_type):
        if not os.path.isfile(path):
            self.send_error(404)
            return
        self._send_file(path, content_type)

    def _serve_pwa(self, request_path):
        if not os.path.isdir(BUILD_DIR):
            self._send_html_message(404, 'No customized PWA has been built yet.')
            return
        rel_path = request_path[len('/pwa/'):].strip('/') if request_path.startswith('/pwa/') else ''
        if rel_path == '':
            rel_path = 'index.html'
        rel_path = unquote(rel_path)
        full_path = os.path.abspath(os.path.join(BUILD_DIR, rel_path))
        build_root = os.path.abspath(BUILD_DIR)
        if not (full_path == build_root or full_path.startswith(build_root + os.sep)):
            self.send_error(403)
            return
        if os.path.isdir(full_path):
            full_path = os.path.join(full_path, 'index.html')
        if not os.path.isfile(full_path):
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(full_path)[0] or 'application/octet-stream'
        self._send_file(full_path, content_type)

    def _send_file(self, path, content_type, filename=None):
        with open(path, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        if filename:
            # Sanitize to prevent CRLF header injection via a crafted filename
            safe_name = _safe_filename(filename)
            self.send_header('Content-Disposition', f'attachment; filename="{safe_name}"')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_html_message(self, code, message):
        data = f'<!doctype html><title>PWA Preview</title><p>{html_mod.escape(message)}</p>'.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class ReusableTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


# --- CLI Helper Functions ---

def has_arg(long_name, short_name=None):
    return long_name in sys.argv or (short_name and short_name in sys.argv)


def get_arg_value(long_name, short_name=None):
    for i, arg in enumerate(sys.argv):
        if arg == long_name or (short_name and arg == short_name):
            if i + 1 < len(sys.argv):
                return sys.argv[i + 1]
    return None


def print_box(title):
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")


def handle_help():
    print_box("Masjid PWA Builder - Usage Guide")
    print("\n  Interactive Mode:")
    print("    python3 pwa-builder.py [--port 8080]")
    print("    Starts a local web portal for customization and manual builds.")
    
    print("\n  Headless CLI Mode:")
    print("    python3 pwa-builder.py --status, -s")
    print("    Shows current version and status of custom data files.")
    
    print("\n    python3 pwa-builder.py --build, -b")
    print("    Performs a build using the current saved state.")
    
    print("\n    python3 pwa-builder.py --build --increment-patch, -i")
    print("    Increments the patch number in the state, then builds.")
    
    print("\n    python3 pwa-builder.py --build --patch, -p <N>")
    print("    Sets a specific patch number in the state, then builds.")
    
    print("\n  General:")
    print("    --help, -h       Show this help message.")
    print(f"{'=' * 60}\n")
    sys.exit(0)


def handle_status():
    print_box("Masjid PWA Builder Status")
    state = load_state()
    defaults = collect_defaults()
    
    version = state.get('appVersion') or defaults.get('appVersionDefault')
    print(f"  Current Version:  {version}")
    print(f"  Source PWA:       {SOURCE_DIR}")
    print(f"  Build Workspace:  {BUILD_DIR}")
    print(f"  State File:       {STATE_FILE}")
    
    # Check if custom files exist
    for key, path in [
        ('Prayers Schedule', CUSTOM_PRAYERS_FILE),
        ('Iqamah Schedule', CUSTOM_IQAMAH_FILE),
        ('Notifications', CUSTOM_NOTIFICATIONS_FILE),
        ('Nearby Masjids', CUSTOM_NEARBY_FILE),
    ]:
        exists = "Exists" if os.path.isfile(path) else "Not Found"
        print(f"  {key:<18}: {exists}")
        
    print(f"{'=' * 60}\n")
    sys.exit(0)


def handle_headless_build():
    print_box("Masjid PWA Headless Build")
    
    try:
        state = load_state()
        if not state:
            print("ERROR: No saved state found. Please run the portal once or provide a state file.")
            sys.exit(1)
        
        updated_state = False
        
        # Sync major.minor from source version.js
        source_ver = current_version()
        source_parts = parse_semver(source_ver)
        if source_parts:
            old_base = state.get('appVersionBase')
            if old_base != source_parts['base']:
                print(f"  Syncing Version:  {old_base} -> {source_parts['base']} (from source)")
                state['appVersionBase'] = source_parts['base']
                # Reset patch to 0 if major.minor changed
                state['appVersionPatch'] = '0'
                state['appVersion'] = f"{source_parts['base']}.0"
                updated_state = True
        
        # Handle patch number overrides
        new_patch = get_arg_value('--patch', '-p')
        if new_patch:
            if re.fullmatch(r'\d+', new_patch):
                state['appVersionPatch'] = new_patch
                base = state.get('appVersionBase', '1.0')
                state['appVersion'] = f"{base}.{new_patch}"
                print(f"  Version Override: {state['appVersion']}")
                updated_state = True
            else:
                print(f"ERROR: Invalid patch number: {new_patch}")
                sys.exit(1)
        elif has_arg('--increment-patch', '-i'):
            current_patch = state.get('appVersionPatch', '0')
            if not str(current_patch).isdigit():
                current_patch = '0'
            new_patch = str(int(current_patch) + 1)
            state['appVersionPatch'] = new_patch
            base = state.get('appVersionBase', '1.0')
            state['appVersion'] = f"{base}.{new_patch}"
            print(f"  Incremented to:   {state['appVersion']}")
            updated_state = True

        # Ensure build settings are correct for headless mode
        state['buildMode'] = 'build'
        state['keepTempDir'] = True
        state['keepArchive'] = True
        
        if updated_state:
            save_state(state)
        
        meta = generate_pwa(state)
        
        print(f"  Status:   SUCCESS")
        print(f"  Built to: {meta['build_dir']}")
        print(f"  Archive:  {meta['archive_path']}")
        print(f"  Version:  {state.get('appVersion', 'unknown')}")
        print(f"{'=' * 60}\n")
        sys.exit(0)
    except Exception as e:
        print(f"  Status:   FAILED")
        print(f"  Error:    {str(e)}")
        # import traceback; traceback.print_exc()
        print(f"{'=' * 60}\n")
        sys.exit(1)


def main():
    if not os.path.isdir(SOURCE_DIR):
        print(f"ERROR: Source PWA directory not found at: {SOURCE_DIR}")
        print("Make sure 'masjid-web-app' exists alongside 'pwa-guide-and-tools'.")
        sys.exit(1)

    if has_arg('--help', '-h'):
        handle_help()

    if has_arg('--status', '-s'):
        handle_status()

    if has_arg('--build', '-b'):
        handle_headless_build()

    if not os.path.isfile(HTML_FILE):
        print(f"ERROR: UI file not found at: {HTML_FILE}")
        print("Make sure 'pwa-builder.html' exists in the same directory as this script.")
        sys.exit(1)

    print_box("Masjid PWA Builder")
    print(f"  Portal:   http://localhost:{PORT}")
    print(f"  Preview:  http://localhost:{PORT}/pwa/")
    print(f"  Source:   {SOURCE_DIR}")
    print(f"  State:    {STATE_FILE}")
    print("  Press Ctrl+C to stop")
    print(f"{'=' * 60}\n")

    with ReusableTCPServer(('', PORT), PWABuilderHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down PWA Builder...")
            httpd.shutdown()


if __name__ == '__main__':
    main()
