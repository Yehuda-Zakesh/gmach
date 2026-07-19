/**
 * storage.js — Browser-local persistence.
 *
 * Nothing here is part of the library's data: the USB drive stays the source
 * of truth. This only remembers per-browser conveniences (theme choice) and
 * the FileSystemDirectoryHandle, which cannot be serialized to JSON and must
 * live in IndexedDB.
 *
 * Every method degrades to a no-op rather than throwing: private-browsing
 * windows and locked-down profiles can disable storage entirely, and that
 * must not stop the catalog from rendering.
 */
(function (NS) {
  'use strict';

  var Logger = NS.require('Logger');

  var DB_NAME = 'usblib';
  var DB_VERSION = 1;
  var STORE = 'handles';
  var PREFS_PREFIX = 'usblib.';

  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is unavailable'));
        return;
      }

      var req = window.indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error('IndexedDB open failed'));
      };
    }).catch(function (err) {
      // Cache the failure so we don't retry on every call, but let callers
      // keep working against the no-op paths below.
      Logger.warn('storage: IndexedDB is unavailable —', err.message);
      dbPromise = null;
      throw err;
    });

    return dbPromise;
  }

  function tx(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var req = fn(t.objectStore(STORE));
        t.oncomplete = function () {
          resolve(req ? req.result : undefined);
        };
        t.onerror = function () {
          reject(t.error);
        };
        t.onabort = function () {
          reject(t.error);
        };
      });
    });
  }

  var Storage = {
    /**
     * Stores a structured-cloneable value (used for directory handles).
     * @returns {Promise<boolean>} false when storage is unavailable
     */
    put: function (key, value) {
      return tx('readwrite', function (store) {
        return store.put(value, key);
      })
        .then(function () {
          return true;
        })
        .catch(function (err) {
          Logger.warn('storage: put("' + key + '") failed —', err.message);
          return false;
        });
    },

    /** @returns {Promise<*>} the value, or null. */
    get: function (key) {
      return tx('readonly', function (store) {
        return store.get(key);
      })
        .then(function (v) {
          return v === undefined ? null : v;
        })
        .catch(function () {
          return null;
        });
    },

    /** @returns {Promise<boolean>} */
    remove: function (key) {
      return tx('readwrite', function (store) {
        return store.delete(key);
      })
        .then(function () {
          return true;
        })
        .catch(function () {
          return false;
        });
    },

    /* --- Small preferences (localStorage) -------------------------------- */

    /**
     * @param {string} key
     * @param {*} [fallback]
     * @returns {*}
     */
    getPref: function (key, fallback) {
      try {
        var raw = window.localStorage.getItem(PREFS_PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },

    /** @returns {boolean} */
    setPref: function (key, value) {
      try {
        window.localStorage.setItem(PREFS_PREFIX + key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },

    removePref: function (key) {
      try {
        window.localStorage.removeItem(PREFS_PREFIX + key);
      } catch (e) {
        /* Nothing to do — the preference simply won't persist. */
      }
    },

    /* --- Session flags --------------------------------------------------- */

    getSession: function (key, fallback) {
      try {
        var raw = window.sessionStorage.getItem(PREFS_PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },

    setSession: function (key, value) {
      try {
        window.sessionStorage.setItem(PREFS_PREFIX + key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },

    removeSession: function (key) {
      try {
        window.sessionStorage.removeItem(PREFS_PREFIX + key);
      } catch (e) {
        /* Nothing to do. */
      }
    },
  };

  NS.define('Storage', Storage);
})(window.USBLib);
