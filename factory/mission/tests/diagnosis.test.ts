import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMission,
  createDiagnosis,
  createDiagnosisRepairPlan,
  Mission,
  Diagnosis,
  DiagnosisRepairPlan,
  DiagnosisInput,
  VisualQaResult,
} from "../mission.js";
import { MissionState } from "../state.js";
import {
  classifyDiagnosis,
  generateRepairPlan,
  evaluateBuildFailure,
  evaluateRuntimeErrors,
  evaluateBlankCanvas,
  evaluateAssetLoading,
  evaluateVisualRegression,
} from "../diagnosis.js";
import {
  auditRepairPlan,
  auditAction,
  isRepairPlanSafe,
  isAbsolutePath,
  hasPathTraversal,
  isInProtectedPath,
  isProjectRelative,
} from "../repair-plan-audit.js";
import { InMemoryEventSink, MissionEventTypes } from "../events.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "diagnosis-test-"));
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

function makeInput(overrides: Partial<DiagnosisInput> = {}): DiagnosisInput {
  return {
    missionId: "mission-test123",
    projectId: "traffic-dodge",
    projectPath: path.join(tmpDir, "projects", "traffic-dodge"),
    acceptanceCriteria: ["Build succeeded", "Visual QA passed"],
    buildFailed: false,
    runtimeErrors: [],
    visualQaStatus: "failed",
    failedChecks: [
      { name: "canvas-exists", viewport: "1280x720", message: "Canvas not found" },
    ],
    artifactMetadata: [],
    affectedFiles: ["src/game/scenes/MenuScene.ts"],
    ...overrides,
  };
}

// ─── 1. Runtime error diagnosis ──────────────────────────────────────

describe("runtime error diagnosis", () => {
  it("diagnoses runtime errors with high confidence", () => {
    const input = makeInput({
      buildFailed: false,
      runtimeErrors: ["page: Uncaught TypeError", "console: ReferenceError"],
      visualQaStatus: "failed",
      failedChecks: [],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("runtime-error");
    expect(diagnosis.severity).toBe("high");
    expect(diagnosis.confidence).toBe("high");
    expect(diagnosis.evidence.length).toBeGreaterThan(0);
  });

  it("does not diagnose runtime-error when no runtime errors exist", () => {
    const input = makeInput({
      buildFailed: false,
      runtimeErrors: [],
      visualQaStatus: "failed",
      failedChecks: [{ name: "canvas-exists", viewport: "1280x720" }],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).not.toBe("runtime-error");
  });
});

// ─── 2. Blank canvas diagnosis ───────────────────────────────────────

describe("blank canvas diagnosis", () => {
  it("diagnoses blank canvas when all failed checks are canvas-related", () => {
    const input = makeInput({
      buildFailed: false,
      runtimeErrors: [],
      visualQaStatus: "failed",
      failedChecks: [
        { name: "canvas-exists", viewport: "1280x720", message: "Canvas not found" },
        { name: "canvas-visible", viewport: "1280x720", message: "Canvas not visible" },
      ],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("blank-canvas");
    expect(diagnosis.severity).toBe("medium");
    expect(diagnosis.confidence).toBe("low");
  });

  it("does not diagnose blank-canvas when non-canvas checks fail", () => {
    const input = makeInput({
      buildFailed: false,
      runtimeErrors: [],
      visualQaStatus: "failed",
      failedChecks: [
        { name: "canvas-exists", viewport: "1280x720", message: "Canvas not found" },
        { name: "page-loads", viewport: "1280x720", message: "Page did not load" },
      ],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).not.toBe("blank-canvas");
  });
});

// ─── 3. Visual regression diagnosis ──────────────────────────────────

describe("visual regression diagnosis", () => {
  it("diagnoses visual regression when QA fails without runtime errors", () => {
    const input = makeInput({
      buildFailed: false,
      runtimeErrors: [],
      visualQaStatus: "failed",
      failedChecks: [
        { name: "screenshot-match", viewport: "1280x720", message: "Screenshot differs" },
      ],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("visual-regression");
    expect(diagnosis.severity).toBe("medium");
    expect(diagnosis.confidence).toBe("high");
  });
});

// ─── 4. Asset-loading diagnosis ──────────────────────────────────────

describe("asset-loading diagnosis", () => {
  it("diagnoses asset loading when 404 errors are present", () => {
    const input = makeInput({
      buildFailed: false,
      runtimeErrors: ["GET /assets/sprite.png 404"],
      visualQaStatus: "failed",
      failedChecks: [],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("asset-loading");
    expect(diagnosis.severity).toBe("medium");
    expect(diagnosis.confidence).toBe("medium");
  });

  it("diagnoses asset loading with load-related errors", () => {
    const input = makeInput({
      buildFailed: false,
      runtimeErrors: ["Failed to load resource"],
      visualQaStatus: "failed",
      failedChecks: [],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("asset-loading");
  });
});

// ─── 5. Build failure diagnosis ──────────────────────────────────────

describe("build failure diagnosis", () => {
  it("diagnoses build failure with critical severity", () => {
    const input = makeInput({
      buildFailed: true,
      buildError: "src/game/main.ts(15,3): error TS2345: Type 'string' is not assignable to type 'number'",
      visualQaStatus: "skipped",
      failedChecks: [],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("build-output");
    expect(diagnosis.severity).toBe("critical");
    expect(diagnosis.confidence).toBe("high");
    expect(diagnosis.evidence.some((e) => e.includes("Build status: failure"))).toBe(true);
  });

  it("build failure takes priority over other diagnoses", () => {
    const input = makeInput({
      buildFailed: true,
      buildError: "Compile error",
      runtimeErrors: ["page: TypeError"],
      visualQaStatus: "failed",
      failedChecks: [{ name: "canvas-exists", viewport: "1280x720" }],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("build-output");
  });
});

// ─── 6. Unknown diagnosis ────────────────────────────────────────────

describe("unknown diagnosis", () => {
  it("returns unknown when no evidence matches", () => {
    const input = makeInput({
      buildFailed: false,
      runtimeErrors: [],
      visualQaStatus: "passed",
      failedChecks: [],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("unknown");
    expect(diagnosis.severity).toBe("low");
    expect(diagnosis.confidence).toBe("low");
  });

  it("returns unknown with insufficient evidence", () => {
    const input = makeInput({
      buildFailed: false,
      runtimeErrors: [],
      visualQaStatus: "skipped",
      failedChecks: [],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("unknown");
    expect(diagnosis.confidence).toBe("low");
  });
});

// ─── 7. Severity assignment ──────────────────────────────────────────

describe("severity assignment", () => {
  it("assigns critical to build-output", () => {
    const input = makeInput({ buildFailed: true, visualQaStatus: "skipped", failedChecks: [] });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.severity).toBe("critical");
  });

  it("assigns high to runtime-error", () => {
    const input = makeInput({
      runtimeErrors: ["error"],
      visualQaStatus: "failed",
      failedChecks: [],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.severity).toBe("high");
  });

  it("assigns medium to visual-regression", () => {
    const input = makeInput({
      visualQaStatus: "failed",
      failedChecks: [{ name: "screenshot-match", viewport: "1280x720" }],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.severity).toBe("medium");
  });

  it("assigns low to unknown", () => {
    const input = makeInput({ visualQaStatus: "passed", failedChecks: [] });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.severity).toBe("low");
  });
});

// ─── 8. Confidence assignment ────────────────────────────────────────

describe("confidence assignment", () => {
  it("assigns high confidence for build failure", () => {
    const input = makeInput({ buildFailed: true, visualQaStatus: "skipped", failedChecks: [] });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.confidence).toBe("high");
  });

  it("assigns high confidence for runtime errors", () => {
    const input = makeInput({
      runtimeErrors: ["TypeError"],
      visualQaStatus: "failed",
      failedChecks: [],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.confidence).toBe("high");
  });

  it("assigns low confidence for unknown", () => {
    const input = makeInput({ visualQaStatus: "passed", failedChecks: [] });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.confidence).toBe("low");
  });
});

// ─── 9. RepairPlan generation ────────────────────────────────────────

describe("RepairPlan generation", () => {
  it("generates a RepairPlan with actions", () => {
    const input = makeInput({
      buildFailed: true,
      buildError: "TS error",
      visualQaStatus: "skipped",
      failedChecks: [],
    });
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    expect(plan.id).toMatch(/^rp-/);
    expect(plan.missionId).toBe(input.missionId);
    expect(plan.diagnosisId).toBe(diagnosis.id);
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.maxAttempts).toBe(3);
    expect(plan.allowedProjectId).toBe(input.projectId);
    expect(plan.verificationPlan.steps.length).toBeGreaterThan(0);
  });

  it("includes verification plan with build→audit for build failures", () => {
    const input = makeInput({ buildFailed: true, visualQaStatus: "skipped", failedChecks: [] });
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    expect(plan.verificationPlan.steps).toEqual(["build", "audit"]);
  });

  it("includes verification plan with build→visual-qa→audit for non-build failures", () => {
    const input = makeInput({
      runtimeErrors: ["error"],
      visualQaStatus: "failed",
      failedChecks: [],
    });
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    expect(plan.verificationPlan.steps).toEqual(["build", "visual-qa", "audit"]);
  });

  it("includes protected paths in RepairPlan", () => {
    const input = makeInput();
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    expect(plan.protectedPaths).toContain("factory/**");
    expect(plan.protectedPaths).toContain("agents/**");
    expect(plan.protectedPaths).toContain("visual-office/**");
  });
});

// ─── 10. Relative path enforcement ───────────────────────────────────

describe("relative path enforcement", () => {
  it("allows project-relative paths", () => {
    expect(isProjectRelative("src/game/scenes/MenuScene.ts")).toBe(true);
    expect(isProjectRelative("package.json")).toBe(true);
    expect(isProjectRelative("public/index.html")).toBe(true);
  });

  it("rejects absolute paths", () => {
    expect(isAbsolutePath("/etc/passwd")).toBe(true);
    expect(isAbsolutePath("/home/user/file.ts")).toBe(true);
    expect(isAbsolutePath("src/file.ts")).toBe(false);
  });

  it("rejects paths with traversal", () => {
    expect(hasPathTraversal("../etc/passwd")).toBe(true);
    expect(hasPathTraversal("src/../../secret")).toBe(true);
    expect(hasPathTraversal("src/file.ts")).toBe(false);
  });

  it("rejects protected paths", () => {
    expect(isInProtectedPath("factory/orchestrator/index.ts", ["factory/**", "agents/**"])).toBe(true);
    expect(isInProtectedPath("agents/orchestrator.md", ["factory/**", "agents/**"])).toBe(true);
    expect(isInProtectedPath("src/file.ts", ["factory/**", "agents/**"])).toBe(false);
  });
});

// ─── 11. Path traversal rejection ────────────────────────────────────

describe("path traversal rejection", () => {
  it("rejects ../  in file paths", () => {
    const violations = auditAction(
      { file: "../factory/orchestrator.ts", operation: "modify", reason: "test", expectedOutcome: "test", scope: "project" },
      ["factory/**", "agents/**"]
    );
    expect(violations.some((v) => v.rule === "action.file.no-traversal")).toBe(true);
  });

  it("rejects absolute paths", () => {
    const violations = auditAction(
      { file: "/etc/passwd", operation: "modify", reason: "test", expectedOutcome: "test", scope: "project" },
      ["factory/**"]
    );
    expect(violations.some((v) => v.rule === "action.file.no-absolute")).toBe(true);
  });
});

// ─── 12. Protected path rejection ────────────────────────────────────

describe("protected path rejection", () => {
  it("rejects changes to factory/**", () => {
    const violations = auditAction(
      { file: "factory/orchestrator/index.ts", operation: "modify", reason: "test", expectedOutcome: "test", scope: "project" },
      ["factory/**", "agents/**", "visual-office/**"]
    );
    expect(violations.some((v) => v.rule === "action.file.no-protected")).toBe(true);
  });

  it("rejects changes to agents/**", () => {
    const violations = auditAction(
      { file: "agents/orchestrator.md", operation: "modify", reason: "test", expectedOutcome: "test", scope: "project" },
      ["factory/**", "agents/**"]
    );
    expect(violations.some((v) => v.rule === "action.file.no-protected")).toBe(true);
  });

  it("rejects changes to visual-office/**", () => {
    const violations = auditAction(
      { file: "visual-office/service.ts", operation: "modify", reason: "test", expectedOutcome: "test", scope: "project" },
      ["factory/**", "agents/**", "visual-office/**"]
    );
    expect(violations.some((v) => v.rule === "action.file.no-protected")).toBe(true);
  });

  it("allows changes within the target project", () => {
    const violations = auditAction(
      { file: "src/game/scenes/MenuScene.ts", operation: "modify", reason: "test", expectedOutcome: "test", scope: "project" },
      ["factory/**", "agents/**", "visual-office/**"]
    );
    expect(violations.length).toBe(0);
  });
});

// ─── 13. maxAttempts bound ───────────────────────────────────────────

describe("maxAttempts bound", () => {
  it("accepts valid maxAttempts", () => {
    const input = makeInput();
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    expect(plan.maxAttempts).toBe(3);
  });

  it("rejects maxAttempts > 10", () => {
    const input = makeInput();
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 11);
    const violations = auditRepairPlan(plan);
    expect(violations.some((v) => v.rule === "plan.maxAttempts.bounded")).toBe(true);
  });

  it("rejects maxAttempts < 1", () => {
    const input = makeInput();
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 0);
    const violations = auditRepairPlan(plan);
    expect(violations.some((v) => v.rule === "plan.maxAttempts.bounded")).toBe(true);
  });
});

// ─── 14. No arbitrary shell fields ───────────────────────────────────

describe("no arbitrary shell fields", () => {
  it("RepairAction has no executable field", () => {
    const input = makeInput();
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    for (const action of plan.actions) {
      expect(action).not.toHaveProperty("executable");
      expect(action).not.toHaveProperty("command");
      expect(action).not.toHaveProperty("argv");
      expect(action).not.toHaveProperty("cwd");
    }
  });

  it("RepairAction only has structured fields", () => {
    const input = makeInput();
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    for (const action of plan.actions) {
      const keys = Object.keys(action);
      expect(keys.sort()).toEqual(["file", "operation", "reason", "expectedOutcome", "scope"].sort());
    }
  });
});

// ─── 15. Verification plan ───────────────────────────────────────────

describe("verification plan", () => {
  it("includes build step in all verification plans", () => {
    const input = makeInput({ buildFailed: true, visualQaStatus: "skipped", failedChecks: [] });
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    expect(plan.verificationPlan.steps).toContain("build");
  });

  it("includes audit step in all verification plans", () => {
    const input = makeInput({ buildFailed: true, visualQaStatus: "skipped", failedChecks: [] });
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    expect(plan.verificationPlan.steps).toContain("audit");
  });

  it("skips visual-qa when build is known to have failed", () => {
    const input = makeInput({ buildFailed: true, visualQaStatus: "skipped", failedChecks: [] });
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    expect(plan.verificationPlan.steps).not.toContain("visual-qa");
  });

  it("includes visual-qa when build succeeds", () => {
    const input = makeInput({
      buildFailed: false,
      visualQaStatus: "failed",
      failedChecks: [{ name: "screenshot-match", viewport: "1280x720" }],
    });
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    expect(plan.verificationPlan.steps).toContain("visual-qa");
  });
});

// ─── 16. Insufficient evidence → unknown ─────────────────────────────

describe("insufficient evidence → unknown", () => {
  it("returns unknown when QA passed", () => {
    const input = makeInput({ visualQaStatus: "passed", failedChecks: [] });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("unknown");
    expect(diagnosis.confidence).toBe("low");
  });

  it("returns unknown when QA skipped", () => {
    const input = makeInput({ visualQaStatus: "skipped", failedChecks: [] });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("unknown");
    expect(diagnosis.confidence).toBe("low");
  });

  it("returns unknown when no errors and no failed checks", () => {
    const input = makeInput({
      buildFailed: false,
      runtimeErrors: [],
      visualQaStatus: "passed",
      failedChecks: [],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("unknown");
  });
});

// ─── 17. Multiple failed checks → combined diagnosis ─────────────────

describe("multiple failed checks → combined diagnosis", () => {
  it("runtime errors take priority over blank canvas", () => {
    const input = makeInput({
      buildFailed: false,
      runtimeErrors: ["page: TypeError"],
      visualQaStatus: "failed",
      failedChecks: [
        { name: "canvas-exists", viewport: "1280x720", message: "Canvas not found" },
        { name: "canvas-visible", viewport: "1280x720", message: "Canvas not visible" },
      ],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("runtime-error");
  });

  it("build failure takes priority over runtime errors", () => {
    const input = makeInput({
      buildFailed: true,
      buildError: "TS error",
      runtimeErrors: ["page: TypeError"],
      visualQaStatus: "failed",
      failedChecks: [{ name: "canvas-exists", viewport: "1280x720" }],
    });
    const diagnosis = classifyDiagnosis(input);
    expect(diagnosis.category).toBe("build-output");
  });
});

// ─── 18. Artifact metadata handling ──────────────────────────────────

describe("artifact metadata handling", () => {
  it("includes artifact metadata in diagnosis input", () => {
    const input = makeInput({
      artifactMetadata: [
        { id: "art_001", type: "screenshot", label: "1280x720/menu" },
        { id: "art_002", type: "trace", label: "trace-run-1" },
      ],
    });
    expect(input.artifactMetadata.length).toBe(2);
    expect(input.artifactMetadata[0].id).toBe("art_001");
  });

  it("does not pass binary data through diagnosis", () => {
    const input = makeInput();
    const diagnosis = classifyDiagnosis(input);
    const serialized = JSON.stringify(diagnosis);
    expect(serialized).not.toContain("base64");
    expect(serialized).not.toContain("buffer");
    expect(serialized).not.toContain("data:image");
  });
});

// ─── 19. Old missions without diagnosis still load ───────────────────

describe("old missions without diagnosis still load", () => {
  it("loads mission state that has no diagnosis", async () => {
    const mission = makeMission();

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const loaded = state2.getMission();
    expect(loaded).toBeDefined();
    expect(loaded.id).toBe(mission.id);
    expect(loaded.diagnosis).toBeUndefined();
    expect(loaded.diagnosisRepairPlan).toBeUndefined();
    expect(state2.getDiagnosis()).toBeNull();
    expect(state2.getDiagnosisRepairPlan()).toBeNull();
  });

  it("loads mission state with diagnosis", async () => {
    const mission = makeMission();

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    const diagnosis = createDiagnosis(
      mission.id,
      "traffic-dodge",
      "runtime-error",
      "high",
      "high",
      "Test diagnosis",
      ["Test evidence"]
    );
    const plan = createDiagnosisRepairPlan(
      mission.id,
      diagnosis.id,
      "Test plan",
      "high",
      "high",
      [{ file: "src/main.ts", operation: "modify", reason: "test", expectedOutcome: "fix", scope: "project" }],
      { steps: ["build", "audit"], description: "test" },
      3,
      "traffic-dodge"
    );

    await state1.recordDiagnosisCompleted(diagnosis, plan);

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const loadedDiagnosis = state2.getDiagnosis();
    expect(loadedDiagnosis).toBeDefined();
    expect(loadedDiagnosis!.category).toBe("runtime-error");

    const loadedPlan = state2.getDiagnosisRepairPlan();
    expect(loadedPlan).toBeDefined();
    expect(loadedPlan!.actions.length).toBe(1);
  });
});

// ─── Additional: safety audit ────────────────────────────────────────

describe("RepairPlan safety audit", () => {
  it("passes for a valid RepairPlan", () => {
    const input = makeInput();
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    const violations = auditRepairPlan(plan);
    expect(violations.length).toBe(0);
    expect(isRepairPlanSafe(plan)).toBe(true);
  });

  it("fails when mission ID is empty", () => {
    const input = makeInput();
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    (plan as any).missionId = "";
    const violations = auditRepairPlan(plan);
    expect(violations.some((v) => v.rule === "plan.missionId.required")).toBe(true);
  });

  it("fails when project ID is empty", () => {
    const input = makeInput();
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    (plan as any).allowedProjectId = "";
    const violations = auditRepairPlan(plan);
    expect(violations.some((v) => v.rule === "plan.allowedProjectId.required")).toBe(true);
  });

  it("fails when no actions", () => {
    const input = makeInput();
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    plan.actions = [];
    const violations = auditRepairPlan(plan);
    expect(violations.some((v) => v.rule === "plan.actions.non-empty")).toBe(true);
  });

  it("fails when no verification plan", () => {
    const input = makeInput();
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    (plan as any).verificationPlan = { steps: [], description: "" };
    const violations = auditRepairPlan(plan);
    expect(violations.some((v) => v.rule === "plan.verificationPlan.required")).toBe(true);
  });

  it("fails when summary is empty", () => {
    const input = makeInput();
    const diagnosis = classifyDiagnosis(input);
    const plan = generateRepairPlan(input, diagnosis, 3);
    (plan as any).summary = "";
    const violations = auditRepairPlan(plan);
    expect(violations.some((v) => v.rule === "plan.summary.required")).toBe(true);
  });
});

// ─── Additional: events ──────────────────────────────────────────────

describe("diagnosis events", () => {
  it("emits diagnosis.started and diagnosis.completed events", async () => {
    const mission = makeMission();

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    await state.recordDiagnosisStarted();
    await state.recordDiagnosisCompleted(
      createDiagnosis(mission.id, "traffic-dodge", "runtime-error", "high", "high", "Test", ["evidence"]),
      createDiagnosisRepairPlan(mission.id, "diag-1", "Plan", "high", "high", [], { steps: ["build"], description: "test" }, 3, "traffic-dodge")
    );

    const jsonlPath = path.join(tmpDir, "outputs", "missions", `${mission.id}.jsonl`);
    const content = await fs.readFile(jsonlPath, "utf8");
    const lines = content.trim().split("\n");
    const events = lines.map((l) => JSON.parse(l));

    expect(events.some((e: any) => e.type === "mission.diagnosis.started")).toBe(true);
    expect(events.some((e: any) => e.type === "mission.diagnosis.completed")).toBe(true);
  });

  it("diagnosis.completed event includes compact metadata", async () => {
    const mission = makeMission();

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const diagnosis = createDiagnosis(mission.id, "traffic-dodge", "build-output", "critical", "high", "Build failed", ["error"]);
    const plan = createDiagnosisRepairPlan(mission.id, diagnosis.id, "Fix build", "critical", "high", [], { steps: ["build"], description: "test" }, 3, "traffic-dodge");

    await state.recordDiagnosisCompleted(diagnosis, plan);

    const jsonlPath = path.join(tmpDir, "outputs", "missions", `${mission.id}.jsonl`);
    const content = await fs.readFile(jsonlPath, "utf8");
    const lines = content.trim().split("\n");
    const event = lines.map((l) => JSON.parse(l)).find((e: any) => e.type === "mission.diagnosis.completed");

    expect(event).toBeDefined();
    expect(event.payload.diagnosisId).toBe(diagnosis.id);
    expect(event.payload.category).toBe("build-output");
    expect(event.payload.severity).toBe("critical");
    expect(event.payload.confidence).toBe("high");
    expect(event.payload.repairPlanId).toBe(plan.id);
    expect(event.payload.actionCount).toBe(0);
  });

  it("no binary screenshots in events", async () => {
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const diagnosis = createDiagnosis(mission.id, "traffic-dodge", "unknown", "low", "low", "Test", []);
    const plan = createDiagnosisRepairPlan(mission.id, diagnosis.id, "Plan", "low", "low", [], { steps: ["build"], description: "test" }, 3, "traffic-dodge");

    await state.recordDiagnosisCompleted(diagnosis, plan);

    const jsonlPath = path.join(tmpDir, "outputs", "missions", `${mission.id}.jsonl`);
    const content = await fs.readFile(jsonlPath, "utf8");
    expect(content).not.toContain("base64");
    expect(content).not.toContain("buffer");
    expect(content).not.toContain("data:image");
  });
});

// ─── Additional: state persistence ───────────────────────────────────

describe("diagnosis state persistence", () => {
  it("persists diagnosis across state reload", async () => {
    const mission = makeMission();

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    const diagnosis = createDiagnosis(mission.id, "traffic-dodge", "runtime-error", "high", "high", "Test diagnosis", ["evidence"]);
    const plan = createDiagnosisRepairPlan(
      mission.id,
      diagnosis.id,
      "Test plan",
      "high",
      "high",
      [{ file: "src/main.ts", operation: "modify", reason: "fix", expectedOutcome: "fixed", scope: "project" }],
      { steps: ["build", "audit"], description: "Build and audit" },
      3,
      "traffic-dodge"
    );

    await state1.recordDiagnosisCompleted(diagnosis, plan);

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const loaded = state2.getDiagnosis();
    expect(loaded).toBeDefined();
    expect(loaded!.category).toBe("runtime-error");

    const loadedPlan = state2.getDiagnosisRepairPlan();
    expect(loadedPlan).toBeDefined();
    expect(loadedPlan!.actions.length).toBe(1);
  });

  it("mission status becomes diagnosis-planned after diagnosis", async () => {
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const diagnosis = createDiagnosis(mission.id, "traffic-dodge", "unknown", "low", "low", "Test", []);
    const plan = createDiagnosisRepairPlan(mission.id, diagnosis.id, "Plan", "low", "low", [], { steps: ["build"], description: "test" }, 3, "traffic-dodge");

    await state.recordDiagnosisStarted();
    expect(state.getMission().status).toBe("diagnosis-planned");

    await state.recordDiagnosisCompleted(diagnosis, plan);
    expect(state.getMission().status).toBe("diagnosis-planned");
  });
});
