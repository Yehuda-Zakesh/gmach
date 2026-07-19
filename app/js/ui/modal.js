/**
 * modal.js — Accessible dialogs.
 *
 * Built on plain elements rather than <dialog>: the native element's
 * ::backdrop and top-layer behaviour still vary between the Chromium and
 * Firefox versions this has to support, and the focus handling below is
 * needed either way.
 */
(function (NS) {
  'use strict';

  var Dom = NS.require('ui.Dom');
  var Icons = NS.require('ui.Icons');

  /** @type {Object[]} open modals, innermost last. */
  var stack = [];

  function onKeyDown(evt) {
    if (!stack.length) return;
    var top = stack[stack.length - 1];

    if (evt.key === 'Escape' && top.closeOnEscape) {
      evt.preventDefault();
      top.close();
      return;
    }

    Dom.trapFocus(top.dialog, evt);
  }

  document.addEventListener('keydown', onKeyDown);

  var Modal = {
    /**
     * Opens a modal.
     *
     * @param {Object} options
     * @param {string} options.title
     * @param {Node|Array} options.body
     * @param {Array} [options.footer] nodes for the footer
     * @param {'narrow'|'default'|'wide'} [options.size]
     * @param {boolean} [options.closeOnEscape] default true
     * @param {boolean} [options.closeOnBackdrop] default true
     * @param {function():void} [options.onClose]
     * @returns {{close: function, dialog: HTMLElement, root: HTMLElement}}
     */
    open: function (options) {
      var opts = options || {};
      var titleId = 'modal-title-' + stack.length;
      var previousFocus = document.activeElement;

      var closeBtn = Dom.h(
        'button.btn.btn--ghost.btn--icon',
        { type: 'button', 'aria-label': 'סגירה' },
        Icons.get('close')
      );

      var dialog = Dom.h(
        'div.modal__dialog' +
          (opts.size === 'wide' ? '.modal__dialog--wide' : '') +
          (opts.size === 'narrow' ? '.modal__dialog--narrow' : ''),
        {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': titleId,
        },
        [
          Dom.h('div.modal__head', {}, [
            Dom.h('h2.modal__title', { id: titleId, text: opts.title || '' }),
            closeBtn,
          ]),
          Dom.h('div.modal__body', {}, opts.body || null),
          opts.footer && opts.footer.length
            ? Dom.h('div.modal__foot', {}, opts.footer)
            : null,
        ]
      );

      var backdrop = Dom.h('div.modal__backdrop');
      var root = Dom.h('div.modal-root.is-open', {}, [backdrop, dialog]);

      var handle = {
        root: root,
        dialog: dialog,
        closeOnEscape: opts.closeOnEscape !== false,
        close: function () {
          var i = stack.indexOf(handle);
          if (i === -1) return; // Already closed.
          stack.splice(i, 1);

          if (root.parentNode) root.parentNode.removeChild(root);
          if (!stack.length) document.body.style.removeProperty('overflow');
          if (opts.onClose) opts.onClose();

          // Returning focus to the trigger is what makes keyboard navigation
          // survive a modal round-trip.
          if (previousFocus && previousFocus.focus) {
            try {
              previousFocus.focus();
            } catch (e) {
              /* The trigger may have been removed while the modal was open. */
            }
          }
        },
      };

      closeBtn.addEventListener('click', handle.close);

      if (opts.closeOnBackdrop !== false) {
        backdrop.addEventListener('click', handle.close);
      }

      document.body.appendChild(root);
      document.body.style.setProperty('overflow', 'hidden');
      stack.push(handle);

      // Prefer the first meaningful control; fall back to the dialog itself so
      // focus never escapes to the page behind.
      var target =
        Dom.qs('[autofocus]', dialog) ||
        Dom.qs('input, select, textarea, button.btn--primary', dialog) ||
        dialog;
      if (target === dialog) dialog.setAttribute('tabindex', '-1');
      setTimeout(function () {
        target.focus();
      }, 40);

      return handle;
    },

    /**
     * A yes/no dialog.
     * @param {Object} options
     * @param {string} options.title
     * @param {string} options.message
     * @param {string} [options.confirmText]
     * @param {string} [options.cancelText]
     * @param {boolean} [options.danger]
     * @returns {Promise<boolean>}
     */
    confirm: function (options) {
      var opts = options || {};

      return new Promise(function (resolve) {
        var handle;
        var answered = false;

        function answer(value) {
          if (answered) return;
          answered = true;
          resolve(value);
          handle.close();
        }

        var cancelBtn = Dom.h('button.btn', {
          type: 'button',
          text: opts.cancelText || 'ביטול',
          on: {
            click: function () {
              answer(false);
            },
          },
        });

        var confirmBtn = Dom.h(
          'button.btn.' + (opts.danger ? 'btn--danger' : 'btn--primary'),
          {
            type: 'button',
            text: opts.confirmText || 'אישור',
            on: {
              click: function () {
                answer(true);
              },
            },
          }
        );

        handle = Modal.open({
          title: opts.title || 'אישור פעולה',
          size: 'narrow',
          body: Dom.h('p', {
            text: opts.message || '',
            style: { 'line-height': '1.7', margin: '0' },
          }),
          footer: [confirmBtn, cancelBtn],
          // Dismissing without choosing means "no".
          onClose: function () {
            if (!answered) {
              answered = true;
              resolve(false);
            }
          },
        });

        setTimeout(function () {
          (opts.danger ? cancelBtn : confirmBtn).focus();
        }, 40);
      });
    },

    /** Closes every open modal. */
    closeAll: function () {
      stack.slice().forEach(function (h) {
        h.close();
      });
    },

    /** @returns {boolean} */
    isOpen: function () {
      return stack.length > 0;
    },
  };

  NS.define('ui.Modal', Modal);
})(window.USBLib);
