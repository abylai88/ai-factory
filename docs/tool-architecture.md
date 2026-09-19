# AI Factory Tool Layer — Architecture

Weak model + specialized tools + good planning + good context + playtest
feedback + repair loop = much stronger practical agent.

## What was actually built

```
Factory agent
  → ToolRegistry.execute(toolId, args, { role, projectDir })
    → permission check (ROLE_TOOLS matrix + destructive-role gate)
    → handler: studio-bridge | local-exec | filesystem | http | stub
    → ToolResult PASS / FAIL / BLOCKED
  → agent continues reasoning
```

Missing Studio/Blender/Rojo surfaces as **BLOCKED infrastructure** —
never as a game-code FAIL. `rojo build` PASS does NOT imply gameplay PASS;
the runtime QA gate (`factory/roblox/visual-qa.ts`) asserts spawn safety
both statically (no Studio needed) and live (Studio connected).

## Scene Editing Tool Layer (`scene.*`)

The live Studio MCP surface has no native create/delete/clone/move/rename
tool, so `factory/studio/scene-editing.ts` provides them as **safe, bounded,
readback-verified scene edits** on top of the existing bridge:

- **Ops**: `inspect`, `plan` (dry-run), `create`, `clone`, `set`, `move`,
  `rename`, `destroy`, plus typed shortcuts `part`, `spawn`, `folder`,
  `model`, `attachment`, `ui`. Naming (classes), defaults and allowed property
  classes come from the engine allowlists in `factory/roblox/validation.ts`.
- **Safety**:
  - Protected roots (`Workspace`, `Players`, `ReplicatedStorage`,
    `ServerScriptService`, `ServerStorage`, services, `StarterGui`,
    `StarterPlayer`, ...) can never be destroyed/moved/renamed/reparented;
    nothing is ever created/moved/cloned under `Players`.
  - No `Players`/`Teams` class ever; scripts are refused by `destroy` and no
    `Script`/`LocalScript`/`ModuleScript` property is ever written.
  - Destructive edits flow through a guarded Luau chunk emitted with proper
    string escaping + a JSON result envelope, executed on the **edit** peer
    via `execute_luau`, and every successful op is **read back** (structure +
    properties). No read-back → honest failure, never fabricated success.
- **Permissions**: full edit roles are visual/ui/programmer/builder;
  `scene.destroy` is private to visual/programmer and requires `confirm:true`;
  `scene.ui` is restricted to ui/visual; all 14 roles get read-only
  `inspect`/`plan`.
- **Evidence**: every commit pair (before/after structure + properties,
  optional screenshot) is returned in the ToolResult for QA review; captured
  visual state is classified `VISUAL_PASS | VISUAL_FAIL |
  VISUAL_UNVERIFIED | VISUAL_UNAVAILABLE` (`factory/roblox/screenshot.ts`),
  never auto-upgraded to PASS without a vision verdict.

## Module map

| Path | Purpose |
|---|---|
| `factory/tools/types.ts` | ToolDefinition/ToolResult/PASS-FAIL-BLOCKED contract |
| `factory/tools/registry.ts` | Central registry: permissions, timeout, retry, observability |
| `factory/tools/roles.ts` | Role → tool-id matrix (§4 of master task) |
| `factory/tools/safety.ts` | Project/path scope, class allowlist, destructive-role gate |
| `factory/tools/observability.ts` | tool.* / studio.* / playtest.* / screenshot.* / repair.* events |
| `factory/tools/builtin.ts` | Registers every built-in tool (studio + local) |
| `factory/tools/mcp-config.ts` | opencode.json MCP snippet + health checks (no secrets) |
| `factory/studio/bridge.ts` | Studio HTTP-bridge client (PRIMARY-compatible) + discovery |
| `factory/studio/mcp-bridge.ts` | MCP Streamable-HTTP transport bridge (`.../mcp` URL) + `createStudioBridge()` |
| `factory/studio/tools.ts` | inspect/create/modify/delete/scripts/eval/play/output/screenshot |
| `factory/studio/scene-editing.ts` | Controlled scene edits (`scene.*`): typed create/set/move/rename/destroy/clone via safe validated Luau + readback evidence |
| `factory/studio/playtest.ts` | PLAY → OBSERVE → SCREENSHOT → OUTPUT → ASSERT cycle |
| `factory/roblox/toolchain.ts` | stylua/selene/luau-lsp/lune/wally/rokit probes + runs |
| `factory/roblox/visual-qa.ts` | Runtime QA gate + RobloxRepairContext (instances, screenshot, state) |
| `factory/roblox/screenshot.ts` | Screenshot capture + pluggable vision evaluation |
| `factory/roblox/reference-style.ts` | Reference image/text → structured style intent |
| `factory/roblox/asset-search.ts` | Metadata-only search + validated insert + quarantine notes |
| `factory/roblox/gameplay-tools.ts` | create_collectible/shop/quest/zone/checkpoint/npc (transparent Luau) |
| `factory/roblox/game-systems/` | 11 reusable Luau ModuleScripts + install manifest |
| `factory/roblox/smoke-studio.ts` | Real smoke: floor + spawn + coins → validate → rojo → live QA |
| `factory/hermes/gateway.ts` | Telegram → Hermes → Factory intent contract (allowlist, no bypass) |
| `factory/blender/bridge.ts` | OPTIONAL Blender adapter (BLOCKED when absent, never fatal) |

## Studio connection (PRIMARY)

PRIMARY: **Chrrxs/robloxstudio-mcp** (MIT, active 2026) — MCP server +
HTTP bridge (`http://127.0.0.1:3002`) + Studio plugin (long-poll `/poll`,
results via `/response`). This client uses the direct-HTTP surface
(`GET /health`, `GET /status`, `POST /mcp/<tool>`).

ALTERNATE TRANSPORT: when `STUDIO_BRIDGE_URL` points at an MCP endpoint
(`.../mcp`), `factory/studio/mcp-bridge.ts` is used instead — it speaks
MCP JSON-RPC 2.0 / Streamable-HTTP directly to a running Studio MCP server,
so no separate bridge sidecar on 3002 is required. It satisfies the same
`StudioBridgeClient` contract; construction is centralized in
`createStudioBridge()` (also used by `visual-qa.ts`, `smoke-studio.ts`,
`builtin.ts`). Auth token is read from `MCP_AUTH_FILE` (default
`~/.robloxstudio-mcp/auth-token`) and never logged. Unknown factory tools
with no 1:1 MCP mapping (create/clone/delete/move instance) return BLOCKED
(infra) rather than being silently faked.

OPTIONAL FALLBACK / REFERENCE: official Roblox `studio-rust-mcp-server` /
creator-docs MCP surface. Evaluated but not executed: bloxforge,
roblox-ai-studio, stud, and other small MCPs (less maintained / narrower).

Manual setup still required (cannot be done from here):
1. `npx -y @chrrxs/robloxstudio-mcp@latest --auto-install-plugin`
   (or add the `roblox-studio` MCP server from `renderMcpConfigSnippet()`
   to `opencode.json`), fully close + reopen Studio.
2. Open the Rojo-built place (`rojo build` → open `.rbxlx` in Studio).
3. Verify the plugin shows Connected; set `STUDIO_BRIDGE_URL` /
   `STUDIO_BRIDGE_PORT` / `STUDIO_INSTANCE_ID` if non-default. For the MCP
   transport, set `STUDIO_BRIDGE_URL=http://127.0.0.1:<port>/mcp` and
   `MCP_AUTH_FILE` to the auth-token path.

Runtime-QA eval quirk: the eval sandbox (`eval_server_runtime`) returns nil
for class-filtered traversal (`FindFirstChildOfClass` /
`FindFirstChildWhichIsA`) even for valid instances where `IsA()` is true;
server-side QA assertions must use `GetDescendants()` + `IsA()` instead.

## Tool permissions (roles)

- PROGRAMMER: script_read/edit, execute_luau, luau_validate, rojo_build,
  toolchain, playtest, read_output, inspect, gamesystems, gameplay.
- VISUAL (`agents/opencode/visual.md`): inspect/create/modify, terrain,
  lighting, material, asset search/insert, screenshot, playtest.
- UI (`agents/opencode/ui.md`): create/modify/inspect UI, screenshot, playtest.
- QA (`agents/opencode/qa.md`, mirrors tester): play/stop, screenshot,
  output, inspect, runtime_assert, validate, build.
- DIRECTOR: read-only (research, plans, screenshots, results).
- RESEARCH (researcher/market/competitor/idea): web/reference only —
  NO destructive Studio permissions.
- REVIEWER: read-only observation (inspect, screenshots, logs, validate).

Shell-level enforcement lives in
`factory/permissions/permission-profiles.ts` (now 17 profiles: +visual,
+ui, +qa); runtime enforcement in `ToolRegistry.execute`.

## Playtest flow

```
BUILD (rojo validation)
  → OPEN/CONNECT STUDIO (discovery; absent → BLOCKED)
  → PLAY → OBSERVE → SCREENSHOT/VIEWPORT → READ OUTPUT
  → PLAYER STATE (server-peer assertions)
  → EVALUATE → FAIL? → repair context → PLAY AGAIN
```

Repair context preserves: platform, engine, stack, affected files AND
instances, tool name, command, stdout/stderr, screenshot ref, runtime
state, attempt number, failure type (`roblox_runtime`), observation,
suggested route (visual/gameplay — NOT architect for spawn/floor).

## Telegram / Hermes

`factory/hermes/gateway.ts`: `Telegram → Hermes → Factory API/Mission
Gateway → Manager`. Hermes parses intents (`create-game`, `edit-game`,
`add-structure`, `restyle`, `reference-image`, `game-status`) with sender
allowlist validation; the Factory owns execution. Reference images become
structured style intent (`reference-style.ts`), never exact copies.

Upstream: NousResearch/hermes-agent (MIT) — referenced, not vendored.

## Blender (optional)

PRIMARY candidate: ahujasid/blender-mcp (MIT). Reference: official Blender
lab `blender_mcp`. `factory/blender/bridge.ts` health-checks the bridge and
returns TOOL_UNAVAILABLE/BLOCKED when absent — the Roblox pipeline never
breaks without Blender.

## Dev toolchain

`PROGRAMMER → Luau → StyLua → Selene → Luau validation → Lune tests →
Rojo build → Studio playtest` via `factory/roblox/toolchain.ts`.
Binaries invoked, never vendored (Rojo MPL-2.0; StyLua/Selene MPL-2.0;
luau-lsp MIT; Lune MPL-2.0; Wally/Rokit Apache-2.0).

## Quality gates

Static (tsc/Luau/structure/lint/format) → project (Rojo mapping, services,
scripts) → runtime (playtest, screenshots, logs, state) → game (spawn,
core loop, interaction, progression, UI). "All files exist" never equals
"game complete": the runtime gate asserts the player experience.

## OpenCode MCP config

No root `opencode.json` exists in this repo (per-project configs are
generated at scaffold). Merge the snippet from `renderMcpConfigSnippet()`:

```json
{
  "mcpServers": {
    "roblox-studio": { "command": "npx", "args": ["-y", "@chrrxs/robloxstudio-mcp@latest"] },
    "blender": { "command": "uvx", "args": ["blender-mcp"] }
  }
}
```

Both servers are optional; health is checked at runtime via
`checkMcpHealth()` + `StudioBridge.discover()`.

## License record (third-party, all referenced — nothing vendored)

| Repo | License | Commercial | Attribution | Use |
|---|---|---|---|---|
| Chrrxs/robloxstudio-mcp | MIT | yes | yes (keep notice) | PRIMARY Studio bridge protocol-compatible client (own code) |
| Roblox/creator-docs, studio-rust-mcp-server | Apache-2.0/CC-BY (docs) | yes | yes | fallback/reference |
| NousResearch/hermes-agent | MIT | yes | yes | gateway contract only |
| ahujasid/blender-mcp | MIT | yes | yes | optional bridge contract |
| Blender lab blender_mcp | GPL-compatible (Blender) | addon terms | yes | reference only |
| rojo-rbx/rojo | MPL-2.0 | yes (binary use) | n/a (invoke binary) | external binary |
| StyLua/Selene/Lune | MPL-2.0 | yes (binary use) | n/a | external binaries |
| luau-lsp | MIT | yes | n/a (invoke) | external binary |
| Wally/Rokit | Apache-2.0 | yes | n/a (invoke) | external binaries |

## How to install / verify tools

```bash
npx tsc --noEmit                       # static gate
npx vitest run factory/tools factory/studio factory/roblox  # tool-layer tests
npx tsx factory/roblox/smoke-provision.ts  # existing provision smoke
ROJO_BIN=/mnt/c/Users/<you>/.rokit/tool-storage/rojo-rbx/rojo/7.7.0/rojo.exe \
  npx vitest run factory/roblox        # rojo-backed validation
```

Studio live path: install the MCP plugin (above), open Studio, then the
`runtime.assert` / `studio.*` tools flip from BLOCKED to live.
