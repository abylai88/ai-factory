import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMission,
  Mission,
  Delegation,
} from "../mission.js";
import { MissionState } from "../state.js";
import { createReadOnlyPlanner } from "../planner.js";
import {
  MissionOrchestrator,
  DeterministicAuditor,
  FactoryExecutionAdapter,
  ReadOnlyFactoryAdapter,
} from "../orchestrator.js";
import { InMemoryEventSink } from "../events.js";
import {
  MissionProjectManager,
  MissionAwareFactoryAdapter,
  InnerFactoryAdapter,
} from "../mission-project-manager.js";
import { ProjectProvisioner } from "../project-provisioner.js";

let tmpDir: string;
let templatesDir: string;
let projectsDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safety-test-"));
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
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
}

function makeProvisioner(allowedIds: string[] = ["test-template"]): ProjectProvisioner {
  return new ProjectProvisioner({
    baseDir: tmpDir,
    templatesDir,
    projectsDir,
    allowedTemplateIds: allowedIds,
  });
}

function makeReadOnlyMission(goal: string, projectId?: string): Mission {
  return createMission(goal, {
    projectId: projectId ?? "test-project",
    engine: "web",
    stack: "Phaser + TypeScript",
    template: "test-template",
    workspace: path.join(tmpDir, "projects", projectId ?? "test-project"),
  });
}

class MockReadOnlyAdapter implements FactoryExecutionAdapter {
  async runDelegation(
    delegation: Delegation,
    _mission: Mission,
    _config: { baseDir: string; project: string; fromStep?: string }
  ): Promise<AgentResult> {
    return {
      delegationId: delegation.id,
      status: "passed",
      output: "Read-only investigation complete",
      durationMs: 10,
      readOnly: true,
    };
  }
}

// ─── Safety: Reject Arbitrary Command ───

describe("safety: reject arbitrary command", () => {
  it("rejects template IDs with shell commands", async () => {
    const provisioner = makeProvisioner();

    const dangerous = [
      "test;ls",
      "test|cat /etc/passwd",
      "test&&whoami",
      "test`id`",
      "test$(whoami)",
    ];

    for (const id of dangerous) {
      await expect(provisioner.provision(id)).rejects.toThrow(
        "Invalid template ID"
      );
    }
  });
});

// ─── Safety: Reject Arbitrary Executable ───

describe("safety: reject arbitrary executable", () => {
  it("rejects template IDs with executable paths", async () => {
    const provisioner = makeProvisioner();

    const dangerous = [
      "/bin/bash",
      "/usr/bin/python",
      "C:\\Windows\\System32\\cmd.exe",
    ];

    for (const id of dangerous) {
      await expect(provisioner.provision(id)).rejects.toThrow(
        "Invalid template ID"
      );
    }
  });
});

// ─── Safety: Reject Arbitrary CWD ───

describe("safety: reject arbitrary cwd", () => {
  it("rejects project paths outside projects directory", async () => {
    const provisioner = makeProvisioner();

    const result = await provisioner.validateProject("/tmp/evil-project");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("outside");
  });

  it("rejects project paths with traversal", async () => {
    const provisioner = makeProvisioner();

    const result = await provisioner.validateProject(
      path.join(projectsDir, "../etc")
    );
    expect(result.valid).toBe(false);
  });
});

// ─── Safety: Reject Arbitrary Filesystem Path ───

describe("safety: reject arbitrary filesystem path", () => {
  it("rejects absolute paths as template ID", async () => {
    const provisioner = makeProvisioner();

    await expect(provisioner.provision("/etc/passwd")).rejects.toThrow(
      "Invalid template ID"
    );
    await expect(
      provisioner.provision("C:\\Windows\\System32")
    ).rejects.toThrow("Invalid template ID");
  });

  it("rejects path traversal in template ID", async () => {
    const provisioner = makeProvisioner();

    await expect(provisioner.provision("../etc/passwd")).rejects.toThrow(
      "Invalid template ID"
    );
    await expect(
      provisioner.provision("test/../../etc/passwd")
    ).rejects.toThrow("Invalid template ID");
  });
});

// ─── Safety: Reject Arbitrary Project Root ───

describe("safety: reject arbitrary project root", () => {
  it("validates project path stays within projects directory", async () => {
    const provisioner = makeProvisioner();

    const result = await provisioner.validateProject("/tmp/evil-project");
    expect(result.valid).toBe(false);
  });

  it("rejects project path with traversal", async () => {
    const provisioner = makeProvisioner();

    const result = await provisioner.validateProject(
      path.join(projectsDir, "../etc")
    );
    expect(result.valid).toBe(false);
  });
});

// ─── Safety: Reject Write/Edit Permission Escalation ───

describe("safety: reject write/edit permission escalation", () => {
  it("ReadOnlyFactoryAdapter does not expose write operations", () => {
    const adapter = new ReadOnlyFactoryAdapter();

    const prototype = Object.getPrototypeOf(adapter);
    const methodNames = Object.getOwnPropertyNames(prototype);

    expect(methodNames).not.toContain("write");
    expect(methodNames).not.toContain("edit");
    expect(methodNames).not.toContain("applyPatch");
    expect(methodNames).not.toContain("createFile");
    expect(methodNames).not.toContain("deleteFile");
  });

  it("read-only delegation does not include write steps", async () => {
    const mission = makeReadOnlyMission(
      "Inspect the project architecture"
    );
    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);

    for (const delegation of plan.delegations) {
      expect(delegation.pipelineType).not.toBe("game");
      expect(delegation.description.toLowerCase()).not.toContain("write");
      expect(delegation.description.toLowerCase()).not.toContain("create");
      expect(delegation.description.toLowerCase()).not.toContain("modify");
      expect(delegation.description.toLowerCase()).not.toContain("delete");
    }
  });
});

// ─── Safety: Mission State Integrity ───

describe("safety: mission state integrity", () => {
  it("sanitizes mission ID for filesystem", async () => {
    const state = new MissionState(tmpDir, "../../etc/passwd");
    await state.init();

    expect(state.getMission().id).not.toContain("..");
    expect(state.getMission().id).not.toContain("/");
  });

  it("handles long mission IDs", async () => {
    const longId = "a".repeat(200);
    const state = new MissionState(tmpDir, longId);
    await state.init();

    expect(state.getMission().id.length).toBeLessThanOrEqual(64);
  });

  it("handles special characters in mission ID", async () => {
    const state = new MissionState(tmpDir, "mission with spaces & symbols!");
    await state.init();

    expect(state.getMission().id).not.toContain(" ");
    expect(state.getMission().id).not.toContain("&");
  });
});

// ─── Safety: Deterministic Auditor Cannot Self-Pass ───

describe("safety: auditor cannot self-pass", () => {
  it("auditor checks acceptance criteria against output", async () => {
    const auditor = new DeterministicAuditor();
    const delegation = {
      id: "del-1",
      missionId: "m1",
      objectiveId: "obj-1",
      title: "Test",
      description: "desc",
      pipelineType: "engineering" as const,
      dependsOn: [],
      parallelizable: false,
      acceptanceCriteria: [
        "Codebase analyzed",
        "Architecture documented",
      ],
      status: "passed" as const,
      createdAt: new Date().toISOString(),
    };

    const mission = makeReadOnlyMission("Test mission");
    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);

    const failResult = {
      delegationId: delegation.id,
      status: "failed" as const,
      output: "Nothing relevant here",
      error: "Agent failed",
      durationMs: 100,
    };

    const audit1 = await auditor.audit(delegation, failResult, mission, plan);
    expect(audit1.status).toBe("FAIL");

    const passResult = {
      delegationId: delegation.id,
      status: "passed" as const,
      output:
        "Codebase analyzed: src/main.ts entry point, src/scenes/GameScene.ts gameplay logic, src/scenes/MenuScene.ts UI. Architecture documented with scene-based design. 5 modules identified.",
      durationMs: 100,
    };

    const audit2 = await auditor.audit(delegation, passResult, mission, plan);
    expect(audit2.status).toBe("PASS");
  });
});

// ─── Safety: No Write Operations in Read-Only Path ───

describe("safety: no write operations in read-only path", () => {
  it("read-only adapter does not modify project files", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "safety-nowrite");

    const projectPath = path.join(projectsDir, "safety-nowrite");
    const testFile = path.join(projectPath, "src", "test.txt");
    await fs.writeFile(testFile, "original content");

    const manager = new MissionProjectManager({
      baseDir: tmpDir,
      provisioner,
    });
    const mission = makeReadOnlyMission(
      "Inspect the project",
      "safety-nowrite"
    );

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);
    await state.setPlan(plan);

    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const adapter = new MockReadOnlyAdapter();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    await orchestrator.executeMission(mission, plan);

    const content = await fs.readFile(testFile, "utf8");
    expect(content).toBe("original content");
  });
});

interface AgentResult {
  delegationId: string;
  status: "passed" | "failed" | "blocked";
  output: string;
  error?: string;
  durationMs: number;
  readOnly?: boolean;
}
