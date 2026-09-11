
import { GameStrings } from "@/interfaces/GameContent";

/**
 * Centralized UI strings for the game.
 * All text displayed to the player is defined here for easy localization
 * and modification. Currently Russian (Yandex Games target audience).
 *
 * To add a new language: create a new object conforming to GameStrings
 * and select it at boot time based on locale.
 */

export const STRINGS_RU: GameStrings = {

    // Preloader
    preloaderTitle: 'Traffic',
    preloaderSubtitle: 'Dodge',
    preloaderMessage: 'Нажмите в любом месте, чтобы начать',
    preloaderError: 'Ошибка инициализации Яндекс SDK\nПожалуйста, попробуйте обновить страницу...',

    // Menu
    menuTitle: 'TRAFFIC DODGE',
    menuSubtitle: 'Избегай трафика!',
    menuBestScore: 'Лучший счёт: ',
    menuPlayButton: 'ИГРАТЬ',
    menuControlsHint: '← → или A/D — управление',
    menuTouchHint: 'Смахни влево/вправо на телефоне',

    // Gameplay HUD
    hudScorePrefix: 'СЧЁТ: ',
    hudDistanceUnit: ' м',
    hudNearMissIcon: '⚡ ',
    hudPauseTitle: 'ПАУЗА',
    hudPauseResumeHint: 'Нажми ESC или тапни чтобы продолжить',

    // Near-miss popup
    nearMissPopupPrefix: '+',

    // Game Over
    gameOverTitle: 'ИГРА ОКОНЧЕНА',
    gameOverScorePrefix: 'СЧЁТ: ',
    gameOverNewRecord: '🏆 НОВЫЙ РЕКОРД!',
    gameOverDistance: 'Дистанция: ',
    gameOverNearMisses: '⚡ Проезды вплотную: ',
    gameOverBestPrefix: 'Лучший: ',
    gameOverRetryButton: 'ЗАНОВО',
    gameOverMenuButton: 'МЕНЮ',
};

/** Default strings instance — swap for i18n at runtime */
export const Strings: GameStrings = STRINGS_RU;
