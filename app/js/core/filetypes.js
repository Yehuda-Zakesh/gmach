/**
 * filetypes.js — Registry of supported file types.
 *
 * ADDING A NEW TYPE
 * ------------------------------------------------------------------
 * Call FileTypes.register() once, from anywhere that runs after this file:
 *
 *     USBLib.FileTypes.register({
 *       key: 'iso',
 *       label: 'קובץ ISO',
 *       extensions: ['iso', 'img'],
 *       icon: 'disc',            // any key from ui/icons.js
 *       downloadable: true
 *     });
 *
 * Nothing else in the codebase needs to change: cards, badges, the details
 * modal, the admin filter dropdown and the scanner all read from here.
 */
(function (NS) {
  'use strict';

  var Paths = NS.require('Paths');

  /** @type {Object.<string, Object>} keyed by type key */
  var registry = {};
  /** @type {Object.<string, string>} extension -> type key */
  var byExtension = {};

  var FALLBACK_KEY = 'other';

  var FileTypes = {
    /**
     * Registers (or replaces) a file type.
     * @param {{key:string,label:string,extensions:string[],icon:string,
     *          downloadable?:boolean,hint?:string}} def
     */
    register: function (def) {
      if (!def || !def.key) throw new Error('FileTypes.register: "key" is required');

      var entry = {
        key: def.key,
        label: def.label || def.key.toUpperCase(),
        extensions: (def.extensions || []).map(function (e) {
          return String(e).toLowerCase().replace(/^\./, '');
        }),
        icon: def.icon || 'file',
        downloadable: def.downloadable !== false,
        hint: def.hint || '',
      };

      registry[entry.key] = entry;
      entry.extensions.forEach(function (ext) {
        byExtension[ext] = entry.key;
      });

      return entry;
    },

    /** @returns {Object} the type definition, never null (falls back to "other"). */
    get: function (key) {
      return registry[key] || registry[FALLBACK_KEY];
    },

    /** @returns {boolean} */
    has: function (key) {
      return Object.prototype.hasOwnProperty.call(registry, key);
    },

    /** @returns {Object[]} all registered types, in registration order. */
    all: function () {
      return Object.keys(registry).map(function (k) {
        return registry[k];
      });
    },

    /**
     * Resolves a type key from a filename or path.
     * @param {string} fileName
     * @returns {string} type key
     */
    fromFileName: function (fileName) {
      var ext = Paths.extension(fileName);
      return byExtension[ext] || FALLBACK_KEY;
    },

    /** Human label for a type key. */
    labelOf: function (key) {
      return FileTypes.get(key).label;
    },

    /** Icon key for a type key. */
    iconOf: function (key) {
      return FileTypes.get(key).icon;
    },
  };

  /* --- Built-in types ---------------------------------------------------- */
  /* Order matters only for the admin's filter dropdown. */

  FileTypes.register({
    key: 'exe',
    label: 'קובץ התקנה',
    extensions: ['exe', 'msi', 'msix', 'appx', 'bat', 'cmd'],
    icon: 'app-window',
    hint: 'הפעל את הקובץ לאחר ההורדה כדי להתחיל בהתקנה.',
  });

  FileTypes.register({
    key: 'zip',
    label: 'ארכיון',
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'cab'],
    icon: 'archive',
    hint: 'חלץ את הארכיון לתיקייה לפני השימוש.',
  });

  FileTypes.register({
    key: 'pdf',
    label: 'מסמך PDF',
    extensions: ['pdf'],
    icon: 'file-text',
    hint: 'ניתן לפתוח בכל קורא PDF.',
  });

  FileTypes.register({
    key: 'iso',
    label: 'תמונת דיסק',
    extensions: ['iso', 'img', 'vhd', 'vhdx'],
    icon: 'disc',
    hint: 'יש לחבר (Mount) את הקובץ או לצרוב אותו למדיה.',
  });

  FileTypes.register({
    key: 'doc',
    label: 'מסמך',
    extensions: ['doc', 'docx', 'rtf', 'odt', 'txt', 'md', 'xls', 'xlsx', 'ppt', 'pptx'],
    icon: 'file-text',
  });

  FileTypes.register({
    key: 'image',
    label: 'תמונה',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'],
    icon: 'image',
  });

  FileTypes.register({
    key: 'video',
    label: 'וידאו',
    extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm'],
    icon: 'play',
  });

  FileTypes.register({
    key: 'apk',
    label: 'אפליקציית אנדרואיד',
    extensions: ['apk', 'aab'],
    icon: 'smartphone',
  });

  FileTypes.register({
    key: 'folder',
    label: 'תיקייה',
    extensions: [],
    icon: 'folder',
    downloadable: false,
  });

  FileTypes.register({
    key: FALLBACK_KEY,
    label: 'קובץ',
    extensions: [],
    icon: 'file',
  });

  NS.define('FileTypes', FileTypes);
})(window.USBLib);
