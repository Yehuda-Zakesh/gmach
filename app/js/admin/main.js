/**
 * main.js — Administrator console bootstrap (admin.html).
 *
 * This page is never linked from index.html. It is reached only by typing
 * admin.html into the address bar, and it is gated by a password.
 */
(function (NS) {
  'use strict';

  var Dom = NS.require('ui.Dom');
  var Icons = NS.require('ui.Icons');
  var Modal = NS.require('ui.Modal');
  var Toast = NS.require('ui.Toast');
  var Theme = NS.require('ui.Theme');
  var Utils = NS.require('Utils');
  var Paths = NS.require('Paths');
  var Db = NS.require('Db');
  var Schema = NS.require('Schema');
  var Fs = NS.require('Fs');
  var Crypto = NS.require('Crypto');
  var Logger = NS.require('Logger');
  var Auth = NS.require('admin.Auth');
  var Scanner = NS.require('admin.Scanner');
  var Persist = NS.require('admin.Persist');
  var Editor = NS.require('admin.Editor');

  var state = {
    db: null,
    rootHandle: null,
    dirty: false,
    view: 'library',
    filter: { query: '', type: '', status: '' },
  };

  var el = {};

  /* --- Dirty tracking ---------------------------------------------------- */

  function markDirty() {
    state.dirty = true;
    Dom.setHidden(el.dirtyDot, false);
    el.saveBtn.classList.add('btn--primary');
  }

  function markClean() {
    state.dirty = false;
    Dom.setHidden(el.dirtyDot, true);
  }

  // A refresh with unsaved edits would silently lose them, and the database
  // is the administrator's only copy.
  window.addEventListener('beforeunload', function (evt) {
    if (!state.dirty) return;
    evt.preventDefault();
    evt.returnValue = '';
  });

  /* --- Saving ------------------------------------------------------------ */

  function save() {
    el.saveBtn.classList.add('btn--loading');

    return Persist.save({ db: state.db, rootHandle: state.rootHandle })
      .then(function (result) {
        markClean();

        if (result.method === 'download') {
          showDownloadInstructions(result.fallbackReason);
        } else {
          Toast.success('הנתונים נשמרו לכונן.');
        }

        renderStatus();
        return result;
      })
      .catch(function (err) {
        Logger.error('admin: save failed', err);
        Toast.error('השמירה נכשלה: ' + err.message);
      })
      .then(function () {
        el.saveBtn.classList.remove('btn--loading');
      });
  }

  function showDownloadInstructions(reason) {
    Modal.open({
      title: 'השלמת השמירה',
      size: 'narrow',
      body: Dom.h('div', { style: { display: 'grid', gap: '16px' } }, [
        reason
          ? Dom.h('div.notice.notice--warn', {}, [
              Icons.get('warning'),
              Dom.h('div', { text: 'לא ניתן היה לכתוב ישירות לכונן: ' + reason }),
            ])
          : null,
        Dom.h('p', {
          style: { margin: '0', 'line-height': '1.7' },
          text:
            'הדפדפן הוריד שני קבצים: database.js ו־database.json. ' +
            'כדי להשלים את השמירה, העתק את שניהם לתיקיית data שבכונן, ' +
            'והחלף את הקבצים הקיימים.',
        }),
        Dom.h('div.notice.notice--info', {}, [
          Icons.get('info'),
          Dom.h('div', {
            text:
              'בדפדפני Chrome או Edge ניתן לחבר את תיקיית הפרויקט פעם אחת ' +
              'ואז השמירה מתבצעת אוטומטית ללא הורדות.',
          }),
        ]),
      ]),
      footer: [
        Dom.h('button.btn.btn--primary', {
          type: 'button',
          text: 'הבנתי',
          on: {
            click: function () {
              Modal.closeAll();
            },
          },
        }),
      ],
    });
  }

  /* --- Folder connection ------------------------------------------------- */

  function connectFolder() {
    if (!Fs.supportsFileSystemAccess()) {
      Toast.warn('הדפדפן אינו תומך בחיבור ישיר לתיקייה. השמירה תתבצע דרך הורדות.');
      return Promise.resolve(false);
    }

    return Fs.pickProjectRoot()
      .then(function (handle) {
        return Fs.looksLikeProjectRoot(handle).then(function (ok) {
          if (!ok) {
            // Writing database.js into the wrong folder would be silent and
            // confusing, so refuse rather than guess.
            Fs.forgetProjectRoot();
            Toast.error(
              'התיקייה שנבחרה אינה תיקיית הפרויקט — לא נמצא בה הקובץ index.html.'
            );
            return false;
          }

          state.rootHandle = handle;
          Toast.success('התיקייה חוברה בהצלחה. מעכשיו השמירה תתבצע ישירות לכונן.');
          renderStatus();
          return true;
        });
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return false;
        Logger.warn('admin: folder connection failed —', err.message);
        Toast.error('חיבור התיקייה נכשל: ' + err.message);
        return false;
      });
  }

  function restoreFolder() {
    return Fs.getSavedProjectRoot()
      .then(function (handle) {
        if (!handle) return null;
        return Fs.hasPermission(handle, 'readwrite').then(function (granted) {
          // Chrome only re-grants a persisted handle from a user gesture, so
          // hold it either way and let the first save prompt if needed.
          state.rootHandle = handle;
          if (!granted) {
            Logger.info('admin: restored a handle that still needs permission');
          }
          return handle;
        });
      })
      .catch(function () {
        return null;
      });
  }

  /* --- Scanning ---------------------------------------------------------- */

  /**
   * Desktop-app only: scans data/software directly via the Rust
   * list_software_directory command and reconciles the result — the
   * location is already known (it's the folder the app itself manages), so
   * this needs no dialog and runs quietly every time the console opens.
   * Only surfaces a toast when the scan actually changed something.
   */
  function runAutoScan() {
    if (!window.__TAURI__) return Promise.resolve();

    return window.__TAURI__.core
      .invoke('list_software_directory', {})
      .then(function (entries) {
        var outcome = Scanner.reconcile(state.db, entries, {
          softwareRoot: state.db.settings.softwareRoot,
        });

        var c = outcome.counts;
        if (c.added || c.updated || c.moved || c.missing || c.restored) {
          markDirty();

          var parts = [
            c.added ? c.added + ' נוספו' : '',
            c.updated ? c.updated + ' עודכנו' : '',
            c.moved ? c.moved + ' הועברו' : '',
            c.missing ? c.missing + ' חסרים' : '',
            c.restored ? c.restored + ' חזרו' : '',
          ].filter(Boolean);

          Toast.info(
            'סריקה אוטומטית עדכנה את הספרייה: ' + parts.join(', ') + '. אל תשכח לשמור.',
            6000
          );
        }

        return outcome;
      })
      .catch(function (err) {
        Logger.error('admin: auto-scan failed', err);
        Toast.error('הסריקה האוטומטית נכשלה: ' + (err && err.message ? err.message : err));
      });
  }

  function runScan() {
    var log = Dom.h('div.scan-log', { text: 'מתחיל סריקה…\n' });
    var progress = Dom.h('div.progress.progress--indeterminate', {}, [
      Dom.h('div.progress__bar'),
    ]);

    var handle = Modal.open({
      title: 'סריקת תיקיית התוכנות',
      body: Dom.h('div', { style: { display: 'grid', gap: '16px' } }, [progress, log]),
      closeOnBackdrop: false,
      footer: [],
    });

    function append(line) {
      log.textContent += line + '\n';
      log.scrollTop = log.scrollHeight;
    }

    return Scanner.discover({
      rootHandle: state.rootHandle,
      softwareRoot: state.db.settings.softwareRoot,
      onProgress: function (n, path) {
        // Appending on every file makes a 5000-file scan crawl: each write
        // forces a reflow of the log box.
        if (n % 25 === 0) append(n + ' פריטים… ' + path);
      },
    })
      .then(function (result) {
        append('נמצאו ' + result.entries.length + ' פריטים בכונן.');

        if (result.method === 'input') {
          var expected = Paths.normalize(state.db.settings.softwareRoot);
          if (Paths.normalize(result.rootName) !== expected) {
            throw new Error(
              'נבחרה התיקייה "' +
                result.rootName +
                '" אך בהגדרות מוגדרת התיקייה "' +
                expected +
                '". בחר את התיקייה הנכונה, או עדכן את ההגדרות.'
            );
          }
        }

        var outcome = Scanner.reconcile(state.db, result.entries, {
          softwareRoot: state.db.settings.softwareRoot,
        });

        handle.close();
        showScanResults(outcome);

        if (
          outcome.counts.added ||
          outcome.counts.updated ||
          outcome.counts.moved ||
          outcome.counts.missing ||
          outcome.counts.restored
        ) {
          markDirty();
        }

        renderAll();
        return outcome;
      })
      .catch(function (err) {
        handle.close();
        Logger.error('admin: scan failed', err);
        Toast.error('הסריקה נכשלה: ' + err.message);
      });
  }

  /**
   * Desktop-app only: opens a native "choose files" dialog, copies whatever
   * is picked into data/software/ (via the Rust import_software_files
   * command), then reconciles the result exactly like a folder scan would —
   * so admins no longer need to drop files into the folder by hand first.
   */
  function runImport() {
    if (!window.__TAURI__) return;

    return window.__TAURI__.core
      .invoke('import_software_files', {})
      .then(function (copied) {
        if (!copied.length) return; // dialog cancelled, or nothing selected

        var entries = copied.map(function (f) {
          return {
            path: f.path,
            name: f.name,
            kind: 'file',
            size: f.size,
            lastModified: f.lastModified,
          };
        });

        var outcome = Scanner.reconcile(state.db, entries, {
          softwareRoot: state.db.settings.softwareRoot,
        });

        showScanResults(outcome);
        markDirty();
        renderAll();
        Toast.success('נוספו ' + copied.length + ' קבצים לתיקיית התוכנה.');
        return outcome;
      })
      .catch(function (err) {
        Logger.error('admin: import failed', err);
        Toast.error('ההוספה נכשלה: ' + (err && err.message ? err.message : err));
      });
  }

  function showScanResults(outcome) {
    var c = outcome.counts;

    var summary = Dom.h('div.stat-row', {}, [
      stat(c.added, 'נוספו'),
      stat(c.updated, 'עודכנו'),
      stat(c.moved, 'הועברו'),
      stat(c.missing, 'חסרים'),
      stat(c.restored, 'חזרו'),
    ]);

    var TAG = {
      added: { cls: 'add', text: 'חדש' },
      updated: { cls: 'update', text: 'עודכן' },
      moved: { cls: 'update', text: 'הועבר' },
      missing: { cls: 'miss', text: 'חסר' },
      restored: { cls: 'add', text: 'חזר' },
    };

    var list = outcome.changes.length
      ? Dom.h(
          'div.diff-list',
          {},
          outcome.changes.slice(0, 300).map(function (ch) {
            var tag = TAG[ch.kind];
            return Dom.h('div.diff-item', {}, [
              Dom.h('span.diff-item__tag.diff-item__tag--' + tag.cls, { text: tag.text }),
              Dom.h('span.truncate', { text: ch.name, style: { flex: '1' } }),
              Dom.h('span.diff-item__path', { text: ch.detail }),
            ]);
          })
        )
      : Dom.h('div.notice', {}, [
          Icons.get('check-circle'),
          Dom.h('div', { text: 'לא נמצאו שינויים — הספרייה מעודכנת.' }),
        ]);

    Modal.open({
      title: 'תוצאות הסריקה',
      size: 'wide',
      body: Dom.h('div', { style: { display: 'grid', gap: '16px' } }, [
        summary,
        outcome.changes.length > 300
          ? Dom.h('div.notice.notice--info', {}, [
              Icons.get('info'),
              Dom.h('div', {
                text:
                  'מוצגים 300 השינויים הראשונים מתוך ' + outcome.changes.length + '.',
              }),
            ])
          : null,
        list,
        c.missing
          ? Dom.h('div.notice.notice--warn', {}, [
              Icons.get('warning'),
              Dom.h('div', {
                text:
                  'פריטים חסרים לא נמחקו — המידע שלהם נשמר. אם הקבצים הוסרו לצמיתות, ' +
                  'ניתן לנקות אותם ממסך הספרייה.',
              }),
            ])
          : null,
      ]),
      footer: [
        Dom.h('button.btn.btn--primary', {
          type: 'button',
          text: 'סגירה',
          on: {
            click: function () {
              Modal.closeAll();
            },
          },
        }),
      ],
    });
  }

  function stat(value, label) {
    return Dom.h('div.stat', {}, [
      Dom.h('div.stat__value', { text: String(value) }),
      Dom.h('div.stat__label', { text: label }),
    ]);
  }

  /* --- Library view ------------------------------------------------------ */

  function filteredItems() {
    var q = Utils.normalize(state.filter.query);

    return state.db.items.filter(function (i) {
      if (state.filter.type && i.type !== state.filter.type) return false;

      if (state.filter.status === 'hidden' && !i.hidden) return false;
      if (state.filter.status === 'visible' && i.hidden) return false;
      if (state.filter.status === 'missing' && !i.missing) return false;
      if (state.filter.status === 'new' && !i.isNew) return false;

      if (!q) return true;

      return (
        Utils.normalize(i.name).indexOf(q) !== -1 ||
        Utils.normalize(i.path).indexOf(q) !== -1 ||
        Utils.normalize(i.category).indexOf(q) !== -1
      );
    });
  }

  function renderLibrary() {
    var items = filteredItems();
    var s = Db.stats(state.db);

    el.navCount.textContent = String(s.total);

    Dom.replace(el.libStats, [
      stat(s.total, 'סה״כ פריטים'),
      stat(s.files, 'קבצים'),
      stat(s.folders, 'תיקיות'),
      stat(s.isNew, 'מסומנים כחדשים'),
      stat(s.hidden, 'מוסתרים'),
      stat(s.missing, 'חסרים'),
    ]);

    Dom.setHidden(el.purgeBtn, s.missing === 0);

    if (!items.length) {
      Dom.replace(el.tableWrap, [
        Dom.h('div.empty', {}, [
          Icons.get(state.db.items.length ? 'search' : 'inbox', {
            className: 'empty__icon',
          }),
          Dom.h('div.empty__title', {
            text: state.db.items.length ? 'אין תוצאות' : 'הספרייה ריקה',
          }),
          Dom.h('p.empty__text', {
            text: state.db.items.length
              ? 'שנה את החיפוש או את הסינון.'
              : 'לחץ על "סריקת תיקייה" כדי לייבא את התוכנות מהכונן.',
          }),
        ]),
      ]);
      return;
    }

    var rows = items.map(buildRow);

    Dom.replace(el.tableWrap, [
      Dom.h('table.table', {}, [
        Dom.h('thead', {}, [
          Dom.h('tr', {}, [
            Dom.h('th', { text: 'פריט' }),
            Dom.h('th', { text: 'קטגוריה' }),
            Dom.h('th', { text: 'גרסה' }),
            Dom.h('th', { text: 'גודל' }),
            Dom.h('th', { text: 'עודכן' }),
            Dom.h('th', { text: 'מצב' }),
            Dom.h('th', { text: 'פעולות' }),
          ]),
        ]),
        Dom.h('tbody', {}, rows),
      ]),
    ]);
  }

  function buildRow(item) {
    var iconWrap = Dom.h('div.row-icon');
    var iconSrc = Db.imageSrc(item.icon);

    if (iconSrc) {
      var img = Dom.h('img', { src: iconSrc, alt: '' });
      img.addEventListener('error', function () {
        Dom.replace(iconWrap, Icons.get(NS.FileTypes.iconOf(item.type)));
      });
      iconWrap.appendChild(img);
    } else {
      iconWrap.appendChild(Icons.get(NS.FileTypes.iconOf(item.type)));
    }

    var badges = [];
    if (item.isNew) badges.push(Dom.h('span.badge.badge--new', { text: 'חדש' }));
    if (item.hidden) badges.push(Dom.h('span.badge.badge--hidden', { text: 'מוסתר' }));
    if (item.missing) badges.push(Dom.h('span.badge.badge--missing', { text: 'חסר' }));
    if (item.kind === 'folder') {
      badges.push(
        Dom.h('span.badge', {
          text:
            item.folderMode === Schema.FOLDER_MODE.PACKAGE ? 'חבילה' : 'קטגוריה',
        })
      );
    }
    if (!badges.length) badges.push(Dom.h('span.badge', { text: 'פעיל' }));

    var size =
      item.kind === 'folder' ? Db.folderSize(state.db.items, item) : item.size;

    var tr = Dom.h(
      'tr',
      {
        className:
          (item.hidden ? 'is-hidden-item ' : '') + (item.missing ? 'is-missing' : ''),
      },
      [
        Dom.h('td', {}, [
          Dom.h('div.row-main', {}, [
            iconWrap,
            Dom.h('div.row-text', {}, [
              Dom.h('div.row-name.truncate', { text: item.name, title: item.name }),
              Dom.h('div.row-path.truncate', { text: item.path, title: item.path }),
            ]),
          ]),
        ]),
        Dom.h('td', { text: item.category || '—' }),
        Dom.h('td', {}, Dom.h('span.ltr', { text: item.version || '—' })),
        Dom.h('td', {}, Dom.h('span.ltr', { text: size ? Utils.formatSize(size) : '—' })),
        Dom.h('td', {}, Dom.h('span.nowrap', { text: Utils.formatDate(item.updatedAt) })),
        Dom.h('td', {}, Dom.h('div.details__tags', {}, badges)),
        Dom.h('td', {}, [
          Dom.h('div.row-actions', {}, [
            Dom.h(
              'button.btn.btn--ghost.btn--icon',
              {
                type: 'button',
                title: 'עריכה',
                'aria-label': 'עריכת ' + item.name,
                on: {
                  click: function () {
                    openEditor(item);
                  },
                },
              },
              Icons.get('edit')
            ),
            Dom.h(
              'button.btn.btn--ghost.btn--icon',
              {
                type: 'button',
                title: item.hidden ? 'הצגה למשתמשים' : 'הסתרה ממשתמשים',
                'aria-label': item.hidden ? 'הצגת ' + item.name : 'הסתרת ' + item.name,
                on: {
                  click: function () {
                    item.hidden = !item.hidden;
                    markDirty();
                    renderLibrary();
                  },
                },
              },
              Icons.get(item.hidden ? 'eye-off' : 'eye')
            ),
            Dom.h(
              'button.btn.btn--ghost.btn--icon.btn--danger',
              {
                type: 'button',
                title: 'מחיקה ממסד הנתונים',
                'aria-label': 'מחיקת ' + item.name,
                on: {
                  click: function () {
                    removeItem(item);
                  },
                },
              },
              Icons.get('trash')
            ),
          ]),
        ]),
      ]
    );

    return tr;
  }

  function openEditor(item) {
    Editor.open({
      item: item,
      db: state.db,
      getRootHandle: function () {
        return state.rootHandle;
      },
      onSave: function () {
        markDirty();
        renderAll();
        Toast.success('הפריט עודכן. אל תשכח לשמור.');
      },
    });
  }

  function removeItem(item) {
    var children =
      item.kind === 'folder' ? Db.descendantsOf(state.db.items, item.id) : [];

    Modal.confirm({
      title: 'מחיקת פריט',
      danger: true,
      confirmText: 'מחיקה',
      message:
        'הפריט "' +
        item.name +
        '" יימחק ממסד הנתונים' +
        (children.length ? ' יחד עם ' + children.length + ' פריטים שבתוכו' : '') +
        '. הקבצים עצמם לא יימחקו מהכונן, אך כל המידע שהוזן ידנית יאבד.',
    }).then(function (ok) {
      if (!ok) return;

      var doomed = {};
      doomed[item.id] = true;
      children.forEach(function (c) {
        doomed[c.id] = true;
      });

      state.db.items = state.db.items.filter(function (i) {
        return !doomed[i.id];
      });

      Scanner.rebuildTree(state.db);
      Schema.syncCategories(state.db);
      markDirty();
      renderAll();
      Toast.success('הפריט נמחק ממסד הנתונים.');
    });
  }

  function purgeMissing() {
    var count = state.db.items.filter(function (i) {
      return i.missing;
    }).length;

    Modal.confirm({
      title: 'ניקוי פריטים חסרים',
      danger: true,
      confirmText: 'נקה',
      message:
        count +
        ' פריטים שסומנו כחסרים יימחקו ממסד הנתונים, כולל כל המידע שהוזן עבורם. ' +
        'אם הקבצים רק נותקו זמנית, עדיף לחבר את הכונן ולסרוק מחדש.',
    }).then(function (ok) {
      if (!ok) return;

      var removed = Scanner.purgeMissing(state.db);
      markDirty();
      renderAll();
      Toast.success(removed + ' פריטים נוקו.');
    });
  }

  /* --- Settings view ----------------------------------------------------- */

  function renderSettings() {
    var s = state.db.settings;

    el.settings.title.value = s.appTitle;
    el.settings.subtitle.value = s.appSubtitle;
    el.settings.contactName.value = s.contact.name;
    el.settings.contactPhone.value = s.contact.phone;
    el.settings.contactEmail.value = s.contact.email;
    el.settings.contactNote.value = s.contact.note;
    el.settings.contactVisible.checked = s.contact.visible;
    el.settings.softwareRoot.value = s.softwareRoot;
    el.settings.accent.value = s.ui.accent;
    el.settings.newDays.value = String(s.ui.newDays);
    el.settings.showCategories.checked = s.ui.showCategories;
  }

  function applySettings() {
    var s = state.db.settings;

    s.appTitle = Utils.str(el.settings.title.value) || Schema.SETTINGS_DEFAULTS.appTitle;
    s.appSubtitle = Utils.str(el.settings.subtitle.value);
    s.contact.name = Utils.str(el.settings.contactName.value);
    s.contact.phone = Utils.str(el.settings.contactPhone.value);
    s.contact.email = Utils.str(el.settings.contactEmail.value);
    s.contact.note = Utils.str(el.settings.contactNote.value);
    s.contact.visible = el.settings.contactVisible.checked;
    s.ui.showCategories = el.settings.showCategories.checked;
    s.ui.newDays = Utils.clamp(Number(el.settings.newDays.value) || 0, 0, 365);

    var root = Paths.normalize(el.settings.softwareRoot.value);
    if (!root) {
      Toast.error('יש להזין את שם תיקיית התוכנות.');
      return false;
    }
    s.softwareRoot = root;

    if (Theme.setAccent(el.settings.accent.value)) {
      s.ui.accent = el.settings.accent.value;
    }

    markDirty();
    Toast.success('ההגדרות עודכנו. אל תשכח לשמור.');
    return true;
  }

  function openPasswordDialog() {
    var current = Dom.h('input.input', { type: 'password', autocomplete: 'current-password' });
    var next = Dom.h('input.input', { type: 'password', autocomplete: 'new-password' });
    var confirm = Dom.h('input.input', { type: 'password', autocomplete: 'new-password' });
    var error = Dom.h('div.field__error', { style: { display: 'none' } });

    function submit() {
      error.style.display = 'none';

      Auth.changePassword(state.db, current.value, next.value, confirm.value).then(
        function (result) {
          if (!result.ok) {
            error.textContent = result.message;
            error.style.display = 'block';
            return;
          }
          handle.close();
          markDirty();
          Toast.success('הסיסמה שונתה. שמור כדי להחיל את השינוי על הכונן.');
        }
      );
    }

    var handle = Modal.open({
      title: 'שינוי סיסמה',
      size: 'narrow',
      body: Dom.h('div', { style: { display: 'grid', gap: '16px' } }, [
        Dom.h('label.field', {}, [
          Dom.h('span.field__label', { text: 'סיסמה נוכחית' }),
          current,
        ]),
        Dom.h('label.field', {}, [
          Dom.h('span.field__label', { text: 'סיסמה חדשה' }),
          next,
          Dom.h('span.field__hint', {
            text: 'לפחות ' + Crypto.MIN_PASSWORD_LENGTH + ' תווים.',
          }),
        ]),
        Dom.h('label.field', {}, [
          Dom.h('span.field__label', { text: 'אימות הסיסמה החדשה' }),
          confirm,
        ]),
        error,
      ]),
      footer: [
        Dom.h('button.btn.btn--primary', {
          type: 'button',
          text: 'שינוי',
          on: { click: submit },
        }),
        Dom.h('button.btn', {
          type: 'button',
          text: 'ביטול',
          on: {
            click: function () {
              handle.close();
            },
          },
        }),
      ],
    });

    [current, next, confirm].forEach(function (input) {
      input.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          submit();
        }
      });
    });
  }

  /* --- Backup ------------------------------------------------------------ */

  function importBackup() {
    var input = Dom.h('input', {
      type: 'file',
      accept: '.json,application/json',
      style: { display: 'none' },
    });

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;

      Persist.importBackup(file)
        .then(function (raw) {
          return Modal.confirm({
            title: 'שחזור מגיבוי',
            danger: true,
            confirmText: 'שחזור',
            message:
              'הגיבוי מכיל ' +
              raw.items.length +
              ' פריטים. כל המידע הנוכחי יוחלף, כולל הסיסמה ששמורה בגיבוי.',
          }).then(function (ok) {
            if (!ok) return;

            var normalized = Schema.normalizeDatabase(raw);
            state.db = normalized.db;
            markDirty();
            renderAll();
            Toast.success('הגיבוי נטען. שמור כדי להחיל אותו על הכונן.');
          });
        })
        .catch(function (err) {
          Toast.error(err.message);
        });
    });

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  }

  /* --- Chrome ------------------------------------------------------------ */

  function switchView(name) {
    state.view = name;

    Dom.qsa('.nav-item', el.sidebar).forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.view === name);
    });

    ['library', 'settings', 'help'].forEach(function (v) {
      Dom.setHidden(Dom.must('#view-' + v), v !== name);
    });

    el.topTitle.textContent = {
      library: 'ניהול הספרייה',
      settings: 'הגדרות',
      help: 'עזרה',
    }[name];
  }

  function renderStatus() {
    var cap = Fs.capability();
    var connected = !!state.rootHandle;

    var dot = connected ? 'ok' : cap === 'none' ? '' : 'warn';
    var text = connected
      ? 'התיקייה מחוברת — שמירה ישירה לכונן.'
      : cap === 'full'
      ? 'התיקייה אינה מחוברת. השמירה תתבצע דרך הורדות.'
      : 'הדפדפן אינו תומך בשמירה ישירה. השמירה תתבצע דרך הורדות.';

    Dom.replace(el.status, [
      Dom.h('span.status-dot' + (dot ? '.status-dot--' + dot : '')),
      Dom.h('span', { text: text }),
      state.db.settings.lastScan
        ? Dom.h('div', {
            style: { 'margin-top': '6px' },
            text: 'סריקה אחרונה: ' + Utils.formatDate(state.db.settings.lastScan, true),
          })
        : null,
    ]);

    Dom.setHidden(el.connectBtn, connected || cap !== 'full');
  }

  function renderAll() {
    renderLibrary();
    renderSettings();
    renderStatus();
  }

  /* --- Gate -------------------------------------------------------------- */

  function showGate() {
    var isSetup = Auth.needsSetup(state.db);

    var password = Dom.h('input.input', {
      type: 'password',
      autocomplete: isSetup ? 'new-password' : 'current-password',
      autofocus: true,
    });

    var confirm = Dom.h('input.input', { type: 'password', autocomplete: 'new-password' });
    var error = Dom.h('div.field__error', { style: { display: 'none' } });
    var submitBtn = Dom.h('button.btn.btn--primary.btn--block.btn--lg', {
      type: 'submit',
      text: isSetup ? 'יצירת הסיסמה' : 'כניסה',
    });

    function fail(message) {
      error.textContent = message;
      error.style.display = 'block';
      submitBtn.classList.remove('btn--loading');
      password.focus();
      password.select();
    }

    function submit(evt) {
      evt.preventDefault();
      error.style.display = 'none';
      submitBtn.classList.add('btn--loading');

      var action = isSetup
        ? Auth.setup(state.db, password.value, confirm.value)
        : Auth.login(state.db, password.value);

      action.then(function (result) {
        if (!result.ok) {
          fail(result.message);
          return;
        }

        if (isSetup) markDirty();
        enterConsole();

        if (isSetup) {
          Toast.info('הסיסמה נוצרה. שמור את הנתונים כדי לשמור אותה בכונן.', 7000);
        }
      });
    }

    var form = Dom.h('form.gate__form', { on: { submit: submit } }, [
      Dom.h('label.field', {}, [
        Dom.h('span.field__label', { text: isSetup ? 'סיסמה חדשה' : 'סיסמה' }),
        password,
        isSetup
          ? Dom.h('span.field__hint', {
              text: 'לפחות ' + Crypto.MIN_PASSWORD_LENGTH + ' תווים.',
            })
          : null,
      ]),
      isSetup
        ? Dom.h('label.field', {}, [
            Dom.h('span.field__label', { text: 'אימות הסיסמה' }),
            confirm,
          ])
        : null,
      error,
      submitBtn,
    ]);

    Dom.replace(el.gateCard, [
      Dom.h('div.gate__mark', {}, Icons.get(isSetup ? 'key' : 'lock')),
      Dom.h('h1.gate__title', { text: isSetup ? 'הגדרת סיסמת ניהול' : 'ממשק ניהול' }),
      Dom.h('p.gate__text', {
        text: isSetup
          ? 'זוהי הכניסה הראשונה. בחר סיסמה שתגן על ממשק הניהול.'
          : 'הזן את סיסמת המנהל כדי להמשיך.',
      }),
      form,
      Dom.h('div.gate__foot', {
        text:
          'הסיסמה מגנה מפני כניסה מקרית בלבד. לכל מי שמחזיק פיזית בכונן יש גישה ' +
          'מלאה לקבצים שבו.',
      }),
    ]);

    Dom.setHidden(el.gate, false);
    Dom.setHidden(el.console, true);
    setTimeout(function () {
      password.focus();
    }, 60);
  }

  function enterConsole() {
    Dom.setHidden(el.gate, true);
    Dom.setHidden(el.console, false);
    runAutoScan().then(function () {
      renderAll();
      switchView('library');
    });
  }

  /* --- Startup ----------------------------------------------------------- */

  function cacheElements() {
    el.gate = Dom.must('#gate');
    el.gateCard = Dom.must('#gate-card');
    el.console = Dom.must('#console');
    el.sidebar = Dom.must('#sidebar');
    el.topTitle = Dom.must('#top-title');
    el.topActions = Dom.must('#top-actions');
    el.saveBtn = Dom.must('#save-btn');
    el.dirtyDot = Dom.must('#dirty-dot');
    el.status = Dom.must('#fs-status');
    el.connectBtn = Dom.must('#connect-btn');
    el.navCount = Dom.must('#nav-count');
    el.libStats = Dom.must('#lib-stats');
    el.tableWrap = Dom.must('#table-wrap');
    el.purgeBtn = Dom.must('#purge-btn');
    el.importBtn = Dom.must('#import-btn');
    el.appVersion = Dom.must('#app-version');

    el.settings = {
      title: Dom.must('#set-title'),
      subtitle: Dom.must('#set-subtitle'),
      contactName: Dom.must('#set-contact-name'),
      contactPhone: Dom.must('#set-contact-phone'),
      contactEmail: Dom.must('#set-contact-email'),
      contactNote: Dom.must('#set-contact-note'),
      contactVisible: Dom.must('#set-contact-visible'),
      softwareRoot: Dom.must('#set-software-root'),
      accent: Dom.must('#set-accent'),
      newDays: Dom.must('#set-new-days'),
      showCategories: Dom.must('#set-show-categories'),
    };
  }

  function bindEvents() {
    Dom.qsa('.nav-item', el.sidebar).forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchView(btn.dataset.view);
      });
    });

    el.saveBtn.addEventListener('click', save);
    el.connectBtn.addEventListener('click', connectFolder);
    el.purgeBtn.addEventListener('click', purgeMissing);

    Dom.setHidden(Dom.must('#scan-btn'), !!window.__TAURI__);
    Dom.must('#scan-btn').addEventListener('click', runScan);
    Dom.setHidden(el.importBtn, !window.__TAURI__);
    el.importBtn.addEventListener('click', runImport);
    Dom.must('#settings-apply').addEventListener('click', applySettings);
    Dom.must('#password-btn').addEventListener('click', openPasswordDialog);
    Dom.must('#export-btn').addEventListener('click', function () {
      Persist.exportBackup(state.db);
      Toast.success('הגיבוי הורד.');
    });
    Dom.must('#import-btn').addEventListener('click', importBackup);
    Dom.must('#preview-btn').addEventListener('click', function () {
      window.open('index.html', '_blank', 'noopener');
    });

    Dom.must('#lock-btn').addEventListener('click', function () {
      if (state.dirty) {
        Modal.confirm({
          title: 'יציאה ללא שמירה',
          danger: true,
          confirmText: 'צא בלי לשמור',
          message: 'יש שינויים שלא נשמרו. אם תצא כעת הם יאבדו.',
        }).then(function (ok) {
          if (!ok) return;
          Auth.lock();
          window.location.reload();
        });
        return;
      }
      Auth.lock();
      window.location.reload();
    });

    var onFilter = Utils.debounce(function () {
      state.filter.query = Dom.must('#lib-search').value;
      renderLibrary();
    }, 120);

    Dom.must('#lib-search').addEventListener('input', onFilter);

    Dom.must('#lib-type').addEventListener('change', function (evt) {
      state.filter.type = evt.target.value;
      renderLibrary();
    });

    Dom.must('#lib-status').addEventListener('change', function (evt) {
      state.filter.status = evt.target.value;
      renderLibrary();
    });

    document.addEventListener('keydown', function (evt) {
      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 's') {
        evt.preventDefault();
        if (!Dom.qs('#console[hidden]')) save();
      }
    });

    el.topActions.appendChild(Theme.createToggle());
  }

  function populateTypeFilter() {
    var select = Dom.must('#lib-type');
    NS.FileTypes.all().forEach(function (t) {
      select.appendChild(Dom.h('option', { value: t.key, text: t.label }));
    });
  }

  function start() {
    cacheElements();
    Theme.init('auto');
    bindEvents();
    populateTypeFilter();
    el.appVersion.textContent = NS.VERSION;

    Db.load()
      .then(function (result) {
        state.db = result.db;

        if (result.error) {
          // A missing database on the admin side is recoverable: start an
          // empty one so the administrator can scan and build it.
          Toast.warn('לא נמצא קובץ נתונים קיים — נוצר מסד נתונים חדש.', 7000);
          markDirty();
        }

        if (result.repairs.length) {
          Logger.warn('admin: repairs —', result.repairs.join(' | '));
          Toast.warn(result.repairs.length + ' בעיות בנתונים תוקנו אוטומטית.', 6000);
          markDirty();
        }

        Theme.setAccent(state.db.settings.ui.accent);

        return restoreFolder();
      })
      .then(function () {
        if (Auth.needsSetup(state.db) || !Auth.isUnlocked()) showGate();
        else enterConsole();
      })
      .catch(function (err) {
        Logger.error('admin: startup failed', err);
        Toast.error('טעינת ממשק הניהול נכשלה: ' + err.message);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  NS.define('admin.Main', { start: start, state: state });
})(window.USBLib);
