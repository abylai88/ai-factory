import path from "node:path";
import { runGoal } from "../pipeline/pipeline-runner.js";
import { selectPipeline } from "../pipeline/pipeline.js";
import { detectEngine } from "../engine/engine.js";

/**
 * AI Factory Manager.
 *
 * Accepts a high-level goal and runs it through the appropriate pipeline:
 *   - New game → game production pipeline
 *   - Bugfix/improvement → game improvement pipeline
 *   - Technical task → engineering pipeline
 *
 * It delegates execution to PipelineRunner (the single orchestrator) so that
 * Manager, Orchestrator and CLI all share one orchestration path.
 */

function parseArgs(argv: string[]): {
  goal: string;
  pipeline?: "game" | "engineering";
  project?: string;
} {
  const args = [...argv];
  const positional: string[] = [];
  let pipeline: "game" | "engineering" | undefined;
  let project: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--pipeline") {
      const val = args[++i]?.toLowerCase();
      if (val === "game" || val === "engineering") {
        pipeline = val;
      }
    } else if (a === "--project") {
      project = args[++i];
    } else if (!a.startsWith("--")) {
      positional.push(a);
    }
  }

  return {
    goal: positional.join(" ").trim(),
    pipeline,
    project
  };
}

const { goal, pipeline: pipelineType, project: explicitProject } =
  parseArgs(process.argv.slice(2));

if (!goal) {
  console.log(`
🏭 AI FACTORY MANAGER

Usage:

npx tsx factory/manager/manager.ts "your task" [options]

Options:

  --pipeline <type>  game | engineering (auto-detected from goal)
  --project <dir>    Project directory

Examples:

npx tsx factory/manager/manager.ts "Create Parking Panic game"
npx tsx factory/manager/manager.ts "Fix TypeScript errors" --pipeline engineering
`);
  process.exit(1);
}

console.log(`
╔══════════════════════════════════════╗
║        🧠 AI FACTORY MANAGER         ║
╚══════════════════════════════════════╝
`);

console.log("🎯 GOAL:", goal);

const projectDir =
  explicitProject ??
  process.env.AI_FACTORY_PROJECT;

if (!projectDir) {
  console.log("\n❌ No project specified. Use --project or set AI_FACTORY_PROJECT.");
  process.exit(1);
}

console.log("📁 PROJECT:", projectDir);

const baseDir = path.resolve(
  process.env.AI_FACTORY_HOME ?? process.cwd()
);

const engine = await detectEngine(projectDir);
console.log(
  `⚙️  ENGINE: ${engine.kind}${engine.stack ? " — " + engine.stack : ""}`
);

if (engine.kind === "unity") {
  console.log(
    "\n⚠️  UNITY project detected but no Unity adapter exists. WEB pipeline only."
  );
  process.exit(1);
}

// Auto-detect or use explicit pipeline type
const pipelineDef = selectPipeline(goal, pipelineType);
console.log(`📋 PIPELINE: ${pipelineDef.name} (${pipelineDef.type})`);

console.log("\n🚀 Starting pipeline with context handoff...\n");

await runGoal(goal, baseDir, projectDir, {
  pipelineType: pipelineDef.type
});
