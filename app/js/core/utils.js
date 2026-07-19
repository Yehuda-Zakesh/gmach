/**
 * utils.js — Small, dependency-free helpers shared across the app.
 */
(function (NS) {
  'use strict';

  var HE_LOCALE = 'he-IL';

  var Utils = {
    /**
     * Generates a collision-resistant id. Uses crypto.randomUUID when the
     * browser exposes it, otherwise falls back to random bytes.
     * @param {string} [prefix]
     * @returns {string}
     */
    uid: function (prefix) {
      var p = prefix ? prefix + '_' : '';
      var c = window.crypto || window.msCrypto;

      if (c && typeof c.randomUUID === 'function') {
        return p + c.randomUUID().replace(/-/g, '').slice(0, 16);
      }

      if (c && c.getRandomValues) {
        var buf = new Uint8Array(8);
        c.getRandomValues(buf);
        return p + Array.prototype.map
          .call(buf, function (b) {
            return ('0' + b.toString(16)).slice(-2);
          })
          .join('');
      }

      return p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    },

    /**
     * Trailing-edge debounce.
     * @param {Function} fn
     * @param {number} wait ms
     * @returns {Function} wrapped fn with a .cancel() method
     */
    debounce: function (fn, wait) {
      var t = null;
      var wrapped = function () {
        var args = arguments;
        var self = this;
        if (t) clearTimeout(t);
        t = setTimeout(function () {
          t = null;
          fn.apply(self, args);
        }, wait);
      };
      wrapped.cancel = function () {
        if (t) clearTimeout(t);
        t = null;
      };
      return wrapped;
    },

    /** Deep clone via structuredClone when available, JSON otherwise. */
    clone: function (value) {
      if (typeof structuredClone === 'function') {
        try {
          return structuredClone(value);
        } catch (e) {
          /* Falls through to the JSON path for non-cloneable values. */
        }
      }
      return JSON.parse(JSON.stringify(value));
    },

    /**
     * True for plain objects (not arrays, not null, not class instances).
     *
     * Walks to the end of the prototype chain rather than comparing against
     * this realm's `Object.prototype` directly. An object created in another
     * realm — a different document, an iframe, a sandboxed evaluation of
     * data/database.js — has a *different* Object.prototype, so the identity
     * check would call it "not plain" and the whole database would be
     * silently discarded as corrupt. The failure mode is an empty catalog
     * with no error, which is exactly the kind of thing nobody debugs.
     *
     * @param {*} v
     * @returns {boolean}
     */
    isPlainObject: function (v) {
      if (Object.prototype.toString.call(v) !== '[object Object]') return false;

      var proto = Object.getPrototypeOf(v);
      if (proto === null) return true; // Object.create(null)

      var base = proto;
      while (Object.getPrototypeOf(base) !== null) {
        base = Object.getPrototypeOf(base);
      }

      return proto === base;
    },

    /**
     * Fills in missing keys of `target` from `defaults`, recursing into plain
     * objects. Existing values always win — this is how new schema fields get
     * added to an old database without touching administrator edits.
     * @param {Object} target
     * @param {Object} defaults
     * @returns {Object} target
     */
    applyDefaults: function (target, defaults) {
      Object.keys(defaults).forEach(function (key) {
        var d = defaults[key];
        if (!(key in target) || target[key] === undefined) {
          target[key] = Utils.isPlainObject(d) || Array.isArray(d) ? Utils.clone(d) : d;
        } else if (Utils.isPlainObject(d) && Utils.isPlainObject(target[key])) {
          Utils.applyDefaults(target[key], d);
        }
      });
      return target;
    },

    /** Coerces anything to a trimmed string. */
    str: function (v) {
      if (v === null || v === undefined) return '';
      return String(v).trim();
    },

    /** Clamps n into [min, max]. */
    clamp: function (n, min, max) {
      return Math.min(max, Math.max(min, n));
    },

    /**
     * Formats a byte count for display: 0 -> "0 B", 1536 -> "1.5 KB",
     * 5242880 -> "5 MB". Returns "—" for anything that isn't a real size.
     * @param {number} bytes
     * @returns {string}
     */
    formatSize: function (bytes) {
      var n = Number(bytes);
      if (!isFinite(n) || n < 0) return '—';
      if (n === 0) return '0 B';

      var units = ['B', 'KB', 'MB', 'GB', 'TB'];
      var i = Math.floor(Math.log(n) / Math.log(1024));
      i = Utils.clamp(i, 0, units.length - 1);

      var value = n / Math.pow(1024, i);
      var decimals = value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2;

      // Trailing zeros are noise in a file listing: "5 MB" reads better than
      // "5.00 MB", while "1.5 KB" keeps the precision that matters. Only
      // strip after a decimal point — "100" must not become "1".
      var text = value.toFixed(decimals);
      if (text.indexOf('.') !== -1) text = text.replace(/0+$/, '').replace(/\.$/, '');

      return text + ' ' + units[i];
    },

    /**
     * Formats an ISO date for Hebrew display. Returns "—" for missing/invalid.
     * @param {string} iso
     * @param {boolean} [withTime]
     * @returns {string}
     */
    formatDate: function (iso, withTime) {
      if (!iso) return '—';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '—';

      var opts = { year: 'numeric', month: '2-digit', day: '2-digit' };
      if (withTime) {
        opts.hour = '2-digit';
        opts.minute = '2-digit';
      }

      try {
        return d.toLocaleDateString(HE_LOCALE, opts);
      } catch (e) {
        return d.toISOString().slice(0, withTime ? 16 : 10).replace('T', ' ');
      }
    },

    /** Days elapsed since an ISO date; Infinity when unparseable. */
    daysSince: function (iso) {
      if (!iso) return Infinity;
      var d = new Date(iso);
      if (isNaN(d.getTime())) return Infinity;
      return (Date.now() - d.getTime()) / 86400000;
    },

    /** Current time as an ISO string. */
    nowIso: function () {
      return new Date().toISOString();
    },

    /**
     * Normalizes text for search: lowercase, strips Hebrew niqqud, collapses
     * whitespace and punctuation that users rarely type.
     * @param {string} s
     * @returns {string}
     */
    normalize: function (s) {
      return Utils.str(s)
        .toLowerCase()
        .replace(/[֑-ׇ]/g, '') // Hebrew cantillation + niqqud
        .replace(/[_\-.,()[\]{}'"`|/\\]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },

    /**
     * Locale-aware comparator that sorts Hebrew correctly and falls back
     * gracefully where Intl is unavailable.
     */
    compareText: function (a, b) {
      var x = Utils.str(a);
      var y = Utils.str(b);
      try {
        return x.localeCompare(y, HE_LOCALE, { numeric: true, sensitivity: 'base' });
      } catch (e) {
        return x < y ? -1 : x > y ? 1 : 0;
      }
    },

    /**
     * Stable sort by a list of {key, dir} descriptors.
     * Array.prototype.sort is already stable in modern engines; this wrapper
     * just keeps the comparator declarations readable at call sites.
     * @param {Array} arr mutated in place
     * @param {Function} compare
     */
    sortBy: function (arr, compare) {
      return arr.sort(compare);
    },

    /** Escapes a string for safe use inside a RegExp. */
    escapeRegExp: function (s) {
      return Utils.str(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    /** Reads a File/Blob as a data URL. */
    readAsDataURL: function (file) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () {
          resolve(r.result);
        };
        r.onerror = function () {
          reject(r.error || new Error('קריאת הקובץ נכשלה'));
        };
        r.readAsDataURL(file);
      });
    },

    /** Reads a File/Blob as text. */
    readAsText: function (file) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () {
          resolve(r.result);
        };
        r.onerror = function () {
          reject(r.error || new Error('קריאת הקובץ נכשלה'));
        };
        r.readAsText(file);
      });
    },

    /** Resolves after `ms`. */
    delay: function (ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    },

    /**
     * Yields to the event loop so long synchronous loops (scanning thousands
     * of files) don't freeze the UI thread.
     */
    yieldToUi: function () {
      return new Promise(function (resolve) {
        setTimeout(resolve, 0);
      });
    },

    /** Base64-encodes a Uint8Array. */
    bytesToBase64: function (bytes) {
      var bin = '';
      var chunk = 0x8000; // Avoids "Maximum call stack size exceeded".
      for (var i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(
          null,
          bytes.subarray(i, Math.min(i + chunk, bytes.length))
        );
      }
      return btoa(bin);
    },

    /** Decodes base64 to a Uint8Array. */
    base64ToBytes: function (b64) {
      var bin = atob(b64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },

    /** UTF-8 encodes a string to a Uint8Array. */
    utf8ToBytes: function (s) {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
      return Utils.base64ToBytes(btoa(unescape(encodeURIComponent(s))));
    },

    /**
     * Constant-time-ish string comparison for password hashes. JS strings make
     * true constant time impossible, but this avoids the trivial early-exit
     * of `===` for equal-length inputs.
     */
    timingSafeEqual: function (a, b) {
      var x = String(a);
      var y = String(b);
      if (x.length !== y.length) return false;
      var diff = 0;
      for (var i = 0; i < x.length; i++) {
        diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
      }
      return diff === 0;
    },
  };

  NS.define('Utils', Utils);
})(window.USBLib);
