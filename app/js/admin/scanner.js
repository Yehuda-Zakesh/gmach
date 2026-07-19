/**
 * scanner.js — Discovering software and reconciling it with the database.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ------------------------------------------------------------------
 * A scan NEVER recreates the database. Administrator work — display names,
 * descriptions, versions, install instructions, icons, categories, ordering,
 * folder behaviour — is the expensive part, and the filesystem knows nothing
 * about it. So reconcile() only ever:
 *
 *   • adds items it has not seen before,
 *   • updates the mechanical facts of items it has (size, mtime, filename),
 *   • flags items whose file has disappeared as `missing` — never deletes.
 *
 * Deletion is always an explicit administrator action, because a scan of the
 * wrong folder, or a drive that mounted slowly, must not be able to wipe
 * years of curation.
 *
 * IDs are preserved across renames and moves via the match strategies below,
 * so links, ordering and parent relationships survive reorganising the drive.
 */
(function (NS) {
  'use strict';

  var Utils = NS.require('Utils');
  var Paths = NS.require('Paths');
  var Schema = NS.require('Schema');
  var FileTypes = NS.require('FileTypes');
  var Fs = NS.require('Fs');
  var Logger = NS.require('Logger');

  /** Change kinds reported back to the UI. */
  var CHANGE = {
    ADDED: 'added',
    UPDATED: 'updated',
    MOVED: 'moved',
    MISSING: 'missing',
    RESTORED: 'restored',
  };

  function pathKey(p) {
    return Paths.normalize(p).toLowerCase();
  }

  var Scanner = {
    CHANGE: CHANGE,

    /**
     * Reads the software directory using whichever capability is available.
     *
     * @param {Object} options
     * @param {FileSystemDirectoryHandle} [options.rootHandle] project root
     * @param {string} options.softwareRoot relative path, e.g. "software"
     * @param {function(number, string):void} [options.onProgress]
     * @returns {Promise<{entries:Array, method:string, rootName:string}>}
     */
    discover: function (options) {
      var opts = options || {};
      var softwareRoot = Paths.normalize(opts.softwareRoot) || 'software';

      // Preferred path: we already hold the project folder, so the software
      // directory can be walked with no dialog at all.
      if (opts.rootHandle) {
        return Fs.getDirectory(opts.rootHandle, softwareRoot, false)
          .then(function (dir) {
            return Fs.walkDirectory(dir, {
              prefix: softwareRoot,
              onProgress: opts.onProgress,
            });
          })
          .then(function (entries) {
            return { entries: entries, method: 'handle', rootName: softwareRoot };
          })
          .catch(function (err) {
            Logger.warn('scanner: could not walk "' + softwareRoot + '" —', err.message);
            throw new Error(
              'לא נמצאה התיקייה "' +
                softwareRoot +
                '" בתוך תיקיית הפרויקט. בדוק את שם התיקייה בהגדרות.'
            );
          });
      }

      // Fallback: ask for the software folder directly via a directory input.
      return Fs.pickDirectoryViaInput().then(function (result) {
        return {
          entries: result.entries,
          method: 'input',
          rootName: result.rootName,
        };
      });
    },

    /**
     * Merges discovered entries into the database.
     *
     * @param {Object} db mutated in place
     * @param {Array} entries from discover()
     * @param {Object} [options]
     * @param {string} [options.softwareRoot] restricts the scope of the scan
     * @returns {{changes:Array, counts:Object}}
     */
    reconcile: function (db, entries, options) {
      var opts = options || {};
      var softwareRoot = Paths.normalize(opts.softwareRoot || db.settings.softwareRoot);
      var now = Utils.nowIso();
      var changes = [];

      // Only items beneath the scanned root are in scope. Anything else in the
      // database (a different library root, a hand-added entry) is untouched —
      // scanning "software" must not mark "manuals" as missing.
      var inScope = db.items.filter(function (i) {
        return Paths.isInside(i.path, softwareRoot);
      });

      var byPath = new Map();
      inScope.forEach(function (i) {
        byPath.set(pathKey(i.path), i);
      });

      var seenIds = new Set();
      var normalized = Scanner._normalizeEntries(entries, softwareRoot);

      /* --- Pass 1: exact path matches ----------------------------------- */
      var unmatched = [];

      normalized.forEach(function (entry) {
        var existing = byPath.get(pathKey(entry.path));
        if (!existing) {
          unmatched.push(entry);
          return;
        }

        seenIds.add(existing.id);
        var change = Scanner._updateItem(existing, entry, now);
        if (change) changes.push(change);
      });

      /* --- Pass 2: moves and renames ------------------------------------ */
      // Anything in scope that pass 1 did not touch is a candidate source for
      // a move: its file is no longer where the database says it is. Index
      // those by size, the one fact that survives being moved to a new path.
      var orphansBySize = new Map();

      inScope.forEach(function (item) {
        if (seenIds.has(item.id) || item.kind !== 'file') return;
        var key = String(item.size);
        if (!orphansBySize.has(key)) orphansBySize.set(key, []);
        orphansBySize.get(key).push(item);
      });

      var stillNew = [];

      unmatched.forEach(function (entry) {
        if (entry.kind !== 'file') {
          stillNew.push(entry);
          return;
        }

        // Size alone is far too weak — installers routinely share a byte
        // count. Require the identical size AND the identical filename before
        // reusing an id, so a move ("Tools/x.exe" -> "Utils/x.exe") is caught
        // but two unrelated same-size files are never merged into one.
        var match = (orphansBySize.get(String(entry.size)) || []).find(function (c) {
          return (
            !seenIds.has(c.id) &&
            c.fileName.toLowerCase() === entry.name.toLowerCase()
          );
        });

        if (!match) {
          stillNew.push(entry);
          return;
        }

        seenIds.add(match.id);
        var from = match.path;

        match.path = entry.path;
        match.fileName = entry.name;
        match.missing = false;
        Scanner._applyFileFacts(match, entry);

        changes.push({
          kind: CHANGE.MOVED,
          id: match.id,
          name: match.name,
          path: entry.path,
          detail: from + '  ->  ' + entry.path,
        });
      });

      /* --- Pass 3: new items -------------------------------------------- */
      stillNew.forEach(function (entry) {
        var item = Schema.createItem({
          path: entry.path,
          fileName: entry.name,
          kind: entry.kind,
          size: entry.size,
          addedAt: now,
          updatedAt: entry.lastModified ? new Date(entry.lastModified).toISOString() : now,
          isNew: true,
        });

        db.items.push(item);
        seenIds.add(item.id);

        changes.push({
          kind: CHANGE.ADDED,
          id: item.id,
          name: item.name,
          path: item.path,
          detail: item.path,
        });
      });

      /* --- Pass 4: parent links ----------------------------------------- */
      Scanner.rebuildTree(db, softwareRoot);

      /* --- Pass 5: missing ---------------------------------------------- */
      inScope.forEach(function (item) {
        if (seenIds.has(item.id)) {
          if (item.missing) {
            item.missing = false;
            changes.push({
              kind: CHANGE.RESTORED,
              id: item.id,
              name: item.name,
              path: item.path,
              detail: item.path,
            });
          }
          return;
        }

        if (!item.missing) {
          item.missing = true;
          changes.push({
            kind: CHANGE.MISSING,
            id: item.id,
            name: item.name,
            path: item.path,
            detail: item.path,
          });
        }
      });

      Schema.syncCategories(db);
      db.settings.lastScan = now;

      var counts = {
        added: 0,
        updated: 0,
        moved: 0,
        missing: 0,
        restored: 0,
        total: normalized.length,
      };
      changes.forEach(function (c) {
        counts[c.kind]++;
      });

      Logger.info(
        'scanner: reconciled — ' +
          counts.added + ' added, ' +
          counts.updated + ' updated, ' +
          counts.moved + ' moved, ' +
          counts.missing + ' missing'
      );

      return { changes: changes, counts: counts };
    },

    /**
     * @private
     * Cleans discovered entries and drops anything outside the software root
     * or with an unsafe path.
     */
    _normalizeEntries: function (entries, softwareRoot) {
      var seen = new Set();
      var out = [];

      entries.forEach(function (raw) {
        var path = Paths.normalize(raw.path);
        if (!path) return;

        if (!Paths.isInside(path, softwareRoot)) {
          Logger.warn('scanner: ignoring an out-of-scope entry —', path);
          return;
        }

        // The root folder itself is a container, not a catalog item.
        if (pathKey(path) === pathKey(softwareRoot)) return;

        var key = pathKey(path);
        if (seen.has(key)) return;
        seen.add(key);

        out.push({
          path: path,
          name: raw.name || Paths.basename(path),
          kind: raw.kind === 'folder' ? 'folder' : 'file',
          size: Math.max(0, Number(raw.size) || 0),
          lastModified: Number(raw.lastModified) || 0,
        });
      });

      // Folders before their contents, so parent items always exist by the
      // time rebuildTree looks for them.
      out.sort(function (a, b) {
        var depth = Paths.segments(a.path).length - Paths.segments(b.path).length;
        if (depth) return depth;
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        return Utils.compareText(a.path, b.path);
      });

      return out;
    },

    /**
     * @private
     * Applies the facts the filesystem owns. Never touches a field the
     * administrator can edit.
     * @returns {boolean} whether anything changed
     */
    _applyFileFacts: function (item, entry) {
      var changed = false;

      if (entry.kind === 'file') {
        if (item.size !== entry.size) {
          item.size = entry.size;
          changed = true;
        }

        if (entry.lastModified) {
          var iso = new Date(entry.lastModified).toISOString();
          if (item.updatedAt !== iso) {
            item.updatedAt = iso;
            changed = true;
          }
        }

        // A file whose extension changed is a different kind of thing, but
        // only re-derive the type if the administrator never overrode it.
        var derived = FileTypes.fromFileName(entry.name);
        if (item.type !== derived && FileTypes.fromFileName(item.fileName) === item.type) {
          item.type = derived;
          changed = true;
        }
      }

      if (item.fileName !== entry.name) {
        item.fileName = entry.name;
        changed = true;
      }

      return changed;
    },

    /**
     * @private
     * @returns {Object|null} a change record, or null when nothing moved
     */
    _updateItem: function (item, entry, now) {
      var wasMissing = item.missing;
      var changed = Scanner._applyFileFacts(item, entry);

      if (wasMissing) {
        item.missing = false;
        return {
          kind: CHANGE.RESTORED,
          id: item.id,
          name: item.name,
          path: item.path,
          detail: item.path,
        };
      }

      if (!changed) return null;

      return {
        kind: CHANGE.UPDATED,
        id: item.id,
        name: item.name,
        path: item.path,
        detail: item.path,
      };
    },

    /**
     * Recomputes every item's parentId from its path.
     *
     * The path is the single source of truth for the tree: deriving parents
     * from it means a folder renamed on disk cannot leave orphans behind, and
     * there is no second structure to keep in sync.
     *
     * @param {Object} db mutated in place
     * @param {string} [scopeRoot] limit to items beneath this path
     */
    rebuildTree: function (db, scopeRoot) {
      var root = Paths.normalize(scopeRoot || db.settings.softwareRoot);

      var folderByPath = new Map();
      db.items.forEach(function (i) {
        if (i.kind === 'folder') folderByPath.set(pathKey(i.path), i);
      });

      db.items.forEach(function (item) {
        if (scopeRoot && !Paths.isInside(item.path, root)) return;

        var parentPath = Paths.dirname(item.path);

        // Reaching the software root means the item sits at the top level.
        if (!parentPath || pathKey(parentPath) === pathKey(root)) {
          item.parentId = null;
          return;
        }

        var parent = folderByPath.get(pathKey(parentPath));
        item.parentId = parent ? parent.id : null;
      });
    },

    /**
     * Removes items flagged missing. The one destructive operation here, and
     * it only ever runs from an explicit click with a confirmation behind it.
     * @param {Object} db mutated in place
     * @returns {number} how many were removed
     */
    purgeMissing: function (db) {
      var before = db.items.length;

      db.items = db.items.filter(function (i) {
        return !i.missing;
      });

      var removed = before - db.items.length;
      if (removed) {
        Scanner.rebuildTree(db);
        Schema.syncCategories(db);
        Logger.info('scanner: purged ' + removed + ' missing items');
      }

      return removed;
    },
  };

  NS.define('admin.Scanner', Scanner);
})(window.USBLib);
