(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkdownSelectionNotesHighlightUtils = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function findUniqueTextMatch(target, nodes) {
    const needle = String(target || '').trim();
    if (!needle) return null;
    const matches = [];
    nodes.forEach(function (value, nodeIndex) {
      const text = String(value || '');
      let from = 0;
      let index;
      while ((index = text.indexOf(needle, from)) >= 0) {
        matches.push({ nodeIndex: nodeIndex, index: index, length: needle.length });
        from = index + Math.max(needle.length, 1);
      }
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function isAnchorTextValid(anchorText, noteText) {
    return normalizeText(anchorText) === normalizeText(noteText);
  }

  function storageKey(source) {
    return 'markdown-selection-notes:' + (source || 'unknown');
  }

  function clampSidebarWidth(width) {
    const value = Number(width);
    return Math.max(240, Math.min(520, Number.isFinite(value) ? value : 320));
  }

  return { normalizeText, findUniqueTextMatch, isAnchorTextValid, storageKey, clampSidebarWidth };
}));
