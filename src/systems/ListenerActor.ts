// The Hush has its own procedural silhouette so it remains readable in the institute's dark rooms.

import * as THREE from 'three';
import type { MaterialLibrary } from '../assets/materials/MaterialLibrary';
import type { Vec3 } from '../core/Script';
import type { CharacterBody, Collider, PhysicsWorld } from '../physics/PhysicsWorld';
import { HushModel } from './HushModel';
import { findGridPath } from './HushNavigation';
import { HushPresentation } from './HushPresentation';

const WALK_SPEED = 1.15;
const VANISH_TIME = 0.5;
const HUSH_RADIUS = 0.34;
const HUSH_HALF_HEIGHT = 0.56;
const HUSH_BODY_OFFSET = 0.9;

const tempDir = new THREE.Vector3();
const NAV_REPLAN_DISTANCE = 0.9;
const NAV_BLOCKED_TIME = 0.55;

export class ListenerActor {
  readonly root = new THREE.Group();
  private model: HushModel;
  private presentation = new HushPresentation();
  private effectRing: THREE.Mesh;
  private effectMaterial: THREE.MeshBasicMaterial;
  private effectRoot: THREE.Group;
  private route: THREE.Vector3[] = [];
  private routeIndex = 0;
  private plannedTarget = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private plannedRevision = -1;
  private blockedTime = 0;
  private presentationBaseY = 0;
  private timeLeft = 0;
  private walkTarget: THREE.Vector3 | null = null;
  private lookAtPlayer = false;
  private pathPoints: THREE.Vector3[] = [];
  private pathLength = 0;
  private pathDuration = 0;
  private holdStill = false;
  private clock = 0;
  private walkSpeedNow = 0;
  /** A real position, kept current so that the audio and Hush systems can measure distance. */
  readonly position = new THREE.Vector3();
  private character: CharacterBody | null = null;
  private respawnColliderPending = false;

  constructor(
    private scene: THREE.Scene,
    _materials: MaterialLibrary,
    physics?: PhysicsWorld,
    spawn = new THREE.Vector3(-16, 0, 6.2),
  ) {
    this.root.name = 'hush-actor';
    this.root.visible = false;
    this.root.position.copy(spawn);
    this.position.copy(spawn);
    this.model = new HushModel(this.root);
    if (physics) {
      this.character = physics.createCharacter(HUSH_RADIUS, HUSH_HALF_HEIGHT, {
        x: spawn.x,
        y: spawn.y + HUSH_BODY_OFFSET,
        z: spawn.z,
      });
    }
    this.effectMaterial = new THREE.MeshBasicMaterial({
      color: 0x9fe5dc,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.effectRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.018, 8, 32), this.effectMaterial);
    this.effectRing.rotation.x = Math.PI / 2;
    this.effectRoot = new THREE.Group();
    this.effectRoot.add(this.effectRing);
    this.effectRoot.visible = false;
    scene.add(this.effectRoot);

    scene.add(this.root);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  get modelCreated(): boolean {
    return this.model.root.parent === this.root;
  }

  get modelRoot(): THREE.Group {
    return this.model.root;
  }

  get modelVisible(): boolean {
    return this.model.visible;
  }

  /** True while an authored appearance or Hush sequence owns the actor's transform. */
  get scriptedControl(): boolean {
    return this.timeLeft > 0 || this.pathPoints.length > 0 || this.walkTarget !== null;
  }

  get collider(): Collider | null {
    return this.character?.collider ?? null;
  }

  get facing(): THREE.Vector3 {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.root.quaternion);
    forward.y = 0;
    return forward.normalize();
  }

  /** Stands (or walks) somewhere briefly, then flickers out of existence. */
  appear(at: Vec3, lookAtPlayer: boolean, duration: number, walkTo?: Vec3): void {
    this.root.position.set(at[0], at[1], at[2]);
    this.position.copy(this.root.position);
    this.syncCharacterPosition();
    this.presentationBaseY = at[1];
    this.root.visible = true;
    this.timeLeft = duration;
    this.lookAtPlayer = lookAtPlayer;
    this.pathPoints = [];
    this.walkTarget = walkTo ? new THREE.Vector3(walkTo[0], walkTo[1], walkTo[2]) : null;
    this.position.copy(this.root.position);
  }

  /** Follows a path over a set time, as during a Hush. Progress comes from the state machine. */
  walkPath(path: Vec3[], duration: number): void {
    this.pathPoints = path.map((point) => new THREE.Vector3(point[0], point[1], point[2]));
    this.pathLength = 0;
    for (let i = 1; i < this.pathPoints.length; i++) this.pathLength += this.pathPoints[i - 1].distanceTo(this.pathPoints[i]);
    this.pathDuration = duration;
    this.root.position.copy(this.pathPoints[0]);
    this.position.copy(this.root.position);
    this.syncCharacterPosition();
    this.presentationBaseY = this.root.position.y;
    this.root.visible = true;
    this.timeLeft = Infinity;
    this.walkTarget = null;
    this.lookAtPlayer = false;
    this.holdStill = false;
  }

  /** Stops it mid-walk, facing the player. It has heard something. */
  setListening(listening: boolean): void {
    this.holdStill = listening;
    this.lookAtPlayer = listening;
  }

  hide(): void {
    this.root.visible = false;
    this.timeLeft = 0;
    this.pathPoints = [];
    this.walkTarget = null;
    this.holdStill = false;
  }

  setPosition(position: THREE.Vector3, faceDirection?: THREE.Vector3): void {
    this.root.visible = true;
    this.root.position.copy(position);
    this.presentationBaseY = position.y;
    this.position.copy(position);
    if (faceDirection) {
      const direction = faceDirection.clone().setY(0).normalize();
      if (direction.lengthSq() > 0.001) this.root.rotation.y = Math.atan2(-direction.x, -direction.z);
    }
    this.character?.body.setNextKinematicTranslation({
      x: position.x,
      y: position.y + 0.9,
      z: position.z,
    });
  }

  /** Returns control to the physical AI after an authored appearance or path. */
  resumeAIAt(position: THREE.Vector3): void {
    this.timeLeft = 0;
    this.pathPoints = [];
    this.pathLength = 0;
    this.pathDuration = 0;
    this.walkTarget = null;
    this.lookAtPlayer = false;
    this.holdStill = false;
    this.route = [];
    this.routeIndex = 0;
    this.plannedTarget.set(Number.POSITIVE_INFINITY, 0, 0);
    this.plannedRevision = -1;
    this.blockedTime = 0;
    this.walkSpeedNow = 0;
    this.root.scale.setScalar(1);
    this.root.rotation.z = 0;
    this.model.setOpacity(1);
    this.presentation.reset();
    this.setPosition(position);
  }

  setEnabled(enabled: boolean): void {
    this.character?.collider.setEnabled(enabled);
  }

  rigVisibleForAI(): void {
    if (!this.presentation.transitioning && !this.respawnColliderPending) this.root.visible = true;
  }

  beginDeath(): void {
    this.setEnabled(false);
    this.respawnColliderPending = false;
    this.presentationBaseY = this.root.position.y;
    this.presentation.beginDeath();
    this.root.visible = true;
    this.root.scale.setScalar(1);
    this.effectRoot.visible = true;
  }

  beginRespawn(position: THREE.Vector3): void {
    this.setPosition(position);
    this.setEnabled(false);
    this.respawnColliderPending = true;
    this.presentationBaseY = position.y;
    this.route = [];
    this.presentation.beginRespawn();
    this.root.visible = true;
    this.effectRoot.visible = true;
  }

  resetForSession(position: THREE.Vector3): void {
    this.presentation.reset();
    this.respawnColliderPending = false;
    this.timeLeft = 0;
    this.pathPoints = [];
    this.pathLength = 0;
    this.pathDuration = 0;
    this.walkTarget = null;
    this.lookAtPlayer = false;
    this.holdStill = false;
    this.route = [];
    this.routeIndex = 0;
    this.plannedTarget.set(Number.POSITIVE_INFINITY, 0, 0);
    this.plannedRevision = -1;
    this.blockedTime = 0;
    this.walkSpeedNow = 0;
    this.root.scale.setScalar(1);
    this.root.rotation.set(0, 0, 0);
    this.model.setOpacity(1);
    this.effectMaterial.opacity = 0;
    this.effectRoot.visible = false;
    this.setEnabled(true);
    this.setPosition(position);
    this.hide();
  }

  updatePresentation(dt: number): void {
    const frame = this.presentation.update(dt);
    if (frame.phase === 'idle' && this.respawnColliderPending) {
      this.setEnabled(true);
      this.respawnColliderPending = false;
      this.character?.body.setNextKinematicTranslation({
        x: this.root.position.x,
        y: this.root.position.y + 0.9,
        z: this.root.position.z,
      });
    }
    this.root.visible = frame.visible;
    this.root.scale.setScalar(frame.scale);
    this.root.rotation.z = frame.fall * 1.05;
    this.root.position.y = this.presentationBaseY - frame.fall * 0.12;
    this.model.setOpacity(frame.opacity);
    this.effectRoot.visible = frame.effectOpacity > 0;
    this.effectRoot.position.set(this.root.position.x, this.root.position.y + 0.05, this.root.position.z);
    this.effectRing.scale.setScalar(frame.effectScale);
    this.effectMaterial.opacity = frame.effectOpacity;
  }

  updateAI(
    dt: number,
    target: THREE.Vector3,
    _playerPos: THREE.Vector3,
    physics: PhysicsWorld,
    speed: number,
    revision = 0,
    state: 'patrol' | 'investigate' | 'chase' | 'search' | 'return' | 'attack' | 'dead' = 'patrol',
  ): boolean {
    if (this.presentation.transitioning || this.respawnColliderPending) return false;
    this.root.visible = true;
    if (speed <= 0) {
      this.model.update(dt, 0, state);
      return false;
    }
    if (
      this.route.length === 0 ||
      this.plannedTarget.distanceTo(target) > NAV_REPLAN_DISTANCE ||
      this.plannedRevision !== revision
    ) {
      this.rebuildRoute(target, physics, revision);
    }
    while (this.routeIndex < this.route.length && this.position.distanceTo(this.route[this.routeIndex]) < 0.28) this.routeIndex++;
    if (this.routeIndex >= this.route.length) {
      if (this.position.distanceTo(target) <= 0.55) {
        this.blockedTime = 0;
        this.model.update(dt, 0, state);
        return false;
      }
      this.model.update(dt, 0, state);
      this.blockedTime += dt;
      if (this.blockedTime >= NAV_BLOCKED_TIME) {
        this.blockedTime = 0;
        this.route = [];
        this.plannedRevision = -1;
      }
      return true;
    }
    const waypoint = this.route[this.routeIndex];
    tempDir.copy(waypoint).sub(this.root.position);
    tempDir.y = 0;
    const distance = tempDir.length();
    if (distance <= 0.05) {
      this.blockedTime = 0;
      return false;
    }
    tempDir.normalize();
    const desiredLength = Math.min(distance, speed * dt);
    const desired = { x: tempDir.x * desiredLength, y: -0.02, z: tempDir.z * desiredLength };
    let blocked = false;
    if (this.character) {
      this.character.controller.computeColliderMovement(this.character.collider, desired);
      const corrected = this.character.controller.computedMovement();
      this.root.position.x += corrected.x;
      this.root.position.y += corrected.y;
      this.root.position.z += corrected.z;
      this.character.body.setNextKinematicTranslation({
        x: this.root.position.x,
        y: this.root.position.y + 0.9,
        z: this.root.position.z,
      });
      blocked = Math.hypot(corrected.x, corrected.z) < desiredLength * 0.35;
      this.blockedTime = blocked ? this.blockedTime + dt : 0;
      if (blocked && this.blockedTime >= NAV_BLOCKED_TIME) {
        this.blockedTime = 0;
        this.route = [];
        this.plannedRevision = -1;
        this.walkSpeedNow += (0 - this.walkSpeedNow) * (1 - Math.exp(-8 * dt));
        this.position.copy(this.root.position);
        this.model.update(dt, 0, state);
        return true;
      }
    } else {
      this.root.position.addScaledVector(tempDir, desiredLength);
    }
    this.root.rotation.y = Math.atan2(-tempDir.x, -tempDir.z);
    this.position.copy(this.root.position);
    this.clock += dt;
    this.walkSpeedNow += (speed - this.walkSpeedNow) * (1 - Math.exp(-6 * dt));
    this.model.update(dt, this.walkSpeedNow, state);
    return blocked;
  }

  private rebuildRoute(target: THREE.Vector3, physics: PhysicsWorld, revision: number): void {
    this.plannedTarget.copy(target);
    this.plannedRevision = revision;
    this.routeIndex = 0;
    const direction = target.clone().sub(this.position);
    direction.y = 0;
    const distance = direction.length();
    if (distance < 0.05) {
      this.route = [];
      return;
    }
    direction.normalize();
    const obstruction = physics.castCapsule(
      { x: this.position.x, y: this.position.y + HUSH_BODY_OFFSET + 0.05, z: this.position.z },
      direction,
      HUSH_RADIUS,
      HUSH_HALF_HEIGHT,
      distance,
      this.character?.collider,
    );
    if (obstruction === null || obstruction >= distance - 0.65) {
      this.route = [target.clone()];
      return;
    }
    this.route = findGridPath(
      this.position,
      target,
      (point) => physics.isHushSpawnClear(point, this.character?.collider),
    );
  }

  /** Lets it fade out from wherever it is, over the vanish time. */
  dismiss(): void {
    if (this.visible) this.timeLeft = Math.min(this.timeLeft, VANISH_TIME);
    this.pathPoints = [];
  }

  update(dt: number, playerPos: THREE.Vector3, pathProgress: number): void {
    if (!this.visible) return;
    this.clock += dt;
    const root = this.root;
    let speed = 0;

    if (this.pathPoints.length > 1 && !this.holdStill) {
      this.placeOnPath(pathProgress, dt);
      speed = this.pathDuration > 0 ? this.pathLength / this.pathDuration : 0;
    } else if (this.walkTarget) {
      tempDir.copy(this.walkTarget).sub(root.position);
      tempDir.y = 0;
      const distance = tempDir.length();
      if (distance > 0.05) {
        tempDir.normalize();
        root.position.addScaledVector(tempDir, Math.min(distance, WALK_SPEED * dt));
        root.rotation.y = Math.atan2(-tempDir.x, -tempDir.z);
        speed = WALK_SPEED;
      }
    }

    if (this.lookAtPlayer) {
      const heading = Math.atan2(-(playerPos.x - root.position.x), -(playerPos.z - root.position.z));
      const delta = Math.atan2(Math.sin(heading - root.rotation.y), Math.cos(heading - root.rotation.y));
      root.rotation.y += delta * (1 - Math.exp(-3 * dt));
    }

    this.walkSpeedNow += (speed - this.walkSpeedNow) * (1 - Math.exp(-6 * dt));
    this.model.update(dt, this.walkSpeedNow, 'investigate');
    this.position.copy(root.position);
    this.syncCharacterPosition();

    if (this.timeLeft !== Infinity) {
      this.timeLeft -= dt;
      // Rather than fading, it stutters away like a bad signal.
      if (this.timeLeft < VANISH_TIME) root.visible = Math.sin(this.clock * 70) > -0.2 + (VANISH_TIME - this.timeLeft) * 2;
      if (this.timeLeft <= 0) this.hide();
    }
  }

  private placeOnPath(progress: number, dt: number): void {
    let remaining = Math.max(0, Math.min(1, progress)) * this.pathLength;
    const root = this.root;
    for (let i = 1; i < this.pathPoints.length; i++) {
      const from = this.pathPoints[i - 1];
      const to = this.pathPoints[i];
      const length = from.distanceTo(to);
      if (remaining <= length || i === this.pathPoints.length - 1) {
        root.position.lerpVectors(from, to, length > 0 ? Math.min(1, remaining / length) : 0);
        tempDir.copy(to).sub(from);
        const heading = Math.atan2(-tempDir.x, -tempDir.z);
        const delta = Math.atan2(Math.sin(heading - root.rotation.y), Math.cos(heading - root.rotation.y));
        root.rotation.y += delta * (1 - Math.exp(-5 * dt));
        return;
      }
      remaining -= length;
    }
  }

  private syncCharacterPosition(): void {
    this.character?.body.setNextKinematicTranslation({
      x: this.root.position.x,
      y: this.root.position.y + 0.9,
      z: this.root.position.z,
    });
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.scene.remove(this.effectRoot);
    this.model.dispose();
    this.effectMaterial.dispose();
    this.effectRing.geometry.dispose();
  }
}
