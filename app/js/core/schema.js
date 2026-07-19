/**
 * schema.js — Database shape, defaults, factories and migrations.
 *
 * ADDING A FIELD
 * ------------------------------------------------------------------
 * 1. Add it to ITEM_DEFAULTS (or SETTINGS_DEFAULTS) with a sensible default.
 * 2. Bump SCHEMA_VERSION and add a migration entry only if existing values
 *    need to be *transformed*. Purely additive fields need no migration:
 *    Schema.normalizeDatabase() back-fills them via Utils.applyDefaults on
 *    every load, so old databases pick them up automatically.
 * Nothing else needs to change — the admin editor and the catalog read
 * whatever is on the item.
 */
(function (NS) {
  'use strict';

  var Utils = NS.require('Utils');
  var Paths = NS.require('Paths');
  var FileTypes = NS.require('FileTypes');
  var Logger = NS.require('Logger');

  var SCHEMA_VERSION = 1;

  /** How a folder presents itself in the catalog. */
  var FOLDER_MODE = {
    /** One card; Download fetches the whole package. */
    PACKAGE: 'package',
    /** Opens like a category and reveals its contents. */
    CATEGORY: 'category',
  };

  var ITEM_DEFAULTS = {
    id: '',
    name: '',
    fileName: '',
    path: '',
    kind: 'file', // 'file' | 'folder'
    /** Key from FileTypes. Empty means "derive it from the filename". */
    type: '',
    description: '',
    version: '',
    instructions: '',
    category: '',
    updatedAt: '',
    addedAt: '',
    isNew: false,
    hidden: false,
    thumbnail: '',
    icon: '',
    parentId: null,
    folderMode: FOLDER_MODE.CATEGORY,
    packagePath: '', // folderMode=package: the file the Download button serves
    order: 0,
    size: 0,
    missing: false,
    tags: [],
    /** Reserved for future fields so they never collide with core keys. */
    extra: {},
  };

  var SETTINGS_DEFAULTS = {
    appTitle: 'ספריית התוכנות',
    appSubtitle: 'עיון והורדה של תוכנות מתוך הכונן',
    contact: {
      visible: true,
      name: '',
      phone: '',
      email: '',
      note: '',
    },
    softwareRoot: 'software',
    ui: {
      accent: '#4f7cff',
      theme: 'auto', // 'auto' | 'light' | 'dark'
      newDays: 21, // an item stays "חדש" for this many days after addedAt
      showCategories: true,
    },
    security: {
      auth: null, // credential record from core/crypto.js; null until first run
    },
    lastScan: null,
    language: 'he',
  };

  var DATABASE_DEFAULTS = {
    schemaVersion: SCHEMA_VERSION,
    settings: SETTINGS_DEFAULTS,
    categories: [], // [{ id, name, order }]
    items: [],
    meta: {
      generatedAt: '',
      generatedBy: '',
      appVersion: '',
    },
  };

  /**
   * Migrations run in ascending order for every version between the stored
   * schemaVersion and SCHEMA_VERSION. Key = the version being migrated TO.
   * @type {Object.<number, function(Object): void>}
   */
  var MIGRATIONS = {
    // 2: function (db) { db.items.forEach(...); }
  };

  var Schema = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    FOLDER_MODE: FOLDER_MODE,
    ITEM_DEFAULTS: ITEM_DEFAULTS,
    SETTINGS_DEFAULTS: SETTINGS_DEFAULTS,

    /** @returns {Object} a fresh, empty but valid database. */
    createDatabase: function () {
      var db = Utils.clone(DATABASE_DEFAULTS);
      db.meta.generatedAt = Utils.nowIso();
      db.meta.appVersion = NS.VERSION;
      return db;
    },

    /**
     * Builds an item from a scan result or from the admin's "add" form.
     * @param {Object} input at minimum { path }
     * @returns {Object} a complete item
     */
    createItem: function (input) {
      var item = Utils.clone(ITEM_DEFAULTS);
      var now = Utils.nowIso();

      Object.keys(input || {}).forEach(function (k) {
        if (input[k] !== undefined) item[k] = input[k];
      });

      item.id = item.id || Utils.uid('itm');
      item.path = Paths.normalize(item.path);
      item.fileName = item.fileName || Paths.basename(item.path);
      item.name = item.name || Paths.prettify(item.fileName);
      item.addedAt = item.addedAt || now;
      item.updatedAt = item.updatedAt || now;

      if (item.kind === 'folder') {
        item.type = 'folder';
      } else if (!input || !input.type) {
        item.type = FileTypes.fromFileName(item.fileName);
      }

      return item;
    },

    /**
     * Repairs a single item in place: fills new fields, coerces types, and
     * drops values that would break rendering. Never throws — a malformed
     * item degrades to a usable one rather than taking down the page.
     * @param {Object} raw
     * @returns {Object|null} the item, or null if unsalvageable
     */
    normalizeItem: function (raw) {
      if (!Utils.isPlainObject(raw)) return null;

      var item = Utils.applyDefaults(raw, ITEM_DEFAULTS);

      item.path = Paths.normalize(item.path);
      if (!item.path) {
        Logger.warn('schema: dropping an item with no path', item.id || '(no id)');
        return null;
      }

      item.id = Utils.str(item.id) || Utils.uid('itm');
      item.kind = item.kind === 'folder' ? 'folder' : 'file';
      item.fileName = Utils.str(item.fileName) || Paths.basename(item.path);
      item.name = Utils.str(item.name) || Paths.prettify(item.fileName);
      item.description = Utils.str(item.description);
      item.version = Utils.str(item.version);
      item.instructions = Utils.str(item.instructions);
      item.category = Utils.str(item.category);

      if (item.kind === 'folder') {
        item.type = 'folder';
        if (
          item.folderMode !== FOLDER_MODE.PACKAGE &&
          item.folderMode !== FOLDER_MODE.CATEGORY
        ) {
          item.folderMode = FOLDER_MODE.CATEGORY;
        }
        item.packagePath = Paths.normalize(item.packagePath);
      } else {
        // Missing type (hand-edited JSON, an older export) or a type whose
        // registration has since been removed: fall back to the filename
        // rather than leaving the item with the generic "file" icon.
        if (!item.type || !FileTypes.has(item.type)) {
          item.type = FileTypes.fromFileName(item.fileName);
        }
        item.folderMode = FOLDER_MODE.CATEGORY;
        item.packagePath = '';
      }

      item.isNew = !!item.isNew;
      item.hidden = !!item.hidden;
      item.missing = !!item.missing;
      item.order = Number(item.order) || 0;
      item.size = Math.max(0, Number(item.size) || 0);
      item.parentId = item.parentId ? Utils.str(item.parentId) : null;
      item.tags = Array.isArray(item.tags) ? item.tags.map(Utils.str).filter(Boolean) : [];

      if (!Utils.isPlainObject(item.extra)) item.extra = {};

      // An icon/thumbnail is either an inline data: URL or a relative path.
      // Anything else (http://, C:\, /abs) would break on another machine.
      item.icon = Schema.sanitizeImageRef(item.icon);
      item.thumbnail = Schema.sanitizeImageRef(item.thumbnail);

      return item;
    },

    /**
     * @param {string} ref
     * @returns {string} a safe image reference, or '' if it must be discarded.
     */
    sanitizeImageRef: function (ref) {
      var s = Utils.str(ref);
      if (!s) return '';
      if (/^data:image\//i.test(s)) return s;
      if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
        Logger.warn('schema: discarding a non-relative image reference:', s.slice(0, 40));
        return '';
      }
      return Paths.normalize(s);
    },

    /**
     * Validates and repairs a whole database. Always returns something usable.
     * @param {*} raw parsed JSON, or anything at all
     * @returns {{db: Object, repairs: string[]}}
     */
    normalizeDatabase: function (raw) {
      var repairs = [];

      if (!Utils.isPlainObject(raw)) {
        repairs.push('קובץ הנתונים לא היה תקין — נוצר מסד נתונים ריק.');
        return { db: Schema.createDatabase(), repairs: repairs };
      }

      var db = Utils.applyDefaults(Utils.clone(raw), DATABASE_DEFAULTS);

      var stored = Number(db.schemaVersion) || 0;
      if (stored > SCHEMA_VERSION) {
        repairs.push(
          'הקובץ נוצר בגרסה חדשה יותר של המערכת (' +
            stored +
            '). ייתכן שחלק מהשדות לא יוצגו.'
        );
      } else if (stored < SCHEMA_VERSION) {
        for (var v = stored + 1; v <= SCHEMA_VERSION; v++) {
          if (MIGRATIONS[v]) {
            try {
              MIGRATIONS[v](db);
              repairs.push('בוצע עדכון מבנה לגרסה ' + v + '.');
            } catch (e) {
              Logger.error('schema: migration to v' + v + ' failed', e);
              repairs.push('עדכון המבנה לגרסה ' + v + ' נכשל: ' + e.message);
            }
          }
        }
        db.schemaVersion = SCHEMA_VERSION;
      }

      db.settings.softwareRoot =
        Paths.normalize(db.settings.softwareRoot) || SETTINGS_DEFAULTS.softwareRoot;
      db.settings.ui.newDays = Utils.clamp(Number(db.settings.ui.newDays) || 21, 0, 365);

      if (!Array.isArray(db.items)) {
        repairs.push('רשימת הפריטים הייתה פגומה ואופסה.');
        db.items = [];
      }

      if (!Array.isArray(db.categories)) db.categories = [];

      var seenIds = Object.create(null);
      var seenPaths = Object.create(null);
      var clean = [];

      db.items.forEach(function (raw) {
        var item = Schema.normalizeItem(raw);
        if (!item) {
          repairs.push('פריט פגום הוסר מהרשימה.');
          return;
        }

        if (seenIds[item.id]) {
          item.id = Utils.uid('itm');
          repairs.push('נמצא מזהה כפול — הוקצה מזהה חדש לפריט "' + item.name + '".');
        }
        seenIds[item.id] = true;

        var pathKey = item.path.toLowerCase();
        if (seenPaths[pathKey]) {
          repairs.push('נמצאה כפילות בנתיב "' + item.path + '" — הפריט הכפול הוסר.');
          return;
        }
        seenPaths[pathKey] = true;

        clean.push(item);
      });

      db.items = clean;

      // Drop parent links pointing at items that no longer exist, otherwise
      // those children become permanently unreachable in the catalog.
      db.items.forEach(function (item) {
        if (item.parentId && !seenIds[item.parentId]) {
          repairs.push('הקישור של "' + item.name + '" לתיקיית האב אופס.');
          item.parentId = null;
        }
      });

      Schema.syncCategories(db);

      return { db: db, repairs: repairs };
    },

    /**
     * Makes db.categories match the category names actually used by items:
     * adds newly typed names, keeps the administrator's ordering, and prunes
     * names nothing references any more.
     * @param {Object} db mutated in place
     */
    syncCategories: function (db) {
      var used = Object.create(null);
      db.items.forEach(function (i) {
        if (i.category) used[i.category] = true;
      });

      var kept = db.categories.filter(function (c) {
        return c && c.name && used[c.name];
      });

      var known = Object.create(null);
      kept.forEach(function (c) {
        c.id = c.id || Utils.uid('cat');
        c.order = Number(c.order) || 0;
        known[c.name] = true;
      });

      Object.keys(used).forEach(function (name) {
        if (!known[name]) {
          kept.push({ id: Utils.uid('cat'), name: name, order: kept.length });
        }
      });

      kept.sort(function (a, b) {
        return a.order - b.order || Utils.compareText(a.name, b.name);
      });
      kept.forEach(function (c, i) {
        c.order = i;
      });

      db.categories = kept;
    },

    /**
     * Recomputes each item's `isNew` from `addedAt` and settings.ui.newDays.
     * An administrator who ticked "חדש" by hand keeps the flag: only the
     * automatic expiry is applied here, and only to items that aged out.
     * @param {Object} db mutated in place
     */
    refreshNewFlags: function (db) {
      var days = db.settings.ui.newDays;
      if (!days) return;

      db.items.forEach(function (item) {
        if (item.isNew && Utils.daysSince(item.addedAt) > days) {
          item.isNew = false;
        }
      });
    },
  };

  NS.define('Schema', Schema);
})(window.USBLib);
