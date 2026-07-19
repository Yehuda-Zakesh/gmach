/**
 * logger.js — Console logging with a ring buffer.
 *
 * A `file://` page has no server logs and non-technical administrators will
 * not open DevTools. The ring buffer lets the admin console show recent
 * warnings and export them when something needs to be reported.
 */
(function (NS) {
  'use strict';

  var MAX_ENTRIES = 200;
  var PREFIX = '[USBLib]';

  /** @type {Array<{level:string,time:string,message:string,detail:*}>} */
  var buffer = [];

  function record(level, args) {
    var message = Array.prototype.map
      .call(args, function (a) {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.message;
        try {
          return JSON.stringify(a);
        } catch (e) {
          return String(a);
        }
      })
      .join(' ');

    buffer.push({
      level: level,
      time: new Date().toISOString(),
      message: message,
    });

    if (buffer.length > MAX_ENTRIES) buffer.shift();
  }

  function emit(level, consoleMethod, args) {
    record(level, args);
    if (typeof console !== 'undefined' && console[consoleMethod]) {
      console[consoleMethod].apply(
        console,
        [PREFIX].concat(Array.prototype.slice.call(args))
      );
    }
  }

  var Logger = {
    debug: function () {
      emit('debug', 'debug', arguments);
    },
    info: function () {
      emit('info', 'info', arguments);
    },
    warn: function () {
      emit('warn', 'warn', arguments);
    },
    error: function () {
      emit('error', 'error', arguments);
    },

    /** @returns {Array} a copy of the ring buffer, oldest first. */
    entries: function () {
      return buffer.slice();
    },

    /** @returns {Array} only warnings and errors. */
    problems: function () {
      return buffer.filter(function (e) {
        return e.level === 'warn' || e.level === 'error';
      });
    },

    clear: function () {
      buffer.length = 0;
    },

    /** @returns {string} the buffer as plain text, for export. */
    toText: function () {
      return buffer
        .map(function (e) {
          return e.time + ' [' + e.level.toUpperCase() + '] ' + e.message;
        })
        .join('\n');
    },
  };

  NS.define('Logger', Logger);
})(window.USBLib);
