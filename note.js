'use strict';

// ============================================================
//  STICKY NOTE RENDERER
// ============================================================

const noteEl = document.getElementById('note');
const textArea = document.getElementById('text-area');
const closeBtn = document.getElementById('close-btn');
const peelCorner = document.getElementById('peel-corner');

let noteId = null;
// Internal char model: [{ char, struck }]
let chars = [];
let fallen = false;

// ---- Render text from char model into DOM ----
function renderText() {
  // Build HTML preserving cursor is handled via selection tracking
  let html = '';
  for (const c of chars) {
    if (c.char === '\n') {
      html += c.struck ? `<span class="struck">\n</span>` : '\n';
    } else {
      const escaped = c.char
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      html += c.struck ? `<span class="struck">${escaped}</span>` : escaped;
    }
  }
  textArea.innerHTML = html || '';
}

// ---- Get flat cursor offset from Selection ----
function getCursorOffset() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return chars.length;
  const range = sel.getRangeAt(0);
  // Walk text nodes to count offset
  const pre = document.createRange();
  pre.selectNodeContents(textArea);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

// ---- Set cursor at flat offset ----
function setCursorAt(offset) {
  const sel = window.getSelection();
  const range = document.createRange();

  let count = 0;
  let placed = false;

  function walkNode(node) {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent.length;
      if (count + len >= offset) {
        range.setStart(node, offset - count);
        range.collapse(true);
        placed = true;
      } else {
        count += len;
      }
    } else {
      for (const child of node.childNodes) walkNode(child);
    }
  }

  walkNode(textArea);

  if (!placed) {
    range.selectNodeContents(textArea);
    range.collapse(false);
  }

  sel.removeAllRanges();
  sel.addRange(range);
}

// ---- Initialise from saved state ----
window.noteAPI.onInit((data) => {
  noteId = data.id;
  chars = data.text || [];
  fallen = data.status === 'fallen';

  renderText();
  applyStickiness(data.stickiness);

  if (fallen) {
    applyFallenState(data.rotation);
  }
});

// ---- Key handling ----
textArea.addEventListener('keydown', (e) => {
  if (fallen) {
    e.preventDefault();
    return;
  }

  if (e.key === 'Backspace') {
    e.preventDefault();
    const cursorOffset = getCursorOffset();

    // Find last un-struck char before cursor
    let targetIdx = -1;
    for (let i = cursorOffset - 1; i >= 0; i--) {
      if (!chars[i].struck) {
        targetIdx = i;
        break;
      }
    }

    if (targetIdx >= 0) {
      chars[targetIdx].struck = true;
      renderText();
      setCursorAt(targetIdx);
      saveText();
    }
    return;
  }

  // Enter: insert a newline, always un-struck
  if (e.key === 'Enter') {
    e.preventDefault();
    const cursorOffset = getCursorOffset();
    chars.splice(cursorOffset, 0, { char: '\n', struck: false });
    renderText();
    setCursorAt(cursorOffset + 1);
    saveText();
    return;
  }

  // Printable characters: always insert as un-struck, bypassing contenteditable
  // so new text is NEVER contaminated by adjacent struck spans.
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    const cursorOffset = getCursorOffset();
    chars.splice(cursorOffset, 0, { char: e.key, struck: false });
    renderText();
    setCursorAt(cursorOffset + 1);
    saveText();
    return;
  }
});

// ---- Safety net: prevent ALL default contenteditable behaviour ----
// This catches paste, composition (IME), drag-drop text, and any edge case
// where keydown doesn't fire. Without this, the browser can insert characters
// directly inside a <span class="struck"> element.
textArea.addEventListener('beforeinput', (e) => {
  e.preventDefault();

  // Handle paste and insertText that didn't come through keydown
  if (e.inputType === 'insertText' || e.inputType === 'insertFromPaste' ||
      e.inputType === 'insertFromDrop') {
    const text = e.data || (e.dataTransfer ? e.dataTransfer.getData('text/plain') : '') || '';
    if (!text) return;
    const cursorOffset = getCursorOffset();
    for (let i = 0; i < text.length; i++) {
      chars.splice(cursorOffset + i, 0, { char: text[i], struck: false });
    }
    renderText();
    setCursorAt(cursorOffset + text.length);
    saveText();
  }
});

function saveText() {
  if (noteId) window.noteAPI.textChanged(noteId, chars);
}

// ---- Close button ----
closeBtn.addEventListener('click', () => {
  if (noteId) window.noteAPI.close(noteId);
});

// ---- Double-click to re-stick (fallen notes) ----
noteEl.addEventListener('dblclick', () => {
  if (fallen && noteId) {
    window.noteAPI.restick(noteId);
  }
});

// ---- Stickiness visuals ----
function applyStickiness(value) {
  noteEl.classList.remove('stickiness-high', 'stickiness-medium', 'stickiness-low', 'stickiness-critical');

  if (value > 75) {
    noteEl.classList.add('stickiness-high');
    noteEl.style.opacity = '0.92';
    peelCorner.style.width = '0px';
    peelCorner.style.height = '0px';
  } else if (value > 50) {
    noteEl.classList.add('stickiness-medium');
    noteEl.style.opacity = '0.88';
    const size = Math.round((75 - value) / 25 * 18);
    peelCorner.style.width = size + 'px';
    peelCorner.style.height = size + 'px';
  } else if (value > 25) {
    noteEl.classList.add('stickiness-low');
    noteEl.style.opacity = String(0.88 - ((50 - value) / 25) * 0.06);
    const size = Math.round(18 + (50 - value) / 25 * 24);
    peelCorner.style.width = size + 'px';
    peelCorner.style.height = size + 'px';
  } else {
    noteEl.classList.add('stickiness-critical');
    noteEl.style.opacity = String(0.82 - ((25 - value) / 25) * 0.07);
    const size = Math.round(42 + (25 - value) / 25 * 40);
    peelCorner.style.width = size + 'px';
    peelCorner.style.height = size + 'px';
  }
}

window.noteAPI.onStickinessUpdate(({ stickiness }) => {
  applyStickiness(stickiness);
});

// ---- Fall animation triggers ----
window.noteAPI.onFallStart(() => {
  noteEl.classList.add('crumpling');
});

window.noteAPI.onLanded(({ rotation, crumpleTransform }) => {
  noteEl.classList.remove('crumpling');
  applyFallenState(rotation, crumpleTransform);
});

function applyFallenState(rotation, crumpleTransform) {
  fallen = true;
  noteEl.classList.add('fallen', 'crumpled');
  noteEl.classList.remove('swaying');
  const ct = crumpleTransform || 'scale(0.24)';
  noteEl.style.transform = `rotate(${rotation}deg) ${ct}`;
  noteEl.style.borderRadius = '50%';
  noteEl.style.opacity = '0.78';
  textArea.contentEditable = 'false';
}

window.noteAPI.onResticked(() => {
  fallen = false;
  noteEl.classList.remove('fallen', 'crumpling', 'crumpled', 'stickiness-low', 'stickiness-critical', 'stickiness-medium', 'swaying');
  noteEl.classList.add('stickiness-high');
  noteEl.style.transform = '';
  noteEl.style.borderRadius = '';
  noteEl.style.opacity = '0.92';
  peelCorner.style.width = '0px';
  peelCorner.style.height = '0px';
  textArea.contentEditable = 'true';
});

// ---- Fan / Wind ----
let currentFanStatus = { active: false, intensity: 0 };

window.noteAPI.onFanStatus((status) => {
  currentFanStatus = status;
  updateSway();
});

// Sway is now handled by the main process moving the BrowserWindow position,
// so the note div never moves beyond its bounds. No CSS sway needed.
function updateSway() {
  // nothing to do in renderer — main process handles window position sway
}

// ---- Dev helpers (Ctrl+Shift+D to log state) ----
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'D') {
    console.log('[DEV] noteId:', noteId, 'chars:', chars, 'fallen:', fallen, 'fan:', currentFanStatus);
  }
});
