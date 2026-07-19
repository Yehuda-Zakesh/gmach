/**
 * fs.js — File system access, with a working path on every browser.
 *
 * THREE CAPABILITY TIERS
 * ------------------------------------------------------------------
 * A. File System Access API (Chrome/Edge/Brave)
 *    The administrator grants the project folder once. After that, scanning
 *    and saving happen silently and in place — this is the good path.
 *
 * B. <input type="file" webkitdirectory> + downloads (Firefox, and Chromium
 *    profiles where the picker is blocked by policy)
 *    Scanning still works: the input yields every file beneath the chosen
 *    folder with its relative path, size and mtime. Saving cannot write in
 *    place, so the console produces the two data files as downloads and the
 *    administrator copies them into data/ — one drag, documented in the UI.
 *
 * C. Neither (very old browsers)
 *    The public catalog still renders from data/database.js. Only the admin
 *    console is degraded, and it says so instead of failing silently.
 *
 * The public page never calls anything here: it must not prompt a user who
 * only wants to download a file.
 */
(function (NS) {
  'use strict';

  var Utils = NS.require('Utils');
  var Paths = NS.require('Paths');
  var Storage = NS.require('Storage');
  var Logger = NS.require('Logger');

  var HANDLE_KEY = 'projectRoot';

  /** Folders that are never part of the software library. */
  var IGNORED_DIRS = [
    'system volume information',
    '$recycle.bin',
    '.git',
    '.svn',
    'node_modules',
    '__macosx',
  ];

  /**
   * Files that are noise on a USB drive rather than library content.
   * `readme.md` is here because the software folder ships with one explaining
   * how to use it — that is a note to the administrator, not a download.
   */
  var IGNORED_FILES = [
    'thumbs.db',
    'desktop.ini',
    '.ds_store',
    'autorun.inf',
    'readme.md',
  ];

  function isIgnoredDir(name) {
    return IGNORED_DIRS.indexOf(String(name).toLowerCase()) !== -1;
  }

  function isIgnoredFile(name) {
    var lower = String(name).toLowerCase();
    return IGNORED_FILES.indexOf(lower) !== -1 || lower.charAt(0) === '.';
  }

  var Fs = {
    IGNORED_DIRS: IGNORED_DIRS,
    IGNORED_FILES: IGNORED_FILES,

    /** @returns {boolean} tier A available. */
    supportsFileSystemAccess: function () {
      // The desktop build (src-tauri) always uses its own native read/write
      // commands against the auto-managed data/ folder — File System Access
      // would let an administrator point it at the wrong folder entirely, so
      // it's disabled here regardless of what the webview itself supports.
      if (window.__TAURI__) return false;

      return (
        typeof window.showDirectoryPicker === 'function' &&
        typeof window.FileSystemDirectoryHandle !== 'undefined'
      );
    },

    /** @returns {boolean} tier B available. */
    supportsDirectoryInput: function () {
      var input = document.createElement('input');
      return 'webkitdirectory' in input;
    },

    /** @returns {'full'|'scan-only'|'none'} the active tier. */
    capability: function () {
      if (Fs.supportsFileSystemAccess()) return 'full';
      if (Fs.supportsDirectoryInput()) return 'scan-only';
      return 'none';
    },

    /* --- Directory handles (tier A) -------------------------------------- */

    /**
     * Asks the administrator to grant the project folder — the one holding
     * index.html — and remembers it for next time.
     * Must be called from a user gesture.
     * @returns {Promise<FileSystemDirectoryHandle>}
     */
    pickProjectRoot: function () {
      if (!Fs.supportsFileSystemAccess()) {
        return Promise.reject(new Error('הדפדפן אינו תומך בגישה ישירה לקבצים.'));
      }

      return window
        .showDirectoryPicker({ id: 'usblib-root', mode: 'readwrite' })
        .then(function (handle) {
          return Storage.put(HANDLE_KEY, handle).then(function () {
            return handle;
          });
        });
    },

    /** @returns {Promise<FileSystemDirectoryHandle|null>} */
    getSavedProjectRoot: function () {
      return Storage.get(HANDLE_KEY);
    },

    forgetProjectRoot: function () {
      return Storage.remove(HANDLE_KEY);
    },

    /**
     * @param {FileSystemHandle} handle
     * @param {'read'|'readwrite'} mode
     * @returns {Promise<boolean>} true when permission is already granted
     */
    hasPermission: function (handle, mode) {
      if (!handle || !handle.queryPermission) return Promise.resolve(false);
      return handle
        .queryPermission({ mode: mode || 'readwrite' })
        .then(function (state) {
          return state === 'granted';
        })
        .catch(function () {
          return false;
        });
    },

    /**
     * Requests permission if it isn't already granted.
     * Chrome only re-grants a persisted handle from a user gesture, so call
     * this from a click handler.
     * @returns {Promise<boolean>}
     */
    ensurePermission: function (handle, mode) {
      if (!handle || !handle.requestPermission) return Promise.resolve(false);
      var opts = { mode: mode || 'readwrite' };

      return handle
        .queryPermission(opts)
        .then(function (state) {
          if (state === 'granted') return true;
          return handle.requestPermission(opts).then(function (s) {
            return s === 'granted';
          });
        })
        .catch(function (err) {
          Logger.warn('fs: permission request failed —', err.message);
          return false;
        });
    },

    /**
     * Recursively lists a directory handle.
     * @param {FileSystemDirectoryHandle} dirHandle
     * @param {Object} [options]
     * @param {string} [options.prefix] path prepended to every entry
     * @param {number} [options.maxDepth] default 12
     * @param {function(number, string):void} [options.onProgress]
     * @returns {Promise<Array<{path:string,name:string,kind:string,size:number,lastModified:number}>>}
     */
    walkDirectory: function (dirHandle, options) {
      var opts = options || {};
      var prefix = Paths.normalize(opts.prefix || '');
      var maxDepth = opts.maxDepth || 12;
      var onProgress = opts.onProgress || function () {};
      var out = [];

      function walk(handle, base, depth) {
        if (depth > maxDepth) {
          Logger.warn('fs: stopping at max depth in "' + base + '"');
          return Promise.resolve();
        }

        var chain = Promise.resolve();
        var iterator = handle.values();

        function step() {
          return iterator.next().then(function (res) {
            if (res.done) return null;

            var entry = res.value;
            var path = base ? base + '/' + entry.name : entry.name;

            if (entry.kind === 'directory') {
              if (isIgnoredDir(entry.name)) return step();

              out.push({
                path: path,
                name: entry.name,
                kind: 'folder',
                size: 0,
                lastModified: 0,
              });
              onProgress(out.length, path);

              return walk(entry, path, depth + 1).then(step);
            }

            if (isIgnoredFile(entry.name)) return step();

            return entry
              .getFile()
              .then(function (file) {
                out.push({
                  path: path,
                  name: entry.name,
                  kind: 'file',
                  size: file.size,
                  lastModified: file.lastModified,
                });
                onProgress(out.length, path);
              })
              .catch(function (err) {
                Logger.warn('fs: could not read "' + path + '" —', err.message);
              })
              .then(step);
          });
        }

        return chain.then(step);
      }

      return walk(dirHandle, prefix, 0).then(function () {
        return out;
      });
    },

    /**
     * Resolves a subdirectory by relative path.
     * @param {FileSystemDirectoryHandle} root
     * @param {string} relPath
     * @param {boolean} [create]
     * @returns {Promise<FileSystemDirectoryHandle>}
     */
    getDirectory: function (root, relPath, create) {
      var segments = Paths.segments(relPath);
      var chain = Promise.resolve(root);

      segments.forEach(function (seg) {
        chain = chain.then(function (dir) {
          return dir.getDirectoryHandle(seg, { create: !!create });
        });
      });

      return chain;
    },

    /**
     * Writes text to a relative path beneath the project root, creating
     * intermediate folders when asked.
     * @param {FileSystemDirectoryHandle} root
     * @param {string} relPath
     * @param {string} contents
     * @returns {Promise<void>}
     */
    writeTextFile: function (root, relPath, contents) {
      var dirPath = Paths.dirname(relPath);
      var fileName = Paths.basename(relPath);

      return Fs.getDirectory(root, dirPath, true)
        .then(function (dir) {
          return dir.getFileHandle(fileName, { create: true });
        })
        .then(function (fileHandle) {
          return fileHandle.createWritable();
        })
        .then(function (writable) {
          return writable.write(contents).then(function () {
            return writable.close();
          });
        });
    },

    /**
     * Writes binary data (uploaded icons) to a relative path.
     * @returns {Promise<void>}
     */
    writeBinaryFile: function (root, relPath, blob) {
      var dirPath = Paths.dirname(relPath);
      var fileName = Paths.basename(relPath);

      return Fs.getDirectory(root, dirPath, true)
        .then(function (dir) {
          return dir.getFileHandle(fileName, { create: true });
        })
        .then(function (fileHandle) {
          return fileHandle.createWritable();
        })
        .then(function (writable) {
          return writable.write(blob).then(function () {
            return writable.close();
          });
        });
    },

    /**
     * Reads a text file relative to the project root.
     * @returns {Promise<string|null>} null when it does not exist
     */
    readTextFile: function (root, relPath) {
      var dirPath = Paths.dirname(relPath);
      var fileName = Paths.basename(relPath);

      return Fs.getDirectory(root, dirPath, false)
        .then(function (dir) {
          return dir.getFileHandle(fileName, { create: false });
        })
        .then(function (fileHandle) {
          return fileHandle.getFile();
        })
        .then(function (file) {
          return Utils.readAsText(file);
        })
        .catch(function () {
          return null;
        });
    },

    /**
     * Confirms a handle really points at the project folder, so an
     * administrator who picks "Documents" by mistake is told immediately
     * rather than having database.js written into the wrong place.
     * @returns {Promise<boolean>}
     */
    looksLikeProjectRoot: function (root) {
      if (!root || !root.getFileHandle) return Promise.resolve(false);
      return root
        .getFileHandle('index.html', { create: false })
        .then(function () {
          return true;
        })
        .catch(function () {
          return false;
        });
    },

    /* --- Directory input (tier B) ---------------------------------------- */

    /**
     * Opens a folder picker built on <input webkitdirectory> and returns the
     * files beneath it.
     *
     * `webkitRelativePath` is always prefixed with the chosen folder's own
     * name ("software/Tools/x.exe" when "software" was selected), which is
     * exactly the shape stored in the database — provided the folder sits
     * next to index.html. `rootName` is returned so the caller can verify it.
     *
     * @returns {Promise<{rootName:string, entries:Array}>}
     */
    pickDirectoryViaInput: function () {
      return new Promise(function (resolve, reject) {
        var input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.webkitdirectory = true;
        input.setAttribute('webkitdirectory', '');
        input.setAttribute('directory', '');
        input.style.display = 'none';

        var settled = false;

        input.addEventListener('change', function () {
          settled = true;
          var files = Array.prototype.slice.call(input.files || []);
          document.body.removeChild(input);

          if (!files.length) {
            reject(new Error('לא נבחרו קבצים.'));
            return;
          }

          var rootName = String(files[0].webkitRelativePath || '').split('/')[0];
          var entries = [];
          var seenDirs = Object.create(null);

          files.forEach(function (file) {
            var rel = Paths.normalize(file.webkitRelativePath || file.name);
            if (!rel) return;

            var segments = Paths.segments(rel);
            if (isIgnoredFile(segments[segments.length - 1])) return;
            if (
              segments.some(function (s, i) {
                return i < segments.length - 1 && isIgnoredDir(s);
              })
            ) {
              return;
            }

            // The input only reports files, so folders are reconstructed from
            // the path segments. A folder containing no files anywhere below
            // it cannot be seen this way — an acceptable gap, since an empty
            // folder has nothing to offer the catalog either.
            for (var i = 1; i < segments.length; i++) {
              var dirPath = segments.slice(0, i).join('/');
              if (seenDirs[dirPath]) continue;
              seenDirs[dirPath] = true;
              entries.push({
                path: dirPath,
                name: segments[i - 1],
                kind: 'folder',
                size: 0,
                lastModified: 0,
              });
            }

            entries.push({
              path: rel,
              name: file.name,
              kind: 'file',
              size: file.size,
              lastModified: file.lastModified,
            });
          });

          resolve({ rootName: rootName, entries: entries });
        });

        // 'cancel' is not universally supported; the promise simply never
        // settles when the dialog is dismissed, which callers treat as "no
        // change". The input is removed on the next attempt.
        input.addEventListener('cancel', function () {
          if (settled) return;
          settled = true;
          if (input.parentNode) document.body.removeChild(input);
          reject(new Error('הבחירה בוטלה.'));
        });

        document.body.appendChild(input);
        input.click();
      });
    },

    /* --- Downloads (tier B saving) --------------------------------------- */

    /**
     * Saves text as a download. Used when in-place writing is unavailable.
     * @param {string} fileName
     * @param {string} contents
     * @param {string} [mime]
     */
    downloadText: function (fileName, contents, mime) {
      var blob = new Blob([contents], {
        type: (mime || 'text/plain') + ';charset=utf-8',
      });
      var url = URL.createObjectURL(blob);

      var a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Revoking immediately can cancel the download in some builds; a short
      // delay is the pragmatic fix.
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 4000);
    },
  };

  NS.define('Fs', Fs);
})(window.USBLib);
