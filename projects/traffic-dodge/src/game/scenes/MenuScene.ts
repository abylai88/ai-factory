import { Config } from "@/data/Config";
import { GameData } from "@/data/GameData";
import { Strings } from "@/data/Strings";
import { SceneName } from "./Scenes";
import { SndMng } from "@/sound/SndMng";
import { Params } from "@/data/Params";
import { LocalData } from "@/data/LocalData";
import { FrontEvents } from "../events/FrontEvents";

export default class MenuScene extends Phaser.Scene {

    private _title: Phaser.GameObjects.Text;
    private _subtitle: Phaser.GameObjects.Text;
    private _bestScoreText: Phaser.GameObjects.Text;
    private _playBtnContainer: Phaser.GameObjects.Container;
    private _roadGraphics: Phaser.GameObjects.Graphics;
    private _dummy: Phaser.GameObjects.Container;
    private _titleWidth = 0;

    // Animated cars on menu
    private _menuCars: { x: number; speed: number; color: number; lane: number }[] = [];

    constructor() {
        super(SceneName.Menu);
    }

    create() {
        SndMng.scene = this;

        this.cameras.main.centerOn(Config.GW_HALF, Config.GH_HALF);
        this.cameras.main.setBackgroundColor(Config.COLORS.GRASS);

        this._dummy = this.add.container(Config.GW_HALF, Config.GH_HALF);

        // Draw road background
        this._roadGraphics = this.add.graphics();
        this.drawRoad();
        this._dummy.add(this._roadGraphics);

        // Init menu cars
        this.initMenuCars();

        // Title
        this._title = new Phaser.GameObjects.Text(this, 0, -Config.GH_HALF + 120,
            Strings.menuTitle,
            { font: "110px Ubuntu", align: 'center', fontStyle: 'bold' })
            .setOrigin(0.5)
            .setColor('#ffffff');
        this._title.setStroke('#000000', 12);
        this._titleWidth = this._title.width;
        this._dummy.add(this._title);

        // Subtitle
        this._subtitle = new Phaser.GameObjects.Text(this, 0, this._title.y + 100,
            Strings.menuSubtitle,
            { font: "50px Ubuntu", align: 'center' })
            .setOrigin(0.5)
            .setColor('#cccccc');
        this._subtitle.setStroke('#000000', 6);
        this._dummy.add(this._subtitle);

        // Best score
        let bestScore = LocalData.getInstance().bestScore;
        this._bestScoreText = new Phaser.GameObjects.Text(this, 0, -30,
            bestScore > 0 ? `${Strings.menuBestScore}${bestScore}` : '',
            { font: "44px Ubuntu", align: 'center' })
            .setOrigin(0.5)
            .setColor(Config.COLORS.GOLD);
        this._bestScoreText.setStroke('#000000', 4);
        this._dummy.add(this._bestScoreText);

        // Play button
        this.createPlayButton();

        // Controls hint
        let hintY = Config.GH_HALF - 80;
        let hintText = new Phaser.GameObjects.Text(this, 0, hintY,
            Strings.menuControlsHint,
            { font: "36px Ubuntu", align: 'center' })
            .setOrigin(0.5)
            .setColor('#aaaaaa');
        hintText.setStroke('#000000', 3);
        this._dummy.add(hintText);

        // Touch hint
        let touchHint = new Phaser.GameObjects.Text(this, 0, hintY + 45,
            Strings.menuTouchHint,
            { font: "30px Ubuntu", align: 'center' })
            .setOrigin(0.5)
            .setColor('#888888');
        touchHint.setStroke('#000000', 2);
        this._dummy.add(touchHint);

        // Title scale
        this.onResize();

        FrontEvents.getInstance().addListener(FrontEvents.EVENT_WINDOW_RESIZE, this.onResize, this);

        // Cleanup listeners on scene shutdown
        this.events.on('shutdown', () => {
            FrontEvents.getInstance().removeListener(FrontEvents.EVENT_WINDOW_RESIZE, this.onResize, this);
        });
    }

    private drawRoad() {
        this._roadGraphics.clear();

        // Grass background (already set via camera bg)
        // Draw grass stripes for parallax feel
        this._roadGraphics.fillStyle(Config.COLORS.GRASS_DARK, 0.3);
        for (let y = -Config.GH_HALF; y < Config.GH_HALF; y += 80) {
            this._roadGraphics.fillRect(-Config.GW_HALF, y, Config.GW, 40);
        }

        // Road surface
        this._roadGraphics.fillStyle(Config.COLORS.ROAD);
        this._roadGraphics.fillRect(Config.ROAD_LEFT - Config.GW_HALF, -Config.GH_HALF, Config.ROAD_WIDTH, Config.GH);

        // Road edges
        this._roadGraphics.fillStyle(Config.COLORS.ROAD_EDGE);
        this._roadGraphics.fillRect(Config.ROAD_LEFT - Config.GW_HALF - 8, -Config.GH_HALF, 8, Config.GH);
        this._roadGraphics.fillRect(Config.ROAD_RIGHT - Config.GW_HALF, -Config.GH_HALF, 8, Config.GH);

        // Lane markings (dashed)
        this._roadGraphics.fillStyle(Config.COLORS.LANE_MARKING, 0.6);
        let laneW = Config.LANE_WIDTH;
        for (let lane = 1; lane < Config.LANE_COUNT; lane++) {
            let x = Config.ROAD_LEFT - Config.GW_HALF + lane * laneW;
            for (let y = -Config.GH_HALF; y < Config.GH_HALF; y += 60) {
                this._roadGraphics.fillRect(x - 2, y, 4, 30);
            }
        }
    }

    private initMenuCars() {
        this._menuCars = [];
        let lanes = Config.LANE_COUNT;
        for (let i = 0; i < 6; i++) {
            this._menuCars.push({
                x: 0,
                speed: 150 + Math.random() * 200,
                color: Config.TRAFFIC_COLORS[Math.floor(Math.random() * Config.TRAFFIC_COLORS.length)],
                lane: Math.floor(Math.random() * lanes),
            });
            this._menuCars[i].x = -Config.GH_HALF + Math.random() * Config.GH;
        }
    }

    private createPlayButton() {
        this._playBtnContainer = this.add.container(0, 120);
        this._dummy.add(this._playBtnContainer);

        // Button background
        let bg = this.add.graphics();
        bg.fillStyle(0x4caf50);
        bg.fillRoundedRect(-150, -50, 300, 100, 20);
        this._playBtnContainer.add(bg);

        // Button text
        let btnText = new Phaser.GameObjects.Text(this, 0, 0,
            Strings.menuPlayButton,
            { font: "56px Ubuntu", align: 'center', fontStyle: 'bold' })
            .setOrigin(0.5)
            .setColor('#ffffff');
        btnText.setStroke('#000000', 4);
        this._playBtnContainer.add(btnText);

        // Interactive zone
        let hitZone = this.add.zone(0, 0, 300, 100);
        hitZone.setInteractive({ useHandCursor: true });
        hitZone.on('pointerover', () => {
            this._playBtnContainer.setScale(1.05);
        });
        hitZone.on('pointerout', () => {
            this._playBtnContainer.setScale(1.0);
        });
        hitZone.on('pointerdown', () => {
            SndMng.sfxPlay('Click', 0.5);
            Params.reset();
            this.scene.start(SceneName.Game);
        });
        this._playBtnContainer.add(hitZone);

        // Pulse animation
        this.tweens.add({
            targets: this._playBtnContainer,
            scaleX: 1.05,
            scaleY: 1.05,
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
        });
    }

    private onResize() {
        let titleScale = Math.min(1, (Params.gameWidth - 100) / this._titleWidth);
        this._title.scale = titleScale;
    }

    update(time: number, dtMs: number) {
        let dt = dtMs * 0.001;

        // Animate menu cars
        this._roadGraphics.clear();
        this.drawRoad();

        // Move and draw menu cars
        for (let car of this._menuCars) {
            car.x += car.speed * dt;
            if (car.x > Config.GH_HALF + 200) {
                car.x = -Config.GH_HALF - 200;
                car.lane = Math.floor(Math.random() * Config.LANE_COUNT);
                car.speed = 150 + Math.random() * 200;
                car.color = Config.TRAFFIC_COLORS[Math.floor(Math.random() * Config.TRAFFIC_COLORS.length)];
            }

            let carX = GameData.getInstance().getLaneX(car.lane) - Config.GW_HALF;
            // Draw car (rotated 180 since it's coming toward us)
            let carW = Config.CAR_WIDTH;
            let carH = Config.CAR_HEIGHT;

            this._roadGraphics.fillStyle(car.color);
            this._roadGraphics.fillRoundedRect(
                carX - carW / 2, car.x - carH / 2,
                carW, carH, 8
            );
            // Windshield
            this._roadGraphics.fillStyle(0x87ceeb, 0.6);
            this._roadGraphics.fillRect(
                carX - carW / 2 + 10, car.x - carH / 2 + 10,
                carW - 20, 25
            );
            // Taillights
            this._roadGraphics.fillStyle(0xff0000);
            this._roadGraphics.fillRect(carX - carW / 2 + 5, car.x + carH / 2 - 10, 12, 8);
            this._roadGraphics.fillRect(carX + carW / 2 - 17, car.x + carH / 2 - 10, 12, 8);
        }
    }
}
