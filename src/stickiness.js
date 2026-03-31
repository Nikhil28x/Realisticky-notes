'use strict';

/**
 * Manages stickiness values for all notes.
 * Communicates back to main.js via callbacks (no direct IPC here).
 */
class StickinessManager {
  /**
   * @param {Map} notes - The global notes Map (id -> { window, data })
   * @param {object} CONSTANTS
   * @param {function} onFall - Called with (noteId) when stickiness hits 0
   */
  constructor(notes, CONSTANTS, onFall) {
    this._notes = notes;
    this._C = CONSTANTS;
    this._onFall = onFall;
    this._windDecayInterval = null;
  }

  applyMovePenalty(id) {
    const entry = this._notes.get(id);
    if (!entry || entry.data.status !== 'stuck') return;
    entry.data.stickiness = Math.max(0, entry.data.stickiness - this._C.MOVE_PENALTY);
    this._broadcast(entry);
    this._checkFall(id);
  }

  applyWindDecay(id) {
    const entry = this._notes.get(id);
    if (!entry || entry.data.status !== 'stuck') return;
    entry.data.stickiness = Math.max(0, entry.data.stickiness - this._C.WIND_DECAY);
    this._broadcast(entry);
    this._checkFall(id);
  }

  restick(id) {
    const entry = this._notes.get(id);
    if (!entry) return;
    entry.data.stickiness = this._C.INITIAL_STICKINESS;
    entry.data.status = 'stuck';
    this._broadcast(entry);
  }

  startWindDecay() {
    if (this._windDecayInterval) return;
    this._windDecayInterval = setInterval(() => {
      for (const [id, entry] of this._notes) {
        if (entry.data.status === 'stuck') {
          this.applyWindDecay(id);
        }
      }
    }, this._C.WIND_DECAY_INTERVAL);
  }

  stopWindDecay() {
    if (this._windDecayInterval) {
      clearInterval(this._windDecayInterval);
      this._windDecayInterval = null;
    }
  }

  _broadcast(entry) {
    if (!entry.window.isDestroyed()) {
      entry.window.webContents.send('stickiness:update', {
        stickiness: entry.data.stickiness,
      });
    }
  }

  _checkFall(id) {
    const entry = this._notes.get(id);
    if (!entry) return;
    if (entry.data.stickiness <= 0 && entry.data.status === 'stuck') {
      entry.data.status = 'falling';
      this._onFall(id);
    }
  }
}

module.exports = StickinessManager;
