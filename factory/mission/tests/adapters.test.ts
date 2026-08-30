import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMission,
  createDelegation,
  Mission,
  Delegation,
  AgentResult,
} from "../mission.js";
import { MissionState } from "../state.js";
import { createPlanner } from "../planner.js";
import {
  MissionOrchestrator,
  DeterministicAuditor,
} from "../orchestrator.js";
import { InMemoryEventSink, MissionEventTypes } from "../events.js";
import {
  ControlledCodingAdapter,
  ControlledBuildAdapter,
  CompositeCodingBuildAdapter,
  CodingMissionAuditor,
  validateFilePath,
  validateProjectRoot,
  extractMetadata,
  PROTECTED_PATHS,
} from "../adapters.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "adapter-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeMission(goal = "Fix the Traffic Dodge package name"): Mission {
  return createMission(goal, {
    projectId: "traffic-dodge",
    engine: "web",
    stack: "Phaser + TypeScript",
    template: "yagames-phaser-template",
    workspace: path.join(tmpDir, "projects", "traffic-dodge"),
  });
}

function makeDelegationWithMetadata(description: string, deps: string[] = []): Delegation {
  const mission = makeMission();
  return createDelegation(mission.id, "obj-1", "Test Delegation", description, "engineering", {
    dependsOn: deps,
    acceptanceCriteria: ["Test passed"],
  });
}

// ─── Coder Delegation Creation ──────────────────────────────────────

describe("coder delegation creation", () => {
  it("creates delegation with coder role metadata", () => {
    const del = makeDelegationWithMetadata(
      "Replace package name\nROLE: coder\nFILE: package.json\nOPERATION: replace\nFIELD: name\nOLD_VALUE: neon-breaker\nVALUE: traffic-dodge"
    );
    const metadata = extractMetadata(del);
    expect(metadata.role).toBe("coder");
    expect(metadata.codingOperation).toBeDefined();
    expect(metadata.codingOperation!.file).toBe("package.json");
    expect(metadata.codingOperation!.operation).toBe("replace");
    expect(metadata.codingOperation!.field).toBe("name");
  });

  it("creates delegation with builder role metadata", () => {
    const del = makeDelegationWithMetadata(
      "Run build\nROLE: builder\nBUILD_COMMAND: npm run build:prod"
    );
    const metadata = extractMetadata(del);
    expect(metadata.role).toBe("builder");
    expect(metadata.buildCommand).toBe("npm run build:prod");
  });
});

// ─── Safe File Allowlist ────────────────────────────────────────────

describe("safe file allowlist", () => {
  it("allows editing files within project root", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "package.json"), '{"name":"test"}');

    const adapter = new ControlledCodingAdapter();
    const del = makeDelegationWithMetadata(
      "Read file\nROLE: coder\nFILE: package.json\nOPERATION: read"
    );
    const mission = makeMission();

    const result = await adapter.runDelegation(del, mission, {
      baseDir: tmpDir,
      project: projectDir,
    });

    expect(result.status).toBe("passed");
    const parsed = JSON.parse(result.output);
    expect(parsed.file).toBe("package.json");
  });

  it("rejects files outside project root", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const adapter = new ControlledCodingAdapter();
    const del = makeDelegationWithMetadata(
      "Read file\nROLE: coder\nFILE: ../../etc/passwd\nOPERATION: read"
    );
    const mission = makeMission();

    const result = await adapter.runDelegation(del, mission, {
      baseDir: tmpDir,
      project: projectDir,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("traversal");
  });
});

// ─── Path Traversal Rejected ────────────────────────────────────────

describe("path traversal rejected", () => {
  it("rejects ../ traversal in file path", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const result = validateFilePath("../../etc/passwd", projectDir);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("traversal");
  });

  it("rejects absolute path in file", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const result = validateFilePath("/etc/passwd", projectDir);
    expect(result.valid).toBe(false);
  });

  it("rejects path with shell metacharacters", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const result = validateFilePath("file`id`.json", projectDir);
    expect(result.valid).toBe(false);
  });
});

// ─── Protected Path Rejected ────────────────────────────────────────

describe("protected path rejected", () => {
  it("rejects files in factory directory", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const result = validateFilePath("factory/mission/mission.ts", projectDir);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("protected directory");
  });

  it("rejects files in agents directory", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const result = validateFilePath("agents/orchestrator.md", projectDir);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("protected directory");
  });

  it("rejects files in visual-office directory", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const result = validateFilePath("visual-office/package.json", projectDir);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("protected directory");
  });

  it("rejects factory as project root", () => {
    const result = validateProjectRoot(path.resolve("factory"));
    expect(result.valid).toBe(false);
  });

  it("rejects agents as project root", () => {
    const result = validateProjectRoot(path.resolve("agents"));
    expect(result.valid).toBe(false);
  });

  it("rejects visual-office as project root", () => {
    const result = validateProjectRoot(path.resolve("visual-office"));
    expect(result.valid).toBe(false);
  });
});

// ─── Arbitrary Command Rejected ──────────────────────────────────────

describe("arbitrary command rejected", () => {
  it("rejects shell metacharacters in project root", () => {
    const result = validateProjectRoot("project; rm -rf /");
    expect(result.valid).toBe(false);
  });

  it("rejects command injection in file path", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const result = validateFilePath("file$(whoami).json", projectDir);
    expect(result.valid).toBe(false);
  });

  it("rejects pipe characters in file path", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const result = validateFilePath("file|cat /etc/passwd", projectDir);
    expect(result.valid).toBe(false);
  });
});

// ─── Targeted Package Metadata Change ────────────────────────────────

describe("targeted package metadata change", () => {
  it("replaces package name in package.json", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", version: "1.0.0" }, null, 2)
    );

    const adapter = new ControlledCodingAdapter();
    const del = makeDelegationWithMetadata(
      "Replace name\nROLE: coder\nFILE: package.json\nOPERATION: replace\nFIELD: name\nOLD_VALUE: neon-breaker\nVALUE: traffic-dodge"
    );
    const mission = makeMission();

    const result = await adapter.runDelegation(del, mission, {
      baseDir: tmpDir,
      project: projectDir,
    });

    expect(result.status).toBe("passed");
    const parsed = JSON.parse(result.output);
    expect(parsed.fieldChanged).toBe("name");
    expect(parsed.newValue).toBe("traffic-dodge");
    expect(parsed.oldValue).toBe("neon-breaker");

    const fileContent = await fs.readFile(path.join(projectDir, "package.json"), "utf8");
    const pkg = JSON.parse(fileContent);
    expect(pkg.name).toBe("traffic-dodge");
  });
});

// ─── Unchanged Unrelated Fields ──────────────────────────────────────

describe("unchanged unrelated fields", () => {
  it("preserves all other fields in package.json", async () => {
    const original = {
      name: "neon-breaker",
      version: "1.0.0",
      description: "A game",
      main: "src/game/game.js",
      scripts: { dev: "webpack serve", build: "webpack" },
      dependencies: { phaser: "^3.90.0" },
    };
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify(original, null, 2)
    );

    const adapter = new ControlledCodingAdapter();
    const del = makeDelegationWithMetadata(
      "Replace name\nROLE: coder\nFILE: package.json\nOPERATION: replace\nFIELD: name\nOLD_VALUE: neon-breaker\nVALUE: traffic-dodge"
    );
    const mission = makeMission();

    await adapter.runDelegation(del, mission, {
      baseDir: tmpDir,
      project: projectDir,
    });

    const fileContent = await fs.readFile(path.join(projectDir, "package.json"), "utf8");
    const pkg = JSON.parse(fileContent);
    expect(pkg.name).toBe("traffic-dodge");
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.description).toBe("A game");
    expect(pkg.main).toBe("src/game/game.js");
    expect(pkg.scripts).toEqual(original.scripts);
    expect(pkg.dependencies).toEqual(original.dependencies);
  });
});

// ─── Build Delegation ────────────────────────────────────────────────

describe("build delegation", () => {
  it("executes build command successfully", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "package.json"), '{"name":"test","scripts":{"build":"echo success"}}');
    await fs.chmod(path.join(projectDir, "package.json"), 0o644);

    const adapter = new ControlledBuildAdapter();
    const del = makeDelegationWithMetadata(
      "Run build\nROLE: builder\nBUILD_COMMAND: echo build-success"
    );
    const mission = makeMission();

    const result = await adapter.runDelegation(del, mission, {
      baseDir: tmpDir,
      project: projectDir,
    });

    expect(result.status).toBe("passed");
    const parsed = JSON.parse(result.output);
    expect(parsed.status).toBe("success");
    expect(parsed.exitCode).toBe(0);
  });
});

// ─── Build Failure Propagation ───────────────────────────────────────

describe("build failure propagation", () => {
  it("propagates build failure with exit code", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const adapter = new ControlledBuildAdapter();
    const del = makeDelegationWithMetadata(
      "Run failing build\nROLE: builder\nBUILD_COMMAND: false"
    );
    const mission = makeMission();

    const result = await adapter.runDelegation(del, mission, {
      baseDir: tmpDir,
      project: projectDir,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Build failed");
  });

  it("handles missing build command", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const adapter = new ControlledBuildAdapter();
    const del = makeDelegationWithMetadata("No build command specified");
    const mission = makeMission();

    const result = await adapter.runDelegation(del, mission, {
      baseDir: tmpDir,
      project: projectDir,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("No build command");
  });
});

// ─── Successful Coding Mission ──────────────────────────────────────

describe("successful coding mission", () => {
  it("completes full coding + build mission via orchestrator", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", version: "1.0.0", scripts: { "build:prod": "echo build-ok" } }, null, 2)
    );

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const adapter = new CompositeCodingBuildAdapter();
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter: adapter,
      auditor,
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");

    const pkg = JSON.parse(await fs.readFile(path.join(projectDir, "package.json"), "utf8"));
    expect(pkg.name).toBe("traffic-dodge");
  });
});

// ─── Auditor Detects Intended Change ────────────────────────────────

describe("auditor detects intended change", () => {
  it("passes when intended file changed", async () => {
    const auditor = new CodingMissionAuditor();
    const delegation = createDelegation("m1", "obj1", "Modify Package", "desc", "engineering", {
      acceptanceCriteria: ["Intended file changed"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: JSON.stringify({
        projectId: "traffic-dodge",
        file: "package.json",
        operation: "replace",
        beforeContent: '{"name":"neon-breaker"}',
        afterContent: '{"name":"traffic-dodge"}',
        fieldChanged: "name",
        oldValue: "neon-breaker",
        newValue: "traffic-dodge",
      }),
      durationMs: 100,
    };
    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("PASS");
  });

  it("passes when only intended change occurred", async () => {
    const auditor = new CodingMissionAuditor();
    const delegation = createDelegation("m1", "obj1", "Modify Package", "desc", "engineering", {
      acceptanceCriteria: ["Only intended change occurred"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: JSON.stringify({
        projectId: "traffic-dodge",
        file: "package.json",
        operation: "replace",
        beforeContent: '{"name":"neon-breaker","version":"1.0.0"}',
        afterContent: '{"name":"traffic-dodge","version":"1.0.0"}',
        fieldChanged: "name",
      }),
      durationMs: 100,
    };
    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("PASS");
  });
});

// ─── Auditor Detects Unintended Extra Change ────────────────────────

describe("auditor detects unintended extra change", () => {
  it("fails when too many lines changed", async () => {
    const auditor = new CodingMissionAuditor();
    const delegation = createDelegation("m1", "obj1", "Modify Package", "desc", "engineering", {
      acceptanceCriteria: ["Only intended change occurred"],
    });

    const beforeLines = Array(20).fill('"line": "value"').join("\n");
    const afterLines = Array(20).fill('"line": "changed"').join("\n");

    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: JSON.stringify({
        projectId: "traffic-dodge",
        file: "package.json",
        operation: "replace",
        beforeContent: beforeLines,
        afterContent: afterLines,
      }),
      durationMs: 100,
    };
    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("FAIL");
  });

  it("fails when line count changes", async () => {
    const auditor = new CodingMissionAuditor();
    const delegation = createDelegation("m1", "obj1", "Modify Package", "desc", "engineering", {
      acceptanceCriteria: ["Only intended change occurred"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: JSON.stringify({
        projectId: "traffic-dodge",
        file: "package.json",
        operation: "replace",
        beforeContent: "line1\nline2",
        afterContent: "line1\nline2\nline3\nline4",
      }),
      durationMs: 100,
    };
    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("FAIL");
  });
});

// ─── Mission Completion ──────────────────────────────────────────────

describe("mission completion", () => {
  it("completes mission with all criteria met", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", scripts: { "build:prod": "echo build-ok" } }, null, 2)
    );

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const adapter = new CompositeCodingBuildAdapter();
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 1,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter: adapter,
      auditor,
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");

    const events = eventSink.recent();
    expect(events.some((e) => e.type === MissionEventTypes.DELEGATION_STARTED)).toBe(true);
    expect(events.some((e) => e.type === MissionEventTypes.DELEGATION_COMPLETED)).toBe(true);
    expect(events.some((e) => e.type === MissionEventTypes.MISSION_AUDIT_PASSED)).toBe(true);
  });
});

// ─── Mission Failure ─────────────────────────────────────────────────

describe("mission failure", () => {
  it("fails mission when coding operation fails", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const adapter = new CompositeCodingBuildAdapter();
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 1,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter: adapter,
      auditor,
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("failed");

    const events = eventSink.recent();
    expect(events.some((e) => e.type === MissionEventTypes.MISSION_AUDIT_FAILED)).toBe(true);
  });
});

// ─── Persistence ─────────────────────────────────────────────────────

describe("persistence", () => {
  it("persists coding mission state across reload", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker" }, null, 2)
    );

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);
    await state1.setPlan(plan);
    for (const del of plan.delegations) {
      await state1.addDelegation(del);
    }

    await state1.startMission();
    await state1.startDelegation(plan.delegations[0].id, "pipeline-1");

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    expect(state2.getMission().status).toBe("running");
    expect(state2.getDelegations().length).toBe(plan.delegations.length);
  });
});

// ─── Event Emission ──────────────────────────────────────────────────

describe("event emission", () => {
  it("emits coding-specific events", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", scripts: { "build:prod": "echo build-ok" } }, null, 2)
    );

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const adapter = new CompositeCodingBuildAdapter();
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter: adapter,
      auditor,
      eventSink,
      missionState: state,
    });

    await orchestrator.executeMission(mission, plan);

    const events = eventSink.recent();
    const eventTypes = events.map((e) => e.type);

    expect(eventTypes).toContain(MissionEventTypes.DELEGATION_STARTED);
    expect(eventTypes).toContain(MissionEventTypes.DELEGATION_COMPLETED);
    expect(eventTypes).toContain(MissionEventTypes.MISSION_AUDITING);
    expect(eventTypes).toContain(MissionEventTypes.MISSION_AUDIT_PASSED);
  });
});

// ─── Composite Adapter Routing ──────────────────────────────────────

describe("composite adapter routing", () => {
  it("routes builder delegations to build adapter", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const adapter = new CompositeCodingBuildAdapter();
    const del = makeDelegationWithMetadata(
      "Run build\nROLE: builder\nBUILD_COMMAND: echo ok"
    );
    const mission = makeMission();

    const result = await adapter.runDelegation(del, mission, {
      baseDir: tmpDir,
      project: projectDir,
    });

    expect(result.status).toBe("passed");
    const parsed = JSON.parse(result.output);
    expect(parsed.command).toBe("echo ok");
  });

  it("routes coder delegations to coding adapter", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "package.json"), '{"name":"test"}');

    const adapter = new CompositeCodingBuildAdapter();
    const del = makeDelegationWithMetadata(
      "Read file\nROLE: coder\nFILE: package.json\nOPERATION: read"
    );
    const mission = makeMission();

    const result = await adapter.runDelegation(del, mission, {
      baseDir: tmpDir,
      project: projectDir,
    });

    expect(result.status).toBe("passed");
    const parsed = JSON.parse(result.output);
    expect(parsed.file).toBe("package.json");
  });
});

// ─── No Metadata Handling ───────────────────────────────────────────

describe("no metadata handling", () => {
  it("coding adapter fails gracefully without metadata", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const adapter = new ControlledCodingAdapter();
    const del = makeDelegationWithMetadata("Generic delegation without metadata");
    const mission = makeMission();

    const result = await adapter.runDelegation(del, mission, {
      baseDir: tmpDir,
      project: projectDir,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("No coding operation");
  });

  it("build adapter fails gracefully without metadata", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const adapter = new ControlledBuildAdapter();
    const del = makeDelegationWithMetadata("Generic delegation without metadata");
    const mission = makeMission();

    const result = await adapter.runDelegation(del, mission, {
      baseDir: tmpDir,
      project: projectDir,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("No build command");
  });
});

// ─── String Not Found Handling ──────────────────────────────────────

describe("string not found handling", () => {
  it("fails when oldString is not found in file", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "package.json"), '{"name":"test"}');

    const adapter = new ControlledCodingAdapter();
    const del = makeDelegationWithMetadata(
      "Replace name\nROLE: coder\nFILE: package.json\nOPERATION: replace\nOLD_VALUE: nonexistent\nVALUE: new-value"
    );
    const mission = makeMission();

    const result = await adapter.runDelegation(del, mission, {
      baseDir: tmpDir,
      project: projectDir,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("not found");
  });
});

// ─── Protected Paths Constant ────────────────────────────────────────

describe("protected paths constant", () => {
  it("includes factory directory", () => {
    expect(PROTECTED_PATHS).toContain("factory/");
  });

  it("includes agents directory", () => {
    expect(PROTECTED_PATHS).toContain("agents/");
  });

  it("includes visual-office directory", () => {
    expect(PROTECTED_PATHS).toContain("visual-office/");
  });

  it("includes node_modules directory", () => {
    expect(PROTECTED_PATHS).toContain("node_modules/");
  });
});
