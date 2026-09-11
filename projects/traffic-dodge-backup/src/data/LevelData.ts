
import { DifficultyStage, DifficultyProgression } from "@/interfaces/GameContent";

/**
 * Difficulty progression data for Traffic Dodge.
 *
 * The game uses continuous interpolation between stages, so the player
 * experiences a smooth ramp. Each stage defines parameters at its
 * time threshold; the game interpolates linearly between adjacent stages.
 */

export const DIFFICULTY_STAGES: DifficultyStage[] = [
    {
        // 0s — Gentle start: slow cars, generous spacing
        timeThreshold: 0,
        speedMultiplier: 1.0,
        spawnInterval: 1200,
        maxActiveCars: 6,
        doubleSpawnChance: 0,
        tripleSpawnChance: 0,
    },
    {
        // 15s — First ramp: slightly faster, tighter spawns
        timeThreshold: 15,
        speedMultiplier: 1.2,
        spawnInterval: 1000,
        maxActiveCars: 8,
        doubleSpawnChance: 0.1,
        tripleSpawnChance: 0,
    },
    {
        // 30s — Moderate: noticeable speed increase
        timeThreshold: 30,
        speedMultiplier: 1.4,
        spawnInterval: 850,
        maxActiveCars: 10,
        doubleSpawnChance: 0.2,
        tripleSpawnChance: 0,
    },
    {
        // 60s — Hard: cars are fast, spawns are frequent
        timeThreshold: 60,
        speedMultiplier: 1.7,
        spawnInterval: 650,
        maxActiveCars: 12,
        doubleSpawnChance: 0.3,
        tripleSpawnChance: 0.05,
    },
    {
        // 90s — Very hard: near the mechanical skill ceiling
        timeThreshold: 90,
        speedMultiplier: 2.0,
        spawnInterval: 500,
        maxActiveCars: 14,
        doubleSpawnChance: 0.35,
        tripleSpawnChance: 0.1,
    },
    {
        // 120s — Brutal: for expert players
        timeThreshold: 120,
        speedMultiplier: 2.3,
        spawnInterval: 420,
        maxActiveCars: 16,
        doubleSpawnChance: 0.4,
        tripleSpawnChance: 0.15,
    },
    {
        // 180s — Endgame: maximum difficulty
        timeThreshold: 180,
        speedMultiplier: 2.7,
        spawnInterval: 380,
        maxActiveCars: 18,
        doubleSpawnChance: 0.45,
        tripleSpawnChance: 0.2,
    },
];

export const DIFFICULTY_PROGRESSION: DifficultyProgression = {
    stages: DIFFICULTY_STAGES,
    rampDuration: 180,
};

/**
 * Interpolate between two difficulty stages at a given time.
 * Returns the blended stage values.
 */
export function interpolateDifficulty(
    stages: DifficultyStage[],
    gameTime: number
): DifficultyStage {
    // Before first stage
    if (gameTime <= stages[0].timeThreshold) {
        return { ...stages[0] };
    }

    // After last stage
    let last = stages[stages.length - 1];
    if (gameTime >= last.timeThreshold) {
        return { ...last };
    }

    // Find surrounding stages
    for (let i = 0; i < stages.length - 1; i++) {
        let a = stages[i];
        let b = stages[i + 1];
        if (gameTime >= a.timeThreshold && gameTime < b.timeThreshold) {
            let t = (gameTime - a.timeThreshold) / (b.timeThreshold - a.timeThreshold);
            return {
                timeThreshold: gameTime,
                speedMultiplier: lerp(a.speedMultiplier, b.speedMultiplier, t),
                spawnInterval: lerp(a.spawnInterval, b.spawnInterval, t),
                maxActiveCars: Math.round(lerp(a.maxActiveCars, b.maxActiveCars, t)),
                doubleSpawnChance: lerp(a.doubleSpawnChance, b.doubleSpawnChance, t),
                tripleSpawnChance: lerp(a.tripleSpawnChance, b.tripleSpawnChance, t),
            };
        }
    }

    return { ...last };
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}
