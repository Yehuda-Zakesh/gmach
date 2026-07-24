/**
 * download.js — Serving files off the USB drive.
 *
 * WHY RELATIVE PATHS, ALWAYS
 * ------------------------------------------------------------------
 * The drive mounts as D: on one machine and G: on the next. An href of
 * "software/Tools/setup.exe" is resolved by the browser against the address
 * of index.html, so it follows the drive wherever it lands. An absolute path
 * ("file:///D:/software/...") would break the first time the letter changed,
 * so nothing here ever constructs one.
 *
 * A `download` attribute on a same-directory `file://` link is honoured by
 * Chromium; Firefox ignores it for local files and navigates instead, which
 * still reaches the file (its own download prompt takes over for binaries).
 * PDFs are the visible difference: Firefox opens them in its viewer rather
 * than saving. Both outcomes are acceptable, so this stays dependency-free
 * rather than reading bytes into a Blob just to force the filename.
 */
(function (NS) {
  'use strict';

  var Paths = NS.require('Paths');
  var Db = NS.require('Db');
  var Utils = NS.require('Utils');
  var Toast = NS.require('ui.Toast');
  var Modal = NS.require('ui.Modal');
  var Dom = NS.require('ui.Dom');
  var Logger = NS.require('Logger');

  /** Spacing between files of a multi-file package download. */
  var PACKAGE_STAGGER_MS = 700;

  /**
   * Opens a determinate progress modal wired to the "download-progress"
   * Tauri event emitted from copy_with_progress() in main.rs — large
   * installers are streamed in 1 MiB chunks specifically so this can show a
   * real percentage instead of the UI just sitting there looking frozen.
   * @returns {{stop: function}} call stop() once the invoke() promise settles
   */
  function openDownloadProgressModal() {
    var bar = Dom.h('div.progress__bar');
    var track = Dom.h('div.progress', {}, [bar]);
    var status = Dom.h('div', {
      style: { 'font-size': '0.85rem', color: 'var(--text-2)' },
      text: 'מתחיל…',
    });

    var handle = Modal.open({
      title: 'מוריד…',
      body: Dom.h('div', { style: { display: 'grid', gap: '12px' } }, [track, status]),
      closeOnBackdrop: false,
      footer: [],
    });

    var unlisten = null;
    window.__TAURI__.event
      .listen('download-progress', function (evt) {
        var p = evt.payload;
        var pct = p.bytesTotal ? Math.min(100, Math.round((p.bytesDone / p.bytesTotal) * 100)) : 0;
        bar.style.width = pct + '%';

        var fileLabel =
          p.fileCount > 1 ? 'קובץ ' + p.fileIndex + ' מתוך ' + p.fileCount + ' — ' + p.fileName : p.fileName;

        status.textContent =
          fileLabel + ' (' + Utils.formatSize(p.bytesDone) + ' מתוך ' + Utils.formatSize(p.bytesTotal) + ', ' + pct + '%)';
      })
      .then(function (fn) {
        unlisten = fn;
      });

    return {
      stop: function () {
        if (unlisten) unlisten();
        handle.close();
      },
    };
  }

  function triggerDownload(relPath, suggestedName) {
    var name = suggestedName || Paths.basename(relPath);

    if (window.__TAURI__) {
      var progress = openDownloadProgressModal();
      window.__TAURI__.core
        .invoke('download_item', { relPath: relPath, suggestedName: name })
        .then(function (savedName) {
          progress.stop();
          Toast.success('הקובץ "' + savedName + '" ירד בהצלחה ונמצא בתיקיית ההורדות.');
        })
        .catch(function (err) {
          progress.stop();
          Toast.error('ההורדה נכשלה: ' + (err && err.message ? err.message : err));
        });
      return;
    }

    var a = document.createElement('a');
    a.href = Paths.toHref(relPath);
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  var Download = {
    PACKAGE_STAGGER_MS: PACKAGE_STAGGER_MS,

    /**
     * Downloads a single file item.
     * @param {Object} item
     * @returns {boolean} whether a download was started
     */
    file: function (item) {
      if (!item || !item.path) {
        Toast.error('לא נמצא נתיב לקובץ.');
        return false;
      }

      if (!Paths.isSafe(item.path)) {
        Logger.error('download: refusing an unsafe path', item.path);
        Toast.error('נתיב הקובץ אינו תקין ולכן ההורדה בוטלה.');
        return false;
      }

      triggerDownload(item.path, item.fileName);
      return true;
    },

    /**
     * Downloads a PACKAGE folder.
     *
     * With a package file chosen (or inferable), this is a single download.
     * Otherwise every file in the folder is downloaded in sequence — the
     * browser cannot produce a ZIP without a compression library, and adding
     * one would mean shipping a dependency this project is meant to avoid.
     * The spacing keeps Chromium's "download multiple files?" prompt to one
     * ask instead of one per file.
     *
     * @param {Object[]} allItems
     * @param {Object} folder
     * @returns {Promise<number>} how many downloads were started
     */
    folder: function (allItems, folder) {
      var single = Db.downloadPathOf(allItems, folder);

      if (single) {
        triggerDownload(single, Paths.basename(single));
        return Promise.resolve(1);
      }

      var files = Db.packageFilesOf(allItems, folder).filter(function (f) {
        return Paths.isSafe(f.path);
      });

      if (!files.length) {
        Toast.error('התיקייה ריקה — אין מה להוריד.');
        return Promise.resolve(0);
      }

      if (window.__TAURI__) {
        var progress = openDownloadProgressModal();
        return window.__TAURI__.core
          .invoke('download_package', {
            relPaths: files.map(function (f) {
              return f.path;
            }),
            suggestedNames: files.map(function (f) {
              return f.fileName;
            }),
          })
          .then(function (count) {
            progress.stop();
            if (count) Toast.success('הורדו ' + count + ' קבצים לתיקיית ההורדות.');
            return count;
          })
          .catch(function (err) {
            progress.stop();
            Toast.error('ההורדה נכשלה: ' + (err && err.message ? err.message : err));
            return 0;
          });
      }

      Toast.info(
        'מוריד ' + files.length + ' קבצים. ייתכן שהדפדפן יבקש אישור להורדות מרובות.',
        6000
      );

      var chain = Promise.resolve();
      files.forEach(function (file, i) {
        chain = chain.then(function () {
          triggerDownload(file.path, file.fileName);
          return i < files.length - 1 ? Utils.delay(PACKAGE_STAGGER_MS) : null;
        });
      });

      return chain.then(function () {
        return files.length;
      });
    },

    /**
     * Downloads whatever the item is.
     * @param {Object[]} allItems
     * @param {Object} item
     * @returns {Promise<boolean>}
     */
    start: function (allItems, item) {
      if (item.kind === 'folder') {
        return Download.folder(allItems, item).then(function (n) {
          return n > 0;
        });
      }
      return Promise.resolve(Download.file(item));
    },

    /**
     * True when the item has something to serve. Drives the disabled state of
     * the Download button, so a user never clicks into a dead end.
     * @param {Object[]} allItems
     * @param {Object} item
     * @returns {boolean}
     */
    isAvailable: function (allItems, item) {
      if (item.missing) return false;
      if (item.kind === 'file') return !!item.path;
      if (item.folderMode !== NS.Schema.FOLDER_MODE.PACKAGE) return false;
      return (
        !!Db.downloadPathOf(allItems, item) ||
        Db.packageFilesOf(allItems, item).length > 0
      );
    },

    /**
     * Opens a file with its default application. In a plain browser this
     * means a new tab (the escape hatch for PDFs, or browsers that refuse
     * the `download` attribute). In the desktop app it launches the real
     * program directly via the OS — this is the "run it, it's already on
     * this computer" action.
     * @param {Object} item
     */
    open: function (item) {
      if (!item || !item.path || !Paths.isSafe(item.path)) return;

      if (window.__TAURI__) {
        window.__TAURI__.core.invoke('open_item', { relPath: item.path }).catch(function (err) {
          Toast.error('לא ניתן לפתוח את הקובץ: ' + (err && err.message ? err.message : err));
        });
        return;
      }

      window.open(Paths.toHref(item.path), '_blank', 'noopener');
    },

    /**
     * Copies an item's relative path to the clipboard.
     * @param {Object} item
     * @returns {Promise<boolean>}
     */
    copyPath: function (item) {
      var text = Paths.normalize(item.path);

      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard
          .writeText(text)
          .then(function () {
            Toast.success('הנתיב הועתק.');
            return true;
          })
          .catch(function () {
            return Download._legacyCopy(text);
          });
      }

      return Promise.resolve(Download._legacyCopy(text));
    },

    /**
     * @private
     * The async clipboard API needs permission that a `file://` page is not
     * always granted, so fall back to the old selection-based copy.
     */
    _legacyCopy: function (text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();

      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }

      document.body.removeChild(ta);

      if (ok) Toast.success('הנתיב הועתק.');
      else Toast.warn('לא ניתן היה להעתיק את הנתיב. ניתן לסמן אותו ידנית.');
      return ok;
    },
  };

  NS.define('app.Download', Download);
})(window.USBLib);
