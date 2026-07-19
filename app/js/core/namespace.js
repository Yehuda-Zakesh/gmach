/**
 * namespace.js — Module root. MUST be the first script on every page.
 *
 * WHY NOT ES MODULES?
 * ------------------------------------------------------------------
 * This application is required to run directly from a USB drive over the
 * `file://` protocol with no web server. Chromium (and Firefox) assign
 * `file://` documents an opaque origin ("null") and enforce CORS on every
 * ES-module fetch, so `<script type="module">` fails to load with:
 *
 *     Access to script at 'file:///.../main.js' from origin 'null'
 *     has been blocked by CORS policy.
 *
 * Classic scripts are exempt from that check, so the codebase keeps the
 * module *structure* (one responsibility per file, explicit dependencies,
 * no globals leaking beyond the namespace) while loading as classic scripts
 * in dependency order. Each file wraps itself in an IIFE and attaches a
 * single named export to the `USBLib` namespace below.
 *
 * The same restriction blocks `fetch('data/database.json')`, which is why
 * the database has a `data/database.js` mirror. See core/db.js.
 */
(function (global) {
  'use strict';

  var USBLib = global.USBLib || {};

  /** Semantic version of the application shell, shown in the admin console. */
  USBLib.VERSION = '1.0.0';

  /**
   * Defines a namespaced module and returns its export.
   * Re-defining an existing name throws, which surfaces script-order mistakes
   * immediately instead of silently shadowing a dependency.
   *
   * @param {string} name  Dotted path, e.g. "ui.Toast".
   * @param {*} value      The module's export.
   * @returns {*} value
   */
  USBLib.define = function (name, value) {
    var parts = name.split('.');
    var node = USBLib;

    for (var i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = {};
      node = node[parts[i]];
    }

    var leaf = parts[parts.length - 1];
    if (Object.prototype.hasOwnProperty.call(node, leaf)) {
      throw new Error('USBLib: module "' + name + '" is already defined');
    }

    node[leaf] = value;
    return value;
  };

  /**
   * Resolves a namespaced module, throwing a readable error when a script tag
   * is missing from the HTML rather than failing later with "undefined".
   *
   * @param {string} name Dotted path.
   * @returns {*}
   */
  USBLib.require = function (name) {
    var parts = name.split('.');
    var node = USBLib;

    for (var i = 0; i < parts.length; i++) {
      if (node == null || !(parts[i] in node)) {
        throw new Error(
          'USBLib: module "' + name + '" is not loaded. ' +
            'Check the <script> order in the HTML file.'
        );
      }
      node = node[parts[i]];
    }

    return node;
  };

  global.USBLib = USBLib;
})(window);
