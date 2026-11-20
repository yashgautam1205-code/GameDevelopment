import * as THREE from 'three';

const metal = new THREE.MeshStandardMaterial({
  color: 0x252c30,
  metalness: 0.86,
  roughness: 0.28,
});
const gripMaterial = new THREE.MeshStandardMaterial({
  color: 0x111719,
  metalness: 0.38,
  roughness: 0.72,
});
const emitterMaterial = new THREE.MeshStandardMaterial({
  color: 0x4abfc4,
  emissive: 0x168b91,
  emissiveIntensity: 1.8,
  metalness: 0.35,
  roughness: 0.22,
});
const flashMaterial = new THREE.MeshBasicMaterial({
  color: 0xb7ffff,
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

function box(
  parent: THREE.Object3D,
  geometry: THREE.BoxGeometry,
  material: THREE.Material,
  position: THREE.Vector3,
  rotation?: THREE.Euler,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  if (rotation) mesh.rotation.copy(rotation);
  mesh.renderOrder = 20;
  parent.add(mesh);
  return mesh;
}

export class EnergyWeaponView {
  readonly root = new THREE.Group();
  private flash: THREE.Mesh;
  private flashLight: THREE.PointLight;
  private flashRemaining = 0;
  private clock = 0;
  private disposed = false;

  constructor(private parent: THREE.Object3D) {
    this.root.name = 'energy-weapon-view';
    this.root.visible = false;
    this.root.position.set(0.27, 0.88, 0.12);
    this.root.rotation.set(-0.18, 0.08, 0.22);
    this.root.scale.setScalar(0.72);

    box(this.root, new THREE.BoxGeometry(0.17, 0.115, 0.3), metal, new THREE.Vector3(0, 0, 0));
    box(this.root, new THREE.BoxGeometry(0.105, 0.075, 0.28), gripMaterial, new THREE.Vector3(0, -0.015, 0.025));
    box(this.root, new THREE.BoxGeometry(0.087, 0.075, 0.28), metal, new THREE.Vector3(0, 0.015, -0.245));
    box(this.root, new THREE.BoxGeometry(0.105, 0.13, 0.13), metal, new THREE.Vector3(0, 0.02, -0.08));
    box(
      this.root,
      new THREE.BoxGeometry(0.095, 0.19, 0.105),
      gripMaterial,
      new THREE.Vector3(0, -0.12, 0.065),
      new THREE.Euler(-0.28, 0, 0),
    );
    box(this.root, new THREE.BoxGeometry(0.135, 0.024, 0.17), emitterMaterial, new THREE.Vector3(0, 0.068, -0.16));
    box(this.root, new THREE.BoxGeometry(0.012, 0.026, 0.11), emitterMaterial, new THREE.Vector3(0.092, 0.005, -0.18));
    box(this.root, new THREE.BoxGeometry(0.012, 0.026, 0.11), emitterMaterial, new THREE.Vector3(-0.092, 0.005, -0.18));
    box(this.root, new THREE.BoxGeometry(0.11, 0.023, 0.11), gripMaterial, new THREE.Vector3(0, -0.052, -0.04));

    const muzzle = new THREE.Group();
    muzzle.position.set(0, 0.02, -0.39);
    this.root.add(muzzle);
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 8), flashMaterial);
    this.flash.scale.set(0.75, 0.75, 1.8);
    this.flash.renderOrder = 22;
    this.flash.visible = false;
    muzzle.add(this.flash);
    this.flashLight = new THREE.PointLight(0x69e9ff, 0, 1.8, 2);
    muzzle.add(this.flashLight);

    this.parent.add(this.root);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  get firingEffectActive(): boolean {
    return this.flash.visible;
  }

  fire(): void {
    this.flashRemaining = 0.11;
    this.flash.visible = true;
    this.flashLight.intensity = 5;
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.clock += dt;
    this.root.position.y = 0.88 + Math.sin(this.clock * 1.7) * 0.003;
    if (this.flashRemaining <= 0) return;
    this.flashRemaining = Math.max(0, this.flashRemaining - dt);
    const alpha = this.flashRemaining / 0.11;
    this.flashMaterialOpacity(alpha);
    this.flashLight.intensity = alpha * 5;
    this.flash.visible = alpha > 0;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.parent.remove(this.root);
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    for (const material of [metal, gripMaterial, emitterMaterial, flashMaterial]) material.dispose();
    this.flashLight.dispose();
  }

  private flashMaterialOpacity(alpha: number): void {
    flashMaterial.opacity = alpha * 0.9;
  }
}
