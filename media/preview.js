(function () {
  'use strict';

  const language = String(document.documentElement.lang || navigator.language || 'en').toLowerCase();
  const messages = language.startsWith('ko') ? {
    addNote: '메모 추가',
    note: '메모',
    save: '저장',
    cancel: '취소',
    resize: '메모 영역 크기 조절',
    collapse: '메모 영역 접기',
    expand: '메모 영역 펼치기',
    deleteNote: '메모 삭제',
    more: '더 보기'
  } : {
    addNote: 'Add note',
    note: 'Note',
    save: 'Save',
    cancel: 'Cancel',
    resize: 'Resize notes area',
    collapse: 'Collapse notes area',
    expand: 'Expand notes area',
    deleteNote: 'Delete note',
    more: 'Show more'
  };

  const utils = window.MarkdownSelectionNotesHighlightUtils || {
    normalizeText: function (value) { return String(value || '').replace(/\s+/g, ' ').trim(); },
    findUniqueTextMatch: function (target, nodes) {
      const needle = String(target || '').trim();
      const matches = [];
      nodes.forEach(function (value, nodeIndex) {
        const text = String(value || '');
        let from = 0;
        let index;
        while (needle && (index = text.indexOf(needle, from)) >= 0) {
          matches.push({ nodeIndex: nodeIndex, index: index, length: needle.length });
          from = index + needle.length;
        }
      });
      return matches.length === 1 ? matches[0] : null;
    }
  };
  let source = readSource();
  let storageKey = 'markdown-selection-notes:' + source;
  let noteStore = new NoteStore(source);
  let indexedDbReady = false;
  const layoutKey = 'markdown-selection-notes-layout';
  applyPreviewConfig();
  let notes = readNotes();
  let layout = readLayout();
  let selectedText = '';
  let selectedRange = null;
  let releasePoint = { x: 0, y: 0 };
  let visibleLimit = 40;

  const button = document.createElement('button');
  button.id = 'markdown-selection-notes-button';
  button.type = 'button';
  button.innerHTML = '<span class="markdown-selection-notes-document-icon" aria-hidden="true"></span>';
  button.title = messages.addNote;
  button.setAttribute('aria-label', messages.addNote);
  document.body.appendChild(button);

  const editor = document.createElement('div');
  editor.id = 'markdown-selection-notes-editor';
  editor.innerHTML = '<textarea aria-label="' + messages.note + '"></textarea><div class="markdown-selection-notes-editor-actions"><button class="markdown-selection-notes-icon-button" type="button" data-action="save" title="' + messages.save + '" aria-label="' + messages.save + '">✓</button><button class="markdown-selection-notes-icon-button" type="button" data-action="cancel" title="' + messages.cancel + '" aria-label="' + messages.cancel + '">×</button></div>';
  document.body.appendChild(editor);

  const header = document.createElement('div');
  header.id = 'markdown-selection-notes-header';
  document.body.appendChild(header);
  const list = document.createElement('div');
  list.id = 'markdown-selection-notes-list';
  document.body.appendChild(list);
  const resizeHandle = document.createElement('div');
  resizeHandle.id = 'markdown-selection-notes-resize';
  resizeHandle.title = messages.resize;
  resizeHandle.setAttribute('aria-label', messages.resize);
  document.body.appendChild(resizeHandle);
  const toggle = document.createElement('button');
  toggle.id = 'markdown-selection-notes-toggle';
  toggle.type = 'button';
  header.appendChild(toggle);
  applyLayout();
  renderNotes();
  setTimeout(hydrateNotes, 0);
  let highlightTimer;
  const contentObserver = new MutationObserver(function () {
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(syncDocument, 0);
  });
  contentObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-settings'] });

  document.addEventListener('mouseup', function (event) {
    if (button.contains(event.target) || editor.contains(event.target)) return;
    const releaseX = event.clientX;
    const releaseY = event.clientY;
    releasePoint = { x: releaseX, y: releaseY };
    setTimeout(function () {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!text || !selection.rangeCount || !document.body.contains(selection.anchorNode)) {
        hideButton();
        return;
      }
      selectedText = text;
      selectedRange = selection.getRangeAt(0).cloneRange();
      const buttonWidth = 90;
      const buttonHeight = 32;
      const placeAbove = releaseY >= buttonHeight + 8 || window.innerHeight - releaseY < buttonHeight + 8;
      const left = Math.max(8, Math.min(window.innerWidth - buttonWidth - 8, releaseX - (buttonWidth / 2)));
      const top = placeAbove ? Math.max(8, releaseY - buttonHeight - 8) : Math.min(window.innerHeight - buttonHeight - 8, releaseY + 8);
      button.style.left = left + 'px';
      button.style.top = top + 'px';
      button.style.display = 'block';
    }, 0);
  });

  document.addEventListener('mousedown', function (event) {
    if (!button.contains(event.target) && !editor.contains(event.target)) hideButton();
  });

  button.addEventListener('mousedown', function (event) { event.stopPropagation(); });
  editor.addEventListener('mousedown', function (event) { event.stopPropagation(); });

  button.addEventListener('click', function () {
    if (!canCreateNote()) return;
    button.style.display = 'none';
    highlightDraftSelection();
    const editorWidth = 300;
    const editorHeight = 165;
    const gap = 8;
    const placeAbove = releasePoint.y >= editorHeight + gap || window.innerHeight - releasePoint.y < editorHeight + gap;
    const left = Math.max(8, Math.min(window.innerWidth - editorWidth - 8, releasePoint.x - (editorWidth / 2)));
    const top = placeAbove ? Math.max(8, releasePoint.y - editorHeight - gap) : Math.min(window.innerHeight - editorHeight - 8, releasePoint.y + gap);
    editor.classList.add('markdown-selection-notes-editor-floating');
    editor.style.left = left + 'px';
    editor.style.top = top + 'px';
    editor.style.display = 'block';
    syncSidebar();
    editor.querySelector('textarea').focus();
  });

  editor.addEventListener('click', function (event) {
    const action = event.target.dataset.action;
    if (action === 'cancel') {
      editor.style.display = 'none';
      editor.classList.remove('markdown-selection-notes-editor-floating');
      editor.style.left = '';
      editor.style.top = '';
      clearDraftHighlight();
      syncSidebar();
      return;
    }
    if (action === 'save') {
      const comment = editor.querySelector('textarea').value.trim();
      if (!comment) return;
      const note = { id: createId(), source: source, text: selectedText, comment: comment, anchor: serializeRange(selectedRange), createdAt: new Date().toISOString() };
      notes.push(note);
      writeNote(note);
      renderNotes();
      editor.querySelector('textarea').value = '';
      editor.style.display = 'none';
      editor.classList.remove('markdown-selection-notes-editor-floating');
      editor.style.left = '';
      editor.style.top = '';
      clearDraftHighlight();
      syncSidebar();
      hideButton();
    }
  });

  toggle.addEventListener('click', function () {
    layout.collapsed = !layout.collapsed;
    writeLayout();
    applyLayout();
  });

  resizeHandle.addEventListener('pointerdown', function (event) {
    if (layout.collapsed) return;
    const startX = event.clientX;
    const startWidth = layout.width;
    resizeHandle.setPointerCapture(event.pointerId);
    function move(moveEvent) {
      layout.width = Math.max(240, Math.min(520, startWidth + startX - moveEvent.clientX));
      applyLayout();
    }
    function end() {
      writeLayout();
      resizeHandle.removeEventListener('pointermove', move);
      resizeHandle.removeEventListener('pointerup', end);
    }
    resizeHandle.addEventListener('pointermove', move);
    resizeHandle.addEventListener('pointerup', end);
  });

  function hideButton() {
    button.style.display = 'none';
    editor.style.display = 'none';
    editor.classList.remove('markdown-selection-notes-editor-floating');
    editor.style.left = '';
    editor.style.top = '';
    clearDraftHighlight();
    syncSidebar();
  }
  function canCreateNote() {
    return Boolean(selectedText && selectedText.trim() && selectedRange && document.body.contains(selectedRange.startContainer));
  }
  function highlightDraftSelection() {
    if (!selectedRange || !window.CSS || !CSS.highlights || !window.Highlight) return;
    CSS.highlights.delete('markdown-selection-notes-draft');
    CSS.highlights.set('markdown-selection-notes-draft', new Highlight(selectedRange));
  }
  function clearDraftHighlight() {
    if (window.CSS && CSS.highlights) CSS.highlights.delete('markdown-selection-notes-draft');
  }
  function readSource() {
    const previewData = document.getElementById('vscode-markdown-preview-data');
    try { return JSON.parse(previewData?.getAttribute('data-settings') || '{}').source || 'unknown'; } catch (_) { return 'unknown'; }
  }
  function syncDocument() {
    const nextSource = readSource();
    applyPreviewConfig();
    if (nextSource !== source) {
      hideButton();
      source = nextSource;
      storageKey = 'markdown-selection-notes:' + source;
      noteStore = new NoteStore(source);
      indexedDbReady = false;
      notes = readNotes();
      visibleLimit = 40;
      renderNotes();
      hydrateNotes();
      return;
    }
    highlightNotes();
  }
  function applyPreviewConfig() {
    const configElement = document.getElementById('markdown-selection-notes-config');
    if (configElement?.dataset.highlightColor) {
      document.documentElement.style.setProperty('--markdown-selection-notes-highlight-color', configElement.dataset.highlightColor);
    }
  }
  function readNotes() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(value) ? value.map(ensureId) : [];
    } catch (_) { return []; }
  }
  function ensureId(note) { return Object.assign({}, note, { id: note.id || createId(), source: note.source || source }); }
  function createId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
  function writeNote(note) {
    if (indexedDbReady) noteStore.put(note);
    else localStorage.setItem(storageKey, JSON.stringify(notes));
  }
  function removeNote(note) {
    if (indexedDbReady) noteStore.delete(note?.id);
    else localStorage.setItem(storageKey, JSON.stringify(notes));
  }
  function hydrateNotes() {
    noteStore.load().then(function (stored) {
      if (!stored) return;
      indexedDbReady = true;
      if (stored.length) {
        notes = stored.map(ensureId);
        renderNotes();
        return;
      }
      if (notes.length) noteStore.replace(notes);
    }).catch(function () { /* localStorage remains the fallback */ });
  }
  function readLayout() {
    try {
      const value = JSON.parse(localStorage.getItem(layoutKey) || '{}');
      return { width: Math.max(240, Math.min(520, Number(value.width) || 320)), collapsed: value.collapsed === true };
    } catch (_) { return { width: 320, collapsed: false }; }
  }
  function writeLayout() { localStorage.setItem(layoutKey, JSON.stringify(layout)); }
  function applyLayout() {
    document.body.style.setProperty('--markdown-selection-notes-width', layout.width + 'px');
    document.body.classList.toggle('markdown-selection-notes-sidebar-collapsed', layout.collapsed);
    toggle.textContent = layout.collapsed ? '‹' : '›';
    toggle.title = layout.collapsed ? messages.expand : messages.collapse;
    toggle.setAttribute('aria-label', layout.collapsed ? messages.expand : messages.collapse);
  }
  function renderNotes() {
    if (notes.length === 0 && editor.style.display !== 'block' && layout.collapsed) {
      layout.collapsed = false;
      writeLayout();
      applyLayout();
    }
    const ordered = notes.slice().reverse();
    const visible = ordered.slice(0, visibleLimit);
    const cards = visible.map(function (note) {
      return '<div class="markdown-selection-note" data-note-id="' + escapeHtml(note.id) + '"><button class="markdown-selection-note-delete" data-note-id="' + escapeHtml(note.id) + '" title="' + messages.deleteNote + '" aria-label="' + messages.deleteNote + '">×</button><div class="markdown-selection-note-quote">“' + escapeHtml(note.text.slice(0, 120)) + (note.text.length > 120 ? '…' : '') + '”</div><div class="markdown-selection-note-comment">' + escapeHtml(note.comment) + '</div></div>';
    }).join('');
    const more = ordered.length > visible.length ? '<button id="markdown-selection-notes-more" class="markdown-selection-notes-icon-button" type="button" title="' + messages.more + '" aria-label="' + messages.more + '">⋯</button>' : '';
    list.innerHTML = (cards || '') + more;
    list.querySelector('#markdown-selection-notes-more')?.addEventListener('click', function () {
      visibleLimit += 40;
      renderNotes();
    });
    list.querySelectorAll('.markdown-selection-note').forEach(function (card) {
      card.addEventListener('click', function (event) {
        if (event.target.closest('.markdown-selection-note-delete')) return;
        revealNote(notes.find(function (note) { return note.id === card.dataset.noteId; }));
      });
    });
    list.querySelectorAll('.markdown-selection-note-delete').forEach(function (deleteButton) {
      deleteButton.addEventListener('click', function () {
        const index = notes.findIndex(function (note) { return note.id === deleteButton.dataset.noteId; });
        if (index < 0) return;
        const [removed] = notes.splice(index, 1);
        removeNote(removed);
        renderNotes();
      });
    });
    syncSidebar();
    highlightNotes();
  }
  function revealNote(note) {
    const range = rangeFromAnchor(note?.anchor);
    if (!range || !utils || normalizeText(range.toString()) !== normalizeText(note.text)) return;
    const rect = range.getBoundingClientRect();
    const targetTop = window.scrollY + rect.top - (window.innerHeight / 2) + (rect.height / 2);
    window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  }
  function syncSidebar() {
    document.body.classList.toggle('markdown-selection-notes-sidebar-open', notes.length > 0 || editor.style.display === 'block');
  }
  function highlightNotes() {
    if (!window.CSS || !CSS.highlights || !window.Highlight) return;
    CSS.highlights.delete('markdown-selection-notes');
    const highlight = new Highlight();
    notes.forEach(function (note) {
      let range = rangeFromAnchor(note.anchor);
      if (range && normalizeText(range.toString()) !== normalizeText(note.text)) range = null;
      if (!range) range = findTextRange(note.text);
      if (range) highlight.add(range);
    });
    CSS.highlights.set('markdown-selection-notes', highlight);
  }
  function serializeRange(range) {
    if (!range) return null;
    const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    const root = container?.closest('.markdown-body') || document.body;
    return {
      root: root === document.body ? 'body' : 'markdown-body',
      startPath: nodePath(range.startContainer, root),
      startOffset: range.startOffset,
      endPath: nodePath(range.endContainer, root),
      endOffset: range.endOffset
    };
  }
  function nodePath(node, root) {
    const path = [];
    let current = node;
    while (current && current !== root) {
      const parent = current.parentNode;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
      current = parent;
    }
    return current === root ? path : null;
  }
  function nodeFromPath(path, root) {
    if (!Array.isArray(path)) return null;
    let current = root;
    for (const index of path) {
      if (!current.childNodes[index]) return null;
      current = current.childNodes[index];
    }
    return current;
  }
  function rangeFromAnchor(anchor) {
    if (!anchor) return null;
    const root = anchor.root === 'markdown-body' ? document.querySelector('.markdown-body') : document.body;
    if (!root) return null;
    const start = nodeFromPath(anchor.startPath, root);
    const end = nodeFromPath(anchor.endPath, root);
    if (!start || !end || anchor.startOffset > start.length || anchor.endOffset > end.length) return null;
    try {
      const range = document.createRange();
      range.setStart(start, anchor.startOffset);
      range.setEnd(end, anchor.endOffset);
      return range;
    } catch (_) { return null; }
  }
  function findTextRange(text) {
    const target = text.trim();
    if (!target) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let current;
    while ((current = walker.nextNode())) {
      if (current.parentElement && (current.parentElement.closest('#markdown-selection-notes-list, #markdown-selection-notes-editor, #markdown-selection-notes-button, #markdown-selection-notes-toggle, #markdown-selection-notes-resize'))) continue;
      nodes.push(current);
    }
    const match = utils.findUniqueTextMatch(target, nodes.map(node => node.nodeValue));
    if (!match) return null;
    const range = document.createRange();
    range.setStart(nodes[match.nodeIndex], match.index);
    range.setEnd(nodes[match.nodeIndex], match.index + match.length);
    return range;
  }
  function NoteStore(noteSource) {
    this.source = noteSource;
    this.dbPromise = new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(null); return; }
      const request = window.indexedDB.open('markdown-selection-notes', 1);
      request.onupgradeneeded = function () {
        const store = request.result.createObjectStore('notes', { keyPath: 'id' });
        store.createIndex('source', 'source', { unique: false });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { resolve(null); };
    });
  }
  NoteStore.prototype.load = function () {
    const source = this.source;
    return this.dbPromise.then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        const request = db.transaction('notes', 'readonly').objectStore('notes').index('source').getAll(source);
        request.onsuccess = function () { resolve(request.result || []); };
        request.onerror = function () { resolve([]); };
      });
    });
  };
  NoteStore.prototype.put = function (note) {
    return this.dbPromise.then(function (db) {
      if (!db) return;
      const transaction = db.transaction('notes', 'readwrite');
      transaction.objectStore('notes').put(note);
    });
  };
  NoteStore.prototype.delete = function (id) {
    return this.dbPromise.then(function (db) {
      if (!db || !id) return;
      db.transaction('notes', 'readwrite').objectStore('notes').delete(id);
    });
  };
  NoteStore.prototype.replace = function (items) {
    const self = this;
    return Promise.all(items.map(function (note) { return self.put(note); }));
  };
  function normalizeText(value) { return utils.normalizeText(value); }
  function escapeHtml(value) { return value.replace(/[&<>"']/g, function (char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]; }); }
}());
