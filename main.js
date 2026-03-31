'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const StateManager = require('./src/state-manager');
const StickinessManager = require('./src/stickiness');
const FanMonitor = require('./src/fan-monitor');

const CONSTANTS = {
  MAX_NOTES: 5,
  NOTE_WIDTH: 250,
  NOTE_HEIGHT: 250,
  INITIAL_STICKINESS: 100,
  MOVE_PENALTY: 10,
  WIND_DECAY: 5,
  WIND_DECAY_INTERVAL: 30000,
  FAN_POLL_INTERVAL: 5000,
  FAN_TEMP_THRESHOLD: 55,
  FALL_DURATION: 800,
  FALL_ROTATION_MIN: 5,
  FALL_ROTATION_MAX: 15,
  NOTE_OPACITY_BASE: 0.92,
  NOTE_OPACITY_MIN: 0.75,
  STATE_SAVE_DEBOUNCE: 1000,
  NOTE_OFFSET_X: 30,
  NOTE_OFFSET_Y: 30,
};

// Map: id -> { window: BrowserWindow, data: NoteData }
const notes = new Map();

let tray = null;
let stateManager = null;
let stickinessManager = null;
let fanMonitor = null;
let nextOffsetIndex = 0;

// -------------------------------------------------------------------
// Window creation
// -------------------------------------------------------------------

function createNoteWindow(noteData) {
  const win = new BrowserWindow({
    width: CONSTANTS.NOTE_WIDTH,
    height: CONSTANTS.NOTE_HEIGHT,
    x: noteData.x,
    y: noteData.y,
    frame: false,
    transparent: true,
    alwaysOnTop: noteData.status !== 'fallen',
    resizable: false,
    hasShadow: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('note.html');

  win.once('ready-to-show', () => {
    win.webContents.send('note:init', {
      id: noteData.id,
      text: noteData.text,
      stickiness: noteData.stickiness,
      status: noteData.status,
      rotation: noteData.rotation,
    });
  });

  // Track moves — apply penalty only for user-initiated drags
  let moveTimer = null;
  let programmaticMove = false;

  win.on('will-move', () => {
    clearTimeout(moveTimer);
  });

  win.on('moved', () => {
    if (programmaticMove) return;
    // Debounce: if user moves quickly, only penalise once per settle
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const [x, y] = win.getPosition();
      noteData.x = x;
      noteData.y = y;
      stickinessManager.applyMovePenalty(noteData.id);
      stateManager.save(buildState());
    }, 150);
  });

  win._programmaticMove = (fn) => {
    programmaticMove = true;
    fn();
    // Give Electron a tick to fire the move event before resetting
    setTimeout(() => { programmaticMove = false; }, 200);
  };

  notes.set(noteData.id, { window: win, data: noteData });
  updateTrayMenu();

  return win;
}

function buildNoteData(overrides = {}) {
  const primary = screen.getPrimaryDisplay();
  const { workArea } = primary;
  const baseX = Math.round(workArea.x + workArea.width / 2 - CONSTANTS.NOTE_WIDTH / 2);
  const baseY = Math.round(workArea.y + workArea.height / 2 - CONSTANTS.NOTE_HEIGHT / 2);
  const offset = nextOffsetIndex * CONSTANTS.NOTE_OFFSET_X;
  nextOffsetIndex = (nextOffsetIndex + 1) % 8;

  return {
    id: `note-${Date.now()}`,
    x: baseX + offset,
    y: baseY + offset,
    text: [],
    stickiness: CONSTANTS.INITIAL_STICKINESS,
    status: 'stuck',
    rotation: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// -------------------------------------------------------------------
// Fall animation (runs in main process, moves BrowserWindow)
// -------------------------------------------------------------------

function animateFall(noteEntry) {
  const { window: win, data } = noteEntry;

  // Stop sway for this note
  stopSway(data.id);

  const display = screen.getDisplayMatching(win.getBounds());
  const targetY = display.workArea.y + display.workArea.height - CONSTANTS.NOTE_HEIGHT;
  const startPos = win.getPosition();
  const startX = startPos[0];
  const startY = startPos[1];
  const totalDist = targetY - startY;
  if (totalDist <= 0) { onFallComplete(); return; }

  const GRAVITY = 380;
  const AIR_RESISTANCE = 2.0;
  const MAX_VEL = 300;
  const DRIFT_AMP = 20;
  const DRIFT_FREQ = 1.5;

  const phaseH = Math.random() * Math.PI * 2;
  const driftDir = Math.random() < 0.5 ? 1 : -1;

  const finalRotation =
    (CONSTANTS.FALL_ROTATION_MIN +
      Math.random() * (CONSTANTS.FALL_ROTATION_MAX - CONSTANTS.FALL_ROTATION_MIN)) *
    (Math.random() < 0.5 ? 1 : -1);

  let velocity = 0;
  let currentY = startY;
  let lastTime = performance.now();
  let bounced = false;

  // Start crumple CSS in renderer, then begin physics after ball forms
  win.webContents.send('note:fall-start');

  setTimeout(() => {
    function step(now) {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      velocity += GRAVITY * dt;
      velocity = Math.min(velocity, MAX_VEL);
      velocity *= (1 - AIR_RESISTANCE * dt * 0.08);
      currentY += velocity * dt;

      const progress = Math.min((currentY - startY) / totalDist, 1);

      // Gentle horizontal drift
      const driftEnvelope = Math.sin(progress * Math.PI);
      const hDrift = Math.round(
        DRIFT_AMP * driftEnvelope * Math.sin(DRIFT_FREQ * (now / 1000) * Math.PI * 2 + phaseH)
        + driftDir * progress * 8
      );

      const drawY = Math.round(Math.min(currentY, targetY));
      win._programmaticMove(() => {
        if (!win.isDestroyed()) win.setPosition(startX + hDrift, drawY);
      });

      if (currentY < targetY) {
        setTimeout(() => step(performance.now()), 16);
      } else if (!bounced) {
        bounced = true;
        velocity = -(velocity * 0.15);
        currentY = targetY;
        setTimeout(() => step(performance.now()), 16);
      } else if (Math.abs(velocity) > 3) {
        velocity *= 0.4;
        setTimeout(() => step(performance.now()), 16);
      } else {
        onFallComplete();
      }
    }
    step(performance.now());
  }, 700); // wait for crumple-to-ball animation before dropping

  function onFallComplete() {
    win._programmaticMove(() => {
      if (!win.isDestroyed()) win.setPosition(startX, targetY);
    });
    data.x = startX;
    data.y = targetY;
    data.status = 'fallen';
    data.rotation = finalRotation;
    if (!win.isDestroyed()) {
      win.setAlwaysOnTop(false);
      win.webContents.send('note:landed', {
        rotation: finalRotation,
        crumpleTransform: 'scale(0.24)',
      });
    }
    stateManager.save(buildState());
  }
}

// -------------------------------------------------------------------
// Sway system — moves BrowserWindow position, not CSS transforms
// -------------------------------------------------------------------
const swayTimers = new Map(); // noteId -> intervalId

function startSwayForNote(noteId, intensity, stickiness) {
  if (swayTimers.has(noteId)) return; // already swaying

  const entry = notes.get(noteId);
  if (!entry || entry.data.status !== 'stuck') return;

  const basePos = entry.window.getPosition();
  const anchorX = basePos[0];
  const anchorY = basePos[1];

  // Scale amplitude by intensity and inverse stickiness
  const stickinessScale = Math.max(0.3, 1 - (stickiness / 120));
  const ampX = Math.round(2 + intensity * stickinessScale * 6); // max ~8px
  const period = 2500 - intensity * 1200; // 2500ms at low, 1300ms at high
  const startTime = Date.now();

  // Use a smooth perlin-like multi-frequency oscillation
  const phase1 = Math.random() * Math.PI * 2;
  const phase2 = Math.random() * Math.PI * 2;

  const timer = setInterval(() => {
    const e = notes.get(noteId);
    if (!e || e.window.isDestroyed() || e.data.status !== 'stuck') {
      stopSway(noteId);
      return;
    }

    const t = (Date.now() - startTime) / period;
    // Combine two sine waves at different frequencies for organic motion
    const dx = Math.round(
      ampX * 0.7 * Math.sin(t * Math.PI * 2 + phase1) +
      ampX * 0.3 * Math.sin(t * Math.PI * 2 * 2.3 + phase2)
    );
    const dy = Math.round(ampX * 0.15 * Math.sin(t * Math.PI * 2 * 0.7 + phase2));

    e.window._programmaticMove(() => {
      if (!e.window.isDestroyed()) {
        e.window.setPosition(anchorX + dx, anchorY + dy);
      }
    });
  }, 50); // 20fps — smooth enough, low overhead

  swayTimers.set(noteId, timer);
}

function stopSway(noteId) {
  const timer = swayTimers.get(noteId);
  if (timer) {
    clearInterval(timer);
    swayTimers.delete(noteId);
  }
}

function stopAllSway() {
  for (const [id] of swayTimers) stopSway(id);
}

function updateAllSway(fanStatus) {
  if (!fanStatus.active) {
    stopAllSway();
    return;
  }
  for (const [id, entry] of notes) {
    if (entry.data.status === 'stuck') {
      startSwayForNote(id, fanStatus.intensity, entry.data.stickiness);
    }
  }
}

// -------------------------------------------------------------------
// State helpers
// -------------------------------------------------------------------

function buildState() {
  const allNotes = [];
  for (const [, entry] of notes) {
    const [x, y] = entry.window.isDestroyed() ? [entry.data.x, entry.data.y] : entry.window.getPosition();
    allNotes.push({ ...entry.data, x, y });
  }
  return { notes: allNotes };
}

// -------------------------------------------------------------------
// IPC handlers
// -------------------------------------------------------------------

ipcMain.on('note:text-changed', (event, { id, text }) => {
  const entry = notes.get(id);
  if (!entry) return;
  entry.data.text = text;
  stateManager.save(buildState());
});

ipcMain.on('note:close', (event, { id }) => {
  const entry = notes.get(id);
  if (!entry) return;
  stopSway(id);
  if (!entry.window.isDestroyed()) entry.window.close();
  notes.delete(id);
  stateManager.save(buildState());
  updateTrayMenu();
});

ipcMain.on('note:restick', (event, { id }) => {
  const entry = notes.get(id);
  if (!entry) return;
  stickinessManager.restick(id);
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const x = Math.round(workArea.x + workArea.width / 2 - CONSTANTS.NOTE_WIDTH / 2);
  const y = Math.round(workArea.y + 100);
  entry.window._programmaticMove(() => {
    entry.window.setPosition(x, y);
  });
  entry.data.x = x;
  entry.data.y = y;
  entry.data.status = 'stuck';
  entry.data.rotation = 0;
  entry.window.setAlwaysOnTop(true);
  entry.window.webContents.send('note:resticked');
  stateManager.save(buildState());
});

// -------------------------------------------------------------------
// Tray
// -------------------------------------------------------------------

function updateTrayMenu() {
  if (!tray) return;
  const count = notes.size;
  const canCreate = count < CONSTANTS.MAX_NOTES;
  const menu = Menu.buildFromTemplate([
    {
      label: `New Note${canCreate ? '' : ' (max reached)'}`,
      enabled: canCreate,
      click: () => {
        const data = buildNoteData();
        createNoteWindow(data);
        stateManager.save(buildState());
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// -------------------------------------------------------------------
// App lifecycle
// -------------------------------------------------------------------

app.whenReady().then(() => {
  stateManager = new StateManager();
  stickinessManager = new StickinessManager(notes, CONSTANTS, (id) => {
    const entry = notes.get(id);
    if (entry && !entry.window.isDestroyed()) {
      animateFall(entry);
    }
  });

  // Tray icon — use a plain coloured icon generated from data URI
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) trayIcon = nativeImage.createEmpty();
  } catch {
    trayIcon = nativeImage.createEmpty();
  }
  tray = new Tray(trayIcon);
  tray.setToolTip('Sticky Notes');
  updateTrayMenu();

  // Load persisted state or create a default note
  const savedState = stateManager.load();
  if (savedState && savedState.notes && savedState.notes.length > 0) {
    for (const noteData of savedState.notes) {
      createNoteWindow(noteData);
    }
  } else {
    const data = buildNoteData();
    createNoteWindow(data);
    stateManager.save(buildState());
  }

  // Fan monitor
  fanMonitor = new FanMonitor(CONSTANTS, (status) => {
    // Broadcast fan status to all renderers (for stickiness visual updates)
    for (const [, entry] of notes) {
      if (!entry.window.isDestroyed()) {
        entry.window.webContents.send('fan:status', status);
      }
    }
    // Wind decay for stickiness
    if (status.active) {
      stickinessManager.startWindDecay();
    } else {
      stickinessManager.stopWindDecay();
    }
    // Sway via window position (not CSS)
    updateAllSway(status);
  });

  // Listen for screen changes
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-added', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);

  app.on('activate', () => {
    // macOS: re-show if all windows hidden
  });
});

function handleDisplayChange() {
  const displays = screen.getAllDisplays();
  for (const [, entry] of notes) {
    if (entry.window.isDestroyed()) continue;
    const bounds = entry.window.getBounds();
    const inAny = displays.some((d) =>
      bounds.x >= d.bounds.x &&
      bounds.y >= d.bounds.y &&
      bounds.x < d.bounds.x + d.bounds.width &&
      bounds.y < d.bounds.y + d.bounds.height
    );
    if (!inAny) {
      const primary = screen.getPrimaryDisplay();
      entry.window._programmaticMove(() => {
        entry.window.setPosition(
          Math.round(primary.workArea.x + 50),
          Math.round(primary.workArea.y + 50)
        );
      });
    }
    if (entry.data.status === 'fallen') {
      const display = screen.getDisplayMatching(entry.window.getBounds());
      const targetY = display.workArea.y + display.workArea.height - CONSTANTS.NOTE_HEIGHT;
      entry.window._programmaticMove(() => {
        entry.window.setPosition(entry.window.getPosition()[0], targetY);
      });
    }
  }
}

app.on('before-quit', () => {
  stopAllSway();
  if (stateManager) stateManager.saveImmediate(buildState());
});

app.on('window-all-closed', () => {
  // Do not quit when all windows are closed on macOS — tray keeps app alive
  if (process.platform !== 'darwin') app.quit();
});
