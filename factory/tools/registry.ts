import type {
  ToolCallContext,
  ToolDefinition,
  ToolResult,
  ToolRole,
} from "./types.js";
import { blocked, fail } from "./types.js";
import { roleMayUse } from "./roles.js";
import { emitToolEvent } from "./observability.js";
import { mayInvokeDangerous } from "./safety.js";

/**
 * Centralized tool registry.
 *
 * Each tool exposes id/name/description/capability/platform/execution
 * method/permissions/timeout/retry/dangerous/health-check/failure
 * classification. Agents invoke tools by id through `execute()` — never by
 * raw shell. Role permissions are enforced here (defense in depth with the
 * OpenCode bash-permission profiles).
 */

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolCallContext
) => Promise<ToolResult>;

export interface RegisteredTool extends ToolDefinition {
  handler: ToolHandler;
  healthCheck?: () => Promise<{ ok: boolean; message: string }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(def: ToolDefinition, handler: ToolHandler, healthCheck?: RegisteredTool["healthCheck"]): void {
    if (this.tools.has(def.id)) {
      throw new Error(`tool already registered: ${def.id}`);
    }
    this.tools.set(def.id, { ...def, handler, healthCheck });
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  get(id: string): RegisteredTool | undefined {
    return this.tools.get(id);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  listForRole(role: ToolRole): RegisteredTool[] {
    return this.list().filter(
      (t) => t.allowedRoles.includes(role) && roleMayUse(role, t.id)
    );
  }

  /** All registered ids (for completeness audits). */
  ids(): string[] {
    return [...this.tools.keys()];
  }

  async healthCheck(id: string): Promise<{ ok: boolean; message: string }> {
    const t = this.tools.get(id);
    if (!t) return { ok: false, message: `unknown tool: ${id}` };
    if (!t.healthCheck) return { ok: true, message: "no health check (always available)" };
    try {
      return await t.healthCheck();
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async healthCheckAll(): Promise<Record<string, { ok: boolean; message: string }>> {
    const out: Record<string, { ok: boolean; message: string }> = {};
    for (const t of this.list()) {
      out[t.id] = await this.healthCheck(t.id);
    }
    return out;
  }

  /**
   * Execute a tool with permission enforcement, timeout, retry, safety, and
   * observability. Never throws for tool-level failures — returns a
   * PASS/FAIL/BLOCKED ToolResult instead.
   */
  async execute(
    id: string,
    args: Record<string, unknown>,
    ctx: ToolCallContext
  ): Promise<ToolResult> {
    const t = this.tools.get(id);
    const attempt = ctx.attempt ?? 1;
    if (!t) {
      return fail(id, `unknown tool: ${id}`, { affectedFiles: [] });
    }
    if (!t.allowedRoles.includes(ctx.role)) {
      emitToolEvent({
        type: "tool.blocked",
        toolId: id,
        role: ctx.role,
        projectDir: ctx.projectDir,
        message: `permission denied: role ${ctx.role} may not use ${id}`,
        attempt,
      });
      return blocked(id, `permission denied: role "${ctx.role}" may not use tool "${id}"`);
    }
    if (t.dangerous && !mayInvokeDangerous(ctx.role)) {
      emitToolEvent({
        type: "tool.blocked",
        toolId: id,
        role: ctx.role,
        projectDir: ctx.projectDir,
        message: `destructive tool denied for role ${ctx.role}: ${id}`,
        attempt,
      });
      return blocked(id, `destructive operation protection: role "${ctx.role}" may not invoke "${id}"`);
    }
    if (args == null || typeof args !== "object" || Array.isArray(args)) {
      return fail(id, `invalid tool arguments: args must be an object`, { affectedFiles: [] });
    }

    emitToolEvent({
      type: "tool.started",
      toolId: id,
      role: ctx.role,
      projectDir: ctx.projectDir,
      message: `executing ${id}`,
      attempt,
    });
    const start = Date.now();
    const timeoutMs = t.timeoutMs > 0 ? t.timeoutMs : DEFAULT_TIMEOUT_MS;
    const maxTries = 1 + Math.max(0, t.retry?.maxRetries ?? 0);
    let last: ToolResult | undefined;
    for (let i = 1; i <= maxTries; i++) {
      try {
        const result = await withTimeout(t.handler(args, ctx), timeoutMs, id);
        result.durationMs = Date.now() - start;
        last = result;
        if (result.status === "PASS" || result.status === "FAIL") {
          emitToolEvent({
            type: result.status === "PASS" ? "tool.completed" : "tool.failed",
            toolId: id,
            role: ctx.role,
            projectDir: ctx.projectDir,
            message: result.message,
            durationMs: result.durationMs,
            attempt: i,
          });
          return result;
        }
        // BLOCKED: infrastructure — do not retry as code repair; retry only
        // the transport a bounded number of times, then surface BLOCKED.
        emitToolEvent({
          type: "tool.blocked",
          toolId: id,
          role: ctx.role,
          projectDir: ctx.projectDir,
          message: result.message,
          durationMs: result.durationMs,
          attempt: i,
        });
        if (i < maxTries) await sleep(t.retry?.backoffMs ?? 500);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/tool timeout/i.test(message)) {
          last = blocked(id, `tool timeout after ${timeoutMs}ms: ${id}`, {
            stdout: "",
            stderr: message,
            durationMs: Date.now() - start,
          });
          emitToolEvent({
            type: "tool.blocked",
            toolId: id,
            role: ctx.role,
            projectDir: ctx.projectDir,
            message: last.message,
            durationMs: last.durationMs,
            attempt: i,
          });
          return last;
        }
        last = fail(id, `tool error: ${message}`, {
          stdout: "",
          stderr: message,
          durationMs: Date.now() - start,
        });
        emitToolEvent({
          type: "tool.failed",
          toolId: id,
          role: ctx.role,
          projectDir: ctx.projectDir,
          message: last.message,
          durationMs: last.durationMs,
          attempt: i,
        });
        return last;
      }
    }
    return (
      last ??
      blocked(id, `tool unavailable after ${maxTries} attempt(s): ${id}`)
    );
  }
}

function withTimeout(p: Promise<ToolResult>, ms: number, id: string): Promise<ToolResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`tool timeout (${id}) after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Singleton default registry (tests create isolated instances instead). */
export const globalToolRegistry = new ToolRegistry();
