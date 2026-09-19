import Phaser from "phaser";
import { EventBus } from "../utils/EventBus";

export class AudioManager {
  private scene: Phaser.Scene;
  private sfxVolume: number = 0.8;
  private musicVolume: number = 0.6;
  private muted: boolean = false;
  private currentMusic: Phaser.Sound.BaseSound | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.setupListeners();
  }

  private setupListeners(): void {
    EventBus.on("playSfx", (data: { key: string }) => this.playSfx(data.key));
  }

  playSfx(key: string): void {
    if (this.muted) return;
    try {
      this.scene.sound.play(key, { volume: this.sfxVolume });
    } catch {
      // SFX not loaded, ignore
    }
  }

  playMusic(key: string): void {
    if (this.currentMusic) {
      this.currentMusic.stop();
    }
    if (this.muted) return;
    try {
      this.currentMusic = this.scene.sound.add(key, { volume: this.musicVolume, loop: true });
      this.currentMusic.play();
    } catch {
      // Music not loaded, ignore
    }
  }

  stopMusic(): void {
    if (this.currentMusic) {
      this.currentMusic.stop();
      this.currentMusic = null;
    }
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = Phaser.Math.Clamp(v, 0, 1);
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Phaser.Math.Clamp(v, 0, 1);
    if (this.currentMusic) {
      (this.currentMusic as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound).setVolume(this.musicVolume);
    }
  }

  mute(): void {
    this.muted = true;
    this.scene.sound.mute = true;
  }

  unmute(): void {
    this.muted = false;
    this.scene.sound.mute = false;
  }

  isMuted(): boolean {
    return this.muted;
  }
}
