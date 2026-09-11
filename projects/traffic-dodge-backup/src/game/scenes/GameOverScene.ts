import { Config } from "@/data/Config";
import { Params } from "@/data/Params";
import { Strings } from "@/data/Strings";
import { SceneName } from "./Scenes";
import { SndMng } from "@/sound/SndMng";
import { YaGamesApi } from "@/api/YaGamesApi";
import { FrontEvents } from "../events/FrontEvents";
import { LocalData } from "@/data/LocalData";

export default class GameOverScene extends Phaser.Scene {

    private _dummy: Phaser.GameObjects.Container;
    private _title: Phaser.GameObjects.Text;
    private _scoreText: Phaser.GameObjects.Text;
    private _distanceText: Phaser.GameObjects.Text;
    private _nearMissText: Phaser.GameObjects.Text;
    private _bestScoreText: Phaser.GameObjects.Text;
    private _isNewBest: boolean = false;

    constructor() {
        super(SceneName.GameOver);
    }

    create() {
        SndMng.scene = this;
        this.cameras.main.centerOn(Config.GW_HALF, Config.GH_HALF);
        this.cameras.main.setBackgroundColor(0x1a1a2e);

        this._dummy = this.add.container(Config.GW_HALF, Config.GH_HALF);

        // Game Over title
        this._title = new Phaser.GameObjects.Text(this, 0, -Config.GH_HALF + 140,
            Strings.gameOverTitle,
            { font: "90px Ubuntu", align: 'center', fontStyle: 'bold' })
            .setOrigin(0.5)
            .setColor('#ff4444');
        this._title.setStroke('#000000', 8);
        this._dummy.add(this._title);

        // Score
        let score = Params.score;
        let bestScore = LocalData.getInstance().bestScore;
        this._isNewBest = score >= bestScore && score > 0;

        this._scoreText = new Phaser.GameObjects.Text(this, 0, -60,
            `${Strings.gameOverScorePrefix}${score}`,
            { font: "64px Ubuntu", align: 'center', fontStyle: 'bold' })
            .setOrigin(0.5)
            .setColor('#ffffff');
        this._scoreText.setStroke('#000000', 6);
        this._dummy.add(this._scoreText);

        // New best indicator
        if (this._isNewBest && score > 0) {
            let newBestText = new Phaser.GameObjects.Text(this, 0, 0,
                Strings.gameOverNewRecord,
                { font: "44px Ubuntu", align: 'center', fontStyle: 'bold' })
                .setOrigin(0.5)
                .setColor(Config.COLORS.GOLD);
            newBestText.setStroke('#000000', 4);
            this._dummy.add(newBestText);

            this.tweens.add({
                targets: newBestText,
                scaleX: 1.1,
                scaleY: 1.1,
                duration: 500,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.InOut'
            });
        }

        // Distance
        this._distanceText = new Phaser.GameObjects.Text(this, 0, 60,
            `${Strings.gameOverDistance}${Params.distance} м`,
            { font: "44px Ubuntu", align: 'center' })
            .setOrigin(0.5)
            .setColor('#aaaaaa');
        this._distanceText.setStroke('#000000', 4);
        this._dummy.add(this._distanceText);

        // Near misses
        this._nearMissText = new Phaser.GameObjects.Text(this, 0, 120,
            `${Strings.gameOverNearMisses}${Params.nearMisses}`,
            { font: "40px Ubuntu", align: 'center' })
            .setOrigin(0.5)
            .setColor(Config.COLORS.GOLD);
        this._nearMissText.setStroke('#000000', 3);
        this._dummy.add(this._nearMissText);

        // Best score
        this._bestScoreText = new Phaser.GameObjects.Text(this, 0, 180,
            `${Strings.gameOverBestPrefix}${bestScore}`,
            { font: "36px Ubuntu", align: 'center' })
            .setOrigin(0.5)
            .setColor('#888888');
        this._bestScoreText.setStroke('#000000', 3);
        this._dummy.add(this._bestScoreText);

        // Retry button (added to centered dummy container)
        this._dummy.add(this.createRetryButton());

        // Menu button (added to centered dummy container)
        this._dummy.add(this.createMenuButton());

        // Ad after game over
        YaGamesApi.getInstance().gameReady();

        FrontEvents.getInstance().addListener(FrontEvents.EVENT_WINDOW_RESIZE, this.onResize, this);

        // Cleanup listeners on scene shutdown
        this.events.on('shutdown', () => {
            FrontEvents.getInstance().removeListener(FrontEvents.EVENT_WINDOW_RESIZE, this.onResize, this);
        });

        // Fade in
        this.cameras.main.fadeIn(300, 0, 0, 0);
    }

    private createRetryButton(): Phaser.GameObjects.Container {
        let container = this.add.container(0, 300);

        let bg = this.add.graphics();
        bg.fillStyle(0x4caf50);
        bg.fillRoundedRect(-160, -40, 320, 80, 16);
        container.add(bg);

        let text = new Phaser.GameObjects.Text(this, 0, 0,
            Strings.gameOverRetryButton,
            { font: "48px Ubuntu", align: 'center', fontStyle: 'bold' })
            .setOrigin(0.5)
            .setColor('#ffffff');
        text.setStroke('#000000', 4);
        container.add(text);

        let hitZone = this.add.zone(0, 0, 320, 80);
        hitZone.setInteractive({ useHandCursor: true });
        hitZone.on('pointerover', () => container.setScale(1.05));
        hitZone.on('pointerout', () => container.setScale(1.0));
        hitZone.on('pointerdown', () => {
            SndMng.sfxPlay('Click', 0.5);
            Params.reset();
            this.scene.start(SceneName.Game);
        });
        container.add(hitZone);

        this.tweens.add({
            targets: container,
            scaleX: 1.03,
            scaleY: 1.03,
            duration: 600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
        });

        return container;
    }

    private createMenuButton(): Phaser.GameObjects.Container {
        let container = this.add.container(0, 400);

        let bg = this.add.graphics();
        bg.fillStyle(0x555555);
        bg.fillRoundedRect(-160, -35, 320, 70, 14);
        container.add(bg);

        let text = new Phaser.GameObjects.Text(this, 0, 0,
            Strings.gameOverMenuButton,
            { font: "42px Ubuntu", align: 'center' })
            .setOrigin(0.5)
            .setColor('#cccccc');
        text.setStroke('#000000', 3);
        container.add(text);

        let hitZone = this.add.zone(0, 0, 320, 70);
        hitZone.setInteractive({ useHandCursor: true });
        hitZone.on('pointerover', () => container.setScale(1.05));
        hitZone.on('pointerout', () => container.setScale(1.0));
        hitZone.on('pointerdown', () => {
            SndMng.sfxPlay('Click', 0.5);
            this.scene.start(SceneName.Menu);
        });
        container.add(hitZone);

        return container;
    }

    private onResize() {
        // Handle resize if needed
    }

    update(time: number, dtMs: number) {
        // No continuous updates needed
    }
}
