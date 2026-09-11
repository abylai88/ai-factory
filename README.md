# AI Factory

Autonomous AI game factory that takes a goal string, provisions a Phaser/TypeScript project, creates a mission with an execution plan, delegates work to specialized AI agents via OpenCode SDK, performs self-healing repairs, and validates with visual QA -- all orchestrated through a mission-based pipeline system.

## Quick Start

```bash
npm install
npm run mission -- run "Build a simple traffic dodge game"
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run mission -- run "Goal"` | Execute a mission |
| `npm run mission -- diagnose <id>` | Diagnose a failed mission |
| `npm run mission -- list-templates` | List project templates |
| `npm run start -- new "Goal"` | Legacy CLI entry point |

### Mission Options

| Flag | Description | Default |
|------|-------------|---------|
| `--project <dir>` | Project directory | `./projects/<slug>` |
| `--template <id>` | Template for new project | `yagames-phaser-template` |
| `--engine <name>` | Engine: `web` or `unity` | auto-detected |
| `--max-repairs <N>` | Max repair iterations | `3` |
| `--dry-run` | Show plan only, no execution | `false` |
| `--read-only` | Investigation only (no file modifications) | `false` |
| `--force` | Replace existing workspace | `false` |

## Architecture

### Execution Flow

```
Goal String
  -> classifyGoal() + classifyEngine()
  -> ProjectProvisioner.setupWorkspace()
  -> MissionPlanner.createPlan() [OpenCode-backed or ReadOnlyPlanner]
  -> MissionState (file-based JSON persistence)
  -> MissionOrchestrator.executeMission()
    -> ModelRouter.chooseModel()
    -> FactoryExecutionAdapter.runDelegation()
      -> runGoal() -> PipelineRunner -> TaskRunner -> OpenCode -m <model>
    -> ValidationGate (build/test)
    -> DeterministicAuditor.audit()
    -> PeerReviewSystem.review()
    -> MissionSupervisor (stuck detection, failure recovery)
    -> PlaywrightVisualQaAdapter (visual QA)
    -> SelfHealingRepairLoop
  -> Mission State JSON
```

### Core Module: `factory/mission/`

| File | Purpose |
|------|---------|
| `index.ts` | CLI entry point (527 lines) |
| `game-mission.ts` | Programmatic API for game missions |
| `orchestrator.ts` | `MissionOrchestrator` -- core execution engine (2122 lines) |
| `mission.ts` | Domain model: `Mission`, `ExecutionPlan`, `Delegation`, `AgentResult`, `AuditResult` (Zod schemas) |
| `state.ts` | File-based JSON state persistence per mission |
| `mission-planner.ts` | `MissionPlanner` with OpenCode-backed planning + deterministic fallback |
| `opencode-planner-model.ts` | `OpenCodePlannerModel` -- LLM-backed plan generation |
| `model-router.ts` | `ModelRouter` -- role/complexity-based model selection |
| `mission-supervisor.ts` | `MissionSupervisor` -- monitors execution, makes recovery decisions |
| `peer-review.ts` | `PeerReviewSystem` -- post-execution independent review |
| `validation-gate.ts` | `ValidationGate` -- build/test validation |
| `adapters.ts` | `CodingMissionAuditor` |
| `events.ts` | `InMemoryEventSink`, `MissionEventPublisher`, event type registry |
| `diagnosis.ts` | `classifyDiagnosis()`, `generateRepairPlan()` |
| `failure-triage.ts` | `classifyFailure()`, `buildTriagePrompt()` |
| `repair-executor.ts` | `DeterministicRepairExecutor` |
| `project-provisioner.ts` | Template-based project provisioning |
| `mission-project-manager.ts` | `MissionProjectManager`, `MissionAwareFactoryAdapter` |
| `playwright-visual-qa-adapter.ts` | Browser-based visual QA |
| `mission-memory.ts` | Cross-mission knowledge persistence |
| `artifact-store.ts` | Mission artifact storage |

### Agent Roles

Seven specialized roles: Manager, Researcher, Developer, Designer, QA, Repair, Architect.

Agent prompt definitions live in `agents/` (30 Markdown files across 6 categories). These are reference documents -- the production system uses OpenCode SDK with model-based agents, not the prompt files directly.

### Key Interfaces

```typescript
interface FactoryExecutionAdapter {
  runDelegation(delegation, mission, config): Promise<AgentResult>;
}

interface Auditor {
  audit(delegation, result, mission, plan): Promise<AuditResult>;
}
```

## Model Routing

`ModelRouter` selects models based on role and complexity:

```typescript
const router = createModelRouter();
const route = router.chooseModel({ delegation, role: "Developer", mission });
// route.primary, route.fallbacks, route.reason
```

## Testing

```bash
npm test              # Single run
npm run test:watch    # Watch mode
npm run typecheck     # Type-check only
```

**710 tests** across 37 test files covering:
- Mission planning and decomposition
- Orchestrator execution flow
- State persistence and recovery
- Model routing and fallback
- Supervisor stuck detection and failure recovery
- Peer review and audit systems
- Validation gate and repair loops
- Visual QA integration
- E2E full pipeline tests

## Tech Stack

- **Runtime:** Node.js (ESM)
- **Language:** TypeScript 7 (strict mode)
- **AI SDK:** OpenCode AI SDK (`@opencode-ai/sdk`)
- **Validation:** Zod 4
- **Testing:** Vitest 4
- **Execution:** tsx (no build step)
- **Visual QA:** Playwright
- **Project Template:** Phaser + TypeScript (`yagames-phaser-template`)
