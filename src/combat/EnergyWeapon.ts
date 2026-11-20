export interface EnergyWeaponConfig {
  damage: number;
  maxEnergy: number;
  fireCost: number;
  cooldown: number;
  rechargePerSecond: number;
  range: number;
}

export const ENERGY_WEAPON_CONFIG: EnergyWeaponConfig = {
  damage: 25,
  maxEnergy: 100,
  fireCost: 20,
  cooldown: 0.6,
  rechargePerSecond: 8,
  range: 24,
};

export class EnergyWeapon {
  energy = ENERGY_WEAPON_CONFIG.maxEnergy;
  cooldownRemaining = 0;
  equipped = false;

  get isRecharging(): boolean {
    return this.energy < ENERGY_WEAPON_CONFIG.maxEnergy;
  }

  update(dt: number): void {
    if (this.cooldownRemaining > 0) this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    this.energy = Math.min(ENERGY_WEAPON_CONFIG.maxEnergy, this.energy + ENERGY_WEAPON_CONFIG.rechargePerSecond * dt);
  }

  setEquipped(equipped: boolean): void {
    this.equipped = equipped;
  }

  reset(): void {
    this.energy = ENERGY_WEAPON_CONFIG.maxEnergy;
    this.cooldownRemaining = 0;
    this.equipped = false;
  }

  canFire(): boolean {
    return this.equipped && this.cooldownRemaining <= 0 && this.energy >= ENERGY_WEAPON_CONFIG.fireCost;
  }

  fire(): boolean {
    if (!this.canFire()) return false;
    this.energy = Math.max(0, this.energy - ENERGY_WEAPON_CONFIG.fireCost);
    this.cooldownRemaining = ENERGY_WEAPON_CONFIG.cooldown;
    return true;
  }
}
