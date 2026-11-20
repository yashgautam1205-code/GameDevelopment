// A thin wrapper around Rapier. The rest of the game asks simple questions here
// ("what does this ray hit?") and never touches the physics library directly.

import RAPIER from '@dimforge/rapier3d-compat';

export type Collider = RAPIER.Collider;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface CharacterBody {
  collider: RAPIER.Collider;
  body: RAPIER.RigidBody;
  controller: RAPIER.KinematicCharacterController;
}

export class PhysicsWorld {
  private constructor(readonly world: RAPIER.World) {}

  /** Rapier ships as WebAssembly, so it has to be initialised before first use. */
  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 60;
    return new PhysicsWorld(world);
  }

  step(): void {
    this.world.step();
  }

  /** Adds an immovable box, optionally rotated about the vertical axis. */
  addBox(center: Vec3Like, half: Vec3Like, rotationY = 0): Collider {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z);
    if (rotationY !== 0) {
      const s = Math.sin(rotationY / 2);
      desc.setRotation({ x: 0, y: s, z: 0, w: Math.cos(rotationY / 2) });
    }
    return this.world.createCollider(desc);
  }

  removeCollider(collider: Collider): void {
    this.world.removeCollider(collider, false);
  }

  /**
   * Creates the player's body: a capsule moved by a character controller. The
   * controller only reports how far the capsule may move without passing through
   * anything; acceleration, running and crouching are all ours, in PlayerController.
   */
  createCharacter(radius: number, halfHeight: number, position: Vec3Like): CharacterBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z),
    );
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius), body);
    // Every floor in the building is flat, so stepping up ledges and snapping to slopes aren't
    // needed. They only added stalls, as the controller kept testing for steps that don't exist.
    const controller = this.world.createCharacterController(0.02);
    controller.setSlideEnabled(true);
    return { collider, body, controller };
  }

  /** Swaps the capsule's height when crouching, keeping its feet where they are. */
  setCapsule(character: CharacterBody, radius: number, halfHeight: number): void {
    character.collider.setShape(new RAPIER.Capsule(halfHeight, radius));
  }

  /** Would a capsule of this size fit here? Stops the player standing up under a low hatch. */
  capsuleFits(center: Vec3Like, radius: number, halfHeight: number, exclude?: Collider): boolean {
    const hit = this.world.intersectionWithShape(
      center,
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Capsule(halfHeight, radius),
      undefined,
      undefined,
      exclude,
    );
    return hit === null;
  }

  isCapsuleSupported(feet: Vec3Like, exclude?: Collider): boolean {
    const distance = this.castRay(
      { x: feet.x, y: feet.y + 0.18, z: feet.z },
      { x: 0, y: -1, z: 0 },
      0.38,
      exclude,
    );
    return distance !== null && distance <= 0.34;
  }

  isHushSpawnClear(feet: Vec3Like, exclude?: Collider): boolean {
    return (
      this.isCapsuleSupported(feet, exclude) &&
      this.capsuleFits(
        { x: feet.x, y: feet.y + 0.93, z: feet.z },
        0.34,
        0.56,
        exclude,
      ) &&
      this.capsuleFits(
        { x: feet.x, y: feet.y + 1.25, z: feet.z },
        0.34,
        0.88,
        exclude,
      )
    );
  }

  /** Distance along a normalized direction to the first solid thing, or null if clear. */
  castRay(origin: Vec3Like, direction: Vec3Like, maxDistance: number, exclude?: Collider): number | null {
    const hit = this.world.castRay(new RAPIER.Ray(origin, direction), maxDistance, true, undefined, undefined, exclude);
    return hit ? hit.timeOfImpact : null;
  }

  castRayHit(
    origin: Vec3Like,
    direction: Vec3Like,
    maxDistance: number,
    exclude?: Collider,
    alsoExclude?: Collider,
  ): { distance: number; collider: Collider } | null {
    const hit = this.world.castRayAndGetNormal(
      new RAPIER.Ray(origin, direction),
      maxDistance,
      true,
      undefined,
      undefined,
      exclude,
      undefined,
      alsoExclude ? (collider) => collider !== alsoExclude : undefined,
    );
    if (!hit) return null;
    return { distance: hit.timeOfImpact, collider: hit.collider };
  }

  /** Distance to an obstacle using the character's full capsule instead of a thin ray. */
  castCapsule(
    origin: Vec3Like,
    direction: Vec3Like,
    radius: number,
    halfHeight: number,
    maxDistance: number,
    exclude?: Collider,
  ): number | null {
    const hit = this.world.castShape(
      origin,
      { x: 0, y: 0, z: 0, w: 1 },
      direction,
      new RAPIER.Capsule(halfHeight, radius),
      0,
      maxDistance,
      true,
      undefined,
      undefined,
      exclude,
    );
    return hit ? hit.time_of_impact : null;
  }

  /**
   * Sweeps a sphere along a direction and returns the distance it could travel. The
   * camera uses this: a sphere gives the lens some breathing room, where a thin ray
   * would let it clip into a wall at a glancing angle.
   */
  castSphere(origin: Vec3Like, direction: Vec3Like, radius: number, maxDistance: number, exclude?: Collider): number {
    const hit = this.world.castShape(
      origin,
      { x: 0, y: 0, z: 0, w: 1 },
      direction,
      new RAPIER.Ball(radius),
      0,
      maxDistance,
      true,
      undefined,
      undefined,
      exclude,
    );
    return hit ? hit.time_of_impact : maxDistance;
  }

  dispose(): void {
    this.world.free();
  }
}
