/**
 * toast.js — Transient notifications.
 */
(function (NS) {
  'use strict';

  var Dom = NS.require('ui.Dom');
  var Icons = NS.require('ui.Icons');

  var ICON_FOR = {
    success: 'check-circle',
    error: 'error',
    warn: 'warning',
    info: 'info',
  };

  var DEFAULT_MS = 3600;
  var root = null;

  function ensureRoot() {
    if (root && document.body.contains(root)) return root;
    root = Dom.h('div.toast-root', {
      // Announce politely: a toast never interrupts what the user is reading,
      // and errors here are always also reflected in the UI itself.
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'false',
    });
    document.body.appendChild(root);
    return root;
  }

  function dismiss(el) {
    if (!el.parentNode) return;
    el.classList.add('is-leaving');
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 220);
  }

  var Toast = {
    /**
     * @param {string} message
     * @param {'success'|'error'|'warn'|'info'} [level]
     * @param {number} [duration] ms; 0 keeps it until clicked
     * @returns {HTMLElement}
     */
    show: function (message, level, duration) {
      var kind = ICON_FOR[level] ? level : 'info';
      var ms = duration === undefined ? DEFAULT_MS : duration;

      var el = Dom.h('div.toast.toast--' + kind, {}, [
        Icons.get(ICON_FOR[kind]),
        Dom.h('div', { text: message }),
      ]);

      el.addEventListener('click', function () {
        dismiss(el);
      });

      ensureRoot().appendChild(el);

      // Errors stay put by default — they usually need reading twice.
      if (ms > 0) setTimeout(function () { dismiss(el); }, ms);
      return el;
    },

    success: function (m, d) {
      return Toast.show(m, 'success', d);
    },
    error: function (m, d) {
      return Toast.show(m, 'error', d === undefined ? 6000 : d);
    },
    warn: function (m, d) {
      return Toast.show(m, 'warn', d === undefined ? 5000 : d);
    },
    info: function (m, d) {
      return Toast.show(m, 'info', d);
    },

    dismiss: dismiss,

    clear: function () {
      if (root) Dom.clear(root);
    },
  };

  NS.define('ui.Toast', Toast);
})(window.USBLib);
