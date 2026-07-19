/**
 * persist.js — Writing the database back to the USB drive.
 *
 * Always writes BOTH files, always in this order:
 *   data/database.js    the mirror the pages actually load over file://
 *   data/database.json  the canonical, readable, diffable copy
 *
 * database.js is written first on purpose. If the second write fails (drive
 * pulled, disk full), the catalog is still correct — it only ever reads the
 * .js mirror — and the .json is merely stale. The reverse order would leave a
 * correct .json that no page on a USB drive can read.
 */
(function (NS) {
  'use strict';

  var Utils = NS.require('Utils');
  var Paths = NS.require('Paths');
  var Fs = NS.require('Fs');
  var Db = NS.require('Db');
  var Logger = NS.require('Logger');

  var JS_PATH = 'data/database.js';
  var JSON_PATH = 'data/database.json';

  var BANNER =
    '/**\n' +
    ' * database.js — GENERATED FILE. DO NOT EDIT BY HAND.\n' +
    ' *\n' +
    ' * This is a mirror of data/database.json, wrapped so that a page opened\n' +
    ' * from a USB drive (file://) can load it with a plain <script> tag —\n' +
    ' * fetch() of the .json is blocked by CORS on local files.\n' +
    ' *\n' +
    ' * Both files are rewritten together by the administrator console\n' +
    ' * (admin.html). Editing this one by hand will be overwritten on the next\n' +
    ' * save, and editing only the .json will have no effect on what users see.\n' +
    ' */\n';

  var Persist = {
    JS_PATH: JS_PATH,
    JSON_PATH: JSON_PATH,

    /**
     * Serializes the database to pretty-printed JSON.
     * @param {Object} db
     * @returns {string}
     */
    toJson: function (db) {
      var copy = Utils.clone(db);
      copy.meta = copy.meta || {};
      copy.meta.generatedAt = Utils.nowIso();
      copy.meta.generatedBy = 'admin.html';
      copy.meta.appVersion = NS.VERSION;
      return JSON.stringify(copy, null, 2);
    },

    /**
     * Wraps JSON into the loadable mirror.
     * @param {string} json
     * @returns {string}
     */
    toScript: function (json) {
      return BANNER + 'window.' + Db.GLOBAL_KEY + ' = ' + json + ';\n';
    },

    /**
     * Saves in place using a granted directory handle.
     * @param {FileSystemDirectoryHandle} rootHandle
     * @param {Object} db
     * @returns {Promise<{method:string, files:string[]}>}
     */
    saveToHandle: function (rootHandle, db) {
      var json = Persist.toJson(db);
      var script = Persist.toScript(json);

      return Fs.writeTextFile(rootHandle, JS_PATH, script)
        .then(function () {
          return Fs.writeTextFile(rootHandle, JSON_PATH, json);
        })
        .then(function () {
          Logger.info('persist: wrote both database files in place');
          return { method: 'handle', files: [JS_PATH, JSON_PATH] };
        });
    },

    /**
     * Saves by downloading both files, for browsers without in-place writing.
     * The administrator then drops them into data/ — the console explains this
     * rather than leaving them to guess.
     * @param {Object} db
     * @returns {Promise<{method:string, files:string[]}>}
     */
    saveViaDownload: function (db) {
      var json = Persist.toJson(db);
      var script = Persist.toScript(json);

      Fs.downloadText('database.js', script, 'text/javascript');

      // A brief gap keeps Chromium from treating the pair as a suspicious
      // multi-file download burst.
      return Utils.delay(600)
        .then(function () {
          Fs.downloadText('database.json', json, 'application/json');
          Logger.info('persist: exported both database files as downloads');
          return { method: 'download', files: ['database.js', 'database.json'] };
        });
    },

    /**
     * Saves using the desktop app's native command — the data/database.json
     * beside the .exe is written directly, no download/drag-in step needed.
     * @param {Object} db
     * @returns {Promise<{method:string, files:string[]}>}
     */
    saveNative: function (db) {
      var json = Persist.toJson(db);

      return window.__TAURI__.core
        .invoke('write_database', { json: json })
        .then(function () {
          Logger.info('persist: wrote database.json via the desktop app');
          return { method: 'native', files: ['data/database.json'] };
        })
        .catch(function (err) {
          Logger.error('persist: native write failed —', err && err.message ? err.message : err);
          return Persist.saveViaDownload(db).then(function (result) {
            result.fallbackReason = String(err && err.message ? err.message : err);
            return result;
          });
        });
    },

    /**
     * Saves using the best available method.
     * @param {Object} options
     * @param {Object} options.db
     * @param {FileSystemDirectoryHandle} [options.rootHandle]
     * @returns {Promise<{method:string, files:string[]}>}
     */
    save: function (options) {
      var opts = options || {};

      if (window.__TAURI__) return Persist.saveNative(opts.db);

      if (!opts.rootHandle) return Persist.saveViaDownload(opts.db);

      return Fs.ensurePermission(opts.rootHandle, 'readwrite')
        .then(function (granted) {
          if (!granted) {
            Logger.warn('persist: write permission denied — exporting instead');
            return Persist.saveViaDownload(opts.db);
          }
          return Persist.saveToHandle(opts.rootHandle, opts.db);
        })
        .catch(function (err) {
          Logger.error('persist: in-place write failed —', err.message);
          // Falling back rather than failing means the administrator's work is
          // never lost just because the drive was write-protected.
          return Persist.saveViaDownload(opts.db).then(function (result) {
            result.fallbackReason = err.message;
            return result;
          });
        });
    },

    /**
     * Stores an uploaded image.
     *
     * With a directory handle the bytes go to images/ and the database keeps a
     * short relative path. Without one, the image is embedded as a data URL:
     * it makes the database bigger, but it cannot break, and it means icon
     * uploads still work on Firefox.
     *
     * @param {Object} options
     * @param {Blob} options.blob
     * @param {string} options.fileName
     * @param {string} options.subFolder e.g. "icons"
     * @param {FileSystemDirectoryHandle} [options.rootHandle]
     * @returns {Promise<string>} the value to store on the item
     */
    saveImage: function (options) {
      var opts = options;
      var relPath = Paths.join('images', opts.subFolder || '', opts.fileName);

      if (window.__TAURI__) {
        return Utils.readAsDataURL(opts.blob).then(function (dataUrl) {
          var base64 = String(dataUrl).split(',')[1] || '';

          return window.__TAURI__.core
            .invoke('write_image', { relPath: relPath, base64Data: base64 })
            .then(function () {
              return relPath;
            })
            .catch(function (err) {
              Logger.warn(
                'persist: native image write failed, embedding instead —',
                err && err.message ? err.message : err
              );
              return dataUrl;
            });
        });
      }

      if (!opts.rootHandle) {
        return Utils.readAsDataURL(opts.blob);
      }

      return Fs.ensurePermission(opts.rootHandle, 'readwrite')
        .then(function (granted) {
          if (!granted) return Utils.readAsDataURL(opts.blob);

          return Fs.writeBinaryFile(opts.rootHandle, relPath, opts.blob)
            .then(function () {
              return relPath;
            })
            .catch(function (err) {
              Logger.warn('persist: image write failed, embedding instead —', err.message);
              return Utils.readAsDataURL(opts.blob);
            });
        });
    },

    /**
     * Downsizes an image before storing it.
     *
     * Icons are pasted straight off the web at 1024px and an untouched one
     * would add ~1 MB to a database that gets parsed on every page load.
     * Re-encoding to PNG at a sane size keeps the catalog fast.
     *
     * @param {File|Blob} file
     * @param {number} maxSize longest edge, px
     * @returns {Promise<Blob>}
     */
    resizeImage: function (file, maxSize) {
      var limit = maxSize || 256;

      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();

        img.onload = function () {
          URL.revokeObjectURL(url);

          var scale = Math.min(1, limit / Math.max(img.width, img.height));

          // Already small enough — don't re-encode and lose quality for nothing.
          if (scale >= 1) {
            resolve(file);
            return;
          }

          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));

          var ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('עיבוד התמונה נכשל.'));
          }, 'image/png');
        };

        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('לא ניתן לקרוא את קובץ התמונה.'));
        };

        img.src = url;
      });
    },

    /**
     * Exports the database as a timestamped backup download.
     * @param {Object} db
     */
    exportBackup: function (db) {
      var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      Fs.downloadText('database-backup-' + stamp + '.json', Persist.toJson(db), 'application/json');
      Logger.info('persist: exported a backup');
    },

    /**
     * Reads a backup file chosen by the administrator.
     * Only parses and validates — the caller decides whether to adopt it.
     * @param {File} file
     * @returns {Promise<Object>} the parsed raw database
     */
    importBackup: function (file) {
      return Utils.readAsText(file).then(function (text) {
        var parsed;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          throw new Error('הקובץ אינו קובץ JSON תקין.');
        }

        if (!Utils.isPlainObject(parsed) || !Array.isArray(parsed.items)) {
          throw new Error('הקובץ אינו נראה כמו גיבוי של ספריית התוכנות.');
        }

        return parsed;
      });
    },
  };

  NS.define('admin.Persist', Persist);
})(window.USBLib);
