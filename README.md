# Interactive Map

A real-time radar-signal visualizer built with **Angular 21** and **Leaflet**.
The app subscribes to a WebSocket signal feed, plots every incoming signal on
a map, and lets the user scrub through the last 12 hours of activity
with video-player-style transport controls.

---

## Table of contents

1. [Overview](#overview)
2. [Tech stack](#tech-stack)
3. [Running the app](#running-the-app)
4. [User interface guide](#user-interface-guide)
5. [Architecture](#architecture)
6. [Project structure](#project-structure)
7. [WebSocket protocol](#websocket-protocol)
8. [Configuration points](#configuration-points)

---

## Overview

The app simulates a radio-frequency monitoring console. Signals appear at
random points with a "central point" (a `marker`) and an optional
"uncertainty zone" (a `polygon` of 0 or more vertices). Multiple signals can
arrive at the same moment — the UI surfaces these as a labelled burst.

Three views are stitched together by a single root component:

- **Map** — Leaflet canvas filling most of the viewport. Renders every
  visible signal as a marker; renders its zone as a translucent polygon when
  the zone has vertices.
- **Coordinates panel** — left sidebar. Shows the detailed coordinates,
  frequency, timestamp, and zone information for every signal at the current
  cursor moment. Multi-signal bursts get an "N одночасно" badge.
- **Transport controls** — bottom footer. Play / pause, draggable scrubber
  covering the last 12 hours, and a "LIVE" button that snaps the cursor back
  to the real-time edge.

---

## Tech stack

| Layer            | Choice                                                  |
|------------------|---------------------------------------------------------|
| Framework        | Angular 21 (standalone components, zoneless CD)         |
| State            | Signals (`signal`, `computed`, `effect`) — UI surface   |
| Cross-boundary   | Web Workers + postMessage (Delta Sync)                  |
| Map              | Leaflet 1.9 + Canvas Rendering API                      |
| Storage          | IndexedDB (`idb`)                                       |
| Live signal feed | Local Node.js `ws` server (`server/index.js`)           |
| Styling          | SCSS with CSS-variable tokens + reusable mixins         |

---

## Running the app

The client expects a WebSocket signal source on `ws://localhost:8080`. A
single command starts both the local `ws` server and the Angular dev server:

```bash
npm start
```

`concurrently` runs both processes side-by-side with `ws` / `ng` log prefixes.
`--kill-others-on-fail` guarantees that hitting `Ctrl+C` (or a crash in one)
takes the other down too — no zombie port-8080 listeners.

Once `ng serve` is ready, open `http://localhost:4205/`.

### Running each half separately

```bash
npm run server   # WebSocket signal source only
npm run serve    # Angular dev server only (ng serve)
```

### Building for production

```bash
npm run build    # output in ./dist
```

### Override the WebSocket port

```bash
PORT=9000 npm run server
```

(The client URL is currently hard-coded — see [Configuration points](#configuration-points).)

---

## User interface guide

### Map (right / centre)

- **Markers** — every signal whose timestamp is in the trailing 1-second
  window from the cursor. Rendered via HTML5 Canvas for performance.
- **Polygons** — drawn only when the signal carries a non-empty `zone`.
- **Popup** — clicking a marker shows its frequency, lat/lon, and ISO
  timestamp.
- **Highlight** — the burst that the coordinates panel is currently focused
  on gets an orange polygon outline. Multi-signal bursts highlight every
  member.

### Coordinates panel (left)

- **Header** — title + "N одночасно" badge when the current burst has ≥ 2
  signals + a mode chip (`НАЖИВО` / `ВІДТВОРЕННЯ` / `ПАУЗА`).
- **Signal cards** — one card per signal in the burst, each showing
  timestamp (millisecond precision), frequency, coordinates, and zone vertex
  count (or "немає" when the zone is empty).
- **Footer** — number of signals currently visible on the map and the cursor
  timestamp.
- **Empty state** — encouragement to scrub the timeline when no burst lives
  within ±30 seconds of the cursor.

### Transport controls (bottom)

- **Play / Pause** — toggles real-time playback. When pressed from `LIVE`,
  pauses on the current wall-clock moment. When pressed from `PAUSED`,
  resumes playback at 1× real-time from the captured cursor.
- **Scrubber** — drag the white dot along the track to any timestamp in the
  last 12 hours. The leftmost position is `now − 12h`, the rightmost is
  `now`. Both the map and the coordinates panel update continuously during
  the drag.
- **LIVE** — snaps the cursor back to `now` and resumes live updates. The
  red dot pulses while LIVE is engaged.

### Playback semantics

- **LIVE** — cursor follows the wall clock; map shows the last 1s of
  activity; panel shows the burst closest to "now".
- **PAUSED** — cursor frozen at user-selected moment; map shows the
  preceding 1s; panel shows the burst nearest the cursor (within 30s).
- **PLAYING** — cursor walks forward at 1× real-time (100 ms per tick) from
  its current position. When it catches up to the wall clock it
  auto-transitions to LIVE.

---

## Architecture

### Data flow

```
                   ┌────────────────────────────────┐
   ws://localhost  │  Node.js server/index.js       │
   :8080  ◄───────┤  emits 1..10-signal bursts     │
                   │  every 0.3–3.3 s               │
                   └────────────────────────────────┘
                                 │
                                 ▼ JSON SignalMessage
                   ┌────────────────────────────────┐
                   │ NetworkWorker (Web Worker)     │
                   │ WebSocket + DB.put(signal)     │
                   └─────────────┬──────────────────┘
                                 │ Write-Through
                                 ▼
                   ┌────────────────────────────────┐
                   │ IndexedDB (Storage)            │
                   │ signal_history store           │
                   └─────────────▲──────────────────┘
                                 │ Read/Query
                   ┌─────────────┴──────────────────┐
                   │ DBWorker (Web Worker)          │
                   │ Computes timeline window       │
                   │ Calculates Deltas (add/remove) │
                   └─────────────┬──────────────────┘
                                 │
                                 ▼ StateFrame (Deltas via postMessage)
                   ┌────────────────────────────────┐
                   │ SignalStore                    │
                   │ Applies Deltas to State        │
                   │ Derived Signals (computed)     │
                   └─────────────┬──────────────────┘
                                 │
                                 ▼ readonly Signals
              ┌──────────────────┼────────────────────┐
              ▼                  ▼                    ▼
       MapComponent     CoordinatesPanel       ControlPanel
       (Canvas + rAF)   Container (cards)      (transport UI)
```

### Multi-Worker Architecture

To guarantee a stable 60 FPS under load (up to 5,000 active markers, 100,000+ in history), the application delegates heavy processing to Web Workers:

- **NetworkWorker:** Owns the WebSocket connection. Its sole responsibility is writing incoming JSON payloads directly to IndexedDB.
- **DBWorker:** The engine room. Every 100ms, it queries IndexedDB based on the current timeline cursor, calculates a "Delta" (which signals were added, which IDs were removed), and sends this minimal payload to the main thread.
- **Main Thread (UI):** Only handles rendering and applying pre-calculated state diffs. Map updates are throttled using `requestAnimationFrame` to ensure Leaflet renders only during browser paint cycles.

### State machine

`SignalStore.mode: Signal<'live' | 'paused' | 'playing'>`

| Transition       | Trigger                                       | Effect                                                       |
|------------------|-----------------------------------------------|--------------------------------------------------------------|
| live → paused    | Pause button while in LIVE                    | Captures `_now()` into `_cursorOverride`                     |
| live → paused    | Scrubber drag while in LIVE                   | Same — drag pauses automatically                             |
| paused → playing | Play button                                   | Starts a 100 ms interval inside DBWorker to advance cursor   |
| playing → live   | Cursor catches up to `_now()`                 | Auto-snap; timeline syncs with wall clock                    |
| any → live       | LIVE button                                   | Clears override; mode = 'live'                               |
| any → paused     | Pause from playing                            | Cursor stays put; interval stops advancing                   |

### Key design choices

- **Delta Sync:** The DBWorker tracks which signal IDs were sent in the last frame and only sends `addedSignals` and `removedSignalIds`. This reduces `postMessage` serialization overhead from O(N) to O(Δ).
- **Time-Decoupled Map Rendering:** The MapComponent uses `requestAnimationFrame` to decouple Leaflet layer updates from the DBWorker's state stream. The map applies whatever the latest state is on the next screen repaint, avoiding UI thread saturation.
- **IndexedDB Write-Through:** To keep the main thread pristine, the NetworkWorker writes directly to IndexedDB. The DBWorker reads from IndexedDB. The main thread never touches the database.
- **Mode-scoped playback timer.** The 100 ms playback interval is driven by `setInterval` within the `DBWorker`. The UI merely sends playback commands (`PLAY`, `PAUSE`, `SEEK`) via `postMessage`.

---

## Project structure

```
.
├── server/
│   └── index.js                    Local Node.js ws-server (signal source)
└── src/
    ├── app/
    │   ├── app.config.ts           DI providers (zoneless CD + gateway)
    │   ├── app.ts                  Root shell: map + sidebar + controls
    │   ├── core/
    │   │   ├── db/
    │   │   │   └── indexed-db.util.ts       IndexedDB wrapper for workers
    │   │   ├── gateway/
    │   │   │   ├── gateway.constants.ts     WS URL, reconnect delays
    │   │   ├── state/
    │   │   │   └── signal-store.ts          Central state machine
    │   │   └── workers/
    │   │       ├── db.worker.ts             Reads IDB, calcs deltas, handles playback
    │   │       └── network.worker.ts        WS connection, writes to IDB
    │   ├── features/
    │   │   ├── controls/                    Play/pause/scrubber/LIVE
    │   │   ├── coordinates/                 Dumb single-signal card
    │   │   ├── coordinates-panel-container/ Smart wrapper for the sidebar
    │   │   └── map/                         Leaflet canvas + rAF layer diff
    │   └── shared/
    │       ├── constants/
    │       │   ├── map-styles.constant.ts   Leaflet PathOptions presets
    │       │   └── time.constants.ts        12h window, playback tick, etc.
    │       ├── models/
    │       │   ├── geo.model.ts             GeoPoint
    │       │   ├── playback.model.ts        PlaybackMode union
    │       │   └── signal.model.ts          SignalMessage / RadarSignal
    │       │   └── worker.model.ts          Message payloads (Commands & StateFrames)
    │       ├── pipes/
    │       │   └── vertex-count-label.pipe.ts  Ukrainian plural for "вершин"
    │       └── utils/
    │           └── utils.ts                 lowerBound, clamp
    └── styles/
        ├── _mixins.scss              Reusable style patterns
        ├── _tokens.scss              CSS-variable design tokens
        └── styles.scss               Global resets + token registration
```

---

## WebSocket protocol

The server sends one JSON message per signal. Within a burst, every signal
in the burst shares the same `timestamp`.

```jsonc
{
  "timestamp": 1702230572123,   // ms since epoch (number)
  "frequency": 460.0,           // MHz (number, one decimal)
  "point": {
    "lat": 50.01,
    "lon": 30.01
  },
  "zone": [                     // 0 or more vertices
    { "lat": 50.01,     "lon": 30.01     },
    { "lat": 50.010386, "lon": 30.009485 }
  ]
}
```

### Server behaviour

- Tick interval: 300 ms – 3.3 s (random per tick).
- Burst size: geometric distribution, capped at 10 — ~70% solo signals,
  ~21% pairs, ~6% triples, tail to ten.
- ~10% of signals have an empty `zone` (exercising the
  `zone.length === 0` branch).
- Emitter centres are 12 named coordinates; each signal is jittered by up to ±0.025° around its centre.

### Client reconnection

On `close` (which fires after `error` for failed connections too), the
`network.worker.ts` schedules a reconnect with exponential backoff starting at 500 ms
and capped at 10 s.

---

## Configuration points

| What                       | File                                              |
|----------------------------|---------------------------------------------------|
| WebSocket URL              | `core/gateway/gateway.constants.ts`               |
| Reconnect delays           | `core/gateway/gateway.constants.ts`               |
| History window length      | `shared/constants/time.constants.ts` (`HISTORY_WINDOW_MS`) |
| Trailing visibility window | `shared/constants/time.constants.ts` (`SIGNAL_VISIBLE_DURATION_MS`) |
| Playback tick rate         | `shared/constants/time.constants.ts` (`PLAYBACK_TICK_MS`) |
| Map default centre & zoom  | `features/map/map.component.ts` (`initLeaflet`)   |
| Design tokens              | `src/styles/_tokens.scss`                         |
