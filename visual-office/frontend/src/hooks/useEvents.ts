import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FactoryEvent } from "@shared";
import { get } from "../api.js";
import { useOffice } from "../store.js";

const RECONNECT_MS = 3_000;

export function useEvents() {
  const setEvents = useOffice(s => s.setEvents);
  const prependEvent = useOffice(s => s.prependEvent);
  const setConnected = useOffice(s => s.setConnected);
  const queryClient = useQueryClient();

  useEffect(() => {
    let source: EventSource | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const invalidate = (event: FactoryEvent) => {
      if (event.type.startsWith("pipeline.")) {
        void queryClient.invalidateQueries({ queryKey: ["pipelines"] });
        if (event.pipelineId) {
          void queryClient.invalidateQueries({ queryKey: ["pipeline", event.pipelineId] });
        }
      }
      if (event.type.startsWith("task.")) {
        if (event.projectId) {
          void queryClient.invalidateQueries({ queryKey: ["tasks", event.projectId] });
        }
      }
      if (event.type.startsWith("visual_qa.")) {
        void queryClient.invalidateQueries({ queryKey: ["visual-qa"] });
        const runId = typeof event.payload.runId === "string" ? event.payload.runId : undefined;
        if (runId) void queryClient.invalidateQueries({ queryKey: ["visual-qa-run", runId] });
      }
    };

    const connect = () => {
      if (closed) return;
      source?.close();
      source = new EventSource("/api/events");

      source.onopen = () => setConnected(true);
      source.onerror = () => {
        setConnected(false);
        source?.close();
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };

      source.addEventListener("factory", message => {
        try {
          const event = JSON.parse((message as MessageEvent).data) as FactoryEvent;
          prependEvent(event);
          invalidate(event);
        } catch {
          /* ignore malformed SSE payloads */
        }
      });
    };

    void get<{ events: FactoryEvent[] }>("/api/events/recent")
      .then(({ events }) => setEvents(events))
      .catch(() => setEvents([]))
      .finally(connect);

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
      setConnected(false);
    };
  }, [prependEvent, queryClient, setConnected, setEvents]);
}
