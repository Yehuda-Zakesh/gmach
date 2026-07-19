/**
 * dom.js — Tiny DOM helpers.
 *
 * `h()` builds elements without innerHTML, which means user- and
 * administrator-supplied strings (software names, descriptions, filenames)
 * can never be parsed as markup. That matters here: the database is an
 * editable text file on a shared USB drive, and it is exactly the kind of
 * input that ends up containing angle brackets.
 */
(function (NS) {
  'use strict';

  var Dom = {
    /**
     * Creates an element.
     *
     * @param {string} tag e.g. "div", "button.btn.btn--primary", "span#total"
     * @param {Object} [props] attributes and properties:
     *   - class / className    string
     *   - text                 textContent (always escaped)
     *   - html                 innerHTML — only for trusted, code-owned markup
     *   - dataset              { key: value }
     *   - style                { prop: value }
     *   - on                   { event: handler | [handler, options] }
     *   - anything else        setAttribute, or a direct property for
     *                          `value` / `checked` / `disabled`
     * @param {Array|Node|string} [children]
     * @returns {HTMLElement}
     */
    h: function (tag, props, children) {
      var parts = String(tag).split(/(?=[.#])/);
      var el = document.createElement(parts.shift() || 'div');

      parts.forEach(function (p) {
        if (p.charAt(0) === '.') el.classList.add(p.slice(1));
        else if (p.charAt(0) === '#') el.id = p.slice(1);
      });

      var p = props || {};

      Object.keys(p).forEach(function (key) {
        var value = p[key];
        if (value === null || value === undefined || value === false) return;

        switch (key) {
          case 'class':
          case 'className':
            String(value)
              .split(/\s+/)
              .filter(Boolean)
              .forEach(function (c) {
                el.classList.add(c);
              });
            break;

          case 'text':
            el.textContent = String(value);
            break;

          case 'html':
            el.innerHTML = value;
            break;

          case 'dataset':
            Object.keys(value).forEach(function (k) {
              el.dataset[k] = value[k];
            });
            break;

          case 'style':
            Object.keys(value).forEach(function (k) {
              el.style.setProperty(k, value[k]);
            });
            break;

          case 'on':
            Object.keys(value).forEach(function (evt) {
              var v = value[evt];
              if (Array.isArray(v)) el.addEventListener(evt, v[0], v[1]);
              else el.addEventListener(evt, v);
            });
            break;

          case 'value':
          case 'checked':
          case 'disabled':
          case 'selected':
          case 'htmlFor':
            el[key] = value;
            break;

          default:
            el.setAttribute(key, value === true ? '' : String(value));
        }
      });

      if (children !== undefined && children !== null) Dom.append(el, children);
      return el;
    },

    /**
     * Appends children, flattening arrays and skipping null/false so callers
     * can write `[cond && node]` inline.
     * @param {Node} parent
     * @param {Array|Node|string} children
     * @returns {Node} parent
     */
    append: function (parent, children) {
      var list = Array.isArray(children) ? children : [children];

      list.forEach(function (child) {
        if (child === null || child === undefined || child === false) return;
        if (Array.isArray(child)) {
          Dom.append(parent, child);
          return;
        }
        parent.appendChild(
          child instanceof Node ? child : document.createTextNode(String(child))
        );
      });

      return parent;
    },

    /** Removes every child of `el`. */
    clear: function (el) {
      while (el.firstChild) el.removeChild(el.firstChild);
      return el;
    },

    /** Replaces the children of `el`. */
    replace: function (el, children) {
      Dom.clear(el);
      return Dom.append(el, children);
    },

    /** querySelector, scoped. */
    qs: function (selector, scope) {
      return (scope || document).querySelector(selector);
    },

    /** querySelectorAll as a real array. */
    qsa: function (selector, scope) {
      return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
    },

    /**
     * Like qs, but throws when the element is missing. Use for elements the
     * HTML is contractually required to provide, so a typo in an id surfaces
     * at startup instead of as a null-dereference later.
     */
    must: function (selector, scope) {
      var el = Dom.qs(selector, scope);
      if (!el) throw new Error('dom: required element "' + selector + '" is missing');
      return el;
    },

    /** Toggles a class and returns the new state. */
    toggleClass: function (el, name, force) {
      return el.classList.toggle(name, force);
    },

    /** Shows/hides via the `hidden` attribute. */
    setHidden: function (el, hidden) {
      if (hidden) el.setAttribute('hidden', '');
      else el.removeAttribute('hidden');
    },

    /** A DocumentFragment holding `children`. */
    fragment: function (children) {
      var frag = document.createDocumentFragment();
      Dom.append(frag, children);
      return frag;
    },

    /**
     * Delegated event listener.
     * @param {Node} root
     * @param {string} type
     * @param {string} selector
     * @param {function(Event, HTMLElement):void} handler
     */
    delegate: function (root, type, selector, handler) {
      root.addEventListener(type, function (evt) {
        var target = evt.target.closest(selector);
        if (target && root.contains(target)) handler(evt, target);
      });
    },

    /**
     * Traps Tab inside a container (modals, the login card).
     * @param {HTMLElement} container
     * @param {KeyboardEvent} evt
     */
    trapFocus: function (container, evt) {
      if (evt.key !== 'Tab') return;

      var focusable = Dom.qsa(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
          ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        container
      ).filter(function (el) {
        return el.offsetParent !== null || el === document.activeElement;
      });

      if (!focusable.length) return;

      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (evt.shiftKey && document.activeElement === first) {
        evt.preventDefault();
        last.focus();
      } else if (!evt.shiftKey && document.activeElement === last) {
        evt.preventDefault();
        first.focus();
      }
    },
  };

  NS.define('ui.Dom', Dom);
})(window.USBLib);
