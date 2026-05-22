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
| Build/CI         | NX 22 (project.json) + Angular Build                    |
| State            | Signals (`signal`, `computed`, `effect`) — UI surface   |
| Cross-boundary   | Web Workers + `MessageChannel` (Delta Sync)             |
| Map              | Leaflet 1.9 + Canvas Rendering API                      |
| Storage          | IndexedDB (native API, no wrapper)                      |
| Live signal feed | Local Node.js `ws` server (`server/index.js`)           |
| Tests            | Vitest 4 + `fake-indexeddb` + jsdom                     |
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

Once the dev server is ready, open `http://localhost:4205/`.

### Installing dependencies

```bash
npm install --legacy-peer-deps
```

`@nx/angular@22` pins `@angular/compiler-cli@21.2.14` while the app uses
`^21.2.0`, which npm's peer-dep resolver refuses without the flag. Behaviour
is correct at runtime.

### Running each half separately

```bash
npm run server   # WebSocket signal source only
npm run serve    # Angular dev server only (via NX)
```

### Building for production

```bash
npm run build    # output in ./dist
# or:
npx nx build interactive-map
```

### Running tests

```bash
npm test
# or:
npx nx test interactive-map
```

Note: the bare `ng` CLI is **not** available — `nx init` removed
`angular.json` in favour of `project.json`. Use the `npm run …` scripts or
`npx nx <target> interactive-map`.

### Override the WebSocket port

```bash
PORT=9000 npm run server
```

(The client URL is hard-coded in `core/constants/gateway.constants.ts` —
see [Configuration points](#configuration-points).)

---

## User interface guide

### Map (right / centre)

- **Markers** — every signal whose timestamp is in the trailing 1-second
  window from the cursor. Rendered as canvas circle markers for performance.
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
  within ±1 second of the cursor.

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

- **LIVE** — cursor follows the wall clock; map shows the last 1 s of
  activity; panel shows the burst closest to "now".
- **PAUSED** — cursor frozen at user-selected moment; map shows the
  preceding 1 s; panel shows the burst nearest the cursor (within 1 s).
- **PLAYING** — cursor walks forward at 1× real-time (100 ms per tick) from
  its current position. When it catches up to the wall clock it
  auto-transitions to LIVE.

---

## Architecture

### Three processes, two channels

```
WebSocket ──┐
            │   ws://localhost:8080
            ▼
   ┌──────────────────────┐                   ┌──────────────────────┐
   │ NetworkWorker        │  MessageChannel   │ DBWorker             │
   │  └─ NetworkGateway   │ ───NEW_SIGNAL──▶  │  └─ PlaybackEngine   │
   │     (WebSocket +     │                   │     (state, clock,   │
   │      reconnect)      │                   │      batch writer,   │
   └──────────────────────┘                   │      delta compute,  │
                                              │      dispatcher)     │
                                              │  └─ SignalRepository │
                                              │     (IndexedDB I/O)  │
                                              └──────────┬───────────┘
                                                         │ FRAME
                                                         ▼
                                              ┌──────────────────────┐
                                              │ Main thread          │
                                              │  └─ SignalStore      │
                                              │     (signals,        │
                                              │      delta apply)    │
                                              └──────────┬───────────┘
                                                         │ readonly Signals
                                                         ▼
                                                     Components
                                              (MapComponent, etc.)
```

Three message channels, all typed by constants in
`src/app/shared/constants/worker.constants.ts`. String literals for these
types should not appear elsewhere.

| Channel | Direction | Wire | Kinds |
|---|---|---|---|
| **Control plane** | Main → workers | `Worker.postMessage` | `ControlMessageType`: `INIT_PORTS`, `DISPOSE`, `PLAY`, `PAUSE`, `GO_LIVE`, `SEEK` |
| **Data plane**    | Network → DB worker | `MessagePort` | `ChannelMessageType.NewSignal` (one per WS frame) |
| **Frame plane**   | DB worker → Main | `Worker.postMessage` | `FrameMessageType.Frame` (carries `StateFrame` deltas) |

### Class topology

| Class | File | Role |
|---|---|---|
| `SignalStore` | `core/state/signal-store.ts` | Spawns workers, exposes readonly signals to UI, applies deltas, forwards commands. The only Angular `@Injectable` in this layer. |
| `PlaybackEngine` | `core/workers/playback-engine.ts` | Inside DBWorker. Owns the playback state machine, the 100 ms clock, batch writer, delta computation, command dispatcher, and an injected `SignalStorage`. |
| `NetworkGateway` | `core/workers/network-gateway.ts` | Inside NetworkWorker. Owns the WebSocket and exponential-backoff reconnect (500 ms → 10 s). |
| `SignalRepository` | `core/db/signal-repository.ts` | Holds the only `IDBDatabase` handle. Implements `SignalStorage` (interface) so PlaybackEngine depends on the abstraction. |
| `Logger` | `shared/utils/logger.ts` | Structured prefixed logging. Each subsystem instantiates one with its own source name. |

The two `*.worker.ts` files are intentionally thin — they wire
`addEventListener('message', ...)` to a class instance and forward
`INIT_PORTS` / `DISPOSE`. All business logic lives in the classes, which
makes them unit-testable in isolation (construct a `PlaybackEngine` with a
`Map`-backed fake `SignalStorage` and a stub `postFrame` callback in a
regular Vitest test).

### Worker is the single source of truth

The cursor and playback mode live in `PlaybackEngine`, not in `SignalStore`.
UI methods (`play`, `pause`, `goLive`, `seekTo`) are **pure forwarders** —
they post a command and do **not** write `_mode` or `_cursor` locally.
After handling a command, `PlaybackEngine` emits a `FRAME` synchronously, so
the round-trip is one event-loop tick and buttons feel instant.

Optimistic local writes were tried and removed: they dual-wrote state with
the worker's `FRAME`, and could flicker on auto-snap races (e.g. worker
auto-snaps to live while user clicks Pause). State now lives in one place.

### State machine

`SignalStore.mode: Signal<'live' | 'paused' | 'playing'>` — populated from
each incoming `FRAME`.

| Transition       | Trigger                       | Effect (inside `PlaybackEngine`)                                      |
|------------------|-------------------------------|-----------------------------------------------------------------------|
| live → paused    | Pause button or first scrub   | `cursorOverride` captures `now()`                                     |
| paused → playing | Play button                   | Clock ticks advance `cursorOverride` by `PLAYBACK_TICK_MS` per tick   |
| playing → live   | Cursor catches up to `now()`  | Auto-snap; `cursorOverride` reset to `null`                           |
| any → live       | LIVE button                   | `cursorOverride = null`; mode = `live`                                |
| any → paused     | Pause from playing            | Cursor stays put; clock continues but no longer advances cursor       |
| any → seek dest  | Scrubber drag                 | `cursorOverride` clamped to `[now − 12h, now]`; pauses only if `live` |

### Key design choices

- **Delta Sync.** `PlaybackEngine` tracks which signal IDs were sent in the
  last frame and only ships `addedSignals` + `removedSignalIds`. `postMessage`
  serialization is O(Δ), not O(N).
- **Time-decoupled map rendering.** `MapComponent` uses a `requestAnimationFrame`
  loop to apply layer diffs. The map renders the latest state on the next
  paint, regardless of `FRAME` arrival rate — never saturates the UI thread.
- **Self-rescheduling timers (not `setInterval`).** Inside `PlaybackEngine`,
  both the clock and the batch writer chain via `setTimeout` after their
  awaited body resolves. `setInterval` would overlap async ticks once
  `getInRange` exceeds 100 ms, producing concurrent IDB reads and torn frames.
- **Serialized `emitFrame`.** Both the scheduled tick and the dispatch path
  call `emitFrame`. They're chained through a single `framePromise`, so the
  `lastVisibleIds` mutation that produces the delta is never racing — even
  if IDB resolves the two transactions out of order.
- **Content-derived signal ids.** `id = ${timestamp}-${freq}-${lat}-${lon}`
  (precision-locked to the wire format). Same logical signal always maps to
  the same key, so IDB's `keyPath` dedup handles backfill re-sends across
  reconnects and page refreshes for free — no in-memory dedup needed.
- **`SignalStorage` interface.** `PlaybackEngine.repository` is typed
  `SignalStorage`, not the concrete `SignalRepository`. Tests can supply an
  in-memory fake without `fake-indexeddb`.
- **Worker entry points are thin.** All logic in classes. The worker files
  exist only to wire `addEventListener` → class methods and to handle the
  one race-sensitive bit of lifecycle: deferring the `MessageChannel`
  `onmessage` wiring until the engine has finished opening IDB (so backfill
  signals queued during open aren't dropped).

### Lifecycle

**Startup**, in `SignalStore`'s constructor:
1. Spawn both workers (`new Worker(new URL(..., import.meta.url), { type: 'module' })`).
2. Create a `MessageChannel`. Transfer `port1` to NetworkWorker and `port2`
   to DBWorker via `INIT_PORTS`.
3. DBWorker opens IndexedDB via `SignalRepository.open()`, constructs
   `PlaybackEngine`, calls `engine.start()`, then wires the channel-port
   `onmessage` to drain any queued `NEW_SIGNAL` messages.
4. NetworkWorker receives its port and `gateway.attachPort(port)` triggers
   the WS connection. The server immediately sends a 12 h backfill of
   synthetic signals (one per minute, jittered) on each new connection.

**Shutdown**, in `SignalStore.ngOnDestroy`:
1. Post `DISPOSE` to both workers.
2. `PlaybackEngine.dispose()` clears the self-scheduling timers and closes
   `SignalRepository`.
3. `NetworkGateway.dispose()` closes the socket and the port.
4. After `WORKER_TERMINATE_GRACE_MS` (50 ms) the store calls
   `worker.terminate()` as a hard backstop.

### Invariants

1. **The main thread never opens an IndexedDB transaction.** Only
   `SignalRepository` (inside DBWorker) touches IDB.
2. **The NetworkWorker never writes to IDB.** It forwards parsed
   `SignalMessage` payloads over the `MessageChannel`. DBWorker is the sole
   writer.
3. **The cursor and mode live in `PlaybackEngine`, not in `SignalStore`.**
   The store mirrors them from each `FRAME` and exposes them as readonly
   signals. UI methods send commands; the worker echoes the resulting state.
4. **Map rendering is decoupled from state via `requestAnimationFrame`.**
   Don't mutate Leaflet layers in an `effect()` that reads
   `visibleSignals` — coalesce into the existing rAF pump in `MapComponent`.
5. **Templates must not call store methods or service signals directly.**
   Each component exposes pass-through `Signal` / handler properties and
   the template binds to *those*. Keeps templates trivially testable.
6. **Signal ids are content-derived, never sequence-counter based.**
   `${timestamp}-${freq}-${lat.toFixed(5)}-${lon.toFixed(5)}`. Don't introduce
   per-session counters or `crypto.randomUUID()`-style ids — they break the
   reconnect/refresh dedup that the rest of the pipeline relies on.

### Where new code should go

- **New control commands** → add to `ControlMessageType`, extend
  `DispatchableCommand` in `worker.model.ts`, add a handler in
  `PlaybackEngine.commandHandlers`. No string-literal switches anywhere.
- **New persistence methods** → add to `SignalStorage` (the interface) and
  implement on `SignalRepository`. Never new free functions in `core/db/`.
- **New constants** → `shared/constants/` for cross-layer values,
  `core/constants/` for core-only values (IDB schema, gateway tuning).
  Time values compose from `ONE_SECOND_MS` / `ONE_MINUTE_MS` / `ONE_HOUR_MS`
  where possible.
- **New `Logger` source** → add the source name to `LogSource` in
  `shared/constants/log-source.constant.ts` first. `new Logger('Typo')` is
  a type error; the only way in is to extend the enum.

---

## Project structure

```
.
├── server/
│   └── index.js                    Local Node.js ws-server (signal source + backfill)
└── src/
    ├── app/
    │   ├── app.config.ts           DI providers (zoneless CD)
    │   ├── app.ts                  Root shell: map + sidebar + controls
    │   ├── core/
    │   │   ├── constants/                   Core-only constants
    │   │   │   ├── db.constants.ts          IDB schema (db name, store, index)
    │   │   │   └── gateway.constants.ts     WS URL, reconnect delays
    │   │   ├── interfaces/                  Abstractions for core classes
    │   │   │   ├── signal-storage.interface.ts  PlaybackEngine ⇢ storage contract
    │   │   │   └── worker-host.interface.ts     Minimal Worker-scope surface for test mocking
    │   │   ├── db/
    │   │   │   └── signal-repository.ts     IDB-backed SignalStorage impl
    │   │   ├── state/
    │   │   │   └── signal-store.ts          UI bridge: spawns workers, mirrors FRAMEs
    │   │   └── workers/
    │   │       ├── db.worker.ts             Thin entry point — boots PlaybackEngine
    │   │       ├── network.worker.ts        Thin entry point — boots NetworkGateway
    │   │       ├── playback-engine.ts       State, clock, batch writer, deltas, dispatcher
    │   │       └── network-gateway.ts       WebSocket + exponential-backoff reconnect
    │   ├── features/
    │   │   ├── controls/                    Play/pause/scrubber/LIVE
    │   │   ├── coordinates/                 Dumb single-signal card
    │   │   ├── coordinates-panel-container/ Smart wrapper for the sidebar
    │   │   └── map/                         Leaflet canvas + rAF layer diff
    │   └── shared/
    │       ├── constants/                   Cross-layer constants
    │       │   ├── datetime-formats.constant.ts  Angular DatePipe format strings
    │       │   ├── log-source.constant.ts   Typed LogSource enum (no magic strings)
    │       │   ├── map-styles.constant.ts   Leaflet PathOptions presets
    │       │   ├── number-formats.constant.ts    Decimal places, digitsInfo
    │       │   ├── time.constants.ts        12h window, playback tick, etc.
    │       │   └── worker.constants.ts      Worker timings + typed message kinds
    │       ├── models/
    │       │   ├── geo.model.ts             GeoPoint
    │       │   ├── playback.model.ts        PlaybackMode union
    │       │   ├── signal.model.ts          SignalMessage / RadarSignal
    │       │   └── worker.model.ts          StateFrame + command unions + channel guard
    │       ├── pipes/
    │       │   └── vertex-count-label.pipe.ts  Ukrainian plural for "вершин"
    │       └── utils/
    │           ├── logger.ts                Structured prefixed logging
    │           └── utils.ts                 lowerBound, clamp
    └── styles/
        ├── _mixins.scss             Reusable style patterns
        ├── _tokens.scss             CSS-variable design tokens
        └── styles.scss              Global resets + token registration
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

- **Live ticks:** 300 ms – 3.3 s (random per tick).
- **Backfill on connect:** the server emits a 12-hour history to each new
  client — one signal per minute, jittered. The backfill is generated **once
  at server startup** and cached as pre-stringified payloads, then sent
  byte-identically to every connection. Combined with the client's
  content-derived id, this means every reconnect/refresh writes the same
  rows to IDB (no duplicates, no overwrites). Restart the server to refresh
  the cached window.
- **Chunked send:** backfill flushes in batches of 50 with `setImmediate`
  yields between, so the WS send buffer drains and the event loop doesn't
  stall.
- **Burst size:** geometric distribution, capped at 10 — ~70% solo signals,
  ~21% pairs, ~6% triples, tail to ten.
- ~10% of signals have an empty `zone` (exercising the
  `zone.length === 0` branch).
- Emitter centres are 12 named coordinates; each signal is jittered by up
  to ±0.025° around its centre.

### Client reconnection

On `close` (which fires after `error` for failed connections too),
`NetworkGateway` schedules a reconnect with exponential backoff starting at
500 ms and capped at 10 s. The server re-sends its cached backfill on each
reconnect; IDB dedups by `keyPath: id`, which is deterministic per signal
content (same backfill rows → same ids → silent dedup).

---

## Configuration points

| What                       | File                                                                  |
|----------------------------|-----------------------------------------------------------------------|
| WebSocket URL              | `core/constants/gateway.constants.ts`                                 |
| Reconnect delays           | `core/constants/gateway.constants.ts`                                 |
| History window length      | `shared/constants/time.constants.ts` (`HISTORY_WINDOW_MS`)            |
| Trailing visibility window | `shared/constants/time.constants.ts` (`SIGNAL_VISIBLE_DURATION_MS`)   |
| Playback tick rate         | `shared/constants/time.constants.ts` (`PLAYBACK_TICK_MS`)             |
| Batch-write interval       | `shared/constants/worker.constants.ts` (`BATCH_WRITE_INTERVAL_MS`)    |
| Worker terminate grace     | `shared/constants/worker.constants.ts` (`WORKER_TERMINATE_GRACE_MS`)  |
| IDB schema (name/store)    | `core/constants/db.constants.ts`                                      |
| Map default centre & zoom  | `features/map/map.component.ts` (`initLeaflet`)                       |
| Design tokens              | `src/styles/_tokens.scss`                                             |
