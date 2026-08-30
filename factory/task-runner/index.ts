import path from "node:path";
import { TaskRunner } from "./task-runner.js";

const baseDir = path.resolve(
  process.env.AI_FACTORY_HOME ?? process.cwd()
);

const runner = new TaskRunner({
  baseDir,
  maxAttempts: 3
});

await runner.init();

console.log(`
╔══════════════════════════════════════╗
║       🏭 AI FACTORY TASK RUNNER      ║
╚══════════════════════════════════════╝
`);

console.log("📁 FACTORY:", baseDir);

const results = await runner.runQueue();

console.log("\n========================================");
console.log("📊 RUN SUMMARY");
console.log("========================================");

for (const task of results) {
  console.log(
    `${task.status === "passed" ? "✅" : "❌"} ${task.title} → ${task.status}`
  );
}
