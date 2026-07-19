/**
 * crypto.js — Administrator password hashing.
 *
 * SCOPE AND LIMITS — please read before relying on this.
 * ------------------------------------------------------------------
 * The password gate stops a curious user from wandering into admin.html.
 * It is NOT a security boundary: anyone holding the USB drive can open
 * data/database.js in Notepad, replace the stored hash, and let themselves
 * in — and nothing in a client-side app can prevent that. Treat physical
 * possession of the drive as full administrative access, and do not reuse a
 * password here that protects anything else.
 *
 * What this module does provide is that the plaintext password is never
 * written to disk, and that a leaked database file does not hand out a
 * password the administrator may have reused elsewhere. Hence PBKDF2 with a
 * per-install random salt rather than a bare SHA-256.
 */
(function (NS) {
  'use strict';

  var Utils = NS.require('Utils');
  var Sha256 = NS.require('Sha256');

  var ALGO = 'PBKDF2-SHA256';
  var ITERATIONS = 150000;
  var KEY_LENGTH = 32; // bytes
  var SALT_LENGTH = 16; // bytes

  var subtle = (window.crypto && window.crypto.subtle) || null;

  /** @returns {Uint8Array} cryptographically random bytes. */
  function randomBytes(n) {
    var buf = new Uint8Array(n);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(buf);
      return buf;
    }

    // Math.random is not a CSPRNG. Reaching this branch means the browser is
    // ancient or crippled; a weak salt still beats refusing to run offline.
    NS.require('Logger').warn(
      'crypto: getRandomValues is unavailable — falling back to a weak salt.'
    );
    for (var i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256);
    return buf;
  }

  /**
   * Derives the PBKDF2 key. Uses WebCrypto when available (fast, native) and
   * the JS implementation otherwise. Both paths are the same algorithm with
   * the same parameters, so their outputs are interchangeable.
   * @returns {Promise<Uint8Array>}
   */
  function derive(password, saltBytes, iterations) {
    var pwBytes = Utils.utf8ToBytes(password);

    if (subtle && typeof subtle.importKey === 'function') {
      return subtle
        .importKey('raw', pwBytes, { name: 'PBKDF2' }, false, ['deriveBits'])
        .then(function (key) {
          return subtle.deriveBits(
            {
              name: 'PBKDF2',
              salt: saltBytes,
              iterations: iterations,
              hash: 'SHA-256',
            },
            key,
            KEY_LENGTH * 8
          );
        })
        .then(function (bits) {
          return new Uint8Array(bits);
        })
        .catch(function (err) {
          NS.require('Logger').warn(
            'crypto: WebCrypto PBKDF2 failed, using the JS fallback.',
            err
          );
          return Sha256.pbkdf2(pwBytes, saltBytes, iterations, KEY_LENGTH);
        });
    }

    // Yield first so the caller can paint a "working…" state: the JS path
    // takes a few hundred ms and blocks the main thread.
    return Utils.yieldToUi().then(function () {
      return Sha256.pbkdf2(pwBytes, saltBytes, iterations, KEY_LENGTH);
    });
  }

  var Crypto = {
    ALGO: ALGO,
    MIN_PASSWORD_LENGTH: 4,

    /** True when the native, non-blocking implementation is in use. */
    isNative: function () {
      return !!(subtle && typeof subtle.importKey === 'function');
    },

    /**
     * Hashes a new password into a storable credential record.
     * @param {string} password
     * @returns {Promise<{algo:string,iterations:number,salt:string,hash:string,updatedAt:string}>}
     */
    hashPassword: function (password) {
      var salt = randomBytes(SALT_LENGTH);
      return derive(password, salt, ITERATIONS).then(function (key) {
        return {
          algo: ALGO,
          iterations: ITERATIONS,
          salt: Utils.bytesToBase64(salt),
          hash: Utils.bytesToBase64(key),
          updatedAt: Utils.nowIso(),
        };
      });
    },

    /**
     * Verifies a password against a stored credential record.
     * Re-reads `iterations` from the record rather than the constant, so
     * credentials created by an older build keep verifying after an upgrade.
     * @param {string} password
     * @param {Object} record
     * @returns {Promise<boolean>}
     */
    verifyPassword: function (password, record) {
      if (!record || !record.salt || !record.hash) return Promise.resolve(false);

      if (record.algo && record.algo !== ALGO) {
        return Promise.reject(
          new Error('שיטת ההצפנה של הסיסמה אינה נתמכת: ' + record.algo)
        );
      }

      var salt;
      try {
        salt = Utils.base64ToBytes(record.salt);
      } catch (e) {
        return Promise.reject(new Error('רשומת הסיסמה השמורה פגומה.'));
      }

      var iterations = Number(record.iterations) || ITERATIONS;

      return derive(password, salt, iterations).then(function (key) {
        return Utils.timingSafeEqual(Utils.bytesToBase64(key), record.hash);
      });
    },

    /**
     * Rates password strength for the setup form.
     * @param {string} password
     * @returns {{score:number, label:string}} score 0–4
     */
    strength: function (password) {
      var p = String(password || '');
      var score = 0;

      if (p.length >= 4) score++;
      if (p.length >= 8) score++;
      if (p.length >= 12) score++;
      if (/[^a-zA-Z0-9]/.test(p) || (/[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p)))
        score++;

      var labels = ['חלשה מאוד', 'חלשה', 'סבירה', 'טובה', 'חזקה'];
      return { score: score, label: labels[Utils.clamp(score, 0, 4)] };
    },
  };

  NS.define('Crypto', Crypto);
})(window.USBLib);
