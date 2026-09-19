export interface StageData {
  id: string;
  name: string;
  bgColor: number;
  groundColor: number;
  ambientColor: number;
  musicKey: string;
}

export const STAGES: StageData[] = [
  {
    id: "neon-arena",
    name: "Neon Arena",
    bgColor: 0x0a0a1a,
    groundColor: 0x1a1a3a,
    ambientColor: 0x00ffaa,
    musicKey: "music-arena",
  },
  {
    id: "rooftop",
    name: "Rooftop",
    bgColor: 0x1a0a0a,
    groundColor: 0x3a2a1a,
    ambientColor: 0xff6644,
    musicKey: "music-rooftop",
  },
  {
    id: "dojo",
    name: "Dojo",
    bgColor: 0x0a1a0a,
    groundColor: 0x2a3a1a,
    ambientColor: 0xccaa44,
    musicKey: "music-dojo",
  },
];

export function getStage(id: string): StageData {
  return STAGES.find((s) => s.id === id) || STAGES[0];
}

export function getRandomStage(): StageData {
  return STAGES[Math.floor(Math.random() * STAGES.length)];
}
