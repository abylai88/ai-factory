import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMission,
  createDelegation,
  createExecutionPlan,
} from "../mission.js";
import type { Delegation, Mission, AgentRole } from "../mission.js";
import { MissionState } from "../state.js";
import { MissionOrchestrator } from "../orchestrator.js";
import { CodingMissionAuditor } from "../adapters.js";
import { InMemoryEventSink } from "../events.js";

// ─── Helpers ──────────────────────────────────────────────────

async function createTestProject(baseDir: string): Promise<string> {
  const projectPath = path.join(baseDir, "projects", "smoke-game");
  await fs.mkdir(path.join(projectPath, "src"), { recursive: true });
  await fs.mkdir(path.join(projectPath, "docs"), { recursive: true });

  await fs.writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify({
      name: "smoke-game",
      version: "1.0.0",
      scripts: { build: "echo ok", typecheck: "echo ok" },
    }, null, 2)
  );

  await fs.writeFile(
    path.join(projectPath, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2022" } }, null, 2)
  );

  await fs.writeFile(
    path.join(projectPath, "docs", "game-design-document.md"),
    "# Game Design Document\n\n## Concept\nA simple arcade game.\n\n## Mechanics\n- Player moves left/right\n- Enemies spawn from top\n- Score increases on hit\n"
  );

  await fs.writeFile(
    path.join(projectPath, "src", "index.ts"),
    "export const GAME_WIDTH = 800;\nexport const GAME_HEIGHT = 600;\n"
  );

  return projectPath;
}

// ─── Competitor Smoke Test ────────────────────────────────────

describe("SMOKE: Competitor Agent", () => {
  let tmpDir: string;
  let projectPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-competitor-"));
    projectPath = await createTestProject(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("produces competitor analysis artifact via delegation", async () => {
    const mission = createMission("Competitor analysis for arcade game", {
      projectId: "smoke-game",
      engine: "web",
      stack: "phaser",
      workspace: projectPath,
    });

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const delegation = createDelegation(
      mission.id,
      "obj-1",
      "[1] Competitor Analysis",
      "Read docs/ and write docs/competitor-analysis.md with bounded competitor research.\nROLE: competitor",
      "game",
      {
        stepIds: ["competitor"],
        dependsOn: [],
        parallelizable: false,
        acceptanceCriteria: [
          "Competitor analysis completed",
          "Direct competitors analyzed",
          "Differentiation opportunities identified",
        ],
        role: "Researcher" as AgentRole,
      }
    );

    const plan = createExecutionPlan(
      mission,
      [{ id: "obj-1", title: "Research", description: "Research", delegations: [delegation.id] }],
      [delegation],
      [],
      []
    );

    await state.setPlan(plan);
    await state.addDelegation(delegation);

    // Mock adapter that simulates a successful competitor agent
    const mockAdapter = {
      async runDelegation(del: Delegation) {
        // Simulate competitor agent: read docs, write analysis
        const gddPath = path.join(projectPath, "docs", "game-design-document.md");
        const gdd = await fs.readFile(gddPath, "utf-8");

        const analysis = `# Competitor Analysis

## Game Concept Summary
${gdd.split("\n").filter(l => l.startsWith("## Concept")).map(l => l.replace("## Concept", "").trim()).join(" ")}

## Direct Competitors
| Name | Platform | Why similar | Strength | Weakness |
|------|----------|-------------|----------|----------|
| Space Invaders | Web/Mobile | Classic arcade shooter | Iconic gameplay | Dated graphics |
| Galaga | Web/Arcade | Fixed shooter | Tight controls | Limited variety |
| Phoenix | Web/Arcade | Multi-layered shooter | Enemy variety | Unknown to modern players |

## Indirect Competitors
| Name | Platform | Relevance |
|------|----------|-----------|
| Tetris | Web/Mobile | Casual arcade audience |
| Flappy Bird | Mobile | Simple mechanics, high replay |

## Differentiation Opportunities
- Modern pixel art style: appeals to retro enthusiasts
- Combo system: adds depth beyond basic shooting
- Procedural levels: high replayability

## Feature Priorities
1. Core shooting mechanic → foundation
2. Enemy variety → engagement
3. Score system → motivation
`;

        await fs.writeFile(path.join(projectPath, "docs", "competitor-analysis.md"), analysis);

        return {
          delegationId: del.id,
          status: "passed" as const,
          output: "Competitor analysis complete. STATUS: ok. Direct competitors identified and analyzed. Differentiation opportunities documented. Feature priorities set.",
          durationMs: 500,
        };
      },
    };

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 0,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: mockAdapter as any,
      auditor: new CodingMissionAuditor(),
      eventSink: new InMemoryEventSink(),
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);

    // 1. Process started and completed
    expect(result.status).toBe("completed");

    // 2. Correct agent was invoked (via delegation role)
    const finalDel = state.getDelegation(delegation.id);
    expect(finalDel).toBeDefined();
    expect(finalDel!.status).toBe("passed");

    // 3. Correct cwd was used (project workspace)
    // (Verified by mockAdapter reading from projectPath)

    // 4. Artifact was created
    const artifactPath = path.join(projectPath, "docs", "competitor-analysis.md");
    const artifactExists = await fs.access(artifactPath).then(() => true, () => false);
    expect(artifactExists).toBe(true);

    // 5. Artifact contains required sections
    const artifact = await fs.readFile(artifactPath, "utf-8");
    expect(artifact).toContain("Direct Competitors");
    expect(artifact).toContain("Differentiation Opportunities");
    expect(artifact).toContain("Feature Priorities");

    // 6. Result returned to orchestrator
    expect(finalDel!.result).toBeDefined();

    // 7. Process terminated normally (no hanging)
    // (Verified by the fact that executeMission completed)
  });
});

// ─── Programmer Smoke Test ────────────────────────────────────

describe("SMOKE: Programmer Agent", () => {
  let tmpDir: string;
  let projectPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-programmer-"));
    projectPath = await createTestProject(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("performs real code modification and returns success", async () => {
    const mission = createMission("Add a player score system", {
      projectId: "smoke-game",
      engine: "web",
      stack: "phaser",
      workspace: projectPath,
    });

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const delegation = createDelegation(
      mission.id,
      "obj-1",
      "[1] Implement Score System",
      "Read docs/game-design-document.md. Edit src/index.ts to add a SCORE_CONSTANT. Run typecheck.\nROLE: programmer",
      "engineering",
      {
        stepIds: ["implementation"],
        dependsOn: [],
        parallelizable: false,
        acceptanceCriteria: [
          "Source file modified",
          "Build/typecheck passes",
        ],
        role: "Developer" as AgentRole,
      }
    );

    const plan = createExecutionPlan(
      mission,
      [{ id: "obj-1", title: "Implement", description: "Implement", delegations: [delegation.id] }],
      [delegation],
      [],
      []
    );

    await state.setPlan(plan);
    await state.addDelegation(delegation);

    // Mock adapter that simulates a successful programmer agent
    const mockAdapter = {
      async runDelegation(del: Delegation) {
        // Simulate programmer agent: read GDD, edit source file
        const indexPath = path.join(projectPath, "src", "index.ts");
        const content = await fs.readFile(indexPath, "utf-8");

        // Add score constant
        const newContent = content + "\nexport const INITIAL_SCORE = 0;\n";
        await fs.writeFile(indexPath, newContent);

        return {
          delegationId: del.id,
          status: "passed" as const,
          output: "STATUS: ok. WHAT WAS DONE: Added INITIAL_SCORE constant. FILES CHANGED: src/index.ts. VERIFICATION: npx tsc --noEmit passed. Source file modified. Build/typecheck passes.",
          durationMs: 500,
        };
      },
    };

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 0,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: mockAdapter as any,
      auditor: new CodingMissionAuditor(),
      eventSink: new InMemoryEventSink(),
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);

    // 1. Process started and completed
    expect(result.status).toBe("completed");

    // 2. Correct agent was invoked
    const finalDel = state.getDelegation(delegation.id);
    expect(finalDel).toBeDefined();
    expect(finalDel!.status).toBe("passed");

    // 3. Correct cwd was used
    // (Verified by mockAdapter reading/writing from projectPath)

    // 4. Source file was actually modified
    const modifiedContent = await fs.readFile(path.join(projectPath, "src", "index.ts"), "utf-8");
    expect(modifiedContent).toContain("INITIAL_SCORE");
    expect(modifiedContent.length).toBeGreaterThan(0);

    // 5. Result returned as GoalResult with passed status
    expect(finalDel!.result).toBeDefined();
    expect(finalDel!.result).toContain("STATUS: ok");
    expect(finalDel!.result).toContain("FILES CHANGED");

    // 6. Process terminated normally
    // (Verified by executeMission completing)
  });

  it("programmer receives implementation requirements and existing artifacts", async () => {
    const mission = createMission("Implement game mechanics", {
      projectId: "smoke-game",
      engine: "web",
      stack: "phaser",
      workspace: projectPath,
    });

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const delegation = createDelegation(
      mission.id,
      "obj-1",
      "[1] Implement Movement",
      "Read docs/game-design-document.md and src/index.ts. Add player movement code.\nROLE: programmer",
      "engineering",
      {
        stepIds: ["implementation"],
        dependsOn: [],
        parallelizable: false,
        acceptanceCriteria: ["Source file modified"],
        role: "Developer" as AgentRole,
      }
    );

    let receivedPrompt = "";
    const mockAdapter = {
      async runDelegation(del: Delegation, mission: Mission, config: any) {
        // Capture what the agent would receive
        receivedPrompt = `project:${config.project}`;
        return {
          delegationId: del.id,
          status: "passed" as const,
          output: "Done",
          durationMs: 100,
        };
      },
    };

    const plan = createExecutionPlan(
      mission,
      [{ id: "obj-1", title: "Implement", description: "Implement", delegations: [delegation.id] }],
      [delegation],
      [],
      []
    );

    await state.setPlan(plan);
    await state.addDelegation(delegation);

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 0,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: mockAdapter as any,
      auditor: new CodingMissionAuditor(),
      eventSink: new InMemoryEventSink(),
      missionState: state,
    });

    await orchestrator.executeMission(mission, plan);

    // Verify the adapter received the correct project workspace
    expect(receivedPrompt).toContain(projectPath);
  });
});

// ─── Full Integration Smoke Test ──────────────────────────────

describe("SMOKE: Full Delegation Flow", () => {
  let tmpDir: string;
  let projectPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "smoke-full-"));
    projectPath = await createTestProject(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("competitor then programmer sequence works end-to-end", async () => {
    const mission = createMission("Research and implement arcade game", {
      projectId: "smoke-game",
      engine: "web",
      stack: "phaser",
      workspace: projectPath,
    });

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const competitorDel = createDelegation(
      mission.id,
      "obj-1",
      "[1] Competitor Analysis",
      "Write docs/competitor-analysis.md\nROLE: competitor",
      "game",
      {
        stepIds: ["competitor"],
        dependsOn: [],
        parallelizable: false,
        role: "Researcher" as AgentRole,
      }
    );
    competitorDel.id = "comp-del";

    const programmerDel = createDelegation(
      mission.id,
      "obj-2",
      "[2] Implement Game",
      "Edit src/index.ts to add game constants\nROLE: programmer",
      "engineering",
      {
        stepIds: ["implementation"],
        dependsOn: ["comp-del"],
        parallelizable: false,
        role: "Developer" as AgentRole,
      }
    );
    programmerDel.id = "prog-del";

    const plan = createExecutionPlan(
      mission,
      [
        { id: "obj-1", title: "Research", description: "Research", delegations: ["comp-del"] },
        { id: "obj-2", title: "Implement", description: "Implement", delegations: ["prog-del"] },
      ],
      [competitorDel, programmerDel],
      [],
      []
    );

    await state.setPlan(plan);
    await state.addDelegation(competitorDel);
    await state.addDelegation(programmerDel);

    const executionOrder: string[] = [];

    const mockAdapter = {
      async runDelegation(del: Delegation) {
        executionOrder.push(del.id);

        if (del.id === "comp-del") {
          await fs.writeFile(
            path.join(projectPath, "docs", "competitor-analysis.md"),
            "# Competitor Analysis\n\n## Direct Competitors\n- Test Game\n"
          );
          return {
            delegationId: del.id,
            status: "passed" as const,
            output: "Analysis complete",
            durationMs: 100,
          };
        }

        if (del.id === "prog-del") {
          const indexPath = path.join(projectPath, "src", "index.ts");
          const content = await fs.readFile(indexPath, "utf-8");
          await fs.writeFile(indexPath, content + "\nexport const GAME_TITLE = 'Smoke Game';\n");
          return {
            delegationId: del.id,
            status: "passed" as const,
            output: "Implementation complete",
            durationMs: 100,
          };
        }

        return {
          delegationId: del.id,
          status: "passed" as const,
          output: "ok",
          durationMs: 100,
        };
      },
    };

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 0,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: mockAdapter as any,
      auditor: new CodingMissionAuditor(),
      eventSink: new InMemoryEventSink(),
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);

    // 1. Mission completed
    expect(result.status).toBe("completed");

    // 2. Both delegations executed in order
    expect(executionOrder).toEqual(["comp-del", "prog-del"]);

    // 3. Competitor artifact exists
    const compArtifact = await fs.access(
      path.join(projectPath, "docs", "competitor-analysis.md")
    ).then(() => true, () => false);
    expect(compArtifact).toBe(true);

    // 4. Programmer code change exists
    const modifiedCode = await fs.readFile(path.join(projectPath, "src", "index.ts"), "utf-8");
    expect(modifiedCode).toContain("GAME_TITLE");

    // 5. Both delegations passed
    expect(state.getDelegation("comp-del")!.status).toBe("passed");
    expect(state.getDelegation("prog-del")!.status).toBe("passed");

    // 6. No hanging (executeMission returned)
    // (Verified by the test completing)
  });
});
