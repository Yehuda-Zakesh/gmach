/**
 * details.js — The software details modal.
 */
(function (NS) {
  'use strict';

  var Dom = NS.require('ui.Dom');
  var Icons = NS.require('ui.Icons');
  var Modal = NS.require('ui.Modal');
  var Utils = NS.require('Utils');
  var Db = NS.require('Db');
  var Schema = NS.require('Schema');
  var FileTypes = NS.require('FileTypes');
  var Download = NS.require('app.Download');

  function buildIcon(item) {
    var wrap = Dom.h('div.details__icon-wrap');
    var src = Db.imageSrc(item.icon) || Db.imageSrc(item.thumbnail);

    if (src) {
      var img = Dom.h('img', { src: src, alt: '' });
      img.addEventListener('error', function () {
        Dom.replace(wrap, Icons.get(FileTypes.iconOf(item.type)));
      });
      wrap.appendChild(img);
    } else {
      wrap.appendChild(Icons.get(FileTypes.iconOf(item.type)));
    }

    return wrap;
  }

  function buildSpecs(item, allItems) {
    var specs = [];

    function add(label, value) {
      if (!value || value === '—') return;
      specs.push(
        Dom.h('div.spec', {}, [
          Dom.h('div.spec__label', { text: label }),
          Dom.h('div.spec__value', { text: value }),
        ])
      );
    }

    add('גרסה', item.version);
    add('קטגוריה', item.category);
    add('סוג', FileTypes.labelOf(item.type));

    var size = item.kind === 'folder' ? Db.folderSize(allItems, item) : item.size;
    add('גודל', size > 0 ? Utils.formatSize(size) : '');

    add('עודכן לאחרונה', Utils.formatDate(item.updatedAt));
    add('נוסף לספרייה', Utils.formatDate(item.addedAt));

    if (item.kind === 'folder') {
      var files = Db.packageFilesOf(allItems, item);
      add('קבצים בחבילה', files.length ? String(files.length) : '');
    }

    if (!specs.length) return null;
    return Dom.h('div.details__specs', {}, specs);
  }

  function section(title, node) {
    if (!node) return null;
    return Dom.h('div.details__section', {}, [
      Dom.h('div.details__section-title', { text: title }),
      node,
    ]);
  }

  var Details = {
    /**
     * Opens the details modal for an item.
     * @param {Object} item
     * @param {Object[]} allItems
     * @param {Object} [handlers]
     * @param {function(Object):void} [handlers.onOpenFolder]
     */
    open: function (item, allItems, handlers) {
      var hooks = handlers || {};
      var typeDef = FileTypes.get(item.type);
      var canDownload = Download.isAvailable(allItems, item);
      var thumbSrc = Db.imageSrc(item.thumbnail);

      var tags = [];
      if (item.isNew) {
        tags.push(Dom.h('span.badge.badge--new', {}, [Icons.get('sparkles'), 'חדש']));
      }
      tags.push(Dom.h('span.badge', { text: FileTypes.labelOf(item.type) }));
      if (item.category) tags.push(Dom.h('span.badge', { text: item.category }));
      (item.tags || []).forEach(function (t) {
        tags.push(Dom.h('span.badge', { text: t }));
      });

      var banner = null;
      if (thumbSrc) {
        banner = Dom.h('img.details__banner', { src: thumbSrc, alt: '' });
        banner.addEventListener('error', function () {
          if (banner.parentNode) banner.parentNode.removeChild(banner);
        });
      }

      // Falling back to the file type's generic hint means the details panel
      // is never blank where an administrator hasn't written instructions.
      var instructions = item.instructions || typeDef.hint;

      var body = Dom.h('div', {}, [
        Dom.h('div.details__hero', {}, [
          buildIcon(item),
          Dom.h('div.details__heading', {}, [
            Dom.h('div.details__name', { text: item.name }),
            Dom.h('div.details__tags', {}, tags),
          ]),
        ]),

        banner,

        section(
          'תיאור',
          item.description
            ? Dom.h('p.details__text', { text: item.description })
            : Dom.h('p.details__text', {
                text: 'לא הוזן תיאור עבור פריט זה.',
                style: { color: 'var(--text-faint)' },
              })
        ),

        section('פרטים', buildSpecs(item, allItems)),

        instructions
          ? section('הוראות התקנה', Dom.h('p.details__text', { text: instructions }))
          : null,

        section(
          'מיקום בכונן',
          Dom.h('div.details__path.ltr', { text: item.path })
        ),
      ]);

      var footer = [];

      if (item.kind === 'folder' && item.folderMode === Schema.FOLDER_MODE.CATEGORY) {
        footer.push(
          Dom.h(
            'button.btn.btn--primary.btn--lg',
            {
              type: 'button',
              on: {
                click: function () {
                  handle.close();
                  if (hooks.onOpenFolder) hooks.onOpenFolder(item);
                },
              },
            },
            [Icons.get('folder-open'), 'פתיחת התיקייה']
          )
        );
      } else {
        footer.push(
          Dom.h(
            'button.btn.btn--primary.btn--lg',
            {
              type: 'button',
              disabled: !canDownload,
              title: canDownload ? '' : 'אין קובץ זמין להורדה',
              on: {
                click: function (evt) {
                  var btn = evt.currentTarget;
                  btn.classList.add('btn--loading');
                  Download.start(allItems, item).then(function () {
                    btn.classList.remove('btn--loading');
                  });
                },
              },
            },
            [Icons.get('download'), 'הורדה']
          )
        );
      }

      if (item.kind === 'file') {
        footer.push(
          Dom.h(
            'button.btn',
            {
              type: 'button',
              title: 'פתיחה בכרטיסייה חדשה',
              on: {
                click: function () {
                  Download.open(item);
                },
              },
            },
            [Icons.get('external-link'), 'פתיחה']
          )
        );
      }

      footer.push(
        Dom.h(
          'button.btn.btn--ghost',
          {
            type: 'button',
            title: 'העתקת הנתיב היחסי',
            on: {
              click: function () {
                Download.copyPath(item);
              },
            },
          },
          [Icons.get('copy'), 'העתקת נתיב']
        )
      );

      footer.push(Dom.h('span.spacer'));
      footer.push(
        Dom.h('button.btn.btn--ghost', {
          type: 'button',
          text: 'סגירה',
          on: {
            click: function () {
              handle.close();
            },
          },
        })
      );

      var handle = Modal.open({
        title: 'פרטי תוכנה',
        body: body,
        footer: footer,
      });

      return handle;
    },
  };

  NS.define('app.Details', Details);
})(window.USBLib);
