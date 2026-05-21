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
| Cross-boundary   | RxJS Observables — WebSocket transport only             |
| Map              | Leaflet 1.9 + OpenStreetMap tiles                       |
| Test runner      | Vitest 4                                                |
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

### Testing

```bash
npm test         # runs Vitest
```

### Override the WebSocket port

```bash
PORT=9000 npm run server
```

(The client URL is currently hard-coded — see [Configuration points](#configuration-points).)

---

## User interface guide

### Map (right / centre)

- **Markers** — every signal whose timestamp is in the trailing 30-second
  window from the cursor.
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
  the drag (not only on release).
- **LIVE** — snaps the cursor back to `now` and resumes live updates. The
  red dot pulses while LIVE is engaged.

### Playback semantics

- **LIVE** — cursor follows the wall clock; map shows the last 30s of
  activity; panel shows the burst closest to "now".
- **PAUSED** — cursor frozen at user-selected moment; map shows the
  preceding 30s; panel shows the burst nearest the cursor (within 30s).
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
                   │ WebSocketSignalGateway         │
                   │ (Observable<SignalMessage>)    │
                   └────────────────────────────────┘
                                 │
                                 ▼ via SIGNAL_GATEWAY token
                   ┌────────────────────────────────┐
                   │ SignalStore                    │
                   │ Observable → Signal boundary   │
                   │  • time-sorted RadarSignal[]   │
                   │  • cursor / mode state machine │
                   │  • derived Signals (computed)  │
                   └────────────────────────────────┘
                                 │
                                 ▼ readonly Signals
              ┌──────────────────┼────────────────────┐
              ▼                  ▼                    ▼
       MapComponent     CoordinatesPanel       ControlPanel
       (Leaflet diff)   Container (cards)      (transport UI)
```

### State machine

`SignalStore.mode: Signal<'live' | 'paused' | 'playing'>`

| Transition       | Trigger                                       | Effect                                                       |
|------------------|-----------------------------------------------|--------------------------------------------------------------|
| live → paused    | Pause button while in LIVE                    | Captures `_now()` into `_cursorOverride`                     |
| live → paused    | Scrubber drag while in LIVE                   | Same — drag pauses automatically                             |
| paused → playing | Play button                                   | Starts a 100 ms `effect`-scoped interval that advances cursor|
| playing → live   | Cursor catches up to `_now()`                 | Auto-snap; effect cleanup kills the interval                 |
| any → live       | LIVE button                                   | Clears override; mode = 'live'                               |
| any → paused     | Pause from playing                            | Cursor stays put; interval cleaned up                        |

### Key design choices

- **Observable in, Signals out.** The gateway exposes RxJS (because that's
  what a WebSocket subscription naturally is), but the store flips the
  bridge once via `takeUntilDestroyed(...).subscribe(...)`. Every consumer
  downstream reads pure signals — no RxJS lifecycle to worry about.
- **Time-sorted array, not a Map.** Signals live in
  `signal<readonly RadarSignal[]>` sorted ascending by timestamp. Queries
  use binary search (`lowerBound` in `shared/utils/utils.ts`), so
  `visibleSignals` is `O(log n + windowSize)` and `burstAtCursor` is
  `O(log n + burstSize)`. Inserts preserve order via the same binary
  search.
- **Mode-scoped playback timer.** The 100 ms playback interval lives inside
  an `effect((onCleanup) => …)`. When `mode` changes, the effect re-runs
  and the cleanup callback kills the interval. No `if (mode !== 'playing')
  return;` no-ops on every tick.
- **Strict-timestamp burst grouping.** The coordinates panel groups by
  exact equality on `timestamp`, not by a fuzzy ±N-ms window. This is why
  the server hands one `timestamp` to every signal in a burst — so the
  client can faithfully report "N одночасно".
- **Templates never see the store directly.** Every component keeps its
  injected store `private` and re-exposes only the signals/methods it
  needs as `protected` members. This keeps the template-to-state surface
  explicit and refactor-friendly.

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
    │   │   ├── gateway/
    │   │   │   ├── gateway.constants.ts     WS URL, reconnect delays
    │   │   │   ├── provide-websocket-gateway.ts
    │   │   │   ├── random-signal.factory.ts Synthetic history generator
    │   │   │   ├── signal-gateway.ts        SignalGateway interface + token
    │   │   │   └── websocket-signal.gateway.ts  Real WebSocket impl
    │   │   └── state/
    │   │       └── signal-store.ts          Central state machine
    │   ├── features/
    │   │   ├── controls/                    Play/pause/scrubber/LIVE
    │   │   ├── coordinates/                 Dumb single-signal card
    │   │   ├── coordinates-panel-container/ Smart wrapper for the sidebar
    │   │   └── map/                         Leaflet canvas + layer diff
    │   └── shared/
    │       ├── constants/
    │       │   ├── map-styles.constant.ts   Leaflet PathOptions presets
    │       │   └── time.constants.ts        12h window, playback tick, etc.
    │       ├── models/
    │       │   ├── geo.model.ts             GeoPoint
    │       │   ├── playback.model.ts        PlaybackMode union
    │       │   └── signal.model.ts          SignalMessage / RadarSignal
    │       ├── pipes/
    │       │   └── vertex-count-label.pipe.ts  Ukrainian plural for "вершин"
    │       └── utils/
    │           └── utils.ts                 lowerBound, clamp
    └── styles/
        ├── _mixins.scss              Reusable style patterns
        ├── _tokens.scss              CSS-variable design tokens
        └── styles.scss               Global resets + token registration
```

### Layer rules

- `core/` — singletons providing data (gateway) and state (store). May
  depend on `shared/`.
- `features/` — UI. May depend on `core/` and `shared/`. Features never
  depend on each other.
- `shared/` — pure types, constants, utils. No Angular-specific runtime
  (besides pipes). Never depends on `core/` or `features/`.

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
gateway schedules a reconnect with exponential backoff starting at 500 ms
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
| Emitter centres + frequency range | `core/gateway/random-signal.factory.ts`    |
| Server tick rate + burst distribution | `server/index.js`                      |
| Design tokens              | `src/styles/_tokens.scss`                         |
