/**
 * db.js — Loading the database and deriving views over it.
 *
 * TWO FILES, ONE DATABASE
 * ------------------------------------------------------------------
 * `data/database.json` is the canonical, human-readable copy — open it in
 * any text editor, diff it, back it up.
 * `data/database.js` is a byte-for-byte mirror wrapped in an assignment to
 * `window.USBLibDatabase`.
 *
 * The mirror exists because `fetch('data/database.json')` is blocked by CORS
 * on `file://` (opaque origin), so a plain <script> tag is the only way to
 * get data into a page opened straight off the USB drive. The admin console
 * writes both files on every save; see admin/persist.js.
 *
 * Load order preference:
 *   1. window.USBLibDatabase  — set by the <script> tag; always works.
 *   2. fetch(database.json)   — used when the folder happens to be served
 *                               over http(s), so the JSON stays the source
 *                               of truth in that setup.
 */
(function (NS) {
  'use strict';

  var Utils = NS.require('Utils');
  var Paths = NS.require('Paths');
  var Schema = NS.require('Schema');
  var Logger = NS.require('Logger');

  var JSON_PATH = 'data/database.json';
  var GLOBAL_KEY = 'USBLibDatabase';

  var Db = {
    JSON_PATH: JSON_PATH,
    GLOBAL_KEY: GLOBAL_KEY,

    /** True when the page was opened directly from disk. */
    isFileProtocol: function () {
      return window.location.protocol === 'file:';
    },

    /**
     * Loads, validates and repairs the database.
     * Resolves even when everything fails — an empty catalog with a readable
     * message beats a blank page.
     *
     * @returns {Promise<{db:Object, source:string, repairs:string[], error:Error|null}>}
     */
    load: function () {
      return Db._read().then(function (result) {
        var normalized = Schema.normalizeDatabase(result.raw);
        Schema.refreshNewFlags(normalized.db);

        if (normalized.repairs.length) {
          Logger.warn('db: repaired on load —', normalized.repairs.join(' | '));
        }

        return {
          db: normalized.db,
          source: result.source,
          repairs: normalized.repairs,
          error: result.error,
        };
      });
    },

    /**
     * @private
     * @returns {Promise<{raw:*, source:string, error:Error|null}>}
     */
    _read: function () {
      var inline = window[GLOBAL_KEY];

      // Over http(s) the JSON file is authoritative and always fresh, so try
      // it first and treat the inline copy as the fallback.
      if (!Db.isFileProtocol() && typeof fetch === 'function') {
        return fetch(JSON_PATH, { cache: 'no-store' })
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then(function (raw) {
            return { raw: raw, source: 'json', error: null };
          })
          .catch(function (err) {
            Logger.warn('db: could not fetch ' + JSON_PATH + ' —', err.message);
            if (Utils.isPlainObject(inline)) {
              return { raw: inline, source: 'inline', error: null };
            }
            return { raw: null, source: 'none', error: err };
          });
      }

      if (Utils.isPlainObject(inline)) {
        return Promise.resolve({ raw: inline, source: 'inline', error: null });
      }

      return Promise.resolve({
        raw: null,
        source: 'none',
        error: new Error(
          'קובץ הנתונים data/database.js לא נטען. ודא שהקובץ קיים ושהוא נטען לפני שאר הסקריפטים.'
        ),
      });
    },

    /* --- Derived views --------------------------------------------------- */

    /**
     * Items the public catalog is allowed to show.
     * @param {Object} db
     * @returns {Object[]}
     */
    visibleItems: function (db) {
      return db.items.filter(function (i) {
        return !i.hidden && !i.missing;
      });
    },

    /**
     * Indexes items by id for O(1) lookups.
     * @param {Object[]} items
     * @returns {Map<string, Object>}
     */
    indexById: function (items) {
      var map = new Map();
      items.forEach(function (i) {
        map.set(i.id, i);
      });
      return map;
    },

    /**
     * Groups items by parentId.
     * @param {Object[]} items
     * @returns {Map<string|null, Object[]>}
     */
    indexByParent: function (items) {
      var map = new Map();
      items.forEach(function (i) {
        var key = i.parentId || null;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(i);
      });
      return map;
    },

    /**
     * The items a user sees inside a given folder (or at the root).
     *
     * A folder in PACKAGE mode is a leaf: it renders as a single card and its
     * children never surface, which is what makes "one folder = one download"
     * work without a separate data structure.
     *
     * @param {Object[]} items pre-filtered (e.g. visibleItems)
     * @param {string|null} parentId
     * @returns {Object[]} sorted for display
     */
    childrenOf: function (items, parentId) {
      var target = parentId || null;
      var list = items.filter(function (i) {
        return (i.parentId || null) === target;
      });
      return Db.sortForDisplay(list);
    },

    /**
     * Display order: folders first, then the administrator's explicit order,
     * then name. Two items with the same `order` (the default 0) therefore
     * fall back to a stable alphabetical listing.
     * @param {Object[]} items mutated in place and returned
     */
    sortForDisplay: function (items) {
      return items.sort(function (a, b) {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        if (a.order !== b.order) return a.order - b.order;
        return Utils.compareText(a.name, b.name);
      });
    },

    /**
     * Walks up the parent chain from an item to the root.
     * Includes a cycle guard: a corrupted database must not hang the page.
     * @param {Map<string,Object>} byId
     * @param {Object} item
     * @returns {Object[]} ancestors, root-first, excluding `item`
     */
    ancestorsOf: function (byId, item) {
      var chain = [];
      var seen = Object.create(null);
      var current = item && item.parentId ? byId.get(item.parentId) : null;

      while (current && !seen[current.id]) {
        seen[current.id] = true;
        chain.unshift(current);
        current = current.parentId ? byId.get(current.parentId) : null;
      }

      if (current) Logger.warn('db: a cycle was detected in the folder tree');
      return chain;
    },

    /**
     * Every descendant of a folder, at any depth.
     * @param {Object[]} items
     * @param {string} folderId
     * @returns {Object[]}
     */
    descendantsOf: function (items, folderId) {
      var byParent = Db.indexByParent(items);
      var out = [];
      var queue = [folderId];
      var seen = Object.create(null);

      while (queue.length) {
        var id = queue.shift();
        if (seen[id]) continue;
        seen[id] = true;

        (byParent.get(id) || []).forEach(function (child) {
          out.push(child);
          if (child.kind === 'folder') queue.push(child.id);
        });
      }

      return out;
    },

    /**
     * The files a PACKAGE folder should hand over when Download is pressed.
     * @param {Object[]} items
     * @param {Object} folder
     * @returns {Object[]} files only, in display order
     */
    packageFilesOf: function (items, folder) {
      return Db.descendantsOf(items, folder.id).filter(function (i) {
        return i.kind === 'file';
      });
    },

    /**
     * Total size of a folder, computed from its descendants.
     * @param {Object[]} items
     * @param {Object} folder
     * @returns {number} bytes
     */
    folderSize: function (items, folder) {
      return Db.descendantsOf(items, folder.id).reduce(function (sum, i) {
        return sum + (i.kind === 'file' ? i.size || 0 : 0);
      }, 0);
    },

    /**
     * Resolves the href for an item's Download button.
     * @param {Object[]} items
     * @param {Object} item
     * @returns {string} a relative path, or '' when there is nothing to serve
     */
    downloadPathOf: function (items, item) {
      if (item.kind === 'file') return item.path;

      if (item.folderMode === Schema.FOLDER_MODE.PACKAGE) {
        if (item.packagePath) return item.packagePath;

        // No package file was chosen, so fall back to the most plausible
        // installer: the largest executable, else the largest file.
        var files = Db.packageFilesOf(items, item);
        if (!files.length) return '';

        var installers = files.filter(function (f) {
          return f.type === 'exe';
        });
        var pool = installers.length ? installers : files;

        return pool.reduce(function (best, f) {
          return !best || f.size > best.size ? f : best;
        }, null).path;
      }

      return '';
    },

    /**
     * Resolves an icon/thumbnail reference to something usable in `src`.
     * @param {string} ref
     * @returns {string}
     */
    imageSrc: function (ref) {
      if (!ref) return '';
      if (/^data:/i.test(ref)) return ref;

      // Desktop build: the page is served from the bundled app, not from
      // disk next to data/, so a relative href can't reach it. __DATA_ROOT__
      // (an absolute path) is injected alongside USBLibDatabase — see
      // src-tauri/src/main.rs.
      if (window.__TAURI__ && window.__DATA_ROOT__) {
        return window.__TAURI__.core.convertFileSrc(window.__DATA_ROOT__ + '/' + ref);
      }

      return Paths.toHref(ref);
    },

    /** Counts for the admin dashboard. */
    stats: function (db) {
      var s = {
        total: db.items.length,
        files: 0,
        folders: 0,
        hidden: 0,
        missing: 0,
        isNew: 0,
        categories: db.categories.length,
        size: 0,
      };

      db.items.forEach(function (i) {
        if (i.kind === 'folder') s.folders++;
        else {
          s.files++;
          s.size += i.size || 0;
        }
        if (i.hidden) s.hidden++;
        if (i.missing) s.missing++;
        if (i.isNew) s.isNew++;
      });

      return s;
    },
  };

  NS.define('Db', Db);
})(window.USBLib);
