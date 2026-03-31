'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const STATE_FILE = path.join(app.getPath('userData'), 'sticky-notes-state.json');
const DEBOUNCE_MS = 1000;

class StateManager {
  constructor() {
    this._saveTimer = null;
  }

  load() {
    try {
      if (!fs.existsSync(STATE_FILE)) return null;
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  save(state) {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._write(state);
    }, DEBOUNCE_MS);
  }

  saveImmediate(state) {
    clearTimeout(this._saveTimer);
    this._write(state);
  }

  _write(state) {
    try {
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      console.error('[StateManager] Failed to write state:', err);
    }
  }
}

module.exports = StateManager;
