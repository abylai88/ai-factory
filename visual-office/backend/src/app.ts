import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FactoryAdapter } from "./factory-adapter.js";
import { EventBus } from "./events.js";
import { FactoryMonitor } from "./monitor.js";
import { NullInfrastructureAgent } from "./infrastructure-agent.js";
import { PlaywrightVisualQAService } from "../../visual-qa/src/service.js";
import { VisualQaRunRequestSchema } from "../../shared/src/index.js";

export interface AppOptions { factoryRoot?: string; startMonitor?: boolean; serveStatic?: boolean; visualQa?: PlaywrightVisualQAService; }

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(moduleDir, "../..");

export function createApp(options: AppOptions = {}) {
  const factoryRoot = path.resolve(options.factoryRoot ?? process.env.AI_FACTORY_HOME ?? path.resolve(process.cwd(), ".."));
  const app = Fastify({ logger: false });
  const adapter = new FactoryAdapter({ factoryRoot });
  const events = new EventBus();
  const monitor = new FactoryMonitor(adapter, events);
  const hermes = new NullInfrastructureAgent();
  const visualQa = options.visualQa ?? new PlaywrightVisualQAService({
    factoryRoot,
    publish: event => events.publish(event)
  });

  app.register(cors, { origin: [/^http:\/\/127\.0\.0\.1(?::\d+)?$/, /^http:\/\/localhost(?::\d+)?$/] });

  app.get("/api/health", async () => ({
    status: "ok",
    mode: "read-only",
    factoryRoot: "configured",
    version: "0.1.0"
  }));

  app.get("/api/pipelines", async () => ({ pipelines: await adapter.listPipelines() }));

  app.get<{ Params: { id: string } }>("/api/pipelines/:id", async (request, reply) => {
    const pipeline = await adapter.getPipeline(request.params.id);
    return pipeline ? { pipeline } : reply.code(404).send({ error: "Pipeline not found" });
  });

  app.get("/api/projects", async () => ({ projects: await adapter.listProjects() }));

  app.get<{ Params: { id: string } }>("/api/projects/:id/tasks", async (request, reply) => {
    const tasks = await adapter.getTasks(request.params.id);
    return tasks ? { tasks } : reply.code(404).send({ error: "Project not found" });
  });

  app.get<{ Params: { id: string; taskId: string } }>("/api/projects/:id/tasks/:taskId", async (request, reply) => {
    const task = await adapter.getTask(request.params.id, request.params.taskId);
    return task ? { task } : reply.code(404).send({ error: "Task not found" });
  });

  app.get("/api/agents", async () => ({ agents: await adapter.listAgents() }));

  app.get<{ Params: { name: string } }>("/api/agents/:name", async (request, reply) => {
    const agent = await adapter.getAgent(request.params.name);
    return agent ? { agent } : reply.code(404).send({ error: "Agent not found" });
  });

  app.get("/api/events/recent", async () => ({ events: events.recent() }));

  app.get("/api/diagnostics", async () => {
    await adapter.listPipelines();
    const adapterDiagnostics = adapter.consumeDiagnostics().map(d => ({
      source: d.source,
      message: d.message,
      occurredAt: new Date().toISOString()
    }));
    const eventDiagnostics = events.recent()
      .filter(e => e.type === "diagnostic")
      .map(e => ({
        source: String(e.payload.source ?? "unknown"),
        message: String(e.payload.message ?? "Unknown diagnostic"),
        occurredAt: e.occurredAt
      }));
    return { diagnostics: [...eventDiagnostics, ...adapterDiagnostics] };
  });

  app.get("/api/visual-qa/status", async () => ({ visualQa: await visualQa.getStatus() }));

  app.post("/api/visual-qa/runs", async (request, reply) => {
    const parsed = VisualQaRunRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid Visual QA request", details: parsed.error.flatten() });
    try {
      const run = await visualQa.run(parsed.data);
      return reply.code(202).send({ run });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to start Visual QA run" });
    }
  });

  app.get<{ Params: { id: string } }>("/api/visual-qa/runs/:id", async (request, reply) => {
    if (!/^run-[A-Za-z0-9-]+$/.test(request.params.id)) return reply.code(400).send({ error: "Invalid run id" });
    const run = await visualQa.getResults(request.params.id);
    return run ? { run } : reply.code(404).send({ error: "Run not found" });
  });

  app.get<{ Params: { id: string } }>("/api/artifacts/:id", async (request, reply) => {
    const store = visualQa.getArtifactStore();
    const resolved = await store.resolveArtifactPath(request.params.id);
    if (!resolved) return reply.code(404).send({ error: "Artifact not found" });
    const ext = path.extname(resolved.absolute).toLowerCase();
    const type = ext === ".png" ? "image/png" : ext === ".zip" ? "application/zip" : ext === ".json" ? "application/json" : "application/octet-stream";
    return reply.type(type).send(await import("node:fs/promises").then(fs => fs.readFile(resolved.absolute)));
  });

  app.get("/api/hermes/status", async () => {
    const assessment = await hermes.analyze();
    return { hermes: { available: assessment.available, summary: assessment.summary } };
  });

  app.get("/api/events", (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    reply.raw.flushHeaders();

    const send = (event: unknown) => reply.raw.write(`event: factory\ndata: ${JSON.stringify(event)}\n\n`);
    events.recent().reverse().forEach(send);
    const unsubscribe = events.subscribe(send);
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
    request.raw.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
  });

  const shouldServeStatic = options.serveStatic ?? process.env.NODE_ENV === "production";
  if (shouldServeStatic) {
    const distDir = path.join(packageRoot, "dist");
    void app.register(fastifyStatic, { root: distDir, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }

  if (options.startMonitor !== false) {
    app.addHook("onReady", async () => {
      await visualQa.init();
      await monitor.start();
    });
  } else {
    app.addHook("onReady", async () => { await visualQa.init(); });
  }
  app.addHook("onClose", async () => monitor.stop());

  return app;
}
