# AI Game Company — Mission Lifecycle & Contracts

What is actually implemented (not aspirational). For the full gap map and
evidence, see the mission final report.

## Company flow

```
goal → Production Blueprint → Director vision → MissionPlanner plan
  → dependency-aware delegation graph → specialists → validation
  → QA hierarchy (8 levels) → failure triage → specialist repair
  → repair history (repeat detection) → retest → reviewer → final package
```

Research/market/competitor agents produce **structured design signals**
("fast feedback + visible progression"), never copied maps/UI. Execution
agents (programmer/gameplay/visual/ui/content) implement original systems
through the typed tool layer.

## Key modules (`factory/mission/`)

| Module | Role |
|---|---|
| `blueprint.ts` | `deriveBlueprintFromGoal` — structured pre-implementation contract (platform, genre, core loop, progression, monetization, systems, acceptance/QA/launch criteria). `blueprintSliceForRole` serves per-role summaries. |
| `director-vision.ts` | Director turns blueprint + research into vision/plans/milestones with a **frozen core** lower agents may not redefine without evidence. |
| `mission-planner.ts` | LLM planner with deterministic fallback; blueprint summary injected into the planning prompt. |
| `specialist-roles.ts` | 13 specialists, handoff contracts (receives/produces/must-not), core-role mapping, `routeFailureToSpecialist` + text overrides (UI/monetization/content). |
| `context-handoff.ts` | `buildRoleHandoff` — bounded role-specific block (blueprint slice, research, decisions, bugs, evidence, acceptance). |
| `orchestrator.ts` | Dependency graph (`dependsOn`/`parallelizable`), per-delegation handoff injection (`delegation.context.handoff` event), blueprint event (`mission.blueprint.created`), audit → triage → repair → re-audit, peer review, supervisor recovery, repair-history gating. |
| `qa-hierarchy.ts` | 8 levels: static-build → structural → studio-readiness → runtime → gameplay-assertions → visual → regression → final-review. Higher PASS requires lower PASS; runtime PASS needs runtime evidence; visual PASS needs screenshots. |
| `failure-triage.ts` | Pattern rules → category/action/targetRole + owning `specialist`. |
| `repair-history.ts` | Per-delegation repair ledger; `decide` returns proceed / retry-different / blocked (NEEDS_HUMAN on exhausted budget). |
| `resource-control.ts` | `outputs/locks/` file locks: `roblox-studio-singleton`, per-project locks, `ConcurrencyGate`. |
| `artifact-store.ts` | In-memory mission artifacts with bounded context rendering. |

## Roblox production loop (`factory/roblox/production-loop.ts`)

17 ordered stages: source-validation → artifact-provisioning →
project-ready → studio-connect → programmer-tools → scene-tools →
ui-tools → playtest → runtime-assertions → logs → screenshot →
visual-qa → failure-classification → specialist-repair → rebuild →
retest → teardown. Offline-testable via injectable steps; live behavior
delegates to the existing systems (validation, `project-ready.ts`,
scene-editing, playtest lifecycle, screenshot, visual-qa).

## Single-Studio policy

- `factory/studio/project-loader.ts` reuses a healthy existing Studio (PLACE_READY) instead of launching.
- `executeGameMission` holds the `roblox-studio-singleton` lock for Roblox missions; contention returns an honest BLOCKED error — never a second instance.
- Ordinary tests never touch Studio/MCP/network (fake adapters + tmp dirs).

## Hermes status contract (`factory/hermes/status.ts`)

Internal `MissionStatus` → external stage: queued / planning /
researching / building / testing / repairing / blocked / passed /
failed, plus project, active role/task, progress counts, failure
category, retry count, evidence refs. No secrets cross the boundary.

## Model routing (`factory/model-router/router.ts`)

Existing per-role pools + rotation preserved. Added
`classifyTaskComplexity` (LOW/MEDIUM/HIGH/VERY_HIGH) and
`chooseModelForComplexity` with env-configurable pools
(`AI_FACTORY_MODELS_{LOW,MEDIUM,HIGH,VERY_HIGH}`).

## Mission persistence & resume (`state.ts`, `persisted-memory.ts`)

Single persistence system: `MissionState` (versioned JSON snapshot +
JSONL event log under `outputs/missions/`). Snapshot v1 persists mission,
plan, delegations, audits, repairs, diagnosis, visual QA **plus**
artifact metadata, key decisions, the repair ledger, supervisor/escalation
trail, and Roblox readiness summaries. `ArtifactStore`/`RepairHistory`
hydrate from it on every `executeMission` and sync back on meaningful
transitions only (artifact registered, repair attempted, decision made).

- Atomic writes: validate → unique tmp file → rotate previous to `.bak` →
  rename. A crash leaves at most a stray `.tmp`; the last valid state is
  never destroyed. In-process write mutex serializes parallel completions.
- Load order: snapshot → `.bak` → JSONL replay. v0 snapshots migrate with
  safe defaults; newer-than-supported versions are hard BLOCKED/NEEDS_HUMAN.
- Never persisted: secrets/tokens/credentials, Studio peer IDs, live MCP
  connections, running playtests, raw transcripts (summaries only, bounded).
  On resume, readiness is marked `needsRevalidation` — Studio liveness is
  re-checked, never blindly reused.
- Hermes status rebuilds from the persisted summary identically pre/post
  restart (`missionSummaryToHermesStatus`).

## Evidence honesty rules (enforced)
- Never runtime PASS from static validation (`qa-hierarchy.ts`).
- Never visual PASS without screenshots (`qa-hierarchy.ts`, visual/ui agents).
- Never fake teardown (production loop requires teardown evidence).
- Infrastructure BLOCKED (Studio/MCP/Rojo missing) is never a code FAIL
  (`bridge.ts`, failure-triage `tool_unavailable` rules).
