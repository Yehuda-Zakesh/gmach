/**
 * main.js — Public catalog bootstrap (index.html).
 *
 * Nothing on this page ever prompts the user: no folder picker, no
 * permission request, no password. A visitor opens index.html and browses.
 * All file-system machinery lives in the admin console.
 */
(function (NS) {
  'use strict';

  var Dom = NS.require('ui.Dom');
  var Icons = NS.require('ui.Icons');
  var Theme = NS.require('ui.Theme');
  var Toast = NS.require('ui.Toast');
  var Utils = NS.require('Utils');
  var Db = NS.require('Db');
  var Schema = NS.require('Schema');
  var Logger = NS.require('Logger');
  var Search = NS.require('app.Search');
  var Cards = NS.require('app.Cards');
  var Details = NS.require('app.Details');
  var Download = NS.require('app.Download');
  var Help = NS.require('app.Help');

  /** @type {Object} */
  var state = {
    db: null,
    items: [], // visible items only
    byId: new Map(),
    index: null,
    folderId: null, // null = root
    query: '',
    category: '', // '' = all
  };

  var el = {};

  /* --- Rendering --------------------------------------------------------- */

  function currentItems() {
    if (state.query) {
      // A search spans the whole library, not just the open folder — a user
      // looking for "Acrobat" should not have to guess which folder it's in.
      var hits = state.index.search(state.query);
      return state.category
        ? hits.filter(function (i) {
            return i.category === state.category;
          })
        : hits;
    }

    var list = Db.childrenOf(state.items, state.folderId);
    return state.category
      ? list.filter(function (i) {
          return i.category === state.category || i.kind === 'folder';
        })
      : list;
  }

  function renderBreadcrumbs() {
    var crumbs = [];

    function crumb(label, iconName, folderId, isCurrent) {
      if (isCurrent) {
        return Dom.h('span.crumb', { 'aria-current': 'page' }, [
          iconName ? Icons.get(iconName) : null,
          label,
        ]);
      }
      return Dom.h(
        'button.crumb',
        {
          type: 'button',
          on: {
            click: function () {
              navigateTo(folderId);
            },
          },
        },
        [iconName ? Icons.get(iconName) : null, label]
      );
    }

    var atRoot = !state.folderId;
    crumbs.push(crumb('כל התוכנות', 'home', null, atRoot && !state.query));

    if (state.query) {
      crumbs.push(Dom.h('span.crumb-sep', {}, Icons.get('chevron')));
      crumbs.push(crumb('תוצאות חיפוש', 'search', null, true));
    } else if (state.folderId) {
      var folder = state.byId.get(state.folderId);
      if (folder) {
        Db.ancestorsOf(state.byId, folder).forEach(function (a) {
          crumbs.push(Dom.h('span.crumb-sep', {}, Icons.get('chevron')));
          crumbs.push(crumb(a.name, 'folder', a.id, false));
        });
        crumbs.push(Dom.h('span.crumb-sep', {}, Icons.get('chevron')));
        crumbs.push(crumb(folder.name, 'folder-open', folder.id, true));
      }
    }

    Dom.replace(el.breadcrumbs, crumbs);
  }

  function renderEmpty(kind) {
    var config = {
      search: {
        icon: 'search',
        title: 'לא נמצאו תוצאות',
        text: 'לא נמצאה תוכנה התואמת לחיפוש "' + state.query + '". נסה מונח אחר.',
      },
      folder: {
        icon: 'folder-open',
        title: 'התיקייה ריקה',
        text: 'אין פריטים להצגה בתיקייה זו.',
      },
      empty: {
        icon: 'inbox',
        title: 'הספרייה ריקה',
        text:
          'עדיין לא נוספו תוכנות לספרייה. מנהל המערכת יכול להוסיף אותן דרך ' +
          'ממשק הניהול.',
      },
    }[kind];

    Dom.replace(el.catalog, [
      Dom.h('div.empty', {}, [
        Icons.get(config.icon, { className: 'empty__icon' }),
        Dom.h('div.empty__title', { text: config.title }),
        Dom.h('p.empty__text', { text: config.text }),
        kind === 'search'
          ? Dom.h('button.btn', {
              type: 'button',
              text: 'ניקוי החיפוש',
              on: { click: clearSearch },
            })
          : null,
      ]),
    ]);
  }

  var handlers = {
    onOpen: function (item) {
      if (item.kind === 'folder' && item.folderMode === Schema.FOLDER_MODE.CATEGORY) {
        navigateTo(item.id);
        return;
      }
      Details.open(item, state.items, { onOpenFolder: function (f) { navigateTo(f.id); } });
    },
    onDownload: function (item) {
      Download.start(state.items, item);
    },
  };

  function render() {
    renderBreadcrumbs();

    var items = currentItems();

    if (!state.items.length) {
      renderEmpty('empty');
      updateCount(0);
      return;
    }

    if (!items.length) {
      renderEmpty(state.query ? 'search' : 'folder');
      updateCount(0);
      return;
    }

    // The catalog holds a single .grid; rebuild it only when the container was
    // replaced by an empty state.
    var grid = Dom.qs('.grid', el.catalog);
    if (!grid) {
      grid = Dom.h('div.grid', { id: 'software-grid', role: 'list' });
      Dom.replace(el.catalog, [
        Dom.h('div.section-title', {
          text: state.query ? 'תוצאות חיפוש' : 'תוכנות זמינות',
        }),
        grid,
      ]);
    } else {
      var title = Dom.qs('.section-title', el.catalog);
      if (title) title.textContent = state.query ? 'תוצאות חיפוש' : 'תוכנות זמינות';
    }

    Cards.render(grid, items, state.items, handlers);
    updateCount(items.length);
  }

  function updateCount(n) {
    el.count.textContent = n === 1 ? 'פריט אחד' : n + ' פריטים';
  }

  /* --- Navigation & filtering -------------------------------------------- */

  function navigateTo(folderId) {
    state.folderId = folderId || null;

    // Leaving the search behind is the point of clicking a folder.
    if (state.query) {
      state.query = '';
      el.search.value = '';
      el.searchWrap.classList.remove('has-value');
    }

    render();
    el.catalog.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onSearchInput() {
    state.query = el.search.value.trim();
    el.searchWrap.classList.toggle('has-value', !!state.query);
    render();
  }

  function clearSearch() {
    el.search.value = '';
    state.query = '';
    el.searchWrap.classList.remove('has-value');
    render();
    el.search.focus();
  }

  function setCategory(name) {
    state.category = state.category === name ? '' : name;

    Dom.qsa('.chip', el.filters).forEach(function (chip) {
      chip.setAttribute(
        'aria-pressed',
        String(chip.dataset.category === state.category)
      );
    });

    render();
  }

  function renderFilters() {
    if (!state.db.settings.ui.showCategories || !state.db.categories.length) {
      Dom.setHidden(el.filters, true);
      return;
    }

    var chips = [
      Dom.h('button.chip', {
        type: 'button',
        text: 'הכול',
        dataset: { category: '' },
        'aria-pressed': 'true',
        on: {
          click: function () {
            setCategory('');
          },
        },
      }),
    ];

    state.db.categories.forEach(function (cat) {
      chips.push(
        Dom.h('button.chip', {
          type: 'button',
          text: cat.name,
          dataset: { category: cat.name },
          'aria-pressed': 'false',
          on: {
            click: function () {
              setCategory(cat.name);
            },
          },
        })
      );
    });

    Dom.replace(el.filters, chips);
    Dom.setHidden(el.filters, false);
  }

  /* --- Header / hero ----------------------------------------------------- */

  function renderIdentity() {
    var s = state.db.settings;

    document.title = s.appTitle + ' — ספריית תוכנות';
    el.brandTitle.textContent = s.appTitle;
    el.brandSub.textContent = s.appSubtitle;
    el.heroTitle.textContent = s.appTitle;
    el.heroSubtitle.textContent = s.appSubtitle;
    Dom.setHidden(el.heroSubtitle, !s.appSubtitle);

    Theme.setAccent(s.ui.accent);

    renderContact(s.contact);
  }

  function renderContact(contact) {
    if (!contact.visible) {
      Dom.setHidden(el.contact, true);
      return;
    }

    var pills = [];

    if (contact.name) {
      pills.push(
        Dom.h('span.contact-pill', {}, [
          Icons.get('user'),
          Dom.h('span', { text: contact.name }),
        ])
      );
    }

    if (contact.phone) {
      pills.push(
        Dom.h(
          'a.contact-pill',
          { href: 'tel:' + contact.phone.replace(/[^\d+]/g, ''), title: 'חיוג' },
          [
            Icons.get('phone'),
            Dom.h('span.contact-pill__value', { text: contact.phone }),
          ]
        )
      );
    }

    if (contact.email) {
      pills.push(
        Dom.h('a.contact-pill', { href: 'mailto:' + contact.email }, [
          Icons.get('mail'),
          Dom.h('span.contact-pill__value', { text: contact.email }),
        ])
      );
    }

    if (contact.note) {
      pills.push(
        Dom.h('span.contact-pill', {}, [
          Icons.get('info'),
          Dom.h('span', { text: contact.note }),
        ])
      );
    }

    if (!pills.length) {
      Dom.setHidden(el.contact, true);
      return;
    }

    Dom.replace(el.contact, pills);
    Dom.setHidden(el.contact, false);
  }

  function renderFooterMeta() {
    var latest = state.items.reduce(function (best, i) {
      if (!i.updatedAt) return best;
      return !best || i.updatedAt > best ? i.updatedAt : best;
    }, '');

    el.lastUpdate.textContent = latest
      ? 'עודכן לאחרונה: ' + Utils.formatDate(latest)
      : '';
  }

  /* --- Startup ----------------------------------------------------------- */

  function cacheElements() {
    el.brandTitle = Dom.must('#brand-title');
    el.brandSub = Dom.must('#brand-sub');
    el.heroTitle = Dom.must('#hero-title');
    el.heroSubtitle = Dom.must('#hero-subtitle');
    el.contact = Dom.must('#hero-contact');
    el.search = Dom.must('#search-input');
    el.searchWrap = Dom.must('#search');
    el.searchClear = Dom.must('#search-clear');
    el.filters = Dom.must('#filters');
    el.breadcrumbs = Dom.must('#breadcrumbs');
    el.catalog = Dom.must('#catalog');
    el.count = Dom.must('#item-count');
    el.lastUpdate = Dom.must('#last-update');
    el.headerActions = Dom.must('#header-actions');
    el.loading = Dom.must('#loading');
  }

  function bindEvents() {
    el.search.addEventListener('input', onSearchInput);
    el.searchClear.addEventListener('click', clearSearch);

    el.search.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape' && el.search.value) {
        evt.preventDefault();
        clearSearch();
      }
    });

    // "/" focuses search, the convention users already know from every other
    // catalog site. Ignored while typing so it can still be typed literally.
    document.addEventListener('keydown', function (evt) {
      if (evt.key !== '/' || evt.ctrlKey || evt.metaKey || evt.altKey) return;

      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (NS.require('ui.Modal').isOpen()) return;

      evt.preventDefault();
      el.search.focus();
      el.search.select();
    });

    // Backspace at the top level of a folder goes up one, mirroring a file
    // manager. Guarded the same way as "/".
    document.addEventListener('keydown', function (evt) {
      if (evt.key !== 'Backspace' || !state.folderId) return;

      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (NS.require('ui.Modal').isOpen()) return;

      evt.preventDefault();
      var folder = state.byId.get(state.folderId);
      navigateTo(folder ? folder.parentId : null);
    });

    el.headerActions.appendChild(Theme.createToggle());
    Help.init();
  }

  function showFatal(message, detail) {
    Dom.setHidden(el.loading, true);
    Dom.replace(el.catalog, [
      Dom.h('div.empty', {}, [
        Icons.get('error', { className: 'empty__icon' }),
        Dom.h('div.empty__title', { text: message }),
        Dom.h('p.empty__text', { text: detail || '' }),
        Dom.h('button.btn', {
          type: 'button',
          text: 'רענון הדף',
          on: {
            click: function () {
              window.location.reload();
            },
          },
        }),
      ]),
    ]);
  }

  function start() {
    cacheElements();
    Theme.init('auto');
    bindEvents();

    Db.load()
      .then(function (result) {
        state.db = result.db;
        state.items = Db.visibleItems(result.db);
        state.byId = Db.indexById(state.items);
        state.index = Search.createIndex(state.items);

        Dom.setHidden(el.loading, true);

        renderIdentity();
        renderFilters();
        renderFooterMeta();
        render();

        if (result.error) {
          showFatal('לא ניתן לטעון את קובץ הנתונים', result.error.message);
          return;
        }

        if (result.repairs.length) {
          // The catalog still works, so this is a warning rather than a stop:
          // the administrator needs to know, the visitor does not need to care.
          Logger.warn('main: database repairs —', result.repairs.join(' | '));
          Toast.warn('חלק מהנתונים תוקנו אוטומטית בעת הטעינה.', 5000);
        }

        Logger.info(
          'main: loaded ' + state.items.length + ' visible items from ' + result.source
        );
      })
      .catch(function (err) {
        Logger.error('main: startup failed', err);
        showFatal('אירעה שגיאה בטעינת הספרייה', err.message);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  NS.define('app.Main', { start: start, state: state });
})(window.USBLib);
