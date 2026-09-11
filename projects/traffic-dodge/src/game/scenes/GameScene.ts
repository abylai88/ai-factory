import { Config } from "@/data/Config";
import { Params } from "@/data/Params";
import { GameData } from "@/data/GameData";
import { Strings } from "@/data/Strings";
import { SceneName } from "./Scenes";
import { SndMng } from "@/sound/SndMng";
import { YaGamesApi } from "@/api/YaGamesApi";
import { FrontEvents } from "../events/FrontEvents";
import { AdMng } from "../mng/AdMng";
import { LocalData } from "@/data/LocalData";
import { MyMath } from "@/utils/MyMath";

// Traffic car object for pooling
interface TrafficCar {
    sprite: Phaser.GameObjects.Graphics;
    lane: number;
    speed: number;
    color: number;
    active: boolean;
    hitbox: Phaser.Geom.Rectangle;
    nearMissCounted: boolean;
}

export default class GameScene extends Phaser.Scene {

    // Graphics layers
    private _roadGraphics: Phaser.GameObjects.Graphics;
    private _playerGraphics: Phaser.GameObjects.Graphics;
    private _hudGraphics: Phaser.GameObjects.Graphics;

    // Player state
    private _playerLane = 2; // middle lane (0-indexed)
    private _playerTargetX = 0;
    private _playerCurrentX = 0;
    private _playerY = 0;

    // Traffic car pool
    private _trafficCars: TrafficCar[] = [];
    private _trafficPool: Phaser.GameObjects.Graphics[] = [];

    // Spawning
    private _spawnTimer = 0;
    private _gameTime = 0;

    // Input
    private _keyA: Phaser.Input.Keyboard.Key;
    private _keyD: Phaser.Input.Keyboard.Key;
    private _keyLeft: Phaser.Input.Keyboard.Key;
    private _keyRight: Phaser.Input.Keyboard.Key;
    private _touchStartX = 0;
    private _isSwiping = false;

    // Game state
    private _isPlaying = false;
    private _isPaused = false;
    private _score = 0;
    private _distance = 0;
    private _nearMisses = 0;
    private _nearMissTexts: { text: Phaser.GameObjects.Text; timer: number }[] = [];

    // Road scrolling
    private _roadOffset = 0;

    // HUD elements
    private _scoreText: Phaser.GameObjects.Text;
    private _distanceText: Phaser.GameObjects.Text;
    private _nearMissCountText: Phaser.GameObjects.Text;
    private _pauseOverlay: Phaser.GameObjects.Container;

    // Difficulty
    private _currentSpeed = 0;

    constructor() {
        super(SceneName.Game);
    }

    create() {
        Params.reset();
        this._isPlaying = true;
        this._isPaused = false;
        this._gameTime = 0;
        this._score = 0;
        this._distance = 0;
        this._nearMisses = 0;
        this._currentSpeed = Config.BASE_SPEED;

        SndMng.scene = this;
        this.cameras.main.centerOn(Config.GW_HALF, Config.GH_HALF);
        this.cameras.main.setBackgroundColor(Config.COLORS.GRASS);

        // Setup layers
        this._roadGraphics = this.add.graphics();
        this._hudGraphics = this.add.graphics();
        this._playerGraphics = this.add.graphics();

        // Player position
        this._playerY = Config.GH - Config.PLAYER_START_Y;
        this._playerLane = 2;
        this._playerTargetX = GameData.getInstance().getLaneX(this._playerLane);
        this._playerCurrentX = this._playerTargetX;

        // Setup input
        this.setupInput();

        // Create HUD
        this.createHUD();

        // Create pause overlay (hidden)
        this.createPauseOverlay();

        // Initial pool
        this.initTrafficPool();

        YaGamesApi.getInstance().gameReady();

        FrontEvents.getInstance().addListener(FrontEvents.EVENT_WINDOW_RESIZE, this.onResize, this);

        // Cleanup listeners on scene shutdown
        this.events.on('shutdown', () => {
            FrontEvents.getInstance().removeListener(FrontEvents.EVENT_WINDOW_RESIZE, this.onResize, this);
            // Destroy all near-miss text objects
            for (let nt of this._nearMissTexts) {
                nt.text.destroy();
            }
            this._nearMissTexts = [];
            // Destroy traffic car pool
            for (let car of this._trafficPool) {
                car.destroy();
            }
            this._trafficPool = [];
            // Destroy active traffic cars
            for (let car of this._trafficCars) {
                car.sprite.destroy();
            }
            this._trafficCars = [];
        });
    }

    private setupInput() {
        if (this.input.keyboard) {
            this._keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
            this._keyA.on('down', () => this.moveLeft());

            this._keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
            this._keyD.on('down', () => this.moveRight());

            this._keyLeft = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
            this._keyLeft.on('down', () => this.moveLeft());

            this._keyRight = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
            this._keyRight.on('down', () => this.moveRight());

            // Pause with Escape
            let keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
            keyEsc.on('down', () => this.togglePause());
        }

        // Touch/swipe input
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (this._isPaused) return;
            this._touchStartX = pointer.x;
            this._isSwiping = true;
        });

        this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            if (!this._isSwiping) return;
            this._isSwiping = false;

            let dx = pointer.x - this._touchStartX;
            if (Math.abs(dx) > 40) {
                if (dx < 0) {
                    this.moveLeft();
                } else {
                    this.moveRight();
                }
            }
        });
    }

    private moveLeft() {
        if (!this._isPlaying || this._isPaused) return;
        if (this._playerLane > 0) {
            this._playerLane--;
            this._playerTargetX = GameData.getInstance().getLaneX(this._playerLane);
        }
    }

    private moveRight() {
        if (!this._isPlaying || this._isPaused) return;
        if (this._playerLane < Config.LANE_COUNT - 1) {
            this._playerLane++;
            this._playerTargetX = GameData.getInstance().getLaneX(this._playerLane);
        }
    }

    private togglePause() {
        if (!this._isPlaying) return;
        this._isPaused = !this._isPaused;
        this._pauseOverlay.visible = this._isPaused;
    }

    private createHUD() {
        let hudY = -Config.GH_HALF + 30;
        let padding = 40;

        // Score
        this._scoreText = new Phaser.GameObjects.Text(this, -Config.GW_HALF + padding, hudY,
            Strings.hudScorePrefix + '0',
            { font: "40px Ubuntu", align: 'left', fontStyle: 'bold' })
            .setOrigin(0, 0.5)
            .setColor('#ffffff');
        this._scoreText.setStroke('#000000', 4);

        // Distance
        this._distanceText = new Phaser.GameObjects.Text(this, 0, hudY,
            '0' + Strings.hudDistanceUnit,
            { font: "40px Ubuntu", align: 'center', fontStyle: 'bold' })
            .setOrigin(0.5, 0.5)
            .setColor('#ffffff');
        this._distanceText.setStroke('#000000', 4);

        // Near misses
        this._nearMissCountText = new Phaser.GameObjects.Text(this, Config.GW_HALF - padding, hudY,
            Strings.hudNearMissIcon + '0',
            { font: "40px Ubuntu", align: 'right', fontStyle: 'bold' })
            .setOrigin(1, 0.5)
            .setColor(Config.COLORS.GOLD);
        this._nearMissCountText.setStroke('#000000', 4);
    }

    private createPauseOverlay() {
        this._pauseOverlay = this.add.container(0, 0);

        let bg = this.add.graphics();
        bg.fillStyle(0x000000, 0.6);
        bg.fillRect(-Config.GW_HALF, -Config.GH_HALF, Config.GW, Config.GH);
        this._pauseOverlay.add(bg);

        let pauseText = new Phaser.GameObjects.Text(this, 0, -50,
            Strings.hudPauseTitle,
            { font: "90px Ubuntu", align: 'center', fontStyle: 'bold' })
            .setOrigin(0.5)
            .setColor('#ffffff');
        pauseText.setStroke('#000000', 8);
        this._pauseOverlay.add(pauseText);

        let resumeHint = new Phaser.GameObjects.Text(this, 0, 50,
            Strings.hudPauseResumeHint,
            { font: "36px Ubuntu", align: 'center' })
            .setOrigin(0.5)
            .setColor('#aaaaaa');
        resumeHint.setStroke('#000000', 3);
        this._pauseOverlay.add(resumeHint);

        // Tap to resume
        let hitZone = this.add.zone(0, 0, Config.GW, Config.GH);
        hitZone.setInteractive();
        hitZone.on('pointerdown', () => {
            if (this._isPaused) {
                this._isPaused = false;
                this._pauseOverlay.visible = false;
            }
        });
        this._pauseOverlay.add(hitZone);

        this._pauseOverlay.visible = false;
    }

    private initTrafficPool() {
        for (let i = 0; i < 15; i++) {
            let car = this.add.graphics();
            car.visible = false;
            this._trafficPool.push(car);
        }
    }

    private spawnTrafficCar() {
        let lane = Phaser.Math.Between(0, Config.LANE_COUNT - 1);

        // Don't spawn on the same lane as the player if there's already a car close to player Y
        let tooClose = this._trafficCars.some(c =>
            c.active && c.lane === lane && Math.abs(this.getCarY(c) - this._playerY) < Config.CAR_HEIGHT * 2
        );
        if (tooClose) return;

        let poolGraphics = this._trafficPool.pop();
        if (!poolGraphics) {
            poolGraphics = this.add.graphics();
        }

        let color = GameData.getInstance().getRandomTrafficColor();
        let carX = GameData.getInstance().getLaneX(lane);

        let trafficCar: TrafficCar = {
            sprite: poolGraphics,
            lane: lane,
            speed: MyMath.randomInRange(0.5, 1.5), // speed multiplier
            color: color,
            active: true,
            hitbox: new Phaser.Geom.Rectangle(
                carX - Config.CAR_WIDTH / 2,
                Config.SPAWN_Y - Config.CAR_HEIGHT / 2,
                Config.CAR_WIDTH,
                Config.CAR_HEIGHT
            ),
            nearMissCounted: false,
        };

        this._trafficCars.push(trafficCar);
    }

    private getCarY(car: TrafficCar): number {
        return car.hitbox.y + Config.CAR_HEIGHT / 2;
    }

    private drawCar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, isPlayer: boolean) {
        g.clear();

        // Car body
        g.fillStyle(color);
        g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 8);

        // Darker shade for sides
        let darkerColor = Phaser.Display.Color.ValueToColor(color).darken(25).color;
        g.fillStyle(darkerColor, 0.3);
        g.fillRect(x - w / 2, y - h / 2, 8, h);
        g.fillRect(x + w / 2 - 8, y - h / 2, 8, h);

        if (isPlayer) {
            // Player car (facing up)
            // Windshield (front/top)
            g.fillStyle(0x87ceeb, 0.7);
            g.fillRoundedRect(x - w / 2 + 10, y - h / 2 + 8, w - 20, 28, 4);
            // Rear window
            g.fillStyle(0x87ceeb, 0.5);
            g.fillRoundedRect(x - w / 2 + 12, y + h / 2 - 35, w - 24, 20, 3);
            // Headlights
            g.fillStyle(0xffff88);
            g.fillCircle(x - w / 2 + 12, y - h / 2 + 8, 5);
            g.fillCircle(x + w / 2 - 12, y - h / 2 + 8, 5);
            // Taillights
            g.fillStyle(0xff3333);
            g.fillRect(x - w / 2 + 5, y + h / 2 - 8, 12, 6);
            g.fillRect(x + w / 2 - 17, y + h / 2 - 8, 12, 6);
        } else {
            // Traffic car (facing down toward player)
            // Windshield (at bottom since facing down)
            g.fillStyle(0x87ceeb, 0.7);
            g.fillRoundedRect(x - w / 2 + 10, y + h / 2 - 35, w - 20, 28, 4);
            // Rear window (at top)
            g.fillStyle(0x87ceeb, 0.5);
            g.fillRoundedRect(x - w / 2 + 12, y - h / 2 + 8, w - 24, 20, 3);
            // Taillights (at top since facing down)
            g.fillStyle(0xff0000);
            g.fillRect(x - w / 2 + 5, y - h / 2 + 4, 12, 8);
            g.fillRect(x + w / 2 - 17, y - h / 2 + 4, 12, 8);
            // Headlights (at bottom)
            g.fillStyle(0xffffaa);
            g.fillCircle(x - w / 2 + 12, y + h / 2 - 8, 5);
            g.fillCircle(x + w / 2 - 12, y + h / 2 - 8, 5);
        }
    }

    private drawRoad() {
        this._roadGraphics.clear();

        // Grass stripes for scrolling effect
        this._roadGraphics.fillStyle(Config.COLORS.GRASS_DARK, 0.3);
        let offset = this._roadOffset % 80;
        for (let y = offset; y < Config.GH; y += 80) {
            this._roadGraphics.fillRect(-Config.GW_HALF, y, Config.GW, 40);
        }

        // Road surface
        this._roadGraphics.fillStyle(Config.COLORS.ROAD);
        this._roadGraphics.fillRect(Config.ROAD_LEFT, 0, Config.ROAD_WIDTH, Config.GH);

        // Sidewalks
        this._roadGraphics.fillStyle(0x888888);
        this._roadGraphics.fillRect(Config.ROAD_LEFT - 20, 0, 20, Config.GH);
        this._roadGraphics.fillRect(Config.ROAD_RIGHT, 0, 20, Config.GH);

        // Road edges (solid white)
        this._roadGraphics.fillStyle(0xffffff, 0.8);
        this._roadGraphics.fillRect(Config.ROAD_LEFT - 2, 0, 4, Config.GH);
        this._roadGraphics.fillRect(Config.ROAD_RIGHT - 2, 0, 4, Config.GH);

        // Lane markings (dashed, scrolling)
        this._roadGraphics.fillStyle(Config.COLORS.LANE_MARKING, 0.5);
        let laneW = Config.LANE_WIDTH;
        for (let lane = 1; lane < Config.LANE_COUNT; lane++) {
            let x = Config.ROAD_LEFT + lane * laneW;
            for (let y = offset; y < Config.GH; y += 60) {
                this._roadGraphics.fillRect(x - 2, y, 4, 30);
            }
        }
    }

    private drawPlayer() {
        this.drawCar(
            this._playerGraphics,
            this._playerCurrentX,
            this._playerY,
            Config.PLAYER_WIDTH,
            Config.PLAYER_HEIGHT,
            Config.COLORS.PLAYER,
            true
        );
    }

    private drawHUD() {
        this._hudGraphics.clear();

        // HUD background bar
        this._hudGraphics.fillStyle(Config.COLORS.HUD_BG, 0.6);
        this._hudGraphics.fillRect(-Config.GW_HALF, -Config.GH_HALF, Config.GW, 80);

        // Update text
        this._scoreText.text = Strings.hudScorePrefix + Math.floor(this._score);
        this._distanceText.text = Math.floor(this._distance) + Strings.hudDistanceUnit;
        this._nearMissCountText.text = Strings.hudNearMissIcon + this._nearMisses;
    }

    private checkCollisions() {
        let px = this._playerCurrentX;
        let py = this._playerY;
        let pw = Config.PLAYER_WIDTH / 2;
        let ph = Config.PLAYER_HEIGHT / 2;

        for (let car of this._trafficCars) {
            if (!car.active) continue;

            let cx = car.hitbox.x + Config.CAR_WIDTH / 2;
            let cy = car.hitbox.y + Config.CAR_HEIGHT / 2;

            // Collision detection (AABB)
            let overlapX = Math.abs(px - cx) < (pw + Config.CAR_WIDTH / 2);
            let overlapY = Math.abs(py - cy) < (ph + Config.CAR_HEIGHT / 2);

            if (overlapX && overlapY) {
                this.gameOver();
                return;
            }

            // Near-miss detection (car just passed player)
            let nearMissX = Math.abs(px - cx) < (pw + Config.CAR_WIDTH / 2 + Config.NEAR_MISS_THRESHOLD);
            let nearMissY = Math.abs(py - cy) < (ph + Config.CAR_HEIGHT / 2);
            let alreadyPassed = car.hitbox.y > this._playerY + Config.CAR_HEIGHT;

            if (nearMissX && nearMissY && alreadyPassed && !car.nearMissCounted) {
                // This was a near-miss
                car.nearMissCounted = true;
                this._nearMisses++;
                this.showNearMissText(cx, cy - Config.CAR_HEIGHT);
            }
        }
    }

    private showNearMissText(x: number, y: number) {
        let text = new Phaser.GameObjects.Text(this, x, y,
            Strings.nearMissPopupPrefix + Config.NEAR_MISS_BONUS,
            { font: "36px Ubuntu", align: 'center', fontStyle: 'bold' })
            .setOrigin(0.5)
            .setColor(Config.COLORS.GOLD);
        text.setStroke('#000000', 3);
        this._nearMissTexts.push({ text: text, timer: 1.0 });
        this._score += Config.NEAR_MISS_BONUS;
    }

    private gameOver() {
        this._isPlaying = false;
        Params.isGameOver = true;

        // Save stats
        LocalData.getInstance().addGameStats(
            Math.floor(this._score),
            Math.floor(this._distance),
            this._nearMisses
        );

        // Camera shake
        this.cameras.main.shake(300, 0.01);

        // Flash red
        this.cameras.main.flash(200, 255, 0, 0);

        // Delay then go to game over
        this.time.delayedCall(800, () => {
            Params.score = Math.floor(this._score);
            Params.distance = Math.floor(this._distance);
            Params.nearMisses = this._nearMisses;

            // Try interstitial ad
            if (AdMng.getInstance().isInterstitialReady()) {
                AdMng.getInstance().showInterstitial(this.game,
                    () => { },
                    () => {
                        this.scene.start(SceneName.GameOver);
                    },
                    this
                );
            } else {
                this.scene.start(SceneName.GameOver);
            }
        });
    }

    private onResize() {
        // Update positions on resize
    }

    update(time: number, dtMs: number) {
        if (!this._isPlaying || this._isPaused) return;

        let dt = dtMs * 0.001;
        this._gameTime += dt;

        // Update speed
        this._currentSpeed = GameData.getInstance().getSpeed(this._gameTime);

        // Update road scroll
        this._roadOffset += this._currentSpeed * dt;

        // Move player toward target lane smoothly
        let lerpSpeed = 12;
        this._playerCurrentX = Phaser.Math.Linear(this._playerCurrentX, this._playerTargetX, lerpSpeed * dt);

        // Accumulate distance and score
        this._distance += this._currentSpeed * dt * 0.1;
        this._score += Config.SCORE_PER_SECOND * dt * (1 + this._nearMisses * 0.05);

        // Spawn traffic
        let spawnInterval = GameData.getInstance().getSpawnInterval(this._gameTime);
        this._spawnTimer += dtMs;
        if (this._spawnTimer >= spawnInterval) {
            this._spawnTimer -= spawnInterval;
            this.spawnTrafficCar();
        }

        // Move traffic cars
        for (let i = this._trafficCars.length - 1; i >= 0; i--) {
            let car = this._trafficCars[i];
            if (!car.active) continue;

            // Traffic moves downward (toward player)
            let moveAmount = this._currentSpeed * car.speed * dt;
            car.hitbox.y += moveAmount;

            // Check if off screen bottom
            if (car.hitbox.y > Config.DESPAWN_Y) {
                car.active = false;
                car.sprite.visible = false;
                this._trafficPool.push(car.sprite);
                this._trafficCars.splice(i, 1);
            }
        }

        // Check collisions
        this.checkCollisions();

        // Draw everything
        this.drawRoad();
        this.drawPlayer();

        // Draw traffic cars
        for (let car of this._trafficCars) {
            if (!car.active) continue;
            car.sprite.visible = true;
            let cx = car.hitbox.x + Config.CAR_WIDTH / 2;
            let cy = car.hitbox.y + Config.CAR_HEIGHT / 2;
            this.drawCar(car.sprite, cx, cy, Config.CAR_WIDTH, Config.CAR_HEIGHT, car.color, false);
        }

        // Draw HUD
        this.drawHUD();

        // Update near-miss floating texts
        for (let i = this._nearMissTexts.length - 1; i >= 0; i--) {
            let nt = this._nearMissTexts[i];
            nt.timer -= dt;
            nt.text.y -= 60 * dt;
            nt.text.alpha = Math.max(0, nt.timer);
            if (nt.timer <= 0) {
                nt.text.destroy();
                this._nearMissTexts.splice(i, 1);
            }
        }
    }
}
