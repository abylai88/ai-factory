
import { TrafficColorEntry, TrafficBehaviorProfile } from "@/interfaces/GameContent";

/**
 * Traffic car color palette with weighted distribution.
 * Common colors appear more often; rare colors feel special.
 */
export const TRAFFIC_COLORS: TrafficColorEntry[] = [
    { color: 0xf44336, weight: 1.0, name: 'Red' },
    { color: 0xff9800, weight: 1.0, name: 'Orange' },
    { color: 0xffeb3b, weight: 0.8, name: 'Yellow' },
    { color: 0x4caf50, weight: 1.0, name: 'Green' },
    { color: 0x9c27b0, weight: 0.7, name: 'Purple' },
    { color: 0xe91e63, weight: 0.6, name: 'Pink' },
    { color: 0x00bcd4, weight: 0.5, name: 'Cyan' },
    { color: 0xff5722, weight: 0.6, name: 'Deep Orange' },
    { color: 0x795548, weight: 0.8, name: 'Brown' },
    { color: 0x607d8b, weight: 0.7, name: 'Blue Grey' },
    { color: 0x2196f3, weight: 0.4, name: 'Blue' },
    { color: 0x00e676, weight: 0.3, name: 'Light Green' },
    { color: 0xffd740, weight: 0.3, name: 'Amber' },
    { color: 0xff6e40, weight: 0.3, name: 'Deep Orange Alt' },
];

/**
 * Weighted random selection from traffic colors.
 */
export function getRandomTrafficColor(): number {
    let totalWeight = TRAFFIC_COLORS.reduce((sum, c) => sum + c.weight, 0);
    let roll = Math.random() * totalWeight;
    let cumulative = 0;
    for (let entry of TRAFFIC_COLORS) {
        cumulative += entry.weight;
        if (roll <= cumulative) {
            return entry.color;
        }
    }
    return TRAFFIC_COLORS[0].color;
}

/**
 * Traffic behavior profiles.
 * Each profile defines a speed range and spawn weight.
 * The game selects a profile when spawning a car.
 */
export const TRAFFIC_PROFILES: TrafficBehaviorProfile[] = [
    {
        id: 'slow',
        speedRange: [0.4, 0.7],
        weight: 1.5,
        nearMissEligible: true,
    },
    {
        id: 'normal',
        speedRange: [0.7, 1.1],
        weight: 2.0,
        nearMissEligible: true,
    },
    {
        id: 'fast',
        speedRange: [1.1, 1.5],
        weight: 1.0,
        nearMissEligible: true,
    },
    {
        id: 'very_fast',
        speedRange: [1.5, 2.0],
        weight: 0.5,
        nearMissEligible: true,
    },
];

/**
 * Select a random traffic behavior profile using weighted distribution.
 */
export function getRandomTrafficProfile(): TrafficBehaviorProfile {
    let totalWeight = TRAFFIC_PROFILES.reduce((sum, p) => sum + p.weight, 0);
    let roll = Math.random() * totalWeight;
    let cumulative = 0;
    for (let profile of TRAFFIC_PROFILES) {
        cumulative += profile.weight;
        if (roll <= cumulative) {
            return profile;
        }
    }
    return TRAFFIC_PROFILES[0];
}

/**
 * Get a random speed multiplier from a traffic behavior profile.
 */
export function getRandomSpeedMultiplier(profile: TrafficBehaviorProfile): number {
    let [min, max] = profile.speedRange;
    return min + Math.random() * (max - min);
}
