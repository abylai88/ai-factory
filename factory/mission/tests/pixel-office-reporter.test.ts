import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PixelOfficeReporter } from "../pixel-office-reporter.js";
import { InMemoryEventSink } from "../events.js";
import type { MissionEvent } from "../mission.js";

function makeEvent(
  type: string,
  missionId: string,
  payload: Record<string, unknown> = {},
): MissionEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    occurredAt: new Date().toISOString(),
    missionId,
    type: type as MissionEvent["type"],
    payload,
  };
}

describe("PixelOfficeReporter", () => {
  let sink: InMemoryEventSink;
  let reporter: PixelOfficeReporter;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sink = new InMemoryEventSink();
    reporter = new PixelOfficeReporter({
      serverUrl: "http://127.0.0.1:3999",
      authToken: "test-token",
      eventSink: sink,
    });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
  });

  afterEach(() => {
    reporter.stop();
    fetchSpy.mockRestore();
  });

  it("sends agent.started on delegation.created", async () => {
    reporter.start();

    sink.publish({
      missionId: "m1",
      type: "delegation.created",
      payload: {
        id: "del-abc",
        title: "Market Analysis",
        stepIds: ["market"],
        description: "Analyze target market\nROLE: coder\nFILE: src/index.ts",
      },
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:3999/api/ai-factory/events",
      expect.objectContaining({ method: "POST" }),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body).toEqual({
      type: "agent.started",
      missionId: "m1",
      agentId: "del-abc",
      role: "Researcher",
      name: "Market Analysis",
      task: expect.stringContaining("Analyze target market"),
    });
  });

  it("deduplicates delegation.started after delegation.created", async () => {
    reporter.start();

    sink.publish({
      missionId: "m1",
      type: "delegation.created",
      payload: { id: "del-1", title: "Build", stepIds: ["implementation"] },
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    // delegation.started should be deduped
    sink.publish({
      missionId: "m1",
      type: "delegation.started",
      payload: { delegationId: "del-1", pipelineId: "p1" },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sends fallback agent.started on delegation.started without created", async () => {
    reporter.start();

    sink.publish({
      missionId: "m1",
      type: "delegation.started",
      payload: { delegationId: "del-fallback", pipelineId: "p1" },
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.type).toBe("agent.started");
    expect(body.agentId).toBe("del-fallback");
  });

  it("sends agent.completed on delegation.completed with status=passed", async () => {
    reporter.start();

    sink.publish({
      missionId: "m1",
      type: "delegation.created",
      payload: { id: "del-2", title: "Test", stepIds: ["test"] },
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    sink.publish({
      missionId: "m1",
      type: "delegation.completed",
      payload: { delegationId: "del-2", status: "passed" },
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    const body = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
    expect(body).toEqual({
      type: "agent.completed",
      missionId: "m1",
      agentId: "del-2",
    });
  });

  it("sends agent.failed on delegation.completed with status=failed", async () => {
    reporter.start();

    sink.publish({
      missionId: "m1",
      type: "delegation.created",
      payload: { id: "del-3", title: "Build", stepIds: ["build"] },
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    sink.publish({
      missionId: "m1",
      type: "delegation.completed",
      payload: { delegationId: "del-3", status: "failed", error: "Build failed" },
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    const body = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
    expect(body).toEqual({
      type: "agent.failed",
      missionId: "m1",
      agentId: "del-3",
    });
  });

  it("does not forward mission-level events", async () => {
    reporter.start();

    sink.publish({
      missionId: "m1",
      type: "mission.started",
      payload: {},
    });

    sink.publish({
      missionId: "m1",
      type: "mission.completed",
      payload: { status: "completed" },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not forward when stopped", async () => {
    reporter.start();
    reporter.stop();

    sink.publish({
      missionId: "m1",
      type: "delegation.created",
      payload: { id: "del-x", title: "Test", stepIds: ["test"] },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handles HTTP errors gracefully", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    reporter.start();

    // Should not throw
    sink.publish({
      missionId: "m1",
      type: "delegation.created",
      payload: { id: "del-err", title: "Test", stepIds: ["test"] },
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });

  it("handles network errors gracefully", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    reporter.start();

    // Should not throw
    sink.publish({
      missionId: "m1",
      type: "delegation.created",
      payload: { id: "del-net", title: "Test", stepIds: ["test"] },
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });

  it("maps agent roles correctly", async () => {
    reporter.start();

    const roleTests = [
      { stepId: "market", expectedRole: "Researcher" },
      { stepId: "competitor", expectedRole: "Researcher" },
      { stepId: "idea", expectedRole: "Designer" },
      { stepId: "director", expectedRole: "Designer" },
      { stepId: "gameplay", expectedRole: "Designer" },
      { stepId: "designer", expectedRole: "Designer" },
      { stepId: "architect", expectedRole: "Developer" },
      { stepId: "programmer", expectedRole: "Developer" },
      { stepId: "builder", expectedRole: "Developer" },
      { stepId: "content", expectedRole: "Designer" },
      { stepId: "tester", expectedRole: "QA" },
      { stepId: "reviewer", expectedRole: "QA" },
    ];

    for (const { stepId, expectedRole } of roleTests) {
      fetchSpy.mockClear();
      sink.publish({
        missionId: "m1",
        type: "delegation.created",
        payload: { id: `del-${stepId}`, title: stepId, stepIds: [stepId] },
      });

      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.role).toBe(expectedRole);
    }
  });

  it("strips trailing slash from serverUrl", async () => {
    const r = new PixelOfficeReporter({
      serverUrl: "http://127.0.0.1:3999/",
      authToken: "tok",
      eventSink: sink,
    });

    r.start();
    sink.publish({
      missionId: "m1",
      type: "delegation.created",
      payload: { id: "del-slash", title: "Test", stepIds: ["test"] },
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    expect(fetchSpy.mock.calls[0][0]).toBe("http://127.0.0.1:3999/api/ai-factory/events");
    r.stop();
  });

  it("uses 5s timeout on fetch", async () => {
    reporter.start();

    sink.publish({
      missionId: "m1",
      type: "delegation.created",
      payload: { id: "del-timeout", title: "Test", stepIds: ["test"] },
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    expect(fetchSpy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  describe("multiple delegations", () => {
    it("tracks each delegation independently", async () => {
      reporter.start();

      // Delegation 1 created
      sink.publish({
        missionId: "m1",
        type: "delegation.created",
        payload: { id: "del-1", title: "Market", stepIds: ["market"] },
      });
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

      // Delegation 2 created
      sink.publish({
        missionId: "m1",
        type: "delegation.created",
        payload: { id: "del-2", title: "Build", stepIds: ["builder"] },
      });
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

      // Delegation 1 completed
      sink.publish({
        missionId: "m1",
        type: "delegation.completed",
        payload: { delegationId: "del-1", status: "passed" },
      });
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));

      // Delegation 2 failed
      sink.publish({
        missionId: "m1",
        type: "delegation.completed",
        payload: { delegationId: "del-2", status: "failed" },
      });
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(4));

      const bodies = fetchSpy.mock.calls.map((c: unknown[]) => JSON.parse((c[1] as { body: string }).body));
      expect(bodies.map((b: Record<string, unknown>) => b.type)).toEqual([
        "agent.started",
        "agent.started",
        "agent.completed",
        "agent.failed",
      ]);
      expect(bodies.map((b: Record<string, unknown>) => b.agentId)).toEqual([
        "del-1",
        "del-2",
        "del-1",
        "del-2",
      ]);
    });
  });
});
