import path from "node:path";
import { runGoal } from "./pipeline-runner.js";

const goal =
  process.argv
    .slice(2)
    .join(" ")
    .trim();

if (!goal) {
  console.log(`
Usage:

npx tsx factory/pipeline/run-pipeline.ts "your goal"

Example:

npx tsx factory/pipeline/run-pipeline.ts "Create a puzzle game" --project /path/to/project
`);

  process.exit(1);
}

const baseDir =
  path.resolve(
    process.env.AI_FACTORY_HOME ??
    process.cwd()
  );

const project = process.env.AI_FACTORY_PROJECT;

if (!project) {
  console.log("\n❌ No project specified. Set AI_FACTORY_PROJECT environment variable.");
  process.exit(1);
}

await runGoal(
  goal,
  baseDir,
  project
);
