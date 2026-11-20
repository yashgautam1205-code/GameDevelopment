export type HushPresentationPhase = 'idle' | 'death' | 'vanish' | 'respawn' | 'hidden';

export interface HushPresentationFrame {
  phase: HushPresentationPhase;
  visible: boolean;
  opacity: number;
  scale: number;
  fall: number;
  effectScale: number;
  effectOpacity: number;
}

const DEATH_DURATION = 1.1;
const VANISH_DURATION = 0.9;
const RESPAWN_DURATION = 1.2;

export class HushPresentation {
  private phase: HushPresentationPhase = 'idle';
  private elapsed = 0;

  get transitioning(): boolean {
    return this.phase === 'death' || this.phase === 'vanish' || this.phase === 'respawn';
  }

  beginDeath(): void {
    this.phase = 'death';
    this.elapsed = 0;
  }

  beginRespawn(): void {
    this.phase = 'respawn';
    this.elapsed = 0;
  }

  reset(): void {
    this.phase = 'idle';
    this.elapsed = 0;
  }

  update(dt: number): HushPresentationFrame {
    this.elapsed += dt;
    if (this.phase === 'death' && this.elapsed >= DEATH_DURATION) {
      this.phase = 'vanish';
      this.elapsed -= DEATH_DURATION;
    }
    if (this.phase === 'vanish' && this.elapsed >= VANISH_DURATION) {
      this.phase = 'hidden';
      this.elapsed = 0;
    }
    if (this.phase === 'respawn' && this.elapsed >= RESPAWN_DURATION) {
      this.phase = 'idle';
      this.elapsed = 0;
    }

    switch (this.phase) {
      case 'death': {
        const progress = this.elapsed / DEATH_DURATION;
        return { phase: this.phase, visible: true, opacity: 1, scale: 1 - 0.18 * progress, fall: progress, effectScale: 0.45 + progress * 0.4, effectOpacity: 0.65 };
      }
      case 'vanish': {
        const progress = this.elapsed / VANISH_DURATION;
        return { phase: this.phase, visible: true, opacity: 1 - progress, scale: 0.82 * (1 - 0.5 * progress), fall: 1, effectScale: 0.85 + progress * 1.2, effectOpacity: 0.65 * (1 - progress) };
      }
      case 'respawn': {
        const progress = this.elapsed / RESPAWN_DURATION;
        return { phase: this.phase, visible: true, opacity: progress, scale: 0.15 + 0.85 * progress, fall: 0, effectScale: 0.35 + progress * 1.8, effectOpacity: 1 - progress };
      }
      case 'hidden':
        return { phase: this.phase, visible: false, opacity: 0, scale: 0.41, fall: 1, effectScale: 2.05, effectOpacity: 0 };
      case 'idle':
        return { phase: this.phase, visible: true, opacity: 1, scale: 1, fall: 0, effectScale: 1, effectOpacity: 0 };
    }
  }
}
