#!/usr/bin/env node

/**
 * Demo: send a sequence of AI Factory events to Pixel Agents.
 *
 * Usage:
 *   npx tsx factory/mission/demo-pixel-agents.ts [serverUrl] [authToken]
 *
 * Defaults:
 *   serverUrl = http://127.0.0.1:3845
 *   authToken = (reads from ~/.pixel-agents/server.json)
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SERVER_URL = process.argv[2] || "http://127.0.0.1:3845";
const AUTH_TOKEN = process.argv[3] || readAuthToken();

function readAuthToken(): string {
  try {
    const serverJson = path.join(os.homedir(), ".pixel-agents", "server.json");
    const raw = fs.readFileSync(serverJson, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.token || "";
  } catch {
    console.error("Could not read auth token from ~/.pixel-agents/server.json");
    console.error("Usage: npx tsx factory/mission/demo-pixel-agents.ts [serverUrl] [authToken]");
    process.exit(1);
  }
}

async function send(event: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SERVER_URL}/api/hooks/ai-factory`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  console.log(`  -> ${event.hook_event_name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MISSION_ID = `demo-${Date.now()}`;
const DELEGATION_1 = "del-market-analysis";
const DELEGATION_2 = "del-architecture";

console.log(`Mission: ${MISSION_ID}`);
console.log(`Server:  ${SERVER_URL}`);
console.log();

async function main() {
  // 1. Mission created
  await send({
    session_id: `ai-factory:${MISSION_ID}`,
    hook_event_name: "mission.created",
    mission_id: MISSION_ID,
    payload: { goal: "Build a simple game" },
  });
  await sleep(800);

  // 2. Mission started
  await send({
    session_id: `ai-factory:${MISSION_ID}`,
    hook_event_name: "mission.started",
    mission_id: MISSION_ID,
    payload: {},
  });
  await sleep(500);

  // 3. Delegation 1 started (market analysis)
  await send({
    session_id: `ai-factory:${MISSION_ID}:${DELEGATION_1}`,
    hook_event_name: "delegation.started",
    mission_id: MISSION_ID,
    payload: { delegationId: DELEGATION_1, title: "Market Analysis" },
  });
  await sleep(2000);

  // 4. Delegation 1 completed
  await send({
    session_id: `ai-factory:${MISSION_ID}:${DELEGATION_1}`,
    hook_event_name: "delegation.completed",
    mission_id: MISSION_ID,
    payload: { delegationId: DELEGATION_1, status: "passed" },
  });
  await sleep(500);

  // 5. Delegation 2 started (architecture)
  await send({
    session_id: `ai-factory:${MISSION_ID}:${DELEGATION_2}`,
    hook_event_name: "delegation.started",
    mission_id: MISSION_ID,
    payload: { delegationId: DELEGATION_2, title: "Architecture Design" },
  });
  await sleep(1000);

  // 6. Build started
  await send({
    session_id: `ai-factory:${MISSION_ID}:${DELEGATION_2}`,
    hook_event_name: "build.started",
    mission_id: MISSION_ID,
    payload: { delegationId: DELEGATION_2 },
  });
  await sleep(3000);

  // 7. Build completed
  await send({
    session_id: `ai-factory:${MISSION_ID}:${DELEGATION_2}`,
    hook_event_name: "build.completed",
    mission_id: MISSION_ID,
    payload: { delegationId: DELEGATION_2 },
  });
  await sleep(500);

  // 8. Visual QA started
  await send({
    session_id: `ai-factory:${MISSION_ID}:${DELEGATION_2}`,
    hook_event_name: "mission.visual_qa.started",
    mission_id: MISSION_ID,
    payload: { runId: `run-${Date.now()}` },
  });
  await sleep(2000);

  // 9. Visual QA completed
  await send({
    session_id: `ai-factory:${MISSION_ID}:${DELEGATION_2}`,
    hook_event_name: "mission.visual_qa.completed",
    mission_id: MISSION_ID,
    payload: { status: "passed", passed: true, runId: `run-${Date.now()}` },
  });
  await sleep(500);

  // 10. Delegation 2 completed
  await send({
    session_id: `ai-factory:${MISSION_ID}:${DELEGATION_2}`,
    hook_event_name: "delegation.completed",
    mission_id: MISSION_ID,
    payload: { delegationId: DELEGATION_2, status: "passed" },
  });
  await sleep(500);

  // 11. Mission completed
  await send({
    session_id: `ai-factory:${MISSION_ID}`,
    hook_event_name: "mission.completed",
    mission_id: MISSION_ID,
    payload: { status: "completed" },
  });

  console.log();
  console.log("Done! Check Pixel Agents office for animated agents.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
