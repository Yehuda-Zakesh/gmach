/**
 * paths.js — Relative path handling.
 *
 * Every path stored in the database is RELATIVE to the folder holding
 * index.html, uses forward slashes, and never contains a drive letter or a
 * leading slash. That is what lets the USB drive mount as D:, E:, F: … and
 * still resolve correctly: the browser joins the relative path against the
 * document URL, whatever that happens to be today.
 */
(function (NS) {
  'use strict';

  var Utils = NS.require('Utils');

  var Paths = {
    /**
     * Converts any user- or OS-supplied path into the canonical stored form.
     * Backslashes become slashes, `.`/`..` segments and leading slashes are
     * stripped, and duplicate separators collapse.
     * @param {string} p
     * @returns {string} e.g. "software/Tools/setup.exe"
     */
    normalize: function (p) {
      var s = Utils.str(p).replace(/\\/g, '/');

      // Drop anything that looks like an absolute location — those break the
      // moment the drive letter changes.
      s = s.replace(/^[a-zA-Z]:/, '');
      s = s.replace(/^file:\/+/i, '');

      var out = [];
      s.split('/').forEach(function (seg) {
        if (!seg || seg === '.') return;
        if (seg === '..') {
          out.pop();
          return;
        }
        out.push(seg);
      });

      return out.join('/');
    },

    /** Joins segments and normalizes the result. */
    join: function () {
      return Paths.normalize(Array.prototype.slice.call(arguments).join('/'));
    },

    /** The last segment of a path ("a/b/c.exe" -> "c.exe"). */
    basename: function (p) {
      var s = Paths.normalize(p);
      var i = s.lastIndexOf('/');
      return i === -1 ? s : s.slice(i + 1);
    },

    /** Everything before the last segment ("a/b/c.exe" -> "a/b"). */
    dirname: function (p) {
      var s = Paths.normalize(p);
      var i = s.lastIndexOf('/');
      return i === -1 ? '' : s.slice(0, i);
    },

    /** Lowercase extension without the dot ("Setup.EXE" -> "exe"). */
    extension: function (p) {
      var base = Paths.basename(p);
      var i = base.lastIndexOf('.');
      if (i <= 0) return '';
      return base.slice(i + 1).toLowerCase();
    },

    /** Filename without its extension ("Setup.exe" -> "Setup"). */
    stem: function (p) {
      var base = Paths.basename(p);
      var i = base.lastIndexOf('.');
      return i <= 0 ? base : base.slice(0, i);
    },

    /** Path segments as an array. */
    segments: function (p) {
      var s = Paths.normalize(p);
      return s ? s.split('/') : [];
    },

    /** True when `child` sits anywhere beneath `parent`. */
    isInside: function (child, parent) {
      var c = Paths.normalize(child);
      var p = Paths.normalize(parent);
      if (!p) return true;
      return c === p || c.indexOf(p + '/') === 0;
    },

    /**
     * Percent-encodes each segment so spaces, Hebrew names and `#` in
     * filenames survive being used as an href. Separators stay literal.
     * @param {string} p
     * @returns {string}
     */
    toHref: function (p) {
      return Paths.normalize(p)
        .split('/')
        .map(function (seg) {
          return encodeURIComponent(seg);
        })
        .join('/');
    },

    /**
     * Turns a filename into a readable display name:
     * "adobe_reader-v11_setup.exe" -> "Adobe Reader V11 Setup".
     * Hebrew names pass through untouched apart from separator cleanup.
     * @param {string} fileName
     * @returns {string}
     */
    prettify: function (fileName) {
      var name = Paths.stem(fileName);

      name = name
        .replace(/[_+]+/g, ' ')
        .replace(/-{1,}/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

      // Split camelCase, but only between Latin letters.
      name = name.replace(/([a-z])([A-Z])/g, '$1 $2');

      // Title-case Latin words; leave Hebrew and all-caps acronyms as-is.
      name = name
        .split(' ')
        .map(function (w) {
          if (!/^[a-z]/.test(w)) return w;
          return w.charAt(0).toUpperCase() + w.slice(1);
        })
        .join(' ');

      return name || fileName;
    },

    /**
     * Decides whether a stored path is safe to turn into a link.
     *
     * Rejects the RAW input rather than the normalized form. normalize()
     * resolves "software/../../Windows/x.exe" into "Windows/x.exe" — a
     * perfectly relative path that points at a completely different file than
     * the database claims. Silently serving that is worse than refusing, so a
     * path containing traversal is treated as tampered-with and rejected.
     *
     * @param {string} p
     * @param {string} [root] when given, p must also sit beneath it
     * @returns {boolean}
     */
    isSafe: function (p, root) {
      var raw = Utils.str(p).replace(/\\/g, '/');
      if (!raw) return false;

      if (/^[a-zA-Z]:/.test(raw)) return false; // drive letter
      if (raw.charAt(0) === '/') return false; // filesystem root
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false; // file:, http:, javascript:

      var hasTraversal = raw.split('/').some(function (seg) {
        return seg === '..';
      });
      if (hasTraversal) return false;

      var s = Paths.normalize(raw);
      if (!s) return false;

      if (root) return Paths.isInside(s, root);
      return true;
    },
  };

  NS.define('Paths', Paths);
})(window.USBLib);
