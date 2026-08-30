import { create } from "zustand";
import type { FactoryEvent } from "@shared";

interface OfficeState {
  events: FactoryEvent[];
  connected: boolean;
  setEvents: (events: FactoryEvent[]) => void;
  prependEvent: (event: FactoryEvent) => void;
  setConnected: (value: boolean) => void;
}

export const useOffice = create<OfficeState>(set => ({
  events: [],
  connected: false,
  setEvents: events => set({ events }),
  prependEvent: event => set(state => ({ events: [event, ...state.events].slice(0, 100) })),
  setConnected: connected => set({ connected })
}));
