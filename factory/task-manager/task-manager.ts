import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

function sanitize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "project";
}

export type TaskStatus =
  | "queued"
  | "running"
  | "review"
  | "passed"
  | "failed"
  | "done";

export interface Task {
  id: string;
  title: string;
  description: string;
  role: string;
  agent?: string;
  model?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  result?: string;
  error?: string;
  attemptHistory?: string;
}

export class TaskManager {
  private tasks: Task[] = [];
  private readonly filePath: string;

  constructor(baseDir: string, project?: string) {
    const folder = project ? `project-${sanitize(project)}` : "default";
    this.filePath = path.join(baseDir, "tasks", folder, "tasks.json");
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const data = await fs.readFile(this.filePath, "utf8");
      this.tasks = JSON.parse(data);
    } catch {
      this.tasks = [];
      await this.save();
    }
  }

  private async save(): Promise<void> {
    await fs.writeFile(
      this.filePath,
      JSON.stringify(this.tasks, null, 2),
      "utf8"
    );
  }

  async createTask(
    title: string,
    description: string,
    role: string,
    model?: string,
    agent?: string
  ): Promise<Task> {
    const now = new Date().toISOString();

    const task: Task = {
      id: randomUUID(),
      title,
      description,
      role,
      agent,
      model,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      attempts: 0,
    };

    this.tasks.push(task);
    await this.save();

    return task;
  }

  async updateTask(
    id: string,
    updates: Partial<Omit<Task, "id" | "createdAt">>
  ): Promise<Task> {
    const task = this.tasks.find((item) => item.id === id);

    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    Object.assign(task, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });

    await this.save();

    return task;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.find((task) => task.id === id);
  }

  getAllTasks(): Task[] {
    return [...this.tasks];
  }

  getQueuedTasks(): Task[] {
    return this.tasks.filter((task) => task.status === "queued");
  }
}
