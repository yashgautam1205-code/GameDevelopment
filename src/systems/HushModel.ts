import * as THREE from 'three';
import type { HushAIState } from './HushAI';

type HushMotion = HushAIState | 'idle';

function mesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: THREE.Vector3,
  scale?: THREE.Vector3,
): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material);
  part.position.copy(position);
  if (scale) part.scale.copy(scale);
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}

export class HushModel {
  readonly root = new THREE.Group();
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x343a3b,
    emissive: 0x080c0e,
    emissiveIntensity: 0.45,
    roughness: 0.94,
  });
  private readonly limbMaterial = new THREE.MeshStandardMaterial({
    color: 0x252a2c,
    emissive: 0x070a0c,
    emissiveIntensity: 0.4,
    roughness: 0.98,
  });
  private readonly eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xc3eeeb });
  private readonly materials: THREE.Material[] = [this.bodyMaterial, this.limbMaterial, this.eyeMaterial];
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly legs: THREE.Group[] = [];
  private elapsed = 0;

  constructor(parent: THREE.Object3D) {
    this.root.name = 'hush-creature-model';
    parent.add(this.root);
    this.root.add(this.torso);

    mesh(
      this.torso,
      new THREE.CapsuleGeometry(0.17, 0.62, 5, 8),
      this.bodyMaterial,
      new THREE.Vector3(0, 1.35, 0),
      new THREE.Vector3(1, 1, 0.78),
    );
    mesh(
      this.torso,
      new THREE.SphereGeometry(0.2, 10, 8),
      this.limbMaterial,
      new THREE.Vector3(0, 0.99, 0),
      new THREE.Vector3(0.9, 0.72, 0.8),
    );
    mesh(
      this.torso,
      new THREE.CylinderGeometry(0.075, 0.09, 0.2, 8),
      this.limbMaterial,
      new THREE.Vector3(0, 1.72, 0),
    );

    this.head.position.set(0, 1.99, 0);
    this.torso.add(this.head);
    mesh(
      this.head,
      new THREE.SphereGeometry(0.24, 12, 10),
      this.bodyMaterial,
      new THREE.Vector3(0, 0.02, 0),
      new THREE.Vector3(0.96, 1.16, 0.84),
    );
    mesh(
      this.head,
      new THREE.SphereGeometry(0.028, 8, 6),
      this.eyeMaterial,
      new THREE.Vector3(-0.085, 0.045, -0.188),
    );
    mesh(
      this.head,
      new THREE.SphereGeometry(0.028, 8, 6),
      this.eyeMaterial,
      new THREE.Vector3(0.085, 0.045, -0.188),
    );
    mesh(
      this.head,
      new THREE.BoxGeometry(0.11, 0.018, 0.012),
      this.limbMaterial,
      new THREE.Vector3(0, -0.105, -0.194),
    );

    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.22, 1.58, 0);
      this.torso.add(arm);
      mesh(
        arm,
        new THREE.CapsuleGeometry(0.066, 0.5, 4, 7),
        this.limbMaterial,
        new THREE.Vector3(0, -0.28, 0),
      );
      const forearm = new THREE.Group();
      forearm.position.y = -0.55;
      arm.add(forearm);
      mesh(
        forearm,
        new THREE.CapsuleGeometry(0.055, 0.54, 4, 7),
        this.limbMaterial,
        new THREE.Vector3(0, -0.3, 0),
      );
      mesh(
        forearm,
        new THREE.SphereGeometry(0.07, 8, 6),
        this.bodyMaterial,
        new THREE.Vector3(0, -0.62, -0.015),
        new THREE.Vector3(0.8, 1.35, 0.7),
      );
      this.arms.push(arm);

      const leg = new THREE.Group();
      leg.position.set(side * 0.105, 0.98, 0);
      this.root.add(leg);
      mesh(
        leg,
        new THREE.CapsuleGeometry(0.08, 0.38, 4, 7),
        this.limbMaterial,
        new THREE.Vector3(0, -0.18, 0),
      );
      const shin = new THREE.Group();
      shin.position.y = -0.44;
      leg.add(shin);
      mesh(
        shin,
        new THREE.CapsuleGeometry(0.06, 0.58, 4, 7),
        this.limbMaterial,
        new THREE.Vector3(0, -0.19, 0),
      );
      mesh(
        shin,
        new THREE.SphereGeometry(0.085, 8, 6),
        this.bodyMaterial,
        new THREE.Vector3(0, -0.49, -0.055),
        new THREE.Vector3(0.8, 0.65, 1.5),
      );
      this.legs.push(leg);
    }
  }

  get visible(): boolean {
    return this.root.visible && this.root.parent?.visible === true;
  }

  update(dt: number, speed: number, state: HushMotion = 'idle'): void {
    this.elapsed += dt;
    const moving = speed > 0.12;
    const gait = moving ? Math.min(speed / 2.55, 1) : 0;
    const phase = this.elapsed * (moving ? 3.8 + speed * 1.35 : 1.15);
    const stride = Math.sin(phase) * gait;
    const attack = state === 'attack' ? 1 : 0;
    const investigate = state === 'investigate' ? 1 : 0;

    this.torso.position.y = Math.sin(this.elapsed * 1.15) * 0.018 + gait * Math.abs(stride) * 0.025;
    this.torso.rotation.x = -gait * 0.12 - attack * 0.3;
    this.torso.rotation.z = Math.sin(this.elapsed * 0.68) * 0.018;
    this.head.rotation.y = Math.sin(this.elapsed * 0.82) * 0.075 + investigate * Math.sin(this.elapsed * 1.4) * 0.1;
    this.head.rotation.x = attack * -0.12;

    for (let i = 0; i < this.legs.length; i++) {
      this.legs[i].rotation.x = (i === 0 ? 1 : -1) * stride * 0.58;
    }
    for (let i = 0; i < this.arms.length; i++) {
      this.arms[i].rotation.x = (i === 0 ? -1 : 1) * stride * 0.48 - attack * 0.85;
      this.arms[i].rotation.z = (i === 0 ? 1 : -1) * attack * 0.34;
    }
  }

  setOpacity(opacity: number): void {
    const alpha = THREE.MathUtils.clamp(opacity, 0, 1);
    for (const material of this.materials) {
      material.transparent = alpha < 1;
      material.opacity = alpha;
      material.depthWrite = alpha >= 1;
    }
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    for (const material of this.materials) material.dispose();
    this.root.removeFromParent();
  }
}
