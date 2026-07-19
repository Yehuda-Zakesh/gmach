/**
 * theme.js — Light/dark mode and the configurable accent colour.
 */
(function (NS) {
  'use strict';

  var Storage = NS.require('Storage');
  var Dom = NS.require('ui.Dom');
  var Icons = NS.require('ui.Icons');

  var PREF_KEY = 'theme';
  var MODES = ['auto', 'light', 'dark'];

  var mediaQuery = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  var currentMode = 'auto';
  var listeners = [];

  function resolve(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return mediaQuery && mediaQuery.matches ? 'dark' : 'light';
  }

  function apply() {
    var resolved = resolve(currentMode);
    document.documentElement.setAttribute('data-theme', resolved);
    listeners.forEach(function (fn) {
      fn(resolved, currentMode);
    });
  }

  /**
   * Parses "#rgb" / "#rrggbb" into components.
   * @returns {{r:number,g:number,b:number}|null}
   */
  function parseHex(hex) {
    var s = String(hex || '').trim().replace(/^#/, '');
    if (s.length === 3) {
      s = s
        .split('')
        .map(function (c) {
          return c + c;
        })
        .join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    };
  }

  function toHex(rgb) {
    return (
      '#' +
      [rgb.r, rgb.g, rgb.b]
        .map(function (v) {
          return ('0' + Math.round(Math.min(255, Math.max(0, v))).toString(16)).slice(-2);
        })
        .join('')
    );
  }

  /** Relative luminance per WCAG 2.x, used to pick readable button text. */
  function luminance(rgb) {
    var channels = [rgb.r, rgb.g, rgb.b].map(function (v) {
      var c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  var Theme = {
    MODES: MODES,

    /** Reads the saved preference and applies it. Call once at startup. */
    init: function (defaultMode) {
      var saved = Storage.getPref(PREF_KEY, null);
      currentMode = MODES.indexOf(saved) !== -1 ? saved : defaultMode || 'auto';
      apply();

      if (mediaQuery) {
        var onChange = function () {
          if (currentMode === 'auto') apply();
        };
        if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', onChange);
        else if (mediaQuery.addListener) mediaQuery.addListener(onChange);
      }

      return Theme;
    },

    /** @returns {'auto'|'light'|'dark'} */
    getMode: function () {
      return currentMode;
    },

    /** @returns {'light'|'dark'} what is actually on screen. */
    getResolved: function () {
      return resolve(currentMode);
    },

    /** @param {'auto'|'light'|'dark'} mode */
    setMode: function (mode) {
      if (MODES.indexOf(mode) === -1) return;
      currentMode = mode;
      Storage.setPref(PREF_KEY, mode);
      apply();
    },

    /** Cycles light -> dark -> light (skipping auto, which users find opaque). */
    toggle: function () {
      Theme.setMode(Theme.getResolved() === 'dark' ? 'light' : 'dark');
    },

    /**
     * Applies the administrator's accent colour, deriving the hover shade and
     * a readable contrast colour from it. Invalid values are ignored so a
     * typo in the settings form cannot make buttons unreadable.
     * @param {string} hex
     * @returns {boolean} whether the colour was applied
     */
    setAccent: function (hex) {
      var rgb = parseHex(hex);
      if (!rgb) return false;

      var root = document.documentElement;
      var strong = {
        r: rgb.r * 0.82,
        g: rgb.g * 0.82,
        b: rgb.b * 0.82,
      };

      root.style.setProperty('--accent', toHex(rgb));
      root.style.setProperty('--accent-strong', toHex(strong));
      root.style.setProperty(
        '--accent-soft',
        'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.12)'
      );
      root.style.setProperty(
        '--shadow-accent',
        '0 8px 24px rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.28)'
      );
      root.style.setProperty(
        '--accent-contrast',
        luminance(rgb) > 0.55 ? '#131722' : '#ffffff'
      );

      return true;
    },

    /** @param {function(string, string):void} fn called on every change. */
    onChange: function (fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    },

    /**
     * Builds a theme toggle button that keeps its icon and label in sync.
     * @returns {HTMLButtonElement}
     */
    createToggle: function () {
      var btn = Dom.h('button.btn.btn--ghost.btn--icon', {
        type: 'button',
        on: { click: Theme.toggle },
      });

      function sync(resolved) {
        var label = resolved === 'dark' ? 'מעבר למצב בהיר' : 'מעבר למצב כהה';
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
        Dom.replace(btn, Icons.get(resolved === 'dark' ? 'sun' : 'moon'));
      }

      sync(Theme.getResolved());
      Theme.onChange(sync);
      return btn;
    },
  };

  NS.define('ui.Theme', Theme);
})(window.USBLib);
