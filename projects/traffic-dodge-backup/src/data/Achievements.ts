
import { AchievementDefinition, AchievementConditionType } from "@/interfaces/GameContent";

/**
 * Achievement definitions for Traffic Dodge.
 *
 * Each achievement maps to a condition on LocalData stats.
 * The game checks achievements after each game-over and when loading
 * the menu. Unlocked achievements are stored in localStorage.
 */

export const ACHIEVEMENTS: AchievementDefinition[] = [
    // === Games Played ===
    {
        id: 'first_drive',
        name: 'Первый выезд',
        description: 'Сыграй первую игру',
        conditionType: AchievementConditionType.TOTAL_GAMES,
        threshold: 1,
        icon: '🚗',
    },
    {
        id: 'regular_driver',
        name: 'Постоянный водитель',
        description: 'Сыграй 10 игр',
        conditionType: AchievementConditionType.TOTAL_GAMES,
        threshold: 10,
        icon: '🚙',
    },
    {
        id: 'veteran',
        name: 'Ветеран дорог',
        description: 'Сыграй 50 игр',
        conditionType: AchievementConditionType.TOTAL_GAMES,
        threshold: 50,
        icon: '🏆',
    },
    {
        id: 'addicted',
        name: 'Зависимость',
        description: 'Сыграй 100 игр',
        conditionType: AchievementConditionType.TOTAL_GAMES,
        threshold: 100,
        icon: '🔥',
    },

    // === Best Score ===
    {
        id: 'score_500',
        name: 'Новичок',
        description: 'Набери 500 очков',
        conditionType: AchievementConditionType.BEST_SCORE,
        threshold: 500,
        icon: '⭐',
    },
    {
        id: 'score_1000',
        name: 'Опытный',
        description: 'Набери 1000 очков',
        conditionType: AchievementConditionType.BEST_SCORE,
        threshold: 1000,
        icon: '🌟',
    },
    {
        id: 'score_5000',
        name: 'Мастер',
        description: 'Набери 5000 очков',
        conditionType: AchievementConditionType.BEST_SCORE,
        threshold: 5000,
        icon: '💎',
    },
    {
        id: 'score_10000',
        name: 'Легенда',
        description: 'Набери 10000 очков',
        conditionType: AchievementConditionType.BEST_SCORE,
        threshold: 10000,
        icon: '👑',
    },

    // === Best Distance ===
    {
        id: 'distance_1000',
        name: 'Короткая поездка',
        description: 'Проехать 1000 м',
        conditionType: AchievementConditionType.BEST_DISTANCE,
        threshold: 1000,
        icon: '📏',
    },
    {
        id: 'distance_5000',
        name: 'Длинный путь',
        description: 'Проехать 5000 м',
        conditionType: AchievementConditionType.BEST_DISTANCE,
        threshold: 5000,
        icon: '🛣️',
    },
    {
        id: 'distance_10000',
        name: 'Междугородний',
        description: 'Проехать 10000 м',
        conditionType: AchievementConditionType.BEST_DISTANCE,
        threshold: 10000,
        icon: '🗺️',
    },

    // === Near Misses ===
    {
        id: 'first_near_miss',
        name: 'Рисковый',
        description: 'Соверши первый проезд вплотную',
        conditionType: AchievementConditionType.TOTAL_NEAR_MISSES,
        threshold: 1,
        icon: '⚡',
    },
    {
        id: 'near_miss_50',
        name: 'Спидок',
        description: 'Соверши 50 проездов вплотную',
        conditionType: AchievementConditionType.TOTAL_NEAR_MISSES,
        threshold: 50,
        icon: '💨',
    },
    {
        id: 'near_miss_200',
        name: 'Безумный водитель',
        description: 'Соверши 200 проездов вплотную',
        conditionType: AchievementConditionType.TOTAL_NEAR_MISSES,
        threshold: 200,
        icon: '🤯',
    },
    {
        id: 'single_near_miss_5',
        name: 'Адреналин',
        description: 'Соверши 5 проездов вплотную за одну игру',
        conditionType: AchievementConditionType.SINGLE_NEAR_MISSES,
        threshold: 5,
        icon: '💉',
    },
    {
        id: 'single_near_miss_15',
        name: 'Смертельный риск',
        description: 'Соверши 15 проездов вплотную за одну игру',
        conditionType: AchievementConditionType.SINGLE_NEAR_MISSES,
        threshold: 15,
        icon: '💀',
    },
];

/** Achievement storage key prefix */
export const ACHIEVEMENT_STORAGE_PREFIX = 'TD_achievement_';
