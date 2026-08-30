import type { Artifact } from "../../shared/src/index.js";
export interface VisualQaResult { id: string; status: "not_available"; message: string; artifacts: Artifact[]; }
export interface VisualQAService { run(projectId: string): Promise<VisualQaResult>; getResults(id: string): Promise<VisualQaResult | undefined>; getScreenshots(id: string): Promise<Artifact[]>; }
export class StubVisualQAService implements VisualQAService {
  private readonly result: VisualQaResult = { id: "phase-1-stub", status: "not_available", message: "Visual QA is an interface only in Phase 1; Playwright is not executed.", artifacts: [] };
  async run(_projectId: string) { return this.result; } async getResults(id: string) { return id === this.result.id ? this.result : undefined; } async getScreenshots(_id: string) { return []; }
}
