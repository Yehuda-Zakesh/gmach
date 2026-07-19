/**
 * search.js — Instant search over the catalog.
 *
 * The index is built once per database load. Each item gets one normalized
 * haystack string, so filtering N items costs N substring scans — fast enough
 * for thousands of entries that the UI can filter on every keystroke without
 * a debounce, which is what makes the results feel instant.
 */
(function (NS) {
  'use strict';

  var Utils = NS.require('Utils');
  var FileTypes = NS.require('FileTypes');

  /**
   * Fields that participate in search, and how much a match in each is worth.
   * Weights only affect result ordering, never whether an item matches.
   */
  var FIELDS = [
    { key: 'name', weight: 100 },
    { key: 'category', weight: 40 },
    { key: 'version', weight: 30 },
    { key: 'tags', weight: 25 },
    { key: 'description', weight: 20 },
    { key: 'fileName', weight: 15 },
    { key: 'typeLabel', weight: 10 },
  ];

  function Index(items) {
    this.entries = items.map(function (item) {
      var fields = {
        name: Utils.normalize(item.name),
        category: Utils.normalize(item.category),
        version: Utils.normalize(item.version),
        tags: Utils.normalize((item.tags || []).join(' ')),
        description: Utils.normalize(item.description),
        fileName: Utils.normalize(item.fileName),
        typeLabel: Utils.normalize(FileTypes.labelOf(item.type)),
      };

      // Query terms are whitespace-split, so no single term can contain a
      // space. Joining the fields with one is therefore enough to stop a term
      // matching across a field boundary (e.g. "reader 7" spanning
      // name="Reader" and version="7").
      var haystack = FIELDS.map(function (f) {
        return fields[f.key];
      })
        .filter(Boolean)
        .join(' ');

      return { item: item, fields: fields, haystack: haystack };
    });
  }

  /**
   * Scores one entry against the query terms.
   * Every term must appear somewhere (AND semantics) — with a catalog this
   * size, OR matching returns almost everything and helps nobody.
   * @returns {number} 0 when the entry does not match
   */
  Index.prototype._score = function (entry, terms) {
    var total = 0;

    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      if (entry.haystack.indexOf(term) === -1) return 0;

      var best = 0;
      for (var f = 0; f < FIELDS.length; f++) {
        var field = FIELDS[f];
        var value = entry.fields[field.key];
        if (!value) continue;

        var at = value.indexOf(term);
        if (at === -1) continue;

        var score = field.weight;
        if (at === 0) score += field.weight * 0.5; // Prefix matches rank higher.
        if (value === term) score += field.weight; // Exact field match wins.
        if (score > best) best = score;
      }

      total += best;
    }

    return total;
  };

  /**
   * @param {string} query
   * @returns {Object[]} matching items, best first
   */
  Index.prototype.search = function (query) {
    var terms = Utils.normalize(query).split(' ').filter(Boolean);

    if (!terms.length) {
      return this.entries.map(function (e) {
        return e.item;
      });
    }

    var hits = [];

    for (var i = 0; i < this.entries.length; i++) {
      var score = this._score(this.entries[i], terms);
      if (score > 0) hits.push({ item: this.entries[i].item, score: score });
    }

    hits.sort(function (a, b) {
      return b.score - a.score || Utils.compareText(a.item.name, b.item.name);
    });

    return hits.map(function (h) {
      return h.item;
    });
  };

  var Search = {
    /**
     * @param {Object[]} items
     * @returns {Index}
     */
    createIndex: function (items) {
      return new Index(items);
    },
  };

  NS.define('app.Search', Search);
})(window.USBLib);
