
export class Params {

    static isDebugMode = false;
    static gameWidth = 0;

    static interstitialTime = 180; // in sec

    // Gameplay runtime state
    static currentSpeed = 0;
    static score = 0;
    static distance = 0;
    static nearMisses = 0;
    static isGameOver = false;
    static gameTime = 0; // seconds since game start

    static reset() {
        Params.currentSpeed = 0;
        Params.score = 0;
        Params.distance = 0;
        Params.nearMisses = 0;
        Params.isGameOver = false;
        Params.gameTime = 0;
    }

};
