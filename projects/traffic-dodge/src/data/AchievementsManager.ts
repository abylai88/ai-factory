
import { ACHIEVEMENTS, ACHIEVEMENT_STORAGE_PREFIX } from "@/data/Achievements";
import { AchievementDefinition, AchievementConditionType } from "@/interfaces/GameContent";
import { LocalData } from "@/data/LocalData";

export interface AchievementUnlock {
    id: string;
    unlockedAt: number; // timestamp
}

/**
 * Manages achievement tracking, unlock detection, and persistence.
 *
 * After each game-over, call `checkAfterGame()` with the session stats.
 * On menu load, call `getUnlocked()` to display badges.
 */
export class AchievementsManager {

    private static _instance: AchievementsManager;
    private _unlockedIds: Set<string> = new Set();

    private constructor() {
        this._loadFromStorage();
    }

    static getInstance(): AchievementsManager {
        if (!AchievementsManager._instance) {
            AchievementsManager._instance = new AchievementsManager();
        }
        return AchievementsManager._instance;
    }

    /**
     * Returns all currently unlocked achievement IDs.
     */
    getUnlocked(): string[] {
        return Array.from(this._unlockedIds);
    }

    /**
     * Check whether a specific achievement is unlocked.
     */
    isUnlocked(achievementId: string): boolean {
        return this._unlockedIds.has(achievementId);
    }

    /**
     * Get all achievement definitions.
     */
    getAllAchievements(): AchievementDefinition[] {
        return ACHIEVEMENTS;
    }

    /**
     * Get count of unlocked achievements.
     */
    get unlockedCount(): number {
        return this._unlockedIds.size;
    }

    /**
     * Get total number of possible achievements.
     */
    get totalCount(): number {
        return ACHIEVEMENTS.length;
    }

    /**
     * Check achievements after a game session.
     * Returns newly unlocked achievement definitions (empty if none).
     */
    checkAfterGame(
        score: number,
        distance: number,
        nearMisses: number
    ): AchievementDefinition[] {
        let localData = LocalData.getInstance();
        let newlyUnlocked: AchievementDefinition[] = [];

        for (let achievement of ACHIEVEMENTS) {
            if (this._unlockedIds.has(achievement.id)) continue;

            let value = this._getConditionValue(achievement, localData, score, distance, nearMisses);
            if (value >= achievement.threshold) {
                this._unlockedIds.add(achievement.id);
                this._saveToStorage(achievement.id);
                newlyUnlocked.push(achievement);
            }
        }

        return newlyUnlocked;
    }

    /**
     * Reset all unlocked achievements (for testing).
     */
    reset(): void {
        this._unlockedIds.clear();
        for (let achievement of ACHIEVEMENTS) {
            localStorage.removeItem(ACHIEVEMENT_STORAGE_PREFIX + achievement.id);
        }
    }

    private _getConditionValue(
        achievement: AchievementDefinition,
        localData: LocalData,
        score: number,
        distance: number,
        nearMisses: number
    ): number {
        switch (achievement.conditionType) {
            case AchievementConditionType.TOTAL_GAMES:
                return localData.totalGames;
            case AchievementConditionType.BEST_SCORE:
                return localData.bestScore;
            case AchievementConditionType.BEST_DISTANCE:
                return localData.bestDistance;
            case AchievementConditionType.TOTAL_NEAR_MISSES:
                return localData.totalNearMisses;
            case AchievementConditionType.SINGLE_NEAR_MISSES:
                return nearMisses;
            case AchievementConditionType.SINGLE_DISTANCE:
                return distance;
            default:
                return 0;
        }
    }

    private _loadFromStorage(): void {
        for (let achievement of ACHIEVEMENTS) {
            let val = localStorage.getItem(ACHIEVEMENT_STORAGE_PREFIX + achievement.id);
            if (val === '1') {
                this._unlockedIds.add(achievement.id);
            }
        }
    }

    private _saveToStorage(achievementId: string): void {
        localStorage.setItem(ACHIEVEMENT_STORAGE_PREFIX + achievementId, '1');
    }
}
