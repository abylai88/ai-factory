import path from "node:path";
import { TaskRunner } from "./task-runner.js";

const title = process.argv[2];
const description = process.argv.slice(3).join(" ");

if (!title || !description) {
  console.log(`
Usage:

npx tsx factory/task-runner/cli.ts "Task title" "Task description"

Example:

npx tsx factory/task-runner/cli.ts "Analyze project" "Find the most important technical problems."
`);
  process.exit(1);
}

const baseDir = path.resolve(
  process.env.AI_FACTORY_HOME ?? process.cwd()
);

const runner = new TaskRunner({
  baseDir,
  maxAttempts: 3
});

await runner.init();

const task = await runner.getManager().createTask(
  title,
  description,
  "engineering"
);

console.log("\n╔══════════════════════════════════════╗");
console.log("║       🏭 AI FACTORY CLI              ║");
console.log("╚══════════════════════════════════════╝");

console.log("\n📋 TASK CREATED");
console.log("ID:", task.id);
console.log("TITLE:", task.title);

const results = await runner.runQueue();

console.log("\n========================================");
console.log("📊 RESULT");
console.log("========================================");

for (const result of results) {
  console.log(`\n${result.status === "passed" ? "✅" : "❌"} ${result.title}`);
  console.log("STATUS:", result.status);

  if (result.result) {
    console.log("\nAGENT OUTPUT:");
    console.log(result.result);
  }

  if (result.error) {
    console.log("\nERROR:", result.error);
  }
}
