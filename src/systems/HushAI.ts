import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';

export type HushAIState = 'patrol' | 'investigate' | 'chase' | 'search' | 'return' | 'attack' | 'dead';

export interface HushSoundEvent {
  position: THREE.Vector3;
  intensity: number;
  type: 'footstep' | 'door' | 'drop' | 'machinery' | 'interaction';
  timestamp: number;
  sourceId?: string;
}

export const HUSH_AI_CONFIG: {
  maxHealth: number;
  weaponDamage: number;
  visionDistance: number;
  visionFovDegrees: number;
  crouchVisionMultiplier: number;
  sprintVisionMultiplier: number;
  hearingRange: number;
  hearingMinimum: number;
  chaseSpeed: number;
  investigateSpeed: number;
  patrolSpeed: number;
  attackRange: number;
  attackCooldown: number;
  attackDamage: number;
  searchDuration: number;
  arriveDistance: number;
  respawnSeconds: number;
  patrolRoute: THREE.Vector3[];
  respawn: THREE.Vector3;
  respawnAlternatives: THREE.Vector3[];
} = {
  maxHealth: 100,
  weaponDamage: 25,
  visionDistance: 14,
  visionFovDegrees: 100,
  crouchVisionMultiplier: 0.55,
  sprintVisionMultiplier: 1.25,
  hearingRange: 44,
  hearingMinimum: 0.05,
  chaseSpeed: 2.55,
  investigateSpeed: 1.65,
  patrolSpeed: 1.15,
  attackRange: 1.45,
  attackCooldown: 1.1,
  attackDamage: 12,
  searchDuration: 8,
  arriveDistance: 0.55,
  respawnSeconds: 60,
  patrolRoute: [
    new THREE.Vector3(-16, 0, 6.2),
    new THREE.Vector3(-8, 0, 6.2),
    new THREE.Vector3(-2, 0, 6.2),
  ],
  respawn: new THREE.Vector3(-16, 0, 6.2),
  respawnAlternatives: [
    new THREE.Vector3(-12.5, 0, 6.2),
    new THREE.Vector3(1, 0, 6.2),
    new THREE.Vector3(6, 0, 6.2),
  ],
} as const;

export function findAvailableHushSpawn(
  candidates: readonly THREE.Vector3[],
  playerPosition: THREE.Vector3,
  isPhysicallyValid: (position: THREE.Vector3) => boolean,
  minimumPlayerDistance = 6,
): THREE.Vector3 | null {
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - playerPosition.x, candidate.z - playerPosition.z);
    if (distance < minimumPlayerDistance || !isPhysicallyValid(candidate)) continue;
    return candidate.clone();
  }
  return null;
}

export class HushAI {
  state: HushAIState = 'patrol';
  health = HUSH_AI_CONFIG.maxHealth;
  readonly position = new THREE.Vector3();
  readonly lastKnownPosition = new THREE.Vector3();
  readonly movementTarget = new THREE.Vector3();
  lastNoise: { intensity: number; position: THREE.Vector3; type: HushSoundEvent['type']; timestamp: number } | null = null;
  respawnRemaining = 0;
  attackCooldownRemaining = 0;

  private patrolIndex = 0;
  private searchRemaining = 0;
  private blockedTime = 0;
  private navigationRetryTime = 0;
  private respawnRetryRemaining = 0;
  navigationRevision = 0;
  private time = 0;

  constructor(
    private bus: EventBus<GameEvents>,
    start: THREE.Vector3 = HUSH_AI_CONFIG.respawn as THREE.Vector3,
  ) {
    this.position.copy(start);
    this.movementTarget.copy(HUSH_AI_CONFIG.patrolRoute[0]);
  }

  /** Places a new session at the spawn validated by the built level's physics. */
  setSpawnPosition(position: THREE.Vector3): void {
    this.position.copy(position);
    this.lastKnownPosition.copy(position);
    this.patrolIndex = HUSH_AI_CONFIG.patrolRoute.reduce(
      (closest, point, index, route) =>
        point.distanceToSquared(position) < route[closest].distanceToSquared(position) ? index : closest,
      0,
    );
    this.movementTarget.copy(HUSH_AI_CONFIG.patrolRoute[this.patrolIndex]);
    this.navigationRevision++;
  }

  get active(): boolean {
    return this.state !== 'dead';
  }

  get respawning(): boolean {
    return this.state === 'dead';
  }

  get healthFraction(): number {
    return this.health / HUSH_AI_CONFIG.maxHealth;
  }

  hearSound(sound: HushSoundEvent): boolean {
    this.lastNoise = {
      intensity: sound.intensity,
      position: sound.position.clone(),
      type: sound.type,
      timestamp: sound.timestamp,
    };
    if (!this.active) return false;
    const distance = this.position.distanceTo(sound.position);
    if (sound.intensity < HUSH_AI_CONFIG.hearingMinimum) return false;
    const soundRange = HUSH_AI_CONFIG.hearingRange * Math.sqrt(sound.intensity);
    if (distance > soundRange) return false;
    if (this.state === 'chase' || this.state === 'attack') return true;
    this.lastKnownPosition.copy(sound.position);
    this.setState('investigate');
    this.movementTarget.copy(sound.position);
    this.bus.emit('hush:ai:heard', {
      position: [sound.position.x, sound.position.y, sound.position.z],
      intensity: sound.intensity,
      type: sound.type,
    });
    return true;
  }

  canSeePlayer(
    playerPosition: THREE.Vector3,
    facing: THREE.Vector3,
    lineClear: boolean,
    playerCrouching = false,
    playerSprinting = false,
  ): boolean {
    if (!this.active) return false;
    const toPlayer = playerPosition.clone().sub(this.position);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    if (!lineClear || distance > HUSH_AI_CONFIG.visionDistance) return false;
    const crouchFactor = playerCrouching ? HUSH_AI_CONFIG.crouchVisionMultiplier : 1;
    const sprintFactor = playerSprinting ? HUSH_AI_CONFIG.sprintVisionMultiplier : 1;
    if (distance > HUSH_AI_CONFIG.visionDistance * crouchFactor * sprintFactor) return false;
    const forward = facing.clone();
    forward.y = 0;
    if (forward.lengthSq() < 0.001) return true;
    forward.normalize();
    toPlayer.normalize();
    const angle = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(forward.dot(toPlayer), -1, 1)));
    return angle <= HUSH_AI_CONFIG.visionFovDegrees * 0.5;
  }

  update(
    dt: number,
    playerPosition: THREE.Vector3,
    visible = false,
    _playerCrouching = false,
    _playerSprinting = false,
    validateSpawn: (position: THREE.Vector3) => boolean = () => false,
  ): void {
    this.time += dt;
    if (this.attackCooldownRemaining > 0) this.attackCooldownRemaining -= dt;
    if (this.state === 'dead') {
      this.respawnRemaining = Math.max(0, this.respawnRemaining - dt);
      if (this.respawnRemaining < 1e-6) this.respawnRemaining = 0;
      this.respawnRetryRemaining = Math.max(0, this.respawnRetryRemaining - dt);
      if (this.respawnRemaining <= 0 && this.respawnRetryRemaining <= 0) {
        const spawn = findAvailableHushSpawn(
          [HUSH_AI_CONFIG.respawn, ...HUSH_AI_CONFIG.respawnAlternatives],
          playerPosition,
          validateSpawn,
        );
        if (spawn) this.respawn(spawn);
        else this.respawnRetryRemaining = 1;
      }
      return;
    }

    const distanceToPlayer = this.position.distanceTo(playerPosition);
    if (visible) {
      this.lastKnownPosition.copy(playerPosition);
      if (distanceToPlayer <= HUSH_AI_CONFIG.attackRange) {
        this.setState('attack');
        this.movementTarget.copy(playerPosition);
      } else {
        this.setState('chase');
        this.movementTarget.copy(playerPosition);
      }
    }

    switch (this.state) {
      case 'attack':
        if (!visible) {
          this.beginSearch();
        } else if (distanceToPlayer > HUSH_AI_CONFIG.attackRange) {
          this.setState('chase');
        } else if (this.attackCooldownRemaining <= 0) {
          this.attackCooldownRemaining = HUSH_AI_CONFIG.attackCooldown;
          this.bus.emit('hush:ai:attack', { damage: HUSH_AI_CONFIG.attackDamage });
        }
        break;
      case 'chase':
        if (!visible) this.beginSearch();
        break;
      case 'investigate':
        if (visible) {
          this.setState('chase');
        } else if (this.position.distanceTo(this.movementTarget) <= HUSH_AI_CONFIG.arriveDistance) {
          this.beginSearch();
        }
        break;
      case 'search':
        this.searchRemaining -= dt;
        if (visible) {
          this.setState('chase');
        }
        if (this.searchRemaining <= 0) this.setState('return');
        break;
      case 'return':
      case 'patrol':
        if (visible) {
          this.setState('chase');
        } else if (this.state === 'patrol') {
          const target = HUSH_AI_CONFIG.patrolRoute[this.patrolIndex];
          this.movementTarget.copy(target);
          if (this.position.distanceTo(target) <= HUSH_AI_CONFIG.arriveDistance) {
            this.patrolIndex = (this.patrolIndex + 1) % HUSH_AI_CONFIG.patrolRoute.length;
          }
        } else if (this.position.distanceTo(HUSH_AI_CONFIG.patrolRoute[this.patrolIndex]) <= 1.5) {
          this.setState('patrol');
        } else {
          this.movementTarget.copy(HUSH_AI_CONFIG.patrolRoute[this.patrolIndex]);
        }
        break;
    }
  }

  noteMovementBlocked(dt: number, blocked = true): void {
    if (this.state === 'dead') return;
    if (!blocked) {
      this.blockedTime = 0;
      this.navigationRetryTime = 0;
      return;
    }
    this.blockedTime += dt;
    if (this.state === 'investigate' && this.blockedTime >= 5) {
      this.blockedTime = 0;
      this.beginSearch();
      return;
    }
    this.navigationRetryTime += dt;
    if (this.navigationRetryTime >= 1.2) {
      this.navigationRetryTime -= 1.2;
      this.navigationRevision++;
    }
  }

  takeDamage(amount: number): boolean {
    if (!this.active || amount <= 0) return false;
    this.health = THREE.MathUtils.clamp(this.health - amount, 0, HUSH_AI_CONFIG.maxHealth);
    this.bus.emit('hush:ai:damage', { health: this.health, damage: amount });
    if (this.health <= 0) this.die();
    return true;
  }

  die(): void {
    if (this.state === 'dead') return;
    this.setState('dead');
    this.respawnRemaining = HUSH_AI_CONFIG.respawnSeconds;
    this.respawnRetryRemaining = 0;
    this.navigationRevision++;
    this.bus.emit('hush:ai:death', { respawnSeconds: HUSH_AI_CONFIG.respawnSeconds });
  }

  private respawn(spawn: THREE.Vector3): void {
    if (this.state !== 'dead') return;
    this.position.copy(spawn);
    this.health = HUSH_AI_CONFIG.maxHealth;
    this.respawnRemaining = 0;
    this.respawnRetryRemaining = 0;
    this.blockedTime = 0;
    this.navigationRetryTime = 0;
    this.navigationRevision++;
    this.searchRemaining = 0;
    this.patrolIndex = 0;
    this.movementTarget.copy(HUSH_AI_CONFIG.patrolRoute[0]);
    this.setState('patrol');
    this.bus.emit('hush:ai:respawn', {
      position: [spawn.x, spawn.y, spawn.z],
      health: this.health,
    });
  }

  private beginSearch(): void {
    this.searchRemaining = HUSH_AI_CONFIG.searchDuration;
    this.movementTarget.copy(this.lastKnownPosition);
    this.setState('search');
  }

  private setState(state: HushAIState): void {
    if (this.state === state) return;
    const previous = this.state;
    this.state = state;
    this.blockedTime = 0;
    this.navigationRetryTime = 0;
    this.bus.emit('hush:ai:state', { state, previous });
  }
}
