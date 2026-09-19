# Roblox Studio Project Loader

Transport-agnostic loader (`factory/studio/project-loader.ts`) that brings a
Studio place from "not running" to verified-ready without holding one MCP
request open for the whole load.

## Why it exists

`manage_instance launch` with `wait_for_connection=true` holds a single MCP
request open until the plugin connects. For large places that outlasts the
server's own supervision deadline (~30s), so a healthy-but-slow load looks
like an MCP failure. The loader instead uses:

- `manage_instance launch` with `wait_for_connection=false` and a short
  **launch-ack** budget (default 30s) — quick acknowledgement only;
- `manage_instance status` polling for **process health** (alive? failed? pid?);
- `get_connected_instances` polling for **plugin health** (instances/peers);
- `get_project_structure` probes for **place readiness**.

A launch-ack timeout/transport error is NOT a launch failure: the follow-up
status poll is authoritative.

## Observed protocol facts (live, 2026-09-19)

- Launch ack returns fast with `launch_id` (+ `instance_id`, `pid`).
- The server supervises the launch and marks the managed entry `failed`
  with `failure_reason: "Studio launched, but the MCP plugin did not connect
  before timeout."` after ~30s — **even when the Studio process keeps
  running and the plugin registers later** (observed: baseplate plugin
  registered ~53s after launch; instance usable afterwards).
- Therefore a server-declared `failed` launch with a **live process** and a
  timeout-like reason must keep polling, never relaunch. Only a dead
  process (or a hard, non-timeout failure reason) is terminal.
- Disconnected peers can linger in `connected[]` after the process exits;
  readiness is proven only by a successful `get_project_structure` probe,
  never by list presence.
- The real `get_project_structure` envelope (verified live) is a service
  overview: `{note, type:"service_overview", timestamp,
  services:[{path,name,className,hasChildren,childCount}…]}`. Readiness =
  successful query + non-empty `services` (also accepts `root`/`name`/
  `tree`/`path` shapes). The `get_project_structure` and `get_runtime_logs`
  tools are now mapped 1:1 in the MCP bridge (previously missing, which made
  live readiness unconfirmable through the real bridge).

## State machine

```
NOT_RUNNING → STUDIO_STARTING → STUDIO_PROCESS_ALIVE → PLUGIN_CONNECTING
  → PLUGIN_CONNECTED → PLACE_DETECTED → PLACE_OPENING → PLACE_LOADING
  → PLACE_READY
```

Terminal: `LOAD_TIMEOUT`, `DISCONNECTED`, `FAILED`.
`LOAD_SLOW` is a legacy alias of `PLACE_LOADING` (still accepted).
`UNKNOWN` is the unclassifiable fallback.

Process health and plugin health are observed separately:

| evidence | meaning |
|---|---|
| process alive, MCP unreachable | `STUDIO_PROCESS_ALIVE` — still loading, not dead |
| MCP reachable, zero instances | `PLUGIN_CONNECTING` — never failed while process alive |
| instances, wrong place | `PLUGIN_CONNECTED` — advisory past plugin budget, timeout only at max-total |
| target sighted, first probe pending | `PLACE_DETECTED` |
| probing, within slow threshold | `PLACE_OPENING` |
| probing, past slow threshold | `PLACE_LOADING` (healthy, sustained) |

## Single-Studio policy

One task launches **at most one** Studio process:

1. Matching ready place → reuse, zero launches.
2. Matching place, not ready → poll it; never close/relaunch.
3. Owned launch already in flight (same place file, via status) → poll it.
4. Wrong place → close once, then launch exactly once.
5. A repeat call while a healthy load is in flight performs zero launches
   (`diagnostics.launchesAttempted` proves it in tests).

Only concrete evidence of an unusable process (dead, or hard non-timeout
failure reason) permits a fresh launch — and still at most one.

## Timeouts (all bounded, separately configurable)

| budget | default | env override |
|---|---|---|
| launch acknowledgement | 30s | `AI_FACTORY_STUDIO_LOAD_LAUNCH_MS` |
| process startup | 120s | `AI_FACTORY_STUDIO_LOAD_STARTUP_MS` |
| plugin connect | 60s | `AI_FACTORY_STUDIO_LOAD_PLUGIN_MS` |
| place load | 180s | `AI_FACTORY_STUDIO_LOAD_PLACE_MS` |
| slow threshold (advisory) | 60s | `AI_FACTORY_STUDIO_LOAD_SLOW_MS` |
| max total (hard ceiling) | 600s | `AI_FACTORY_STUDIO_LOAD_MAX_MS` |
| poll interval | 5s | `AI_FACTORY_STUDIO_LOAD_POLL_MS` |

A plugin-connect timeout on a live process adds an advisory and keeps
polling; only the max-total budget (or a dead process) ends the wait.
Timeouts record `diagnostics.timeoutCategory`
(`studio-startup` | `plugin-connect` | `place-load` | `max-total` |
`mcp-unreachable`).

## Diagnostics

Every result carries `ProjectLoadEvidence`: state transitions with reasons,
`launchId`, `instanceId`, `launchesAttempted`, `processAlive`, `pid`,
`lastState`, `timeoutCategory`, probe counts, elapsed time, advisories, and
`launchAckInconclusive` when the ack itself was ambiguous. Events
`studio.load.state` / `studio.load.progress` feed the observability bus.
No secrets are ever logged (error text only, no tokens).

## Live integration harness

`factory/studio/tests/project-loader.live.test.ts` is **opt-in only**
(`LIVE_STUDIO_INTEGRATION=1`) and skipped in default CI:

```
STUDIO_BRIDGE_URL="http://127.0.0.1:58741/mcp" \
LIVE_STUDIO_INTEGRATION=1 \
npx vitest run factory/studio/tests/project-loader.live.test.ts
```

Safety: with any connected instance present it performs read-only
observation only (no launch, no close, no playtest). With zero instances it
launches exactly one baseplate, observes to ready, then closes it.
