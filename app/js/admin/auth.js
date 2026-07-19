/**
 * auth.js — The administrator gate.
 *
 * First run has no password stored, so the gate asks the administrator to
 * create one instead of locking them out of their own drive. After that it
 * verifies against the credential record in settings.security.auth.
 *
 * The unlocked flag lives in sessionStorage: closing the tab re-locks the
 * console, but moving between admin views does not re-prompt.
 * See core/crypto.js for what this protects and what it does not.
 */
(function (NS) {
  'use strict';

  var Crypto = NS.require('Crypto');
  var Storage = NS.require('Storage');
  var Logger = NS.require('Logger');

  var SESSION_KEY = 'adminUnlocked';

  /** Slows down repeated guesses without ever locking the drive permanently. */
  var THROTTLE = {
    attempts: 0,
    /** @returns {number} ms to wait before the next attempt is accepted */
    delayMs: function () {
      if (THROTTLE.attempts < 3) return 0;
      return Math.min(4000, (THROTTLE.attempts - 2) * 800);
    },
  };

  var Auth = {
    /**
     * @param {Object} db
     * @returns {boolean} true when no password has been set yet
     */
    needsSetup: function (db) {
      var auth = db.settings.security.auth;
      return !auth || !auth.hash || !auth.salt;
    },

    /** @returns {boolean} */
    isUnlocked: function () {
      return Storage.getSession(SESSION_KEY, false) === true;
    },

    /** Marks the session unlocked. */
    unlock: function () {
      Storage.setSession(SESSION_KEY, true);
    },

    /** Re-locks the console. */
    lock: function () {
      Storage.removeSession(SESSION_KEY);
    },

    /**
     * Verifies a password and unlocks on success.
     * @param {Object} db
     * @param {string} password
     * @returns {Promise<{ok:boolean, message?:string}>}
     */
    login: function (db, password) {
      if (!password) {
        return Promise.resolve({ ok: false, message: 'יש להזין סיסמה.' });
      }

      var wait = THROTTLE.delayMs();

      return new Promise(function (resolve) {
        setTimeout(resolve, wait);
      })
        .then(function () {
          return Crypto.verifyPassword(password, db.settings.security.auth);
        })
        .then(function (ok) {
          if (ok) {
            THROTTLE.attempts = 0;
            Auth.unlock();
            Logger.info('auth: unlocked');
            return { ok: true };
          }

          THROTTLE.attempts++;
          Logger.warn('auth: failed attempt #' + THROTTLE.attempts);
          return { ok: false, message: 'סיסמה שגויה.' };
        })
        .catch(function (err) {
          Logger.error('auth: verification error', err);
          return {
            ok: false,
            message: 'לא ניתן היה לאמת את הסיסמה: ' + err.message,
          };
        });
    },

    /**
     * Creates the first password.
     * @param {Object} db mutated on success
     * @param {string} password
     * @param {string} confirm
     * @returns {Promise<{ok:boolean, message?:string}>}
     */
    setup: function (db, password, confirm) {
      var problem = Auth.validate(password, confirm);
      if (problem) return Promise.resolve({ ok: false, message: problem });

      return Crypto.hashPassword(password)
        .then(function (record) {
          db.settings.security.auth = record;
          Auth.unlock();
          Logger.info('auth: password created');
          return { ok: true };
        })
        .catch(function (err) {
          Logger.error('auth: setup failed', err);
          return { ok: false, message: 'יצירת הסיסמה נכשלה: ' + err.message };
        });
    },

    /**
     * Changes the password. Requires the current one — otherwise anyone who
     * walked up to an unlocked console could lock the real administrator out.
     * @returns {Promise<{ok:boolean, message?:string}>}
     */
    changePassword: function (db, currentPassword, newPassword, confirm) {
      var problem = Auth.validate(newPassword, confirm);
      if (problem) return Promise.resolve({ ok: false, message: problem });

      return Crypto.verifyPassword(currentPassword, db.settings.security.auth)
        .then(function (ok) {
          if (!ok) return { ok: false, message: 'הסיסמה הנוכחית שגויה.' };

          return Crypto.hashPassword(newPassword).then(function (record) {
            db.settings.security.auth = record;
            Logger.info('auth: password changed');
            return { ok: true };
          });
        })
        .catch(function (err) {
          Logger.error('auth: change failed', err);
          return { ok: false, message: 'שינוי הסיסמה נכשל: ' + err.message };
        });
    },

    /**
     * @param {string} password
     * @param {string} confirm
     * @returns {string} an error message, or '' when valid
     */
    validate: function (password, confirm) {
      var p = String(password || '');

      if (p.length < Crypto.MIN_PASSWORD_LENGTH) {
        return 'הסיסמה חייבת להכיל לפחות ' + Crypto.MIN_PASSWORD_LENGTH + ' תווים.';
      }
      if (p !== String(confirm || '')) {
        return 'הסיסמאות אינן תואמות.';
      }
      return '';
    },
  };

  NS.define('admin.Auth', Auth);
})(window.USBLib);
