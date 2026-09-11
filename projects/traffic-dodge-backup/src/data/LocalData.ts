
enum Fields {
    bestScore = 'TD_bestScore',
    bestDistance = 'TD_bestDistance',
    totalGames = 'TD_totalGames',
    totalNearMisses = 'TD_totalNearMisses',
}

export class LocalData {

    private static instance: LocalData = null;

    private _bestScore = 0;
    private _bestDistance = 0;
    private _totalGames = 0;
    private _totalNearMisses = 0;

    private constructor() {
        this._bestScore = this.readInt(Fields.bestScore);
        this._bestDistance = this.readInt(Fields.bestDistance);
        this._totalGames = this.readInt(Fields.totalGames);
        this._totalNearMisses = this.readInt(Fields.totalNearMisses);
    }

    private readInt(field: string): number {
        let val = localStorage.getItem(field) || '0';
        return Number(val);
    }

    static getInstance(): LocalData {
        if (!LocalData.instance) LocalData.instance = new LocalData();
        return LocalData.instance;
    }

    public get bestScore(): number {
        return this._bestScore;
    }

    public set bestScore(v: number) {
        this._bestScore = v;
        localStorage.setItem(Fields.bestScore, String(v));
    }

    public get bestDistance(): number {
        return this._bestDistance;
    }

    public set bestDistance(v: number) {
        this._bestDistance = v;
        localStorage.setItem(Fields.bestDistance, String(v));
    }

    public get totalGames(): number {
        return this._totalGames;
    }

    public set totalGames(v: number) {
        this._totalGames = v;
        localStorage.setItem(Fields.totalGames, String(v));
    }

    public get totalNearMisses(): number {
        return this._totalNearMisses;
    }

    public set totalNearMisses(v: number) {
        this._totalNearMisses = v;
        localStorage.setItem(Fields.totalNearMisses, String(v));
    }

    public addGameStats(score: number, distance: number, nearMisses: number) {
        this.totalGames = this._totalGames + 1;
        this.totalNearMisses = this._totalNearMisses + nearMisses;
        if (score > this._bestScore) {
            this.bestScore = score;
        }
        if (distance > this._bestDistance) {
            this.bestDistance = distance;
        }
    }

}
