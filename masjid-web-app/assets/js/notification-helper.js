/**
 * Notification Helper — unified abstraction for browser (Web Push) and
 * Capacitor Local Notifications.
 *
 * On Android (Capacitor), notifications use NATIVE SOUND playback via
 * notification channels. This means azan/beep plays even when the app
 * is closed or the screen is off.
 *
 * On Web (PWA), notifications are visual-only; JS audio handles sound.
 */
const PrayerNotification = (function () {
  'use strict';

  // Access Capacitor from main frame (it's not injected into iframes)
  let capWindow = null;
  try {
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      capWindow = window;
    } else if (window.parent && window.parent.Capacitor && window.parent.Capacitor.isNativePlatform && window.parent.Capacitor.isNativePlatform()) {
      capWindow = window.parent;
    }
  } catch (e) {
    capWindow = null;
  }

  const isCapacitor = !!capWindow;
  const PERMISSION_CACHE_KEY = 'masjid_notif_permission_granted';

  // Android notification channels — each has its own sound locked at creation
  // Once created, sound can only be changed by the user in system settings.
  const CHANNELS = {
    azan_fajr: {
      id: 'prayer_azan_fajr',
      name: 'Fajr Azan',
      description: 'Full Fajr azan for Fajr prayer notifications',
      sound: 'fajr_mashari',
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#10b981'
    },
    azan: {
      id: 'prayer_azan',
      name: 'Prayer Azan',
      description: 'Full Makka azan for prayer notifications',
      sound: 'azan_makka',
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#10b981'
    },
    beep: {
      id: 'prayer_beep_custom_mp3',
      name: 'Prayer Beep',
      description: 'Custom prayer beep sound for prayer alerts',
      sound: 'prayer_beep',
      importance: 4,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#DB8D0D'
    },
    silent: {
      id: 'prayer_silent_mp3',
      name: 'Silent Prayer Alert',
      description: 'Visual prayer notification with a silent audio track',
      sound: 'prayer_silent',
      importance: 3,
      visibility: 1,
      vibration: false,
      lights: true,
      lightColor: '#10b981'
    }
  };

  var channelsCreated = false;

  // ---------- Timeout wrapper ----------
  function withTimeout(promise, ms) {
    ms = ms || 3000;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        resolve(undefined);
      }, ms);
      promise.then(function (result) {
        clearTimeout(timer);
        resolve(result);
      }).catch(function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // ---------- Channel helpers ----------

  /**
   * Pick the right notification channel for a prayer + type combo.
   */
  function getChannelForPrayer(prayerKey, type) {
    if (type === 'silent') {
      return CHANNELS.silent;
    }
    if (type === 'azan') {
      return (prayerKey === 'fajr') ? CHANNELS.azan_fajr : CHANNELS.azan;
    }
    return CHANNELS.beep;
  }

  /**
   * Ensure all notification channels are created (Android 8+).
   * This is idempotent — Android ignores re-creation of existing channels.
   */
  async function ensureChannels() {
    if (!isCapacitor || channelsCreated) return;

    try {
      var LocalNotifications = capWindow.Capacitor.Plugins.LocalNotifications;
      var allChannels = [CHANNELS.azan_fajr, CHANNELS.azan, CHANNELS.beep, CHANNELS.silent];

      // Create all channels in parallel instead of sequentially to reduce delay
      var channelPromises = allChannels.map(function (ch) {
        var channelDef = {
          id: ch.id,
          name: ch.name,
          description: ch.description,
          importance: ch.importance,
          visibility: ch.visibility,
          vibration: ch.vibration,
          lights: ch.lights,
          lightColor: ch.lightColor
        };
        if (Object.prototype.hasOwnProperty.call(ch, 'sound')) {
          channelDef.sound = ch.sound;
        }
        return withTimeout(LocalNotifications.createChannel(channelDef), 2000).catch(function (chErr) {
          console.log('Channel ' + ch.id + ' note:', chErr);
          return null; // Don't fail the whole operation for one channel
        });
      });

      await Promise.all(channelPromises);
      channelsCreated = true;
      console.log('Notification channels created');
    } catch (e) {
      console.error('Failed to create notification channels:', e);
    }
  }

  // ---------- Permission helpers ----------

  async function requestPermission() {
    if (isCapacitor) {
      try {
        var LocalNotifications = capWindow.Capacitor.Plugins.LocalNotifications;
        var result = await withTimeout(LocalNotifications.requestPermissions(), 5000);
        if (result === undefined) {
          // Bridge often times out from iframes — use cache if available,
          // otherwise assume granted (Android default).
          var cached = localStorage.getItem(PERMISSION_CACHE_KEY);
          var assumed = cached !== null ? cached === 'true' : true;
          localStorage.setItem(PERMISSION_CACHE_KEY, assumed ? 'true' : 'false');
          return assumed;
        }
        var granted = result.display === 'granted';
        localStorage.setItem(PERMISSION_CACHE_KEY, granted ? 'true' : 'false');
        return granted;
      } catch (e) {
        console.error('Capacitor permission request failed:', e);
        return false;
      }
    }

    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') {
      localStorage.setItem(PERMISSION_CACHE_KEY, 'true');
      return true;
    }
    if (Notification.permission === 'denied') return false;

    var result = await Notification.requestPermission();
    var granted = result === 'granted';
    localStorage.setItem(PERMISSION_CACHE_KEY, granted ? 'true' : 'false');
    return granted;
  }

  async function hasPermission() {
    var cached = localStorage.getItem(PERMISSION_CACHE_KEY);

    if (isCapacitor) {
      try {
        var LocalNotifications = capWindow.Capacitor.Plugins.LocalNotifications;
        var status = await withTimeout(LocalNotifications.checkPermissions(), 2000);
        if (status !== undefined) {
          var granted = status.display === 'granted';
          localStorage.setItem(PERMISSION_CACHE_KEY, granted ? 'true' : 'false');
          return granted;
        }
      } catch (e) { /* fall through */ }
      return cached === 'true';
    }

    if (!('Notification' in window)) return false;
    var granted = Notification.permission === 'granted';
    localStorage.setItem(PERMISSION_CACHE_KEY, granted ? 'true' : 'false');
    return granted;
  }

  async function hasExactAlarmPermission() {
    if (!isCapacitor) return true;

    try {
      // With USE_EXACT_ALARM declared in Manifest for Android 13+, 
      // the permission is effectively granted on install for prayer apps.
      // We keep this check for future-proofing or if a custom plugin adds support.
      var LocalNotifications = capWindow.Capacitor.Plugins.LocalNotifications;
      if (!LocalNotifications) return true;

      if (LocalNotifications.checkExactNotificationSetting) {
        var status = await withTimeout(LocalNotifications.checkExactNotificationSetting(), 2000);
        if (status && typeof status.exact_alarm === 'string') {
          return status.exact_alarm === 'granted';
        }
      }
    } catch (e) {
      console.warn('Exact alarm permission check failed:', e);
    }

    return true;
  }

  async function requestExactAlarmPermission() {
    if (!isCapacitor) return true;

    try {
      var LocalNotifications = capWindow.Capacitor.Plugins.LocalNotifications;
      if (!LocalNotifications) return true;

      if (LocalNotifications.changeExactNotificationSetting) {
        var result = await withTimeout(LocalNotifications.changeExactNotificationSetting(), 5000);
        if (result && typeof result.exact_alarm === 'string') {
          return result.exact_alarm === 'granted';
        }
      }
      
      console.log('Native bridge for exact alarm setting request not found. Standard POST_NOTIFICATIONS is used.');
    } catch (e) {
      console.warn('Exact alarm permission request failed:', e);
    }

    return false;
  }

  // ---------- Web-only notification (visual, no sound) ----------

  /**
   * Show a visual browser notification (Web/PWA only).
   * Sound is handled by JS audio in prayers-tables.js for web.
   */
  async function sendWebNotification(title, body, options) {
    if (isCapacitor) return; // Android uses scheduled notifications with native sound
    options = options || {};

    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    var notifOptions = {
      body: body,
      icon: '../icons/icon_x192.png',
      badge: '../icons/icon_x128.png',
      tag: 'prayer-' + (options.prayerKey || 'generic'),
      renotify: true,
      silent: true, // Sound is handled by JS audio, not the notification
      requireInteraction: false
    };

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      try {
        var reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, notifOptions);
        return;
      } catch (e) {
        console.warn('SW showNotification failed:', e);
      }
    }

    try {
      new Notification(title, notifOptions);
    } catch (e) {
      console.error('Notification constructor failed:', e);
    }
  }

  // ---------- Scheduled Notifications (Capacitor only) ----------

  /**
   * Schedule all prayer notifications for the day.
   * Each notification is assigned to the correct channel so the
   * native sound (azan/beep) plays automatically.
   *
  * @param {Array} prayers — [{ key, name, time: Date, type: 'azan'|'beep'|'silent' }]
   */
  async function scheduleAll(prayers) {
    if (!isCapacitor) return;
    if (!prayers || prayers.length === 0) return;

    // Ensure channels exist before scheduling
    await ensureChannels();

    try {
      var LocalNotifications = capWindow.Capacitor.Plugins.LocalNotifications;
      var notifications = [];
      var now = new Date();

      prayers.forEach(function (prayer) {
        if (!prayer.time || prayer.time <= now) {
          console.warn('Skipping notification for', prayer.name, '- time is in the past or invalid:', prayer.time);
          return;
        }

        var channel = getChannelForPrayer(prayer.key, prayer.type);

        var notif = {
          id: _idForPrayer(prayer.key, 'scheduled'),
          title: '🕌 ' + prayer.name + ' Prayer Time',
          body: 'It is time for ' + prayer.name + ' prayer.',
          schedule: {
            at: prayer.time,
            allowWhileIdle: true,
            exact: true  // Ensure exact timing for prayer notifications
          },
          channelId: channel.id,
          sound: channel.sound || undefined,
          smallIcon: 'ic_stat_masjid',
          largeIcon: 'ic_launcher',
          autoCancel: true
        };

        notifications.push(notif);
        console.log('Scheduled notification for', prayer.name, 'at', prayer.time.toLocaleString());
      });

      if (notifications.length > 0) {
        await withTimeout(
          LocalNotifications.schedule({ notifications: notifications }),
          5000
        );
        console.log('Scheduled', notifications.length, 'prayer notifications with native sound');
      }
    } catch (e) {
      console.error('Failed to schedule notifications:', e);
    }
  }

  /**
   * Cancel all pending prayer notifications.
   */
  async function cancelAll() {
    if (!isCapacitor) return;

    try {
      var LocalNotifications = capWindow.Capacitor.Plugins.LocalNotifications;
      var pending = await withTimeout(LocalNotifications.getPending(), 2000);
      if (pending && pending.notifications && pending.notifications.length > 0) {
        await withTimeout(
          LocalNotifications.cancel({
            notifications: pending.notifications.map(function (n) { return { id: n.id }; })
          }),
          2000
        );
        console.log('Cancelled', pending.notifications.length, 'pending notifications');
      }
    } catch (e) {
      console.error('Failed to cancel notifications:', e);
    }
  }

  // ---------- Internal helpers ----------

  function _idForPrayer(key, suffix) {
    var prayerMap = { fajr: 1, zuhr: 2, asr: 3, maghrib: 4, isha: 5, generic: 9 };
    var base = (prayerMap[key.toLowerCase()] || 9) * 100;
    var suffixMap = { now: 1, scheduled: 2 };
    return base + (suffixMap[suffix] || 0);
  }

  // ---------- Public API ----------

  return {
    isCapacitor: isCapacitor,
    requestPermission: requestPermission,
    hasPermission: hasPermission,
    hasExactAlarmPermission: hasExactAlarmPermission,
    requestExactAlarmPermission: requestExactAlarmPermission,
    sendWebNotification: sendWebNotification,
    scheduleAll: scheduleAll,
    cancelAll: cancelAll,
    ensureChannels: ensureChannels  // Expose for early initialization
  };
})();
