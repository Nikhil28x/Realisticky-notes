# Sticky Notes — Implementation Prompt

This document is the step-by-step build guide. Follow this order exactly. Each phase is self-contained and testable before moving to the next.

---

## Phase 1 — Bare Window + Note Appearance

**Goal:** Get a single yellow sticky note on screen that looks right.

### Steps

1. Init an Electron project (`npm init`, install `electron`).

2. In `main.js`, create a single `BrowserWindow` with these settings:
   - `width: 250, height: 250`
   - `frame: false` (no title bar)
   - `transparent: true` (for rounded corners and shadow)
   - `alwaysOnTop: true`
   - `resizable: false`
   - `hasShadow: true`
   - `webPreferences: { nodeIntegration: false, contextIsolation: true, preload: preload.js }`

3. Create `note.html` with a single div styled as the note:
   - Background: `#FDFD96` (Post-it yellow)
   - Opacity: `0.92`
   - Rounded corners: `3px` (sticky notes aren't very round)
   - A subtle `box-shadow` for depth
   - Size: fill the window (minus a bit of padding for the shadow to show)
   - A small `×` button in the top-right, hidden by default, visible on `.note:hover`

4. Bundle a handwriting font (Caveat from Google Fonts — download the TTF, put it in `assets/fonts/`, load it with `@font-face`).

5. Add `-webkit-app-region: drag` to the note body so the user can drag it anywhere. Add `-webkit-app-region: no-drag` to the text area so typing works.

**Test:** Run `npx electron .` → a yellow sticky note appears, stays on top of all windows, can be dragged around, close button works.

---

## Phase 2 — Text Input + Handwriting Feel

**Goal:** Type into the note and have it look handwritten.

### Steps

1. Inside the note div, add a `contenteditable="true"` div that fills the note area.

2. Style the editable area:
   - `font-family: 'Caveat', cursive`
   - `font-size: 22px`
   - `color: #2c2c2c` (dark grey, not pure black — ink on paper)
   - `line-height: 1.6`
   - `padding: 12px`
   - No outline/border on focus
   - `overflow-y: auto` with a custom scrollbar (thin, yellow-toned) or hidden

3. Add faint horizontal lines to the note (like ruled paper):
   - Use `background-image: repeating-linear-gradient(...)` with lines every ~35px
   - Lines should be very faint (`rgba(0,0,0,0.06)`)
   - Text baselines should roughly align with the lines

4. For the "handwritten" feel, add a slight CSS variation:
   - `letter-spacing: 0.5px`
   - The Caveat font already has natural variation, so no extra wobble is needed at this stage

**Test:** Click the note, type text → it looks like handwriting on a sticky note. Text wraps. Scrolls if overflow.

---

## Phase 3 — Strikethrough Backspace

**Goal:** Backspace crosses out characters instead of deleting them.

### Steps

1. Intercept the `keydown` event on the contenteditable div.

2. When `Backspace` is pressed:
   - `event.preventDefault()` — do NOT delete the character
   - Find the character immediately before the cursor
   - If it exists and is NOT already struck through:
     - Wrap it in a `<span class="struck">` tag
     - Move the cursor one position left
   - If it's already struck, skip to the previous non-struck character and strike that
   - If there are no characters left to strike, do nothing

3. Style `.struck`:
   - `text-decoration: line-through`
   - `text-decoration-style: wavy` (gives a hand-drawn feel)
   - `text-decoration-color: rgba(180, 40, 40, 0.7)` (reddish, like a pen crossing out)
   - `text-decoration-thickness: 2px`
   - `opacity: 0.6` (faded, since it's "deleted")

4. When the user types new characters after struck-through text, the new characters appear normal (no strikethrough).

5. Store text as a character array internally:
   ```js
   [
     { char: "H", struck: false },
     { char: "e", struck: true },
     { char: "l", struck: false }
   ]
   ```
   This is what gets saved to state.

**Test:** Type "Hello" → press Backspace twice → "Hel" is normal, "lo" has wavy red strikethrough. Type "p" → "Help" appears with "lo" still struck in the middle.

---

## Phase 4 — Multiple Notes (Up to 5)

**Goal:** Support creating, managing, and closing multiple notes.

### Steps

1. Add a system tray icon:
   - Use Electron's `Tray` class
   - Right-click menu: "New Note", "Quit"
   - "New Note" creates a new note window (if count < 5)
   - If count = 5, the menu item is greyed out

2. Each note gets a unique ID (`note-1` through `note-5` or UUIDs).

3. New notes spawn offset from the last one (+30px right, +30px down) so they don't stack perfectly.

4. The `×` button on each note closes that specific note:
   - Send `note:close` via IPC to main process
   - Main process destroys the BrowserWindow
   - Remove the note from state
   - Save state

5. Track all active notes in main process:
   ```js
   const notes = new Map(); // id → { window, data }
   ```

**Test:** Right-click tray → "New Note" five times → five notes appear, offset. Can't create a 6th. Close one → can create one more.

---

## Phase 5 — State Persistence

**Goal:** Save and restore everything across app restarts.

### Steps

1. Create `state-manager.js` in the main process:
   - State file: `path.join(app.getPath('userData'), 'state.json')`
   - `load()` — reads the file, returns parsed JSON (or default empty state if file doesn't exist)
   - `save(state)` — writes JSON to file (debounced, max once per second)

2. State shape:
   ```json
   {
     "notes": [
       {
         "id": "note-1",
         "x": 200,
         "y": 150,
         "text": [{ "char": "H", "struck": false }],
         "stickiness": 100,
         "status": "stuck",
         "rotation": 0,
         "createdAt": "2026-03-31T10:00:00Z"
       }
     ]
   }
   ```

3. Save triggers (all debounced):
   - Text changed (via IPC from renderer)
   - Note moved (via `move` event on BrowserWindow)
   - Note created or closed
   - Stickiness changed
   - Note fell

4. On app launch:
   - Load state
   - For each note in state: create a BrowserWindow at the saved `(x, y)` position
   - Send `state:restored` via IPC to each renderer with its text, stickiness, status
   - If status is `fallen`: place the note at `y = screenHeight - noteHeight`, apply saved rotation
   - If stickiness < 100%: apply the correct visual state (corner curl, opacity)

**Test:** Create 3 notes, type in them, move them around → kill the app (Ctrl+C in terminal) → restart → all 3 notes reappear in exact positions with exact text and strikethroughs.

---

## Phase 6 — Stickiness System

**Goal:** Track stickiness per note, apply move penalty, visual feedback.

### Steps

1. Create `stickiness.js` in the main process:
   - Each note has a `stickiness` value (0-100)
   - `applyMovePenalty(noteId)` — subtract 10%, trigger visual update, check for fall
   - `applyWindDecay(noteId)` — subtract 5%, trigger visual update, check for fall
   - `restick(noteId)` — reset to 100%, trigger visual update
   - `checkFall(noteId)` — if stickiness <= 0, trigger fall

2. Hook into BrowserWindow `move` event:
   - When a note window is moved by the user (drag ends), call `applyMovePenalty(noteId)`
   - Distinguish between user-initiated moves and programmatic moves (wind sway should NOT count as a move)

3. Send `stickiness:update` via IPC to the renderer whenever the value changes. The renderer updates visuals:
   - **100-76%:** Opacity 0.92, no curl, minimal shadow
   - **75-51%:** Opacity 0.88, top-right corner begins curling (CSS `transform: perspective(500px) rotateX(-2deg) rotateY(3deg)` on a pseudo-element)
   - **50-26%:** Opacity 0.82, bigger curl, note itself tilts slightly
   - **25-1%:** Opacity 0.75, big curl, note visibly lifting

4. The corner peel effect:
   - Add a `::after` pseudo-element on the note div
   - Position it at the top-right corner
   - Use `transform` + `clip-path` to create a triangle that "peels" away
   - The peel size grows as stickiness decreases
   - Behind the peel, show a slightly darker yellow (the underside of the note)

**Test:** Create a note → drag it 5 times → stickiness should be at 50%, note corner is visibly peeling, opacity reduced. Drag 5 more times → stickiness hits 0%.

---

## Phase 7 — Fall Animation

**Goal:** When stickiness hits 0%, the note peels off and falls to the bottom of the screen.

### Steps

1. When `checkFall` triggers:
   - Send `stickiness:fall` to the renderer
   - The renderer plays the peel animation (corner curl grows to full note, ~300ms)
   - Then the main process animates the BrowserWindow position:

2. Fall animation (in main process):
   ```js
   function animateFall(noteWindow, targetY) {
     const startY = noteWindow.getPosition()[1];
     const startTime = Date.now();
     const duration = 800; // ms

     function step() {
       const elapsed = Date.now() - startTime;
       const progress = Math.min(elapsed / duration, 1);
       // Ease-in curve (accelerating, like gravity)
       const eased = progress * progress;
       const currentY = startY + (targetY - startY) * eased;

       // Add slight horizontal drift
       const drift = Math.sin(progress * Math.PI * 2) * 15;
       const [startX] = noteWindow.getPosition();

       noteWindow.setPosition(
         Math.round(startX + drift),
         Math.round(currentY)
       );

       if (progress < 1) {
         setTimeout(step, 16); // ~60fps
       } else {
         // Landing — set final position, apply random rotation
         onLanded(noteWindow);
       }
     }
     step();
   }
   ```

3. Target Y = bottom of the screen the note is currently on:
   - Use `screen.getDisplayMatching(noteWindow.getBounds())` to find the correct monitor
   - Target Y = display workArea bottom - note height

4. On landing:
   - Set note status to `fallen`
   - Apply a random rotation (±5-15 degrees) via IPC to renderer
   - Disable `alwaysOnTop` (fallen notes go behind stuck notes)
   - Note becomes non-draggable (remove `-webkit-app-region: drag`)
   - Save state

5. Re-stick on double-click:
   - Renderer listens for `dblclick` on a fallen note
   - Sends `note:restick` to main
   - Main resets stickiness to 100%, re-enables alwaysOnTop, re-enables drag
   - Moves note to a sensible default position (center of the screen or where it originally was)
   - Renderer removes rotation, resets opacity and curl

**Test:** Drag a note 10 times → it peels and falls smoothly to the bottom → lands at an angle → double-click it → it pops back up, fully sticky.

---

## Phase 8 — Fan Detection + Wind Mode

**Goal:** Detect the system fan and make notes sway when it's running.

### Steps

1. Install `systeminformation`:
   ```
   npm install systeminformation
   ```

2. Create `fan-monitor.js` in the main process:
   ```js
   const si = require('systeminformation');

   let fanActive = false;
   let intensity = 0; // 0-1

   async function pollFan() {
     try {
       const data = await si.cpuTemperature();
       // If temp > 55°C, consider fan as active
       // (most fans spin up around 50-60°C)
       const temp = data.main || 0;

       if (temp > 55) {
         fanActive = true;
         // Map temp 55-90 to intensity 0.2-1.0
         intensity = Math.min(1, Math.max(0.2, (temp - 55) / 35));
       } else {
         fanActive = false;
         intensity = 0;
       }
     } catch (e) {
       // Fallback: try fan speed directly
       // Some systems report fan RPM instead
       fanActive = false;
       intensity = 0;
     }
   }

   setInterval(pollFan, 5000); // Poll every 5 seconds
   ```

3. When `fanActive` changes, send `fan:status` to ALL note renderers:
   ```js
   { active: true, intensity: 0.6 }
   ```

4. In the renderer, `wind.js` handles the animation:
   - When wind is active, start a CSS animation on the note:
     ```css
     @keyframes sway {
       0% { transform: translateX(0px) rotate(0deg); }
       25% { transform: translateX(var(--sway-x)) rotate(var(--sway-r)); }
       50% { transform: translateX(0px) rotate(0deg); }
       75% { transform: translateX(calc(-1 * var(--sway-x))) rotate(calc(-1 * var(--sway-r))); }
       100% { transform: translateX(0px) rotate(0deg); }
     }
     ```
   - `--sway-x` and `--sway-r` are set based on intensity AND current stickiness:
     - High stickiness + low intensity: `--sway-x: 2px`, `--sway-r: 0.5deg`
     - Low stickiness + high intensity: `--sway-x: 15px`, `--sway-r: 4deg`
   - Animation duration: `3s` at low intensity, `1.2s` at high intensity

5. While fan is active, run a 30-second interval in `stickiness.js`:
   ```js
   let windDecayInterval = null;

   function startWindDecay() {
     windDecayInterval = setInterval(() => {
       for (const [id, note] of notes) {
         if (note.data.status === 'stuck') {
           applyWindDecay(id); // -5%
         }
       }
     }, 30000);
   }

   function stopWindDecay() {
     clearInterval(windDecayInterval);
     windDecayInterval = null;
   }
   ```

6. When fan stops: stop the decay interval, send `fan:status { active: false }` to renderers, sway animation stops.

**Test:** Run a CPU stress tool (or lower the temp threshold for testing) → notes start swaying → stickiness drops every 30 seconds → corner starts peeling → eventually falls. Stop the stress tool → notes stop swaying, stickiness freezes.

---

## Phase 9 — Polish + Edge Cases

**Goal:** Handle all the weird stuff.

### Steps

1. **Screen/display changes:**
   - Listen to `screen` module's `display-added`, `display-removed`, `display-metrics-changed`
   - Recalculate fallen note positions (move to bottom of current display)
   - Bounds-check stuck notes (if a monitor was disconnected, move note to primary display)

2. **Multiple monitors:**
   - Fall animation targets the bottom of the monitor the note is on, not the primary monitor
   - Use `screen.getDisplayMatching(window.getBounds())` to determine which monitor

3. **Graceful shutdown:**
   - Listen to `app.on('before-quit')` and `app.on('window-all-closed')`
   - Force a final state save (bypass debounce)
   - Ensure the write completes before exit

4. **Note z-order:**
   - Stuck notes: `alwaysOnTop: true`
   - Fallen notes: `alwaysOnTop: false`
   - Clicking a stuck note brings it to front (handled by Electron automatically)

5. **Prevent fall during drag:**
   - While a note is being dragged (between `will-move` and `moved` events), pause wind decay for that note
   - If stickiness hits 0% during a drag, wait until the drag ends to trigger fall

6. **Initial launch with no state:**
   - If `state.json` doesn't exist, show one blank note at center of primary screen
   - Set tray icon as the primary entry point

7. **Dev-mode helpers (remove before ship):**
   - Keyboard shortcut in renderer: `Ctrl+Shift+D` → log current stickiness, fan status
   - Lower temp threshold to 40°C for testing without a stress tool
   - `Ctrl+Shift+F` → force wind mode on (for UI testing)

---

## Build & Run

```bash
# Install
npm install

# Dev
npx electron .

# Package (using electron-builder)
npm install --save-dev electron-builder
npx electron-builder --mac --win --linux
```

---

## Summary of Constants

```js
const CONSTANTS = {
  MAX_NOTES: 5,
  NOTE_WIDTH: 250,
  NOTE_HEIGHT: 250,
  INITIAL_STICKINESS: 100,
  MOVE_PENALTY: 10,           // % per drag
  WIND_DECAY: 5,              // % per 30 seconds
  WIND_DECAY_INTERVAL: 30000, // ms
  FAN_POLL_INTERVAL: 5000,    // ms
  FAN_TEMP_THRESHOLD: 55,     // °C — fan considered active above this
  FALL_DURATION: 800,         // ms
  FALL_ROTATION_MIN: 5,       // degrees
  FALL_ROTATION_MAX: 15,      // degrees
  NOTE_OPACITY_BASE: 0.92,
  NOTE_OPACITY_MIN: 0.75,
  STATE_SAVE_DEBOUNCE: 1000,  // ms
  NOTE_OFFSET_X: 30,          // px offset for new notes
  NOTE_OFFSET_Y: 30,
};
```

---
