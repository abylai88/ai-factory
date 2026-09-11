import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PixelAgentsBridge } from "../pixel-agents-bridge.js";
import { InMemoryEventSink } from "../events.js";
import type { MissionEvent } from "../mission.js";

function makeEvent(
  type: string,
  missionId: string,
  payload: Record<string, unknown> = {},
): MissionEvent {
  return {
    id: `evt-${Date.now()}`,
    occurredAt: new Date().toISOString(),
    missionId,
    type: type as MissionEvent["type"],
    payload,
  };
}

describe("PixelAgentsBridge", () => {
  let sink: InMemoryEventSink;
  let bridge: PixelAgentsBridge;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sink = new InMemoryEventSink();
    bridge = new PixelAgentsBridge({
      serverUrl: "http://127.0.0.1:3845",
      authToken: "test-token",
      eventSink: sink,
    });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
  });

  afterEach(() => {
    bridge.stop();
    fetchSpy.mockRestore();
  });

  it("forwards events to Pixel Agents hook endpoint", async () => {
    bridge.start();

    sink.publish({
      missionId: "m1",
      type: "mission.started",
      payload: {},
    });

    // Allow async forward to complete
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:3845/api/hooks/ai-factory",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }) as Record<string, string>,
      }),
    );
  });

  it("sends correct session_id for mission events", async () => {
    bridge.start();

    sink.publish({
      missionId: "mission-abc",
      type: "mission.started",
      payload: {},
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.session_id).toBe("ai-factory:mission-abc");
    expect(body.hook_event_name).toBe("mission.started");
    expect(body.mission_id).toBe("mission-abc");
  });

  it("sends delegation-scoped session_id when delegationId is present", async () => {
    bridge.start();

    sink.publish({
      missionId: "mission-abc",
      type: "delegation.started",
      payload: { delegationId: "del-1", title: "Build" },
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.session_id).toBe("ai-factory:mission-abc:del-1");
  });

  it("does not forward when stopped", () => {
    bridge.start();
    bridge.stop();

    sink.publish({
      missionId: "m1",
      type: "mission.started",
      payload: {},
    });

    // Wait a tick — no fetch should happen
    return new Promise((resolve) => setTimeout(resolve, 50)).then(() => {
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("handles HTTP errors gracefully", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    bridge.start();

    // Should not throw
    sink.publish({
      missionId: "m1",
      type: "mission.started",
      payload: {},
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });

  it("strips trailing slash from serverUrl", async () => {
    const b = new PixelAgentsBridge({
      serverUrl: "http://127.0.0.1:3845/",
      authToken: "tok",
      eventSink: sink,
    });

    b.start();
    sink.publish({
      missionId: "m1",
      type: "mission.started",
      payload: {},
    });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    expect(fetchSpy.mock.calls[0][0]).toBe("http://127.0.0.1:3845/api/hooks/ai-factory");
    b.stop();
  });

  describe("forward()", () => {
    it("can be called directly for a single event", async () => {
      await bridge.forward(
        makeEvent("delegation.started", "m1", { delegationId: "d1", title: "Test" }),
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.hook_event_name).toBe("delegation.started");
      expect(body.session_id).toBe("ai-factory:m1:d1");
    });

    it("throws on non-2xx response", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("error", { status: 500 }));

      await expect(
        bridge.forward(makeEvent("mission.started", "m1")),
      ).rejects.toThrow("HTTP 500");
    });
  });

  describe("session ID patterns", () => {
    it("uses mission-level for mission.completed", async () => {
      bridge.start();

      sink.publish({
        missionId: "m-123",
        type: "mission.completed",
        payload: { status: "completed" },
      });

      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.session_id).toBe("ai-factory:m-123");
    });

    it("uses delegation-level for delegation.completed", async () => {
      bridge.start();

      sink.publish({
        missionId: "m-123",
        type: "delegation.completed",
        payload: { delegationId: "del-456", status: "passed" },
      });

      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.session_id).toBe("ai-factory:m-123:del-456");
    });

    it("uses mission-level for visual QA events without delegationId", async () => {
      bridge.start();

      sink.publish({
        missionId: "m-123",
        type: "mission.visual_qa.started",
        payload: { runId: "run-1" },
      });

      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      // No delegationId in payload → mission-level
      expect(body.session_id).toBe("ai-factory:m-123");
    });

    it("forwards full payload through to hook endpoint", async () => {
      bridge.start();

      const payload = {
        delegationId: "del-abc",
        title: "Market Analysis",
        pipelineId: "pipeline-1",
        output: "Analysis complete",
      };

      sink.publish({
        missionId: "m-1",
        type: "delegation.completed",
        payload,
      });

      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.payload).toEqual(payload);
    });
  });
});
