import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ProjectProvisioner,
  ProjectHandle,
} from "../project-provisioner.js";
import {
  MissionProjectManager,
  MissionAwareFactoryAdapter,
  ResolvedProject,
  InnerFactoryAdapter,
} from "../mission-project-manager.js";
import {
  createMission,
  Mission,
  Delegation,
  AgentResult,
} from "../mission.js";
import {
  MissionOrchestrator,
  DeterministicAuditor,
  FactoryExecutionAdapter,
} from "../orchestrator.js";
import { MissionState } from "../state.js";
import { InMemoryEventSink, MissionEventTypes } from "../events.js";

let tmpDir: string;
let templatesDir: string;
let projectsDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "provisioner-test-"));
  templatesDir = path.join(tmpDir, "templates");
  projectsDir = path.join(tmpDir, "projects");
  await fs.mkdir(templatesDir, { recursive: true });
  await fs.mkdir(projectsDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function createFakeTemplate(id: string): Promise<void> {
  const dir = path.join(templatesDir, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "package.json"), '{"name":"test"}');
  await fs.writeFile(path.join(dir, "tsconfig.json"), "{}");
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "configs"), { recursive: true });
}

function makeProvisioner(allowedIds: string[] = ["test-template"]): ProjectProvisioner {
  return new ProjectProvisioner({
    baseDir: tmpDir,
    templatesDir,
    projectsDir,
    allowedTemplateIds: allowedIds,
  });
}

function makeMission(goal = "Build a simple game", projectId?: string): Mission {
  return createMission(goal, {
    projectId: projectId ?? "test-project",
    engine: "web",
    stack: "Phaser + TypeScript",
    template: "test-template",
    workspace: path.join(tmpDir, "projects", projectId ?? "test-project"),
  });
}

// ─── Allowlisted template ────────────────────────────────────────────

describe("ProjectProvisioner — allowlisted template", () => {
  it("provisions a project from an allowlisted template", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();

    const handle = await provisioner.provision("test-template", "my-game");

    expect(handle.projectId).toBe("my-game");
    expect(handle.templateId).toBe("test-template");
    expect(handle.projectPath).toBe(path.join(projectsDir, "my-game"));
    expect(handle.createdAt).toBeTruthy();

    const pkg = await fs.readFile(path.join(handle.projectPath, "package.json"), "utf8");
    expect(JSON.parse(pkg).name).toBe("test");
  });

  it("generates a project ID when none supplied", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();

    const handle = await provisioner.provision("test-template");

    expect(handle.projectId).toMatch(/^proj-/);
    expect(handle.projectPath).toBeTruthy();
  });

  it("lists available templates", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();

    const templates = await provisioner.listTemplates();
    expect(templates.length).toBe(1);
    expect(templates[0].id).toBe("test-template");
    expect(templates[0].exists).toBe(true);
  });

  it("lists templates that do not exist", async () => {
    const provisioner = makeProvisioner(["missing-template"]);

    const templates = await provisioner.listTemplates();
    expect(templates.length).toBe(1);
    expect(templates[0].exists).toBe(false);
  });
});

// ─── Rejected template ───────────────────────────────────────────────

describe("ProjectProvisioner — rejected template", () => {
  it("rejects template not in allowlist", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner(["test-template"]);

    await expect(provisioner.provision("unknown-template")).rejects.toThrow("not in the allowlist");
  });

  it("rejects template with path traversal", async () => {
    const provisioner = makeProvisioner(["test-template"]);

    await expect(provisioner.provision("../../etc/passwd")).rejects.toThrow("Invalid template ID");
  });

  it("rejects template with absolute path", async () => {
    const provisioner = makeProvisioner(["test-template"]);

    await expect(provisioner.provision("/etc/passwd")).rejects.toThrow("Invalid template ID");
  });

  it("rejects template with shell metacharacters", async () => {
    const provisioner = makeProvisioner(["test-template"]);

    await expect(provisioner.provision("test`whoami`")).rejects.toThrow("Invalid template ID");
    await expect(provisioner.provision("test;rm -rf /")).rejects.toThrow("Invalid template ID");
    await expect(provisioner.provision("test${HOME}")).rejects.toThrow("Invalid template ID");
  });

  it("rejects template with angle brackets", async () => {
    const provisioner = makeProvisioner(["test-template"]);

    await expect(provisioner.provision("test<script>")).rejects.toThrow("Invalid template ID");
  });

  it("rejects template with newline injection", async () => {
    const provisioner = makeProvisioner(["test-template"]);

    await expect(provisioner.provision("test\nmalicious")).rejects.toThrow("Invalid template ID");
  });

  it("rejects template with pipe operator", async () => {
    const provisioner = makeProvisioner(["test-template"]);

    await expect(provisioner.provision("test || malicious")).rejects.toThrow("Invalid template ID");
  });

  it("rejects template with history expansion", async () => {
    const provisioner = makeProvisioner(["test-template"]);

    await expect(provisioner.provision("!evil")).rejects.toThrow("Invalid template ID");
  });

  it("rejects empty template ID", async () => {
    const provisioner = makeProvisioner(["test-template"]);

    await expect(provisioner.provision("")).rejects.toThrow("Invalid template ID");
  });

  it("rejects template ID that is too long", async () => {
    const provisioner = makeProvisioner(["test-template"]);

    await expect(provisioner.provision("a".repeat(200))).rejects.toThrow("Invalid template ID");
  });

  it("rejects template with special characters", async () => {
    const provisioner = makeProvisioner(["test-template"]);

    await expect(provisioner.provision("test template")).rejects.toThrow("Invalid template ID");
    await expect(provisioner.provision("test&echo")).rejects.toThrow("Invalid template ID");
  });

  it("rejects template directory that does not exist", async () => {
    const provisioner = makeProvisioner(["nonexistent"]);

    await expect(provisioner.provision("nonexistent")).rejects.toThrow("does not exist");
  });
});

// ─── Project provisioning ────────────────────────────────────────────

describe("ProjectProvisioner — project provisioning", () => {
  it("creates project directory with template files", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();

    const handle = await provisioner.provision("test-template", "my-game");

    const files = await fs.readdir(handle.projectPath);
    expect(files).toContain("package.json");
    expect(files).toContain("tsconfig.json");
    expect(files).toContain("src");
  });

  it("rejects duplicate project IDs", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();

    await provisioner.provision("test-template", "my-game");
    await expect(provisioner.provision("test-template", "my-game")).rejects.toThrow("already exists");
  });

  it("validates existing project path", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    const handle = await provisioner.provision("test-template", "my-game");

    const result = await provisioner.validateProject(handle.projectPath);
    expect(result.valid).toBe(true);
  });

  it("rejects project path outside projects dir", async () => {
    const provisioner = makeProvisioner();

    const result = await provisioner.validateProject("/etc/passwd");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("outside");
  });

  it("rejects non-existent project path", async () => {
    const provisioner = makeProvisioner();

    const result = await provisioner.validateProject(path.join(projectsDir, "nonexistent"));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("does not exist");
  });

  it("excludes node_modules and .git from template copy", async () => {
    await createFakeTemplate("test-template");
    await fs.mkdir(path.join(templatesDir, "test-template", "node_modules"), { recursive: true });
    await fs.writeFile(path.join(templatesDir, "test-template", "node_modules", "pkg.js"), "module.exports={}");
    await fs.mkdir(path.join(templatesDir, "test-template", ".git"), { recursive: true });
    await fs.writeFile(path.join(templatesDir, "test-template", ".git", "config"), "gitconfig");

    const provisioner = makeProvisioner();
    const handle = await provisioner.provision("test-template", "my-game");

    const allFiles = await fs.readdir(handle.projectPath, { recursive: true });
    const fileList = allFiles.map(f => String(f));
    expect(fileList.some(f => f.includes("node_modules"))).toBe(false);
    expect(fileList.some(f => f.includes(".git"))).toBe(false);
  });
});

// ─── Project ID validation ───────────────────────────────────────────

describe("ProjectProvisioner — project ID validation", () => {
  it("sanitizes project ID with special characters", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();

    const handle = await provisioner.provision("test-template", "my game! @#$");

    expect(handle.projectId).not.toContain(" ");
    expect(handle.projectId).not.toContain("!");
    expect(handle.projectId).not.toContain("@");
  });

  it("truncates long project IDs", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();

    const handle = await provisioner.provision("test-template", "a".repeat(200));

    expect(handle.projectId.length).toBeLessThanOrEqual(64);
  });

  it("handles empty project ID by generating one", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();

    const handle = await provisioner.provision("test-template", "");

    expect(handle.projectId).toMatch(/^proj-/);
  });
});

// ─── MissionProjectManager ───────────────────────────────────────────

describe("MissionProjectManager", () => {
  it("resolves project from mission context workspace", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    const handle = await provisioner.provision("test-template", "existing");

    const manager = new MissionProjectManager({ baseDir: tmpDir, provisioner });
    const mission = makeMission("Build a game", "existing");
    mission.context!.workspace = handle.projectPath;

    const resolved = await manager.resolveProject(mission);

    expect(resolved.projectId).toBe("existing");
    expect(resolved.projectPath).toBe(handle.projectPath);
    expect(resolved.isNew).toBe(false);
  });

  it("provisions new project when workspace does not exist", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    const manager = new MissionProjectManager({ baseDir: tmpDir, provisioner });

    const mission = makeMission("Build a game");
    mission.context!.workspace = path.join(projectsDir, "new-game");

    const resolved = await manager.resolveProject(mission);

    expect(resolved.projectId).toBeTruthy();
    expect(resolved.isNew).toBe(true);
    const exists = await fs.access(resolved.projectPath).then(() => true, () => false);
    expect(exists).toBe(true);
  });

  it("resolves project from projectId in context", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    const handle = await provisioner.provision("test-template", "by-id");

    const manager = new MissionProjectManager({ baseDir: tmpDir, provisioner });
    const mission = makeMission("Build a game", "by-id");

    const resolved = await manager.resolveProject(mission);

    expect(resolved.projectId).toBe("by-id");
    expect(resolved.projectPath).toBe(handle.projectPath);
    expect(resolved.isNew).toBe(false);
  });

  it("provisions when project does not exist and no workspace set", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    const manager = new MissionProjectManager({ baseDir: tmpDir, provisioner });

    const mission = makeMission("Build a game", "nonexistent");

    const resolved = await manager.resolveProject(mission);

    expect(resolved.isNew).toBe(true);
    expect(resolved.projectId).toBeTruthy();
  });
});

// ─── MissionAwareFactoryAdapter ──────────────────────────────────────

describe("MissionAwareFactoryAdapter", () => {
  it("delegates execution to inner adapter with resolved project path", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    const handle = await provisioner.provision("test-template", "adapter-test");

    const manager = new MissionProjectManager({ baseDir: tmpDir, provisioner });
    const mission = makeMission("Build a game", "adapter-test");

    let receivedProject = "";
    const mockInner: InnerFactoryAdapter = {
      async runDelegation(_d, _m, config) {
        receivedProject = config.project;
        return { delegationId: _d.id, status: "passed", output: "ok", durationMs: 0 };
      },
    };

    const adapter = new MissionAwareFactoryAdapter({ baseDir: tmpDir, projectManager: manager }, mockInner);

    const delegation = {
      id: "del-1",
      missionId: mission.id,
      objectiveId: "obj-1",
      title: "Test",
      description: "desc",
      pipelineType: "game" as const,
      dependsOn: [],
      parallelizable: false,
      acceptanceCriteria: [],
      status: "queued" as const,
      createdAt: new Date().toISOString(),
    };

    const result = await adapter.runDelegation(delegation, mission, {
      baseDir: tmpDir,
      project: "unused",
    });

    expect(result.status).toBe("passed");
    expect(receivedProject).toBe(handle.projectPath);
  });

  it("returns resolved project info", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    const handle = await provisioner.provision("test-template", "info-test");

    const manager = new MissionProjectManager({ baseDir: tmpDir, provisioner });
    const mission = makeMission("Build a game", "info-test");

    const mockInner: InnerFactoryAdapter = {
      async runDelegation(d) {
        return { delegationId: d.id, status: "passed", output: "ok", durationMs: 0 };
      },
    };

    const adapter = new MissionAwareFactoryAdapter({ baseDir: tmpDir, projectManager: manager }, mockInner);

    const delegation = {
      id: "del-1",
      missionId: mission.id,
      objectiveId: "obj-1",
      title: "Test",
      description: "desc",
      pipelineType: "game" as const,
      dependsOn: [],
      parallelizable: false,
      acceptanceCriteria: [],
      status: "queued" as const,
      createdAt: new Date().toISOString(),
    };

    await adapter.runDelegation(delegation, mission, { baseDir: tmpDir, project: "unused" });

    const resolved = adapter.getResolvedProject();
    expect(resolved).not.toBeNull();
    expect(resolved!.projectId).toBe("info-test");
    expect(resolved!.projectPath).toBe(handle.projectPath);
  });
});

// ─── Mission execution using fake adapter ────────────────────────────

describe("mission execution using fake adapter", () => {
  it("executes full mission lifecycle with MissionAwareFactoryAdapter", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "exec-test");

    const manager = new MissionProjectManager({ baseDir: tmpDir, provisioner });
    const mission = makeMission("Build a game", "exec-test");

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const { createPlanner } = await import("../planner.js");
    const planner = createPlanner();
    const plan = planner.decompose(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const executedDelegations: string[] = [];
    const mockInner: InnerFactoryAdapter = {
      async runDelegation(d) {
        executedDelegations.push(d.id);
        const keywords = d.acceptanceCriteria
          .flatMap((c) => c.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3));
        const output = `Completed successfully. ${keywords.join(" ")} verified and confirmed.`;
        await state.completeDelegation(d.id, "passed", output);
        return { delegationId: d.id, status: "passed", output, durationMs: 10 };
      },
    };

    const adapter = new MissionAwareFactoryAdapter({ baseDir: tmpDir, projectManager: manager }, mockInner);

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(projectsDir, "exec-test"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);

    expect(result.status).toBe("completed");
    expect(executedDelegations.length).toBeGreaterThan(0);

    const events = eventSink.recent();
    expect(events.some(e => e.type === MissionEventTypes.DELEGATION_STARTED)).toBe(true);
    expect(events.some(e => e.type === MissionEventTypes.DELEGATION_COMPLETED)).toBe(true);
  });
});

// ─── Execution failure ───────────────────────────────────────────────

describe("execution failure", () => {
  it("marks mission as failed when adapter throws", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "fail-test");

    const manager = new MissionProjectManager({ baseDir: tmpDir, provisioner });
    const mission = makeMission("Build a game", "fail-test");

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const { createPlanner } = await import("../planner.js");
    const planner = createPlanner();
    const plan = planner.decompose(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const mockInner: InnerFactoryAdapter = {
      async runDelegation(d) {
        await state.completeDelegation(d.id, "failed", "", "Simulated factory crash");
        throw new Error("Simulated factory crash");
      },
    };

    const adapter = new MissionAwareFactoryAdapter({ baseDir: tmpDir, projectManager: manager }, mockInner);

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 1,
      baseDir: tmpDir,
      project: path.join(projectsDir, "fail-test"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);

    expect(result.status).toBe("failed");

    const events = eventSink.recent();
    expect(events.some(e => e.type === MissionEventTypes.MISSION_AUDIT_FAILED)).toBe(true);

    const missionState2 = new MissionState(tmpDir, mission.id);
    await missionState2.init();
    expect(missionState2.getMission().status).toBe("failed");
  });
});

// ─── Persistence after restart ───────────────────────────────────────

describe("persistence after restart", () => {
  it("survives process restart via snapshot reload", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "persist-test");

    const manager = new MissionProjectManager({ baseDir: tmpDir, provisioner });
    const mission = makeMission("Build a game", "persist-test");

    const { createPlanner } = await import("../planner.js");
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
    expect(state2.getDelegation(plan.delegations[0].id)?.status).toBe("running");
  });

  it("persists mission events across restart", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "events-test");

    const manager = new MissionProjectManager({ baseDir: tmpDir, provisioner });
    const mission = makeMission("Build a game", "events-test");

    const { createPlanner } = await import("../planner.js");
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);
    await state1.setPlan(plan);

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    expect(state2.getMission().status).toBe("planned");
    expect(state2.getPlan()).not.toBeNull();
    expect(state2.getPlan()!.delegations.length).toBeGreaterThan(0);
  });
});

// ─── Event emission ──────────────────────────────────────────────────

describe("event emission", () => {
  it("emits events during mission execution", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "event-emit");

    const manager = new MissionProjectManager({ baseDir: tmpDir, provisioner });
    const mission = makeMission("Build a game", "event-emit");

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const { createPlanner } = await import("../planner.js");
    const planner = createPlanner();
    const plan = planner.decompose(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const mockInner: InnerFactoryAdapter = {
      async runDelegation(d) {
        const keywords = d.acceptanceCriteria
          .flatMap((c) => c.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3));
        const output = `Completed successfully. ${keywords.join(" ")} verified and confirmed.`;
        await state.completeDelegation(d.id, "passed", output);
        return { delegationId: d.id, status: "passed", output, durationMs: 10 };
      },
    };

    const adapter = new MissionAwareFactoryAdapter({ baseDir: tmpDir, projectManager: manager }, mockInner);

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(projectsDir, "event-emit"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    await orchestrator.executeMission(mission, plan);

    const events = eventSink.recent();
    const eventTypes = events.map(e => e.type);

    expect(eventTypes).toContain("delegation.started");
    expect(eventTypes).toContain("delegation.completed");
    expect(eventTypes).toContain("mission.auditing");
    expect(eventTypes).toContain("mission.audit.passed");
  });

  it("events flow to subscribers", async () => {
    const sink = new InMemoryEventSink();
    const received: string[] = [];
    sink.subscribe((e) => received.push(e.type));

    sink.publish({ missionId: "m1", type: "mission.created", payload: {} });
    sink.publish({ missionId: "m1", type: "mission.started", payload: {} });

    expect(received).toEqual(["mission.created", "mission.started"]);
  });
});

// ─── No arbitrary shell ──────────────────────────────────────────────

describe("no arbitrary shell", () => {
  it("rejects template IDs containing shell operators", async () => {
    const provisioner = makeProvisioner();

    const dangerous = [
      "test;ls",
      "test|cat /etc/passwd",
      "test&&whoami",
      "test`id`",
      "test$(whoami)",
      "test>file",
      "test<file",
      "test\nevil",
      "test\r\nevil",
    ];

    for (const id of dangerous) {
      await expect(provisioner.provision(id)).rejects.toThrow("Invalid template ID");
    }
  });

  it("rejects template IDs with semicolons", async () => {
    const provisioner = makeProvisioner();

    await expect(provisioner.provision("test;rm -rf /")).rejects.toThrow("Invalid template ID");
  });

  it("rejects template IDs with pipe", async () => {
    const provisioner = makeProvisioner();

    await expect(provisioner.provision("test|malicious")).rejects.toThrow("Invalid template ID");
  });
});

// ─── No arbitrary filesystem path ────────────────────────────────────

describe("no arbitrary filesystem path", () => {
  it("rejects absolute paths as template ID", async () => {
    const provisioner = makeProvisioner();

    await expect(provisioner.provision("/etc/passwd")).rejects.toThrow("Invalid template ID");
    await expect(provisioner.provision("C:\\Windows\\System32")).rejects.toThrow("Invalid template ID");
  });

  it("rejects path traversal in template ID", async () => {
    const provisioner = makeProvisioner();

    await expect(provisioner.provision("../etc/passwd")).rejects.toThrow("Invalid template ID");
    await expect(provisioner.provision("test/../../etc/passwd")).rejects.toThrow("Invalid template ID");
  });

  it("validates project path stays within projects directory", async () => {
    const provisioner = makeProvisioner();

    const result = await provisioner.validateProject("/tmp/evil-project");
    expect(result.valid).toBe(false);
  });

  it("rejects project path with traversal", async () => {
    const provisioner = makeProvisioner();

    const result = await provisioner.validateProject(path.join(projectsDir, "../etc"));
    expect(result.valid).toBe(false);
  });
});
