# Realisticky Notes

A desktop sticky note app built with Electron where notes behave like real physical Post-its. They stick to your screen, respond to your computer's fan with wind physics, lose stickiness over time, crumple, and fall.

## Features

- **Realistic Post-it appearance** — yellow, slightly transparent, handwriting font (Caveat), faint ruled lines
- **Strikethrough backspace** — pressing backspace crosses out characters with a wavy red line instead of deleting them, just like pen on paper
- **Wind physics** — notes sway when your CPU is under load (fan spinning), with organic multi-frequency oscillation
- **Stickiness decay** — notes lose grip from wind exposure and being moved; visual corner peel grows as stickiness drops
- **Crumple & fall** — when stickiness hits 0%, the note crumples with wrinkle lines and falls to the bottom of the screen with gravity physics
- **Re-stick** — double-click a fallen note to restore it to full stickiness
- **State persistence** — all notes, positions, text, stickiness, and fallen status survive app restarts
- **Up to 5 notes** — create and manage notes via the system tray icon
- **Multi-monitor aware** — notes fall to the correct screen bottom and reposition on display changes

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm (comes with Node.js)

## Install

```bash
git clone <repo-url>
cd ishann
npm install
```

## Run

```bash
npm start
```

A yellow sticky note will appear on your screen. Right-click the tray icon to create more notes (up to 5) or quit.

## Usage

| Action | What happens |
|---|---|
| Click note | Start typing |
| Backspace | Crosses out the character (strikethrough) |
| Type after backspace | New text appears normally |
| Drag note | Note re-sticks but loses 10% stickiness |
| Fan spins / CPU load | Notes sway; stickiness drops 5% every 30s |
| Stickiness → 0% | Note crumples and falls to screen bottom |
| Double-click fallen note | Re-sticks at 100% |
| × button (hover) | Closes and removes the note |
| Tray icon → right-click | New Note / Quit |
| Ctrl+Shift+D | Dev: log note state to console |

## Project Structure

```
main.js              Electron main process — windows, IPC, fall physics, sway
preload.js           Context bridge for secure IPC
note.html            Sticky note window markup
note.css             Styles — appearance, stickiness tiers, crumple animation
note.js              Renderer — text engine, strikethrough, stickiness visuals
src/
  state-manager.js   Debounced JSON persistence
  stickiness.js      Per-note stickiness tracking, move penalty, wind decay
  fan-monitor.js     CPU temp / load polling → fan status + intensity
assets/
  fonts/             Caveat font TTF files
  tray-icon.png      System tray icon
```

## Build (optional)

```bash
npm install --save-dev electron-builder
npx electron-builder --mac
```

Replace `--mac` with `--win` or `--linux` for other platforms.

## License

ISC
