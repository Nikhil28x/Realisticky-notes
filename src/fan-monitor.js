'use strict';

const si = require('systeminformation');
const { exec } = require('child_process');

// CPU load threshold (%) above which we consider the fan active.
// Most Mac fans start spinning around 20-30% sustained load.
const LOAD_THRESHOLD = 15;

class FanMonitor {
  /**
   * @param {object} CONSTANTS
   * @param {function} onStatusChange - Called with { active: bool, intensity: 0-1 }
   */
  constructor(CONSTANTS, onStatusChange) {
    this._C = CONSTANTS;
    this._cb = onStatusChange;
    this._lastActive = null;
    this._lastIntensity = 0;
    this._poll();
    this._interval = setInterval(() => this._poll(), this._C.FAN_POLL_INTERVAL);
  }

  async _poll() {
    try {
      let active = false;
      let intensity = 0;
      let detected = false;

      // Strategy 1: CPU temperature (works on Linux / some Intel Macs)
      try {
        const cpuTemp = await si.cpuTemperature();
        if (cpuTemp && typeof cpuTemp.main === 'number' && cpuTemp.main > 0) {
          const threshold = this._C.FAN_TEMP_THRESHOLD;
          if (cpuTemp.main > threshold) {
            active = true;
            intensity = Math.min(1, Math.max(0.2, (cpuTemp.main - threshold) / 35));
            detected = true;
          }
        }
      } catch { /* unavailable */ }

      // Strategy 2: macOS fan RPM via SMC (best-effort, no sudo)
      if (!detected && process.platform === 'darwin') {
        try {
          const rpm = await this._readMacFanRPM();
          if (rpm > 0) {
            // Idle fans ~1200 RPM on Intel Macs, ~0/1800 on Apple Silicon
            const idleRPM = 1200;
            if (rpm > idleRPM) {
              active = true;
              intensity = Math.min(1, Math.max(0.2, (rpm - idleRPM) / 4000));
              detected = true;
            }
          }
        } catch { /* unavailable */ }
      }

      // Strategy 3: CPU load as proxy (universal fallback)
      if (!detected) {
        const load = await si.currentLoad();
        const cpuLoad = load.currentLoad || 0;

        if (cpuLoad > LOAD_THRESHOLD) {
          active = true;
          // Map load 15-100% → intensity 0.15-1.0
          intensity = Math.min(1, Math.max(0.15, (cpuLoad - LOAD_THRESHOLD) / 85));
          detected = true;
        }
      }

      const status = { active, intensity };

      if (
        this._lastActive === null ||
        this._lastActive !== active ||
        Math.abs(intensity - this._lastIntensity) > 0.08
      ) {
        this._lastActive = active;
        this._lastIntensity = intensity;
        this._cb(status);
      }
    } catch (err) {
      if (this._lastActive !== false) {
        this._lastActive = false;
        this._cb({ active: false, intensity: 0 });
      }
    }
  }

  _readMacFanRPM() {
    return new Promise((resolve) => {
      exec('ioreg -r -k "FanCurrentSpeed" 2>/dev/null | grep "FanCurrentSpeed" | head -1', { timeout: 3000 }, (err, stdout) => {
        if (err || !stdout) return resolve(0);
        const match = stdout.match(/=\s*(\d+)/);
        resolve(match ? parseInt(match[1], 10) : 0);
      });
    });
  }

  destroy() {
    clearInterval(this._interval);
  }
}

module.exports = FanMonitor;
