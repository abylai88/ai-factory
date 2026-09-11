
import { Config } from "./Config";

export class GameData extends Phaser.Events.EventEmitter {

    private static instance: GameData = null;

    private constructor() {
        super();
    }

    static getInstance(): GameData {
        if (!GameData.instance) {
            GameData.instance = new GameData();
        }
        return GameData.instance;
    }

    /**
     * Get the x position for a given lane index (0-based)
     */
    getLaneX(laneIndex: number): number {
        let roadCenter = Config.GW_HALF;
        let totalWidth = Config.ROAD_WIDTH;
        let laneWidth = Config.LANE_WIDTH;
        let startX = roadCenter - totalWidth / 2 + laneWidth / 2;
        return startX + laneIndex * laneWidth;
    }

    /**
     * Get a random traffic car color
     */
    getRandomTrafficColor(): number {
        let colors = Config.TRAFFIC_COLORS;
        return colors[Phaser.Math.Between(0, colors.length - 1)];
    }

    /**
     * Calculate current game speed based on elapsed time
     */
    getSpeed(gameTime: number): number {
        let speed = Config.BASE_SPEED + gameTime * Config.SPEED_INCREMENT;
        return Math.min(speed, Config.MAX_SPEED);
    }

    /**
     * Calculate spawn interval based on elapsed time
     */
    getSpawnInterval(gameTime: number): number {
        let interval = Config.MAX_SPAWN_INTERVAL - gameTime * Config.SPAWN_INTERVAL_DECREASE;
        return Math.max(interval, Config.MIN_SPAWN_INTERVAL);
    }

    /**
     * Calculate final score from distance and near misses
     */
    calculateScore(distance: number, nearMisses: number): number {
        let distScore = Math.floor(distance / 10);
        let missScore = nearMisses * Config.NEAR_MISS_BONUS;
        return distScore + missScore;
    }

}
