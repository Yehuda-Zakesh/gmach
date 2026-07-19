/**
 * cards.js — Building and reusing software cards.
 *
 * Cards are built once per item and cached by id. Navigating folders and
 * searching re-order the *same* nodes rather than rebuilding them, so typing
 * in the search box moves existing elements instead of allocating new ones.
 *
 * The entrance animation lives on a `card--enter` class that is removed once
 * it has played. Without that, re-appending a node on every keystroke would
 * restart the animation and make the grid flicker as the user types.
 */
(function (NS) {
  'use strict';

  var Dom = NS.require('ui.Dom');
  var Icons = NS.require('ui.Icons');
  var Utils = NS.require('Utils');
  var Db = NS.require('Db');
  var Schema = NS.require('Schema');
  var FileTypes = NS.require('FileTypes');

  /** @type {Map<string, HTMLElement>} id -> card element */
  var cache = new Map();

  /**
   * Builds the media area: thumbnail if there is one, else the uploaded icon,
   * else the file type's glyph. Broken images fall back to the glyph too.
   */
  function buildMedia(item) {
    var media = Dom.h('div.card__media');
    var thumbSrc = Db.imageSrc(item.thumbnail);
    var iconSrc = Db.imageSrc(item.icon);

    function useGlyph() {
      Dom.replace(
        media,
        Icons.get(FileTypes.iconOf(item.type), { className: 'card__glyph' })
      );
      restoreBadges();
    }

    var badges = buildBadges(item);
    var typeBadge = buildTypeBadge(item);

    function restoreBadges() {
      if (badges) media.appendChild(badges);
      if (typeBadge) media.appendChild(typeBadge);
    }

    if (thumbSrc) {
      var img = Dom.h('img.card__thumb', {
        src: thumbSrc,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
      });
      // A missing thumbnail file is normal on a drive people edit by hand.
      img.addEventListener('error', useGlyph);
      media.appendChild(img);
    } else if (iconSrc) {
      var icon = Dom.h('img.card__icon', {
        src: iconSrc,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
      });
      icon.addEventListener('error', useGlyph);
      media.appendChild(icon);
    } else {
      media.appendChild(
        Icons.get(FileTypes.iconOf(item.type), { className: 'card__glyph' })
      );
    }

    restoreBadges();
    return media;
  }

  function buildBadges(item) {
    var badges = [];

    if (item.isNew) {
      badges.push(
        Dom.h('span.badge.badge--new', {}, [Icons.get('sparkles'), 'חדש'])
      );
    }

    if (item.kind === 'folder' && item.folderMode === Schema.FOLDER_MODE.PACKAGE) {
      badges.push(Dom.h('span.badge', {}, [Icons.get('package'), 'חבילה']));
    }

    if (!badges.length) return null;
    return Dom.h('div.card__badges', {}, badges);
  }

  function buildTypeBadge(item) {
    if (item.kind === 'folder') return null;
    var ext = item.fileName.split('.').pop();
    if (!ext || ext === item.fileName) return null;

    return Dom.h('div.card__type', {}, [
      Dom.h('span.badge.badge--type', { text: ext.toUpperCase() }),
    ]);
  }

  function buildMeta(item, allItems) {
    var bits = [];

    if (item.version) {
      bits.push(
        Dom.h('span.card__meta-item', {}, [
          Icons.get('tag'),
          Dom.h('span.ltr', { text: item.version }),
        ])
      );
    }

    if (item.category) {
      bits.push(
        Dom.h('span.card__meta-item', {}, [Icons.get('grid'), item.category])
      );
    }

    var size =
      item.kind === 'folder' ? Db.folderSize(allItems, item) : item.size;
    if (size > 0) {
      bits.push(
        Dom.h('span.card__meta-item', {}, [
          Icons.get('hard-drive'),
          Dom.h('span.ltr', { text: Utils.formatSize(size) }),
        ])
      );
    }

    if (item.updatedAt) {
      bits.push(
        Dom.h('span.card__meta-item', { title: 'עודכן לאחרונה' }, [
          Icons.get('clock'),
          Utils.formatDate(item.updatedAt),
        ])
      );
    }

    if (!bits.length) return null;
    return Dom.h('div.card__meta', {}, bits);
  }

  var Cards = {
    /**
     * @param {Object} item
     * @param {Object[]} allItems needed for folder sizes and package lookups
     * @param {Object} handlers
     * @param {function(Object):void} handlers.onOpen  card body activated
     * @param {function(Object):void} handlers.onDownload
     * @returns {HTMLElement}
     */
    create: function (item, allItems, handlers) {
      var isCategoryFolder =
        item.kind === 'folder' && item.folderMode === Schema.FOLDER_MODE.CATEGORY;

      var Download = NS.require('app.Download');
      var canDownload = Download.isAvailable(allItems, item);

      // The card body is a button: the whole surface is clickable, and it is
      // reachable and operable from the keyboard for free.
      var body = Dom.h(
        'button.card__body',
        {
          type: 'button',
          'aria-label': (isCategoryFolder ? 'פתיחת התיקייה ' : 'פרטים על ') + item.name,
          on: {
            click: function () {
              handlers.onOpen(item);
            },
          },
        },
        [
          Dom.h('div.card__title.clamp-2', { text: item.name, title: item.name }),
          item.description
            ? Dom.h('p.card__desc.clamp-2', { text: item.description })
            : Dom.h('p.card__desc.clamp-2', {
                text: isCategoryFolder ? 'תיקייה' : FileTypes.labelOf(item.type),
                style: { color: 'var(--text-faint)' },
              }),
          buildMeta(item, allItems),
        ]
      );

      var actions = [];

      if (isCategoryFolder) {
        actions.push(
          Dom.h(
            'button.btn.btn--primary',
            {
              type: 'button',
              on: {
                click: function () {
                  handlers.onOpen(item);
                },
              },
            },
            [Icons.get('folder-open'), 'פתיחה']
          )
        );
      } else {
        actions.push(
          Dom.h(
            'button.btn.btn--primary',
            {
              type: 'button',
              disabled: !canDownload,
              title: canDownload ? 'הורדה' : 'אין קובץ זמין להורדה',
              on: {
                click: function () {
                  handlers.onDownload(item);
                },
              },
            },
            [Icons.get('download'), 'הורדה']
          )
        );

        actions.push(
          Dom.h(
            'button.btn.btn--icon',
            {
              type: 'button',
              'aria-label': 'פרטים על ' + item.name,
              title: 'פרטים',
              style: { flex: 'none' },
              on: {
                click: function () {
                  handlers.onOpen(item);
                },
              },
            },
            Icons.get('info')
          )
        );
      }

      var card = Dom.h(
        'article.card.card--enter' + (item.kind === 'folder' ? '.card--folder' : ''),
        { dataset: { id: item.id } },
        [buildMedia(item), body, Dom.h('div.card__foot', {}, actions)]
      );

      card.addEventListener(
        'animationend',
        function () {
          card.classList.remove('card--enter');
          card.style.removeProperty('animation-delay');
        },
        { once: true }
      );

      return card;
    },

    /**
     * Returns the cached card for an item, creating it on first use.
     * @returns {HTMLElement}
     */
    get: function (item, allItems, handlers) {
      var cached = cache.get(item.id);
      if (cached) return cached;

      var card = Cards.create(item, allItems, handlers);
      cache.set(item.id, card);
      return card;
    },

    /** Drops a single card so it is rebuilt on next use. */
    invalidate: function (id) {
      cache.delete(id);
    },

    /** Drops every cached card. Call when the database is reloaded. */
    invalidateAll: function () {
      cache.clear();
    },

    /**
     * Places `items` into `grid` in order, reusing cached nodes.
     *
     * appendChild moves an element that is already in the document rather
     * than cloning it, so re-ordering costs no allocation — the browser just
     * relinks the nodes.
     *
     * @param {HTMLElement} grid
     * @param {Object[]} items
     * @param {Object[]} allItems
     * @param {Object} handlers
     */
    render: function (grid, items, allItems, handlers) {
      var frag = document.createDocumentFragment();

      items.forEach(function (item, i) {
        var card = Cards.get(item, allItems, handlers);

        // Only cards appearing for the first time animate in, and the stagger
        // is capped: with 200 new cards a per-index delay would leave the last
        // one arriving seconds after the first.
        if (card.classList.contains('card--enter')) {
          card.style.setProperty('animation-delay', Math.min(i, 12) * 22 + 'ms');
        }

        frag.appendChild(card);
      });

      Dom.clear(grid);
      grid.appendChild(frag);
    },
  };

  NS.define('app.Cards', Cards);
})(window.USBLib);
