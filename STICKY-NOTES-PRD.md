# PRD — Sticky Notes Desktop App

**Version:** 1.0
**Date:** March 31, 2026
**Status:** Planning

---

## 1. What Is This

A desktop sticky note app built with Electron. The notes look and behave like real physical sticky notes — yellow, slightly transparent, handwritten text, and most importantly, they obey physics. They respond to your computer's fan, lose stickiness over time, and eventually fall to the bottom of the screen like a real sticky note would peel off a monitor.

---

## 2. Core Concepts

### The Sticky Note
Each note is its own Electron `BrowserWindow` — frameless, always-on-top, draggable, slightly transparent. It looks like a yellow Post-it. The text inside renders in a handwriting font. Maximum 5 notes can exist at once.

### Stickiness
Every note has a stickiness value from 100% (freshly stuck) to 0% (fallen). Stickiness decreases from two things: the system fan running (heat = wind = the note flutters and peels), and the user moving the note (every re-stick weakens the adhesive). When stickiness hits 0%, the note animates falling to the bottom of the screen and lays there.

### State Persistence
If you close the app (kill the terminal), everything is saved — positions, text, stickiness levels, fallen/stuck status. When you reopen, every note comes back exactly where it was.

---

## 3. Features

### 3.1 — Sticky Note Basics

**Create a note:** User can create up to 5 sticky notes. Each one spawns as a new draggable window at a default position (slightly offset from the last one so they don't stack exactly).

**Appearance:**
- Classic yellow background (`#FDFD96` or similar Post-it yellow)
- Slight transparency (opacity ~0.92) so you can faintly see what's behind it
- No window frame, no title bar — just the note
- Subtle drop shadow to look like it's sitting on the desktop
- A small close button (×) in the top-right corner, only visible on hover
- A small "new note" button on the first note or a system tray icon

**Text input:**
- Click anywhere on the note to start typing
- Text renders in a handwriting-style font (e.g., Caveat, Patrick Hand, or Indie Flower from Google Fonts — bundled with the app, not loaded from web)
- Slight random baseline wobble per line to make it look more natural
- Text wraps within the note's bounds
- No formatting controls — just type

### 3.2 — Strikethrough Backspace

When the user presses Backspace:
- The character is NOT deleted
- Instead, a strikethrough line is drawn through it (like crossing out with a pen)
- The strikethrough should look hand-drawn — slightly wavy, not a perfect CSS line
- Multiple backspaces strike through multiple characters moving left
- The struck-through text stays visible (just crossed out)
- There is no way to actually delete text — once written, it's permanent (like ink on paper)

**Edge cases:**
- If the user backspaces past all text, nothing happens (can't strike through nothing)
- Struck-through characters cannot be struck through again
- New text typed after struck-through text appears normally (not struck)

### 3.3 — Fan Detection + Wind Physics

**How it works:**
- The app monitors system fan speed / CPU temperature in the background
- When the fan is actively spinning above idle (threshold TBD per OS), the note enters "wind mode"

**Wind behaviour:**
- The sticky note window starts subtly swaying/oscillating — like paper fluttering in a breeze
- Movement is gentle: ±3-8px horizontal oscillation, slight rotation (±1-2 degrees via CSS transform), with easing so it looks organic
- Higher fan speed = more aggressive flutter (wider oscillation, faster frequency)

**Stickiness decay in wind:**
- While the fan is running above threshold, stickiness drops by **5% every 30 seconds**
- At 100% → note is rock solid, barely moves
- At 50% → note sways more, one corner starts "peeling" visually (slight curl on the top edge)
- At 25% → heavy swaying, the note is clearly about to fall
- At 0% → the note falls

**Visual stickiness feedback:**
- A subtle indicator (e.g., the top edge of the note) shows how stuck it is
- As stickiness decreases, the top-right corner of the note curls away from the "wall" (CSS perspective transform)
- The transparency increases slightly as stickiness drops (note becomes more ghostly)

### 3.4 — Move Penalty

Every time the user drags the note to a new position:
- Stickiness drops by **10%**
- A brief "peel and re-stick" animation plays (note lifts slightly, moves, then presses back down)
- After **10 moves** from full stickiness, the note falls (10 × 10% = 100% lost)

**Interaction with fan decay:**
- Move penalty and fan decay stack. If a note is at 60% from fan decay and the user moves it, it drops to 50%.
- Both sources of decay feed into the same stickiness value.

### 3.5 — The Fall Animation

When stickiness reaches 0%:

1. The note "peels" off — the top detaches with a slight curl animation
2. The note tumbles/rotates slightly as it falls (not a straight drop — it should look like paper falling)
3. It lands at the bottom of the screen (y position = screen height minus note height)
4. It lands with a slight "bounce" and settles at a random slight angle (±5-15 degrees rotation)
5. Once fallen, the note stays at the bottom — the user can still read it but it's clearly "fallen"
6. A fallen note can be "re-stuck" by double-clicking it — this puts it back to 100% stickiness and moves it to a default position (or the user can drag it immediately)

### 3.6 — State Persistence

**What is saved (to a local JSON file):**
```json
{
  "notes": [
    {
      "id": "note-1",
      "x": 200,
      "y": 150,
      "width": 250,
      "height": 250,
      "text": [
        { "char": "H", "struck": false },
        { "char": "e", "struck": true },
        { "char": "l", "struck": false }
      ],
      "stickiness": 72,
      "status": "stuck",
      "rotation": 0,
      "createdAt": "2026-03-31T10:00:00Z"
    }
  ]
}
```

**When state is saved:**
- On every change (text typed, note moved, stickiness change, note created/closed)
- Debounced to avoid excessive writes (save at most once per second)

**When state is restored:**
- On app launch, read the JSON file
- Recreate each note's BrowserWindow at its saved position
- Restore text with strikethroughs intact
- Restore stickiness level and visual state (corner curl, transparency)
- Fallen notes appear at the bottom in their fallen rotation
- Stuck notes appear exactly where they were

**File location:** `~/.sticky-notes/state.json` (or use Electron's `app.getPath('userData')`)

---

## 4. Technical Architecture

```
┌─────────────────────────────────────────────────┐
│                 MAIN PROCESS                     │
│               (Electron main)                    │
│                                                  │
│  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ Window Mgr   │  │ Fan Monitor              │ │
│  │ - create     │  │ - polls CPU temp/fan RPM  │ │
│  │ - position   │  │ - emits fan_status event  │ │
│  │ - fall anim  │  │ - OS-specific backends    │ │
│  └──────┬───────┘  └────────────┬─────────────┘ │
│         │                       │                │
│  ┌──────┴───────────────────────┴─────────────┐ │
│  │ State Manager                               │ │
│  │ - load/save JSON                            │ │
│  │ - stickiness tracking                       │ │
│  │ - debounced persistence                     │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────┘
                       │ IPC (ipcMain ↔ ipcRenderer)
                       │
┌──────────────────────┴──────────────────────────┐
│              RENDERER PROCESS                    │
│          (one per sticky note window)            │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │ Note UI                                     │ │
│  │ - Handwriting text renderer (canvas/DOM)    │ │
│  │ - Strikethrough logic                       │ │
│  │ - Wind sway animation (CSS transforms)      │ │
│  │ - Corner peel effect (CSS perspective)      │ │
│  │ - Drag handling (sends move events to main) │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### Key Technical Decisions

**Each note = its own BrowserWindow**
- Frameless, transparent background, always-on-top
- `alwaysOnTop: true`, `frame: false`, `transparent: true`
- This lets notes exist independently on the desktop, be dragged anywhere, and animate independently

**Text rendering: HTML + CSS (not Canvas)**
- Use a `contenteditable` div with the handwriting font
- Intercept `keydown` for Backspace to add strikethrough spans instead of deleting
- Strikethrough rendered as an SVG line overlaid on the character (slightly wavy path)
- Simpler than Canvas and still looks great

**Fan detection: OS-specific**
- **macOS:** Use `powermetrics` or `iStats` (via child_process) or read from IOKit
- **Windows:** Use `wmic` or `Open Hardware Monitor` WMI queries, or the `systeminformation` npm package
- **Linux:** Read from `/sys/class/hwmon/` or `sensors` command
- **Fallback:** Use `systeminformation` npm package — it works cross-platform and exposes `cpuTemperature()` and `system().fan` data
- Poll every 5 seconds. If fan RPM > idle threshold → wind mode on

**Wind animation:**
- CSS `@keyframes` with `transform: translateX() rotate()`
- Intensity controlled by CSS custom properties (`--sway-amount`, `--sway-speed`) updated via IPC from main process
- requestAnimationFrame for smooth updates

**Fall animation:**
- Animate the BrowserWindow's y-position from current to screen bottom using `setPosition()` in a requestAnimationFrame loop
- Add slight rotation during fall (update `--rotation` CSS var)
- Ease-out at the bottom for the "landing" effect

---

## 5. File Structure

```
sticky-notes/
├── package.json
├── main.js                    # Electron main process entry
├── src/
│   ├── main/
│   │   ├── window-manager.js  # Create, position, destroy note windows
│   │   ├── fan-monitor.js     # System fan/temp polling
│   │   ├── state-manager.js   # Load/save state JSON
│   │   ├── stickiness.js      # Stickiness decay logic + fall trigger
│   │   └── tray.js            # System tray icon + context menu
│   ├── renderer/
│   │   ├── note.html          # Note window HTML shell
│   │   ├── note.js            # Note UI logic (text, strikethrough, drag)
│   │   ├── note.css           # Styles (yellow bg, handwriting, peel effect)
│   │   ├── wind.js            # Wind sway animation controller
│   │   └── fall.js            # Fall animation controller
│   └── shared/
│       ├── constants.js       # Stickiness rates, thresholds, dimensions
│       └── ipc-channels.js    # IPC channel name constants
├── assets/
│   └── fonts/
│       └── Caveat-Regular.ttf # Bundled handwriting font
└── state/                     # Created at runtime
    └── state.json             # Persisted note state
```

---

## 6. IPC Messages (Main ↔ Renderer)

| Channel | Direction | Payload | Purpose |
|---------|-----------|---------|---------|
| `note:text-changed` | Renderer → Main | `{ id, text[] }` | Save text state |
| `note:moved` | Renderer → Main | `{ id, x, y }` | Save position + apply 10% stickiness penalty |
| `note:request-new` | Renderer → Main | `{}` | User wants a new note (max 5 check) |
| `note:close` | Renderer → Main | `{ id }` | User closed a note |
| `note:restick` | Renderer → Main | `{ id }` | User double-clicked fallen note |
| `fan:status` | Main → Renderer | `{ active, rpm, intensity }` | Fan state changed — start/stop wind |
| `stickiness:update` | Main → Renderer | `{ id, value }` | Stickiness changed — update visuals |
| `stickiness:fall` | Main → Renderer | `{ id }` | Stickiness hit 0 — trigger fall animation |
| `state:restored` | Main → Renderer | `{ noteData }` | Restore saved state on launch |

---

## 7. Stickiness Math

```
Initial stickiness:     100%
Fan decay:              -5% every 30 seconds (while fan is above idle)
Move penalty:           -10% per drag
Re-stick (double-click): reset to 100%
Fall trigger:           stickiness <= 0%
```

**Example scenario:**
1. Note created → 100%
2. Fan kicks on, runs for 2 minutes → 100% - (4 × 5%) = 80%
3. User moves note → 80% - 10% = 70%
4. Fan runs for another 3 minutes → 70% - (6 × 5%) = 40%
5. User moves note twice → 40% - 20% = 20%
6. Fan runs 2 more minutes → 20% - (4 × 5%) = 0% → note falls

---

## 8. Visual States

| Stickiness | Corner Curl | Sway Amount | Opacity | State |
|------------|-------------|-------------|---------|-------|
| 100-76% | None | Minimal (±2px) | 0.92 | Firmly stuck |
| 75-51% | Slight curl top-right | Moderate (±5px) | 0.88 | Starting to peel |
| 50-26% | Noticeable curl | Heavy (±10px, ±2° rotation) | 0.82 | Peeling |
| 25-1% | Major curl, note lifting | Aggressive (±15px, ±4°) | 0.75 | About to fall |
| 0% | — | — | 0.92 (reset) | Fallen, flat at bottom |

---

## 9. Edge Cases

**More than 5 notes:** Block creation. Show a small notification or shake the tray icon.

**All notes fallen:** They all sit at the bottom. User can double-click any to re-stick.

**Fan turns off mid-decay:** Stickiness stops decaying from wind. Current value is preserved. Wind animation stops. Note stays wherever its stickiness is at.

**Note dragged while falling:** Not allowed. Fall animation is non-interruptible. Once it starts, it completes.

**Screen resolution change:** On display change event, recalculate "bottom" position for fallen notes. Stuck notes stay at their absolute coordinates (may need bounds checking).

**Multiple monitors:** Notes can be placed on any monitor. Fall animation drops to the bottom of the monitor the note is currently on.

**App killed mid-fall:** State saves stickiness as 0% but position as wherever it was. On restart, note appears at bottom (state manager detects 0% stickiness and places note at screen bottom).

**Empty note:** Allowed. A blank sticky note is still a sticky note.

---

## 10. Dependencies

| Package | Purpose |
|---------|---------|
| `electron` | Desktop window framework |
| `systeminformation` | Cross-platform fan/CPU temp reading |
| `electron-store` or raw `fs` | State persistence (JSON) |

Minimal dependencies. No React, no heavy frameworks. Vanilla HTML/CSS/JS in the renderer.

---
