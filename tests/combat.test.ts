import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EnergyWeapon } from '../src/combat/EnergyWeapon';
import { EnergyWeaponView } from '../src/combat/EnergyWeaponView';
import { EventBus } from '../src/core/EventBus';
import { GameSession } from '../src/core/GameSession';
import type { GameEvents } from '../src/core/GameEvents';
import { MaterialLibrary } from '../src/assets/materials/MaterialLibrary';
import { footstepNoise } from '../src/player/PlayerController';
import { ListenerActor } from '../src/systems/ListenerActor';
import { createItemModel } from '../src/assets/geometry/ItemModels';
import { useInteractable } from '../src/interaction/InteractionLogic';
import { findAvailableHushSpawn, HUSH_AI_CONFIG, HushAI } from '../src/systems/HushAI';
import { findGridPath } from '../src/systems/HushNavigation';
import { HushPresentation } from '../src/systems/HushPresentation';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { LEVEL } from '../src/world/levels';

describe('EnergyWeapon', () => {
  it('uses energy and enforces cooldown', () => {
    const weapon = new EnergyWeapon();
    expect(weapon.fire()).toBe(false);
    weapon.setEquipped(true);
    expect(weapon.fire()).toBe(true);
    expect(weapon.energy).toBe(80);
    expect(weapon.fire()).toBe(false);
    weapon.update(0.6);
    expect(weapon.fire()).toBe(true);
  });

  it('cannot fire without enough energy', () => {
    const weapon = new EnergyWeapon();
    weapon.setEquipped(true);
    weapon.energy = 0;
    expect(weapon.fire()).toBe(false);
  });

  it('recharges energy and reports recharge state', () => {
    const weapon = new EnergyWeapon();
    weapon.setEquipped(true);
    weapon.fire();
    expect(weapon.isRecharging).toBe(true);
    weapon.update(2.5);
    expect(weapon.energy).toBe(100);
    expect(weapon.isRecharging).toBe(false);
  });

  it('attaches the weapon view to the player and keeps it hidden until equipped', () => {
    const player = new THREE.Group();
    const view = new EnergyWeaponView(player);
    try {
      expect(view.root.parent).toBe(player);
      expect(view.visible).toBe(false);
      view.setVisible(true);
      expect(view.visible).toBe(true);
      view.fire();
      expect(view.firingEffectActive).toBe(true);
      view.update(0.12);
      expect(view.firingEffectActive).toBe(false);
    } finally {
      view.dispose();
    }
  });

  it('collects the in-world Energy Pistol once and persists equipment through inventory state', () => {
    const session = new GameSession(LEVEL);
    const pickup = LEVEL.rooms.flatMap((room) => room.interactables).find((def) => def.id === 'pk_energy_pistol');
    if (!pickup) throw new Error('Energy Pistol pickup is missing from the level');
    const weapon = new EnergyWeapon();
    expect(session.inventory.has('energy_pistol')).toBe(false);
    expect(weapon.fire()).toBe(false);

    expect(useInteractable(session, pickup)).toEqual({ type: 'picked-up', itemId: 'energy_pistol' });
    expect(session.inventory.has('energy_pistol')).toBe(true);
    expect(useInteractable(session, pickup)).toEqual({ type: 'none' });
    weapon.setEquipped(session.inventory.has('energy_pistol'));
    expect(weapon.fire()).toBe(true);
    expect(weapon.energy).toBe(80);

    const materials = new MaterialLibrary(8, 1);
    try {
      expect(createItemModel('energyPistol', materials).children.length).toBeGreaterThan(0);
    } finally {
      materials.dispose();
    }
  });
});

describe('Player noise event pipeline', () => {
  it('uses the expected sprint, walk, and crouch noise levels', () => {
    expect(footstepNoise(false, 3.9)).toBe(1);
    expect(footstepNoise(false, 1.95)).toBe(0.32);
    expect(footstepNoise(true, 0.95)).toBe(0.05);
    expect(footstepNoise(false, 0)).toBe(0);
  });

  it('forwards a sprint event once to Hush at its world position', () => {
    const session = new GameSession(LEVEL);
    const heard: { position: [number, number, number]; intensity: number }[] = [];
    session.bus.on('hush:ai:heard', (event) => heard.push(event));
    const sound = { position: [18, 0, 6.2] as [number, number, number], intensity: 1, type: 'footstep' as const, timestamp: 1 };
    session.bus.emit('player:sound', sound);
    expect(session.hushAI.state).toBe('investigate');
    expect(session.hushAI.movementTarget.toArray()).toEqual(sound.position);
    expect(session.hushAI.lastNoise?.intensity).toBe(1);
    expect(session.hushAI.lastNoise?.position.toArray()).toEqual(sound.position);
    expect(heard).toHaveLength(1);
    expect(heard[0].position).toEqual(sound.position);
  });

  it('ignores events beyond sprint hearing range and does not duplicate subscriptions', () => {
    const session = new GameSession(LEVEL);
    let heardCount = 0;
    session.bus.on('hush:ai:heard', () => heardCount++);
    session.bus.emit('player:sound', {
      position: [40, 0, 6.2],
      intensity: 1,
      type: 'footstep',
      timestamp: 1,
    });
    expect(session.hushAI.state).toBe('patrol');
    session.bus.emit('player:sound', {
      position: [-10, 0, 6.2],
      intensity: 1,
      type: 'footstep',
      timestamp: 2,
    });
    session.bus.emit('player:sound', {
      position: [-9, 0, 6.2],
      intensity: 1,
      type: 'footstep',
      timestamp: 3,
    });
    expect(heardCount).toBe(2);
    expect(session.hushAI.movementTarget.x).toBe(-9);
  });
});

describe('HushAI combat and state', () => {
  it('hears loud noise and investigates the actual position', () => {
    const hush = new HushAI(new EventBus<GameEvents>());
    const source = new THREE.Vector3(-10, 0, 6);
    expect(hush.hearSound({ position: source, intensity: 1, type: 'footstep', timestamp: 1 })).toBe(true);
    expect(hush.state).toBe('investigate');
    expect(hush.movementTarget.distanceTo(source)).toBe(0);
  });

  it('keeps investigating a distant sound until it arrives or movement stays blocked', () => {
    const hush = new HushAI(new EventBus<GameEvents>());
    const source = new THREE.Vector3(0, 0, 20);
    hush.hearSound({ position: source, intensity: 1, type: 'footstep', timestamp: 1 });
    hush.position.set(0, 0, 10);
    for (let frame = 0; frame < 6 * 60; frame++) hush.update(1 / 60, source, false);
    expect(hush.state).toBe('investigate');

    hush.position.copy(source);
    hush.update(1 / 60, source, false);
    expect(hush.state).toBe('search');
  });

  it('leaves investigation after five seconds of continuously blocked movement', () => {
    const hush = new HushAI(new EventBus<GameEvents>());
    hush.hearSound({ position: new THREE.Vector3(0, 0, 20), intensity: 1, type: 'footstep', timestamp: 1 });
    for (let frame = 0; frame <= 5 * 60; frame++) hush.noteMovementBlocked(1 / 60, true);
    expect(hush.state).toBe('search');
  });

  it('detects visible players but not through wall state', () => {
    const hush = new HushAI(new EventBus<GameEvents>());
    hush.position.set(0, 0, 0);
    expect(hush.canSeePlayer(new THREE.Vector3(5, 0, 0), new THREE.Vector3(1, 0, 0), true)).toBe(true);
    expect(hush.canSeePlayer(new THREE.Vector3(5, 0, 0), new THREE.Vector3(1, 0, 0), false)).toBe(false);
  });

  it('dies at zero health and cannot take more damage', () => {
    const hush = new HushAI(new EventBus<GameEvents>());
    expect(hush.takeDamage(25)).toBe(true);
    expect(hush.takeDamage(25)).toBe(true);
    expect(hush.takeDamage(25)).toBe(true);
    expect(hush.takeDamage(25)).toBe(true);
    expect(hush.health).toBe(0);
    expect(hush.state).toBe('dead');
    expect(hush.takeDamage(25)).toBe(false);
  });

  it('waits exactly 60 game seconds and restores full health', () => {
    const hush = new HushAI(new EventBus<GameEvents>());
    hush.takeDamage(100);
    expect(hush.respawnRemaining).toBe(60);
    for (let i = 0; i < 59 * 60; i++) hush.update(1 / 60, new THREE.Vector3(20, 0, 20), false, false, false, () => true);
    expect(hush.state).toBe('dead');
    hush.update(1, new THREE.Vector3(20, 0, 20), false, false, false, () => true);
    expect(hush.state).toBe('patrol');
    expect(hush.health).toBe(100);
  });

  it('loses sight and searches the last known position', () => {
    const hush = new HushAI(new EventBus<GameEvents>());
    const player = new THREE.Vector3(3, 0, 0);
    hush.update(1 / 60, player, true);
    expect(hush.state).toBe('chase');
    hush.update(1, player, false);
    expect(hush.state).toBe('search');
  });

  it('does not change target while recovering from blocked movement', () => {
    const hush = new HushAI(new EventBus<GameEvents>());
    const target = new THREE.Vector3(-10, 0, 6);
    hush.hearSound({ position: target, intensity: 1, type: 'footstep', timestamp: 0 });
    hush.noteMovementBlocked(1.2);
    expect(hush.movementTarget.distanceTo(target)).toBe(0);
    expect(hush.navigationRevision).toBeGreaterThan(0);
  });
});

describe('Hush runtime spawn validation', () => {
  it('keeps Hush patrol and spawn candidates inside the indoor Lab Corridor', () => {
    const corridor = LEVEL.rooms.find((room) => room.id === 'labCorridor');
    if (!corridor) throw new Error('Lab Corridor room is missing from the level');
    expect(corridor.openAir).not.toBe(true);
    const [x0, z0, x1, z1] = corridor.rect;
    const candidates = [
      ...HUSH_AI_CONFIG.patrolRoute,
      HUSH_AI_CONFIG.respawn,
      ...HUSH_AI_CONFIG.respawnAlternatives,
    ];
    for (const point of candidates) {
      expect(point.x).toBeGreaterThanOrEqual(x0 + 0.4);
      expect(point.x).toBeLessThanOrEqual(x1 - 0.4);
      expect(point.z).toBeGreaterThanOrEqual(z0 + 0.4);
      expect(point.z).toBeLessThanOrEqual(z1 - 0.4);
      expect(point.y).toBe(corridor.floorY);
    }
  });

  async function makeFloor(): Promise<PhysicsWorld> {
    const physics = await PhysicsWorld.create();
    physics.addBox({ x: 0, y: -0.1, z: 0 }, { x: 25, y: 0.1, z: 25 });
    return physics;
  }

  it('rejects a spawn blocked by a wall', async () => {
    const physics = await makeFloor();
    try {
      physics.addBox({ x: 0, y: 1, z: 0 }, { x: 0.5, y: 1, z: 0.5 });
      physics.step();
      expect(physics.isHushSpawnClear(new THREE.Vector3(0, 0, 0))).toBe(false);
    } finally {
      physics.dispose();
    }
  });

  it('rejects a spawn occupied by an obstacle', async () => {
    const physics = await makeFloor();
    try {
      physics.addBox({ x: 0, y: 0.4, z: 0 }, { x: 0.45, y: 0.4, z: 0.45 });
      physics.step();
      expect(physics.isHushSpawnClear(new THREE.Vector3(0, 0, 0))).toBe(false);
    } finally {
      physics.dispose();
    }
  });

  it('rejects a spawn with insufficient clearance for the full model', async () => {
    const physics = await makeFloor();
    try {
      physics.addBox({ x: 0, y: 2.35, z: 0 }, { x: 0.6, y: 0.1, z: 0.6 });
      physics.step();
      expect(physics.capsuleFits({ x: 0, y: 0.93, z: 0 }, 0.34, 0.56)).toBe(true);
      expect(physics.isHushSpawnClear(new THREE.Vector3(0, 0, 0))).toBe(false);
    } finally {
      physics.dispose();
    }
  });

  it('uses a clear alternative when the primary spawn is blocked', async () => {
    const physics = await makeFloor();
    try {
      physics.addBox({ x: 0, y: 1, z: 0 }, { x: 0.5, y: 1, z: 0.5 });
      physics.step();
      expect(physics.isHushSpawnClear(new THREE.Vector3(4, 0, 0))).toBe(true);
      const spawn = findAvailableHushSpawn(
        [new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0, 0)],
        new THREE.Vector3(20, 0, 20),
        (candidate) => physics.isHushSpawnClear(candidate),
      );
      expect(spawn?.x).toBe(4);
    } finally {
      physics.dispose();
    }
  });

  it('does not respawn when all configured locations are blocked', async () => {
    const physics = await makeFloor();
    try {
      const candidates = [HUSH_AI_CONFIG.respawn, ...HUSH_AI_CONFIG.respawnAlternatives];
      for (const candidate of candidates) {
        physics.addBox(
          { x: candidate.x, y: 1, z: candidate.z },
          { x: 0.5, y: 1, z: 0.5 },
        );
      }
      physics.step();
      const spawn = findAvailableHushSpawn(
        candidates,
        new THREE.Vector3(30, 0, 30),
        (candidate) => physics.isHushSpawnClear(candidate),
      );
      expect(spawn).toBeNull();
    } finally {
      physics.dispose();
    }
  });

  it('waits without respawning when every candidate is blocked', () => {
    const hush = new HushAI(new EventBus<GameEvents>());
    hush.takeDamage(100);
    for (let i = 0; i < 61; i++) hush.update(1, new THREE.Vector3(20, 0, 20), false, false, false, () => false);
    expect(hush.state).toBe('dead');
    expect(hush.health).toBe(0);
  });

  it('does not choose a spawn directly on top of the player', () => {
    const player = new THREE.Vector3(4, 0, 5);
    expect(findAvailableHushSpawn([player], player, () => true)).toBeNull();
  });

});

describe('Hush navigation and presentation', () => {
  const start = new THREE.Vector3(-2, 0, 0);
  const target = new THREE.Vector3(2, 0, 0);
  const blockedWall = (point: THREE.Vector3) =>
    point.x > -0.3 && point.x < 0.3 && point.z > -2.2 && point.z < 2.2;

  it('routes around an obstacle wall to an investigation target', () => {
    const route = findGridPath(start, target, (point) => !blockedWall(point));
    expect(route.length).toBeGreaterThan(2);
    expect(route.every((point) => !blockedWall(point))).toBe(true);
    expect(route[route.length - 1].distanceTo(target)).toBeLessThan(1.5);
    const position = start.clone();
    const step = 1.65 / 60;
    let routeIndex = 0;
    for (let frame = 0; frame < 3000 && position.distanceTo(target) > 0.5; frame++) {
      while (routeIndex < route.length && position.distanceTo(route[routeIndex]) < 0.28) routeIndex++;
      const waypoint = route[routeIndex] ?? target;
      const direction = waypoint.clone().sub(position).setY(0).normalize();
      position.addScaledVector(direction, Math.min(step, position.distanceTo(waypoint)));
    }
    expect(position.distanceTo(target)).toBeLessThan(1.5);
  });

  it('returns a reachable partial route when a closed boundary separates the target', () => {
    const route = findGridPath(start, target, (point) => point.x < -0.5);
    expect(route.length).toBeGreaterThan(0);
    expect(route.every((point) => point.x < -0.5)).toBe(true);
    expect(route[route.length - 1].distanceTo(target)).toBeLessThan(start.distanceTo(target));
  });

  it('recovers route planning after a target is moved', () => {
    const first = findGridPath(start, target, (point) => !blockedWall(point));
    const movedTarget = new THREE.Vector3(2, 0, 3.5);
    const second = findGridPath(start, movedTarget, (point) => !blockedWall(point));
    expect(first).not.toEqual(second);
    expect(second[second.length - 1].distanceTo(movedTarget)).toBeLessThan(1.5);
  });

  it('animates death into disappearance', () => {
    const presentation = new HushPresentation();
    presentation.beginDeath();
    const falling = presentation.update(0.55);
    expect(falling.phase).toBe('death');
    expect(falling.fall).toBeGreaterThan(0);
    presentation.update(0.65);
    const vanishing = presentation.update(0.45);
    expect(vanishing.phase).toBe('vanish');
    expect(vanishing.opacity).toBeLessThan(1);
    const hidden = presentation.update(0.5);
    expect(hidden.visible).toBe(false);
  });

  it('plays a visible respawn effect and returns to idle presentation', () => {
    const presentation = new HushPresentation();
    presentation.beginRespawn();
    const effect = presentation.update(0.6);
    expect(effect.phase).toBe('respawn');
    expect(effect.effectOpacity).toBeGreaterThan(0);
    expect(effect.scale).toBeGreaterThan(0.15);
    expect(presentation.update(0.61).phase).toBe('idle');
  });

  it('creates a scene-attached Hush model and carries it through death and respawn', async () => {
    const physics = await PhysicsWorld.create();
    const materials = new MaterialLibrary(8, 1);
    const scene = new THREE.Scene();
    const actor = new ListenerActor(scene, materials, physics);
    try {
      expect(actor.root.parent).toBe(scene);
      expect(actor.modelCreated).toBe(true);
      expect(actor.modelVisible).toBe(false);
      actor.rigVisibleForAI();
      expect(actor.modelVisible).toBe(true);

      actor.beginDeath();
      actor.updatePresentation(0.55);
      expect(actor.root.rotation.z).toBeGreaterThan(0);
      actor.updatePresentation(1.5);
      expect(actor.visible).toBe(false);

      actor.beginRespawn(new THREE.Vector3(-12.5, 0, 6.2));
      actor.updatePresentation(0.6);
      expect(actor.modelVisible).toBe(true);
      expect(actor.position.toArray()).toEqual([-12.5, 0, 6.2]);
      actor.updatePresentation(0.61);
      expect(actor.collider?.isEnabled()).toBe(true);
    } finally {
      actor.dispose();
      materials.dispose();
      physics.dispose();
    }
  });

  it('returns the physical actor to its AI position after a scripted appearance', async () => {
    const physics = await PhysicsWorld.create();
    const materials = new MaterialLibrary(8, 1);
    const scene = new THREE.Scene();
    const aiPosition = new THREE.Vector3(-8, 0, 6.2);
    physics.addBox({ x: 0, y: -0.1, z: 0 }, { x: 25, y: 0.1, z: 25 });
    physics.step();
    const actor = new ListenerActor(scene, materials, physics, aiPosition);
    try {
      actor.appear([3.5, 4.3, 20.3], true, 0.05);
      actor.update(0.06, new THREE.Vector3(), 0);
      expect(actor.scriptedControl).toBe(false);
      expect(actor.visible).toBe(false);

      actor.resumeAIAt(aiPosition);
      physics.step();
      const body = actor.collider?.translation();
      expect(actor.position.toArray()).toEqual(aiPosition.toArray());
      expect(actor.visible).toBe(true);
      expect(actor.scriptedControl).toBe(false);
      expect(body?.x).toBeCloseTo(aiPosition.x, 3);
      expect(body?.y).toBeCloseTo(aiPosition.y + 0.9, 3);
      expect(body?.z).toBeCloseTo(aiPosition.z, 3);
    } finally {
      actor.dispose();
      materials.dispose();
      physics.dispose();
    }
  });

  it('returns to patrol after a validated respawn with full health', () => {
    const hush = new HushAI(new EventBus<GameEvents>());
    hush.takeDamage(100);
    hush.update(60, new THREE.Vector3(20, 0, 20), false, false, false, () => true);
    expect(hush.state).toBe('patrol');
    expect(hush.health).toBe(100);
  });

  it('physically moves toward a heard position around a Rapier wall', async () => {
    const physics = await PhysicsWorld.create();
    const materials = new MaterialLibrary(8, 1);
    const scene = new THREE.Scene();
    physics.addBox({ x: 0, y: -0.1, z: 20 }, { x: 25, y: 0.1, z: 30 });
    physics.addBox({ x: -8, y: 1.5, z: 23.6 }, { x: 0.18, y: 1.5, z: 3 });
    physics.step();
    const actor = new ListenerActor(scene, materials, physics);
    const bus = new EventBus<GameEvents>();
    const hush = new HushAI(bus, actor.position.clone());
    const target = new THREE.Vector3(...LEVEL.start.pos);
    const start = actor.position.clone();
    let closestDistance = start.distanceTo(target);
    try {
      expect(hush.hearSound({ position: target, intensity: 1, type: 'footstep', timestamp: 1 })).toBe(true);
      for (let frame = 0; frame < 2400 && hush.state === 'investigate'; frame++) {
        physics.step();
        const speed = hush.state === 'investigate' ? HUSH_AI_CONFIG.investigateSpeed : 0;
        const blocked = actor.updateAI(1 / 60, hush.movementTarget, target, physics, speed, hush.navigationRevision, hush.state);
        hush.position.copy(actor.position);
        closestDistance = Math.min(closestDistance, actor.position.distanceTo(target));
        hush.noteMovementBlocked(1 / 60, blocked);
        hush.update(1 / 60, target, false);
      }
      expect(actor.position.distanceTo(start)).toBeGreaterThan(2);
      expect(actor.position.distanceTo(target)).toBeLessThan(HUSH_AI_CONFIG.arriveDistance + 0.35);
      expect(closestDistance).toBeLessThan(start.distanceTo(target) - 4);
      expect(hush.state).toBe('search');
      expect(actor.modelVisible).toBe(true);
      scene.updateMatrixWorld(true);
      expect(actor.modelRoot.getWorldPosition(new THREE.Vector3()).distanceTo(actor.position)).toBeLessThan(0.001);
    } finally {
      actor.dispose();
      materials.dispose();
      physics.dispose();
    }
  });

  it('excludes Hush and the player from sight rays while keeping walls and weapon hits', async () => {
    const physics = await PhysicsWorld.create();
    const target = physics.createCharacter(0.34, 0.56, { x: 0, y: 0.9, z: 5 });
    const actor = physics.createCharacter(0.34, 0.56, { x: 0, y: 0.9, z: 3 });
    const wall = physics.addBox({ x: 0, y: 0.9, z: 2 }, { x: 1, y: 1, z: 0.1 });
    const hush = new HushAI(new EventBus<GameEvents>());
    try {
      physics.step();
      let hit = physics.castRayHit({ x: 0, y: 0.9, z: 0 }, { x: 0, y: 0, z: 1 }, 10);
      expect(hit?.collider.handle).toBe(wall.handle);
      expect(hush.health).toBe(100);

      physics.removeCollider(wall);
      physics.step();
      hit = physics.castRayHit({ x: 0, y: 0.9, z: 0 }, { x: 0, y: 0, z: 1 }, 10);
      expect(hit?.collider).toBe(actor.collider);

      // Hush's sight ray ignores its own collider and the player's collider, but
      // still sees any world geometry between them.
      hit = physics.castRayHit(
        { x: 0, y: 0.9, z: 0 },
        { x: 0, y: 0, z: 1 },
        10,
        actor.collider,
        target.collider,
      );
      expect(hit).toBeNull();

      const secondWall = physics.addBox({ x: 0, y: 0.9, z: 2 }, { x: 1, y: 1, z: 0.1 });
      physics.step();
      hit = physics.castRayHit(
        { x: 0, y: 0.9, z: 0 },
        { x: 0, y: 0, z: 1 },
        10,
        actor.collider,
        target.collider,
      );
      expect(hit?.collider).toBe(secondWall);
      expect(hit?.collider).not.toBe(actor.collider);

      physics.removeCollider(actor.collider);
      physics.removeCollider(secondWall);
      physics.step();
      hit = physics.castRayHit({ x: 0, y: 0.9, z: 0 }, { x: 0, y: 0, z: 1 }, 10);
      expect(hit?.collider).toBe(target.collider);
      if (hit?.collider === target.collider) hush.takeDamage(25);
      expect(hush.health).toBe(75);
    } finally {
      physics.dispose();
    }
  });

  it('uses the capsule sweep to route around low obstacles a sight-height ray misses', async () => {
    const physics = await PhysicsWorld.create();
    const materials = new MaterialLibrary(8, 1);
    const scene = new THREE.Scene();
    physics.addBox({ x: 0, y: -0.1, z: 0 }, { x: 10, y: 0.1, z: 10 });
    physics.addBox({ x: 0, y: 0.3, z: 0 }, { x: 0.55, y: 0.3, z: 0.55 });
    physics.step();
    const actor = new ListenerActor(scene, materials, physics, new THREE.Vector3(-2, 0, 0));
    const target = new THREE.Vector3(2, 0, 0);
    try {
      expect(physics.castRay({ x: -2, y: 0.95, z: 0 }, { x: 1, y: 0, z: 0 }, 4, actor.collider ?? undefined)).toBeNull();
      expect(
        physics.castCapsule(
          { x: -2, y: 0.95, z: 0 },
          { x: 1, y: 0, z: 0 },
          0.34,
          0.56,
          4,
          actor.collider ?? undefined,
        ),
      ).not.toBeNull();

      for (let frame = 0; frame < 2400 && actor.position.distanceTo(target) > 0.6; frame++) {
        physics.step();
        actor.updateAI(1 / 60, target, target, physics, 1.65, 0, 'investigate');
      }
      expect(actor.position.distanceTo(new THREE.Vector3(-2, 0, 0))).toBeGreaterThan(2);
      expect(actor.position.distanceTo(target)).toBeLessThan(1.1);
    } finally {
      actor.dispose();
      materials.dispose();
      physics.dispose();
    }
  });
});
