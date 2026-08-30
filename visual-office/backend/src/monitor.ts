import { watch } from "node:fs";
import path from "node:path";
import { FactoryAdapter } from "./factory-adapter.js";
import { EventBus, normalizePipeline, normalizeTasks } from "./events.js";
import type { PipelineSnapshot, TaskSnapshot } from "../../shared/src/index.js";

export class FactoryMonitor {
  private pipelines = new Map<string, PipelineSnapshot>(); private tasks = new Map<string, TaskSnapshot[]>(); private timer?: NodeJS.Timeout; private poll?: NodeJS.Timeout; private watchers: ReturnType<typeof watch>[] = [];
  constructor(private readonly adapter: FactoryAdapter, private readonly events: EventBus, private readonly debounceMs = 180, private readonly pollMs = 3_000) {}
  async refresh() {
    const next = await this.adapter.listPipelines(); for (const pipeline of next) { for (const event of normalizePipeline(this.pipelines.get(pipeline.id), pipeline)) this.events.publish(event); this.pipelines.set(pipeline.id, pipeline); }
    for (const project of await this.adapter.listProjects()) { const nextTasks = await this.adapter.getTasks(project.id) ?? []; for (const event of normalizeTasks(project.id, this.tasks.get(project.id) ?? [], nextTasks)) this.events.publish(event); this.tasks.set(project.id, nextTasks); }
    for (const diagnostic of this.adapter.consumeDiagnostics()) this.events.publish({ type: "diagnostic", severity: "warning", payload: { source: diagnostic.source, message: diagnostic.message } });
  }
  private schedule = () => { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => void this.refresh(), this.debounceMs); };
  async start() {
    await this.refresh();
    const watchDirs = [
      path.join(this.adapter.config.factoryRoot, "outputs", "pipelines"),
      path.join(this.adapter.config.factoryRoot, "tasks"),
      path.join(this.adapter.config.factoryRoot, "agents", "opencode")
    ];
    for (const dir of watchDirs) {
      try {
        this.watchers.push(watch(dir, { recursive: false }, this.schedule));
      } catch {
        this.events.publish({
          type: "diagnostic",
          severity: "warning",
          payload: { source: dir, message: "File watching unavailable; polling remains active" }
        });
      }
    }
    this.poll = setInterval(() => void this.refresh(), this.pollMs);
  }
  stop() { if (this.timer) clearTimeout(this.timer); if (this.poll) clearInterval(this.poll); this.watchers.forEach(w => w.close()); }
}

