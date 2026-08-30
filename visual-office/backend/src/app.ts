import Fastify from "fastify";
import cors from "@fastify/cors";
import path from "node:path";
import { FactoryAdapter } from "./factory-adapter.js";
import { EventBus } from "./events.js";
import { FactoryMonitor } from "./monitor.js";

export interface AppOptions { factoryRoot?: string; startMonitor?: boolean; }
export function createApp(options: AppOptions = {}) {
  const factoryRoot = path.resolve(options.factoryRoot ?? process.env.AI_FACTORY_HOME ?? path.resolve(process.cwd(), ".."));
  const app = Fastify({ logger: false }); const adapter = new FactoryAdapter({ factoryRoot }); const events = new EventBus(); const monitor = new FactoryMonitor(adapter, events);
  app.register(cors, { origin: [/^http:\/\/127\.0\.0\.1(?::\d+)?$/, /^http:\/\/localhost(?::\d+)?$/] });
  app.get("/api/health", async () => ({ status: "ok", mode: "read-only", factoryRoot: "configured" }));
  app.get("/api/pipelines", async () => ({ pipelines: await adapter.listPipelines() }));
  app.get<{ Params: { id: string } }>("/api/pipelines/:id", async (request, reply) => { const pipeline = await adapter.getPipeline(request.params.id); return pipeline ? { pipeline } : reply.code(404).send({ error: "Pipeline not found" }); });
  app.get("/api/projects", async () => ({ projects: await adapter.listProjects() }));
  app.get<{ Params: { id: string } }>("/api/projects/:id/tasks", async (request, reply) => { const tasks = await adapter.getTasks(request.params.id); return tasks ? { tasks } : reply.code(404).send({ error: "Project not found" }); });
  app.get("/api/agents", async () => ({ agents: await adapter.listAgents() }));
  app.get<{ Params: { name: string } }>("/api/agents/:name", async (request, reply) => { const agent = await adapter.getAgent(request.params.name); return agent ? { agent } : reply.code(404).send({ error: "Agent not found" }); });
  app.get("/api/events", (request, reply) => {
    reply.hijack(); reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" }); reply.raw.flushHeaders();
    const send = (event: unknown) => reply.raw.write(`event: factory\ndata: ${JSON.stringify(event)}\n\n`);
    events.recent().reverse().forEach(send); const unsubscribe = events.subscribe(send); const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
    request.raw.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
  });
  if (options.startMonitor !== false) app.addHook("onReady", async () => { await monitor.start(); });
  app.addHook("onClose", async () => monitor.stop());
  return app;
}

