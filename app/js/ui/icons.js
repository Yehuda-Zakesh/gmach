/**
 * icons.js — Inline SVG icon set.
 *
 * Icons are inlined rather than loaded as files or a font: an icon font or
 * sprite sheet would be one more thing to break when the drive letter
 * changes, and `currentColor` on inline SVG means every icon themes itself.
 *
 * Paths are code-owned constants, so building them with innerHTML is safe —
 * no external string ever reaches this module.
 */
(function (NS) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /** 24x24 stroke paths, drawn with a 2px round stroke. */
  var PATHS = {
    /* Navigation & chrome */
    search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z M21 21l-4.35-4.35',
    close: 'M18 6 6 18 M6 6l12 12',
    chevron: 'm9 18 6-6-6-6',
    'chevron-down': 'm6 9 6 6 6-6',
    home: 'm3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z M9 22V12h6v10',
    menu: 'M4 6h16 M4 12h16 M4 18h16',
    grid: 'M3 3h7v7H3Z M14 3h7v7h-7Z M14 14h7v7h-7Z M3 14h7v7H3Z',
    filter: 'M22 3H2l8 9.46V19l4 2v-8.54Z',

    /* Files & types */
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6',
    'file-text':
      'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
    folder: 'M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z',
    'folder-open':
      'M6 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 3h6a2 2 0 0 1 2 2v2 M2 20l3-8h17l-3 8Z',
    archive: 'M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8 M1 3h22v5H1Z M10 12h4',
    'app-window':
      'M2 4h20v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z M2 9h20 M6 6.5h.01 M9.5 6.5h.01',
    disc: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    image: 'M3 3h18v18H3Z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M21 15l-5-5L5 21',
    play: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M10 8l6 4-6 4Z',
    smartphone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z M12 18h.01',
    package: 'm7.5 4.27 9 5.15 M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z m3.3 7 8.7 5 8.7-5 M12 22V12',

    /* Actions */
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
    edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z',
    trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6',
    save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z M17 21v-8H7v8 M7 3v5h8',
    refresh: 'M3 12a9 9 0 0 1 15-6.7L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15 6.7L3 16 M3 21v-5h5',
    scan: 'M3 7V5a2 2 0 0 1 2-2h2 M17 3h2a2 2 0 0 1 2 2v2 M21 17v2a2 2 0 0 1-2 2h-2 M7 21H5a2 2 0 0 1-2-2v-2 M3 12h18',
    copy: 'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2Z M5 15H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1',
    plus: 'M12 5v14 M5 12h14',
    check: 'M20 6 9 17l-5-5',
    'external-link': 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14 21 3',

    /* Status */
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'eye-off':
      'M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a17.8 17.8 0 0 1-3.2 4.2 M6.6 6.6A17.8 17.8 0 0 0 2 11s3.6 7 10 7a9.1 9.1 0 0 0 4.1-.9 M14.1 14.1a3 3 0 1 1-4.2-4.2 M2 2l20 20',
    sparkles:
      'm12 3 1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9Z M19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1-2.1-.9 2.1-.9Z M5 3l.6 1.4L7 5l-1.4.6L5 7l-.6-1.4L3 5l1.4-.6Z',
    clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M12 6v6l4 2',
    info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M12 16v-4 M12 8h.01',
    warning: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z M12 9v4 M12 17h.01',
    error: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M15 9l-6 6 M9 9l6 6',
    'check-circle': 'M22 11.1V12a10 10 0 1 1-5.9-9.1 M22 4 12 14.1l-3-3',
    spinner: 'M21 12a9 9 0 1 1-6.2-8.6',

    /* Admin & settings */
    lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z M7 11V7a5 5 0 0 1 10 0v4',
    unlock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z M7 11V7a5 5 0 0 1 9.9-1',
    key: 'M15.5 2a6.5 6.5 0 0 0-6.2 8.5L2 17.8V22h4.2l1.5-1.5V19h1.8l1.5-1.5v-1.8h1.8l1.7-1.7A6.5 6.5 0 1 0 15.5 2Z M17 7h.01',
    settings:
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7.9 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.8H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 7.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H10a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V10a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
    library: 'M4 19.5V5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2Zm0 0A2 2 0 0 1 6 18h13 M9 7h6 M9 11h6',
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    phone:
      'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z',
    mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z m0 2 10 7 10-7',
    'log-out': 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
    database: 'M12 8c5 0 9-1.3 9-3s-4-3-9-3-9 1.3-9 3 4 3 9 3Z M21 5v14c0 1.7-4 3-9 3s-9-1.3-9-3V5 M21 12c0 1.7-4 3-9 3s-9-1.3-9-3',
    'hard-drive':
      'M22 12H2 M5.5 5h13a2 2 0 0 1 1.8 1.1l1.5 3A2 2 0 0 1 22 10v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 .2-.9l1.5-3A2 2 0 0 1 5.5 5Z M6 16h.01 M10 16h.01',
    'shield-check': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z m-3.5-10.5 2.5 2.5 4.5-4.5',
    tag: 'M20.6 13.4 12 22l-9-9V3h10Z M7.5 7.5h.01',
    'list-ordered': 'M10 6h11 M10 12h11 M10 18h11 M4 6h1v4 M4 10h2 M6 18H4c0-1 2-2 2-3s-1-1.5-2-1',
    inbox: 'M22 12h-6l-2 3h-4l-2-3H2 M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z',
  };

  var Icons = {
    /**
     * @param {string} name key from PATHS
     * @param {Object} [options]
     * @param {number} [options.size] px, sets width/height
     * @param {string} [options.className]
     * @param {boolean} [options.filled] fill instead of stroke
     * @returns {SVGElement} always an element, never null
     */
    get: function (name, options) {
      var opts = options || {};
      var d = PATHS[name];

      if (!d) {
        NS.require('Logger').warn('icons: unknown icon "' + name + '"');
        d = PATHS.file;
      }

      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', opts.strokeWidth || '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');

      if (opts.size) {
        svg.setAttribute('width', opts.size);
        svg.setAttribute('height', opts.size);
      }
      if (opts.className) svg.setAttribute('class', opts.className);

      d.split(/\s+(?=[Mm])/).forEach(function (segment) {
        var path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', segment.trim());
        if (opts.filled) path.setAttribute('fill', 'currentColor');
        svg.appendChild(path);
      });

      return svg;
    },

    /** @returns {boolean} */
    has: function (name) {
      return Object.prototype.hasOwnProperty.call(PATHS, name);
    },

    /** @returns {string[]} every icon key, for the admin icon picker. */
    names: function () {
      return Object.keys(PATHS);
    },
  };

  NS.define('ui.Icons', Icons);
})(window.USBLib);
