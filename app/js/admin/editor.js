/**
 * editor.js — The visual software editor.
 *
 * The administrator must never have to open database.json. Every field the
 * catalog reads is editable here, with the mechanical facts (path, size,
 * detected type) shown read-only so it is obvious what the scanner owns and
 * what the administrator owns.
 *
 * Edits are applied to a working copy and only merged into the item on save,
 * so cancelling leaves the database untouched.
 */
(function (NS) {
  'use strict';

  var Dom = NS.require('ui.Dom');
  var Icons = NS.require('ui.Icons');
  var Modal = NS.require('ui.Modal');
  var Toast = NS.require('ui.Toast');
  var Utils = NS.require('Utils');
  var Paths = NS.require('Paths');
  var Db = NS.require('Db');
  var Schema = NS.require('Schema');
  var FileTypes = NS.require('FileTypes');
  var Persist = NS.require('admin.Persist');

  var ICON_MAX = 256;
  var THUMB_MAX = 800;

  function field(label, control, hint) {
    return Dom.h('label.field', {}, [
      Dom.h('span.field__label', { text: label }),
      control,
      hint ? Dom.h('span.field__hint', { text: hint }) : null,
    ]);
  }

  function readOnlyField(label, value) {
    return Dom.h('div.field', {}, [
      Dom.h('span.field__label', { text: label }),
      Dom.h('div.details__path.ltr', { text: value || '—' }),
    ]);
  }

  /**
   * An image upload control with a live preview.
   * @returns {{node: HTMLElement, getValue: function():string}}
   */
  function imagePicker(options) {
    var value = options.value || '';
    var preview = Dom.h('div.image-picker__preview');

    function renderPreview() {
      var src = Db.imageSrc(value);
      if (src) {
        var img = Dom.h('img', { src: src, alt: '' });
        img.addEventListener('error', function () {
          Dom.replace(preview, Icons.get('error'));
        });
        Dom.replace(preview, img);
      } else {
        Dom.replace(preview, Icons.get('image'));
      }
    }

    var input = Dom.h('input', {
      type: 'file',
      accept: 'image/*',
      style: { display: 'none' },
      on: {
        change: function () {
          var file = input.files && input.files[0];
          if (!file) return;

          Persist.resizeImage(file, options.maxSize)
            .then(function (blob) {
              return Persist.saveImage({
                blob: blob,
                fileName: options.namePrefix + '-' + Utils.uid() + '.png',
                subFolder: options.subFolder,
                rootHandle: options.getRootHandle(),
              });
            })
            .then(function (ref) {
              value = ref;
              renderPreview();
              Toast.success('התמונה נשמרה.');
            })
            .catch(function (err) {
              Toast.error(err.message);
            })
            .then(function () {
              input.value = '';
            });
        },
      },
    });

    var node = Dom.h('div.field', {}, [
      Dom.h('span.field__label', { text: options.label }),
      Dom.h('div.image-picker', {}, [
        preview,
        Dom.h('div.image-picker__actions', {}, [
          Dom.h(
            'button.btn',
            {
              type: 'button',
              on: {
                click: function () {
                  input.click();
                },
              },
            },
            [Icons.get('upload'), 'העלאה']
          ),
          Dom.h(
            'button.btn.btn--ghost.btn--danger',
            {
              type: 'button',
              on: {
                click: function () {
                  value = '';
                  renderPreview();
                },
              },
            },
            [Icons.get('trash'), 'הסרה']
          ),
        ]),
        input,
      ]),
      Dom.h('span.field__hint', { text: options.hint || '' }),
    ]);

    renderPreview();

    return {
      node: node,
      getValue: function () {
        return value;
      },
    };
  }

  var Editor = {
    /**
     * Opens the editor for one item.
     *
     * @param {Object} options
     * @param {Object} options.item the live item (not mutated until save)
     * @param {Object} options.db
     * @param {function():FileSystemDirectoryHandle|null} options.getRootHandle
     * @param {function(Object):void} options.onSave receives the updated item
     */
    open: function (options) {
      var item = options.item;
      var db = options.db;
      var isFolder = item.kind === 'folder';

      /* --- Controls ------------------------------------------------------ */

      var nameInput = Dom.h('input.input', {
        type: 'text',
        value: item.name,
        maxlength: '120',
        autofocus: true,
      });

      var versionInput = Dom.h('input.input.ltr', {
        type: 'text',
        value: item.version,
        maxlength: '40',
        placeholder: '1.0.0',
      });

      var categoryInput = Dom.h('input.input', {
        type: 'text',
        value: item.category,
        maxlength: '60',
        list: 'editor-categories',
        placeholder: 'לדוגמה: כלי מערכת',
      });

      var categoryList = Dom.h(
        'datalist',
        { id: 'editor-categories' },
        db.categories.map(function (c) {
          return Dom.h('option', { value: c.name });
        })
      );

      var descInput = Dom.h('textarea.textarea', {
        rows: '3',
        maxlength: '600',
        placeholder: 'תיאור קצר שיוצג בכרטיס ובחלון הפרטים.',
        value: item.description,
      });

      var instructionsInput = Dom.h('textarea.textarea', {
        rows: '4',
        maxlength: '2000',
        placeholder: 'הוראות ההתקנה שיוצגו למשתמש.',
        value: item.instructions,
      });

      var orderInput = Dom.h('input.input.ltr', {
        type: 'number',
        value: String(item.order),
        step: '1',
      });

      var typeSelect = Dom.h(
        'select.select',
        { disabled: isFolder },
        FileTypes.all()
          .filter(function (t) {
            return isFolder ? t.key === 'folder' : t.key !== 'folder';
          })
          .map(function (t) {
            return Dom.h('option', {
              value: t.key,
              text: t.label + ' (' + t.key + ')',
              selected: t.key === item.type,
            });
          })
      );

      var tagsInput = Dom.h('input.input', {
        type: 'text',
        value: (item.tags || []).join(', '),
        placeholder: 'מילות מפתח מופרדות בפסיק',
      });

      function toggle(labelText, checked, hint) {
        var input = Dom.h('input', { type: 'checkbox', checked: checked });
        var node = Dom.h('div.field', {}, [
          Dom.h('label.switch', {}, [
            input,
            Dom.h('span.switch__track'),
            Dom.h('span.switch__label', { text: labelText }),
          ]),
          hint ? Dom.h('span.field__hint', { text: hint }) : null,
        ]);
        return { node: node, input: input };
      }

      var newToggle = toggle(
        'מסומן כ"חדש"',
        item.isNew,
        'התגית תוסר אוטומטית לאחר ' + db.settings.ui.newDays + ' ימים מהוספת הפריט.'
      );

      var hiddenToggle = toggle(
        'מוסתר מהמשתמשים',
        item.hidden,
        'הפריט יישאר במסד הנתונים אך לא יוצג בממשק הציבורי.'
      );

      var iconPicker = imagePicker({
        label: 'אייקון',
        value: item.icon,
        maxSize: ICON_MAX,
        subFolder: 'icons',
        namePrefix: 'icon',
        hint: 'מוצג בכרטיס כשאין תמונה ראשית. יוקטן ל־' + ICON_MAX + ' פיקסלים.',
        getRootHandle: options.getRootHandle,
      });

      var thumbPicker = imagePicker({
        label: 'תמונה ראשית',
        value: item.thumbnail,
        maxSize: THUMB_MAX,
        subFolder: 'thumbnails',
        namePrefix: 'thumb',
        hint: 'תמונה רחבה שתוצג בראש הכרטיס ובחלון הפרטים.',
        getRootHandle: options.getRootHandle,
      });

      /* --- Folder behaviour --------------------------------------------- */

      var folderModeSelect = null;
      var packageSelect = null;
      var packageField = null;

      if (isFolder) {
        folderModeSelect = Dom.h('select.select', {}, [
          Dom.h('option', {
            value: Schema.FOLDER_MODE.CATEGORY,
            text: 'קטגוריה — לחיצה פותחת את התוכן',
            selected: item.folderMode === Schema.FOLDER_MODE.CATEGORY,
          }),
          Dom.h('option', {
            value: Schema.FOLDER_MODE.PACKAGE,
            text: 'חבילה — כרטיס אחד עם כפתור הורדה',
            selected: item.folderMode === Schema.FOLDER_MODE.PACKAGE,
          }),
        ]);

        var descendants = Db.packageFilesOf(db.items, item);

        packageSelect = Dom.h(
          'select.select',
          {},
          [
            Dom.h('option', {
              value: '',
              text: 'בחירה אוטומטית (הקובץ הגדול ביותר)',
              selected: !item.packagePath,
            }),
          ].concat(
            descendants.map(function (f) {
              return Dom.h('option', {
                value: f.path,
                text: f.path.slice(item.path.length + 1) + ' — ' + Utils.formatSize(f.size),
                selected: f.path === item.packagePath,
              });
            })
          )
        );

        packageField = field(
          'קובץ ההורדה',
          packageSelect,
          descendants.length
            ? 'הקובץ שיירד בלחיצה על "הורדה". ללא בחירה — כל הקבצים יורדו בזה אחר זה.'
            : 'לא נמצאו קבצים בתיקייה זו.'
        );

        var syncPackageField = function () {
          Dom.setHidden(
            packageField,
            folderModeSelect.value !== Schema.FOLDER_MODE.PACKAGE
          );
        };
        folderModeSelect.addEventListener('change', syncPackageField);
        syncPackageField();
      }

      /* --- Layout -------------------------------------------------------- */

      var body = Dom.h('div.editor-grid', {}, [
        categoryList,

        Dom.h('div.form-grid.form-grid--full', {}, [
          Dom.h('div.field--full', {}, field('שם לתצוגה', nameInput, 'השם שהמשתמש רואה.')),
          field('גרסה', versionInput),
          field('קטגוריה', categoryInput, 'קטגוריה חדשה תיווצר אוטומטית.'),
        ]),

        field('תיאור', descInput),
        field('הוראות התקנה', instructionsInput),

        isFolder
          ? Dom.h('div', {}, [
              field(
                'התנהגות התיקייה',
                folderModeSelect,
                'קובע אם התיקייה נפתחת כקטגוריה או מתנהגת כפריט אחד להורדה.'
              ),
              packageField,
            ])
          : null,

        Dom.h('div.form-grid', {}, [
          field('סוג הקובץ', typeSelect, isFolder ? 'נקבע אוטומטית עבור תיקיות.' : ''),
          field('סדר תצוגה', orderInput, 'מספר נמוך יותר יוצג ראשון.'),
        ]),

        field('תגיות', tagsInput, 'משמשות לחיפוש בלבד.'),

        Dom.h('div.form-grid', {}, [iconPicker.node, thumbPicker.node]),

        Dom.h('div.form-grid', {}, [newToggle.node, hiddenToggle.node]),

        Dom.h('div.form-grid', {}, [
          readOnlyField('נתיב יחסי', item.path),
          readOnlyField('שם הקובץ המקורי', item.fileName),
          readOnlyField(
            'גודל',
            item.kind === 'folder'
              ? Utils.formatSize(Db.folderSize(db.items, item))
              : Utils.formatSize(item.size)
          ),
          readOnlyField('עודכן לאחרונה', Utils.formatDate(item.updatedAt, true)),
        ]),

        item.missing
          ? Dom.h('div.notice.notice--warn', {}, [
              Icons.get('warning'),
              Dom.h('div', {
                text:
                  'הקובץ לא נמצא בסריקה האחרונה. המידע נשמר, אך הפריט לא יוצג ' +
                  'למשתמשים עד שהקובץ יחזור למקומו.',
              }),
            ])
          : null,
      ]);

      /* --- Save ---------------------------------------------------------- */

      function save() {
        var name = Utils.str(nameInput.value);
        if (!name) {
          nameInput.setAttribute('aria-invalid', 'true');
          nameInput.focus();
          Toast.error('שם לתצוגה הוא שדה חובה.');
          return;
        }

        item.name = name;
        item.version = Utils.str(versionInput.value);
        item.category = Utils.str(categoryInput.value);
        item.description = Utils.str(descInput.value);
        item.instructions = Utils.str(instructionsInput.value);
        item.order = Number(orderInput.value) || 0;
        item.isNew = newToggle.input.checked;
        item.hidden = hiddenToggle.input.checked;
        item.icon = iconPicker.getValue();
        item.thumbnail = thumbPicker.getValue();

        item.tags = Utils.str(tagsInput.value)
          .split(',')
          .map(function (t) {
            return t.trim();
          })
          .filter(Boolean);

        if (!isFolder) item.type = typeSelect.value;

        if (isFolder) {
          item.folderMode = folderModeSelect.value;
          item.packagePath = Paths.normalize(packageSelect.value);
        }

        Schema.syncCategories(db);
        handle.close();
        options.onSave(item);
      }

      var handle = Modal.open({
        title: 'עריכת פריט',
        size: 'wide',
        body: body,
        footer: [
          Dom.h(
            'button.btn.btn--primary',
            { type: 'button', on: { click: save } },
            [Icons.get('check'), 'שמירה']
          ),
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

      // Ctrl+Enter saves — the shortcut anyone editing many items will want.
      body.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) {
          evt.preventDefault();
          save();
        }
      });

      return handle;
    },
  };

  NS.define('admin.Editor', Editor);
})(window.USBLib);
