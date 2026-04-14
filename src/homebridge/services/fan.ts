import type { CharacteristicValue, Service } from 'homebridge';
import type { EnviroventAccessory } from '../accessory.js';

/**
 * Fanv2 service — main fan control with airflow speed slider.
 *
 * Maps RotationSpeed to the unit's VAR mode percentage.
 * The unit's min/max airflow percentages (from airflowConfiguration)
 * are mapped to HomeKit's 0-100% range.
 */
export class FanService {
  private readonly service: Service;
  private debounceTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly accessory: EnviroventAccessory) {
    const platform = accessory.platform;

    this.service =
      accessory.accessory.getService(platform.Service.Fanv2) ??
      accessory.accessory.addService(platform.Service.Fanv2, 'Fan');

    // Active characteristic — PIV units run 24/7 so this is mostly informational
    this.service
      .getCharacteristic(platform.Characteristic.Active)
      .onGet(() => this.getActive())
      .onSet((value) => this.setActive(value));

    // RotationSpeed — maps to airflow percentage
    this.service
      .getCharacteristic(platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => this.getRotationSpeed())
      .onSet((value) => this.setRotationSpeed(value));

    // CurrentFanState — read-only status
    this.service
      .getCharacteristic(platform.Characteristic.CurrentFanState)
      .onGet(() => this.getCurrentFanState());
  }

  update(): void {
    const platform = this.accessory.platform;
    this.service.updateCharacteristic(platform.Characteristic.Active, this.getActive());
    this.service.updateCharacteristic(platform.Characteristic.RotationSpeed, this.getRotationSpeed());
    this.service.updateCharacteristic(platform.Characteristic.CurrentFanState, this.getCurrentFanState());
  }

  private getActive(): CharacteristicValue {
    const settings = this.accessory.unitState.settings;
    if (!settings) return 0;
    // Active if airflow is active
    return settings.airflow.active ? 1 : 0;
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    const active = value === 1;
    if (!active) {
      // PIV units can't truly turn off — map "off" to the lowest airflow speed.
      const settings = this.accessory.unitState.settings;
      if (!settings) return;
      const minPercent = settings.airflowConfiguration.varMinPercentage;
      this.accessory.platform.log.info(`PIV unit cannot turn off. Setting to minimum airflow (${minPercent}%).`);
      await this.sendAirflowUpdate(minPercent, settings);
    }

    // The unit is always physically on — immediately reflect that in HomeKit
    // so the icon never renders as "off".
    this.service.updateCharacteristic(this.accessory.platform.Characteristic.Active, 1);
    this.service.updateCharacteristic(this.accessory.platform.Characteristic.RotationSpeed, 0);
  }

  private getRotationSpeed(): CharacteristicValue {
    const settings = this.accessory.unitState.settings;
    if (!settings) return 0;

    const config = settings.airflowConfiguration;
    const currentValue = settings.airflow.value;

    if (settings.airflow.mode === 'VAR') {
      // Map unit's VAR range (24-100%) to HomeKit's 0-100%
      return this.unitPercentToHomeKit(currentValue, config.varMinPercentage, config.maxPercentage);
    }

    // SET mode — find the percentage for the preset mark from airflow maps
    const map = config.maps.find((m) => m.mark === currentValue);
    if (map) {
      return this.unitPercentToHomeKit(map.percent, config.varMinPercentage, config.maxPercentage);
    }

    return 50; // Fallback
  }

  private async setRotationSpeed(value: CharacteristicValue): Promise<void> {
    const speed = value as number;
    const settings = this.accessory.unitState.settings;
    if (!settings) return;

    const config = settings.airflowConfiguration;
    const unitPercent = this.homeKitToUnitPercent(speed, config.varMinPercentage, config.maxPercentage);

    // Debounce rapid slider changes (300ms)
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.sendAirflowUpdate(unitPercent, settings);
    }, 300);
  }

  private async sendAirflowUpdate(unitPercent: number, currentSettings: typeof this.accessory.unitState.settings): Promise<void> {
    if (!currentSettings) return;

    try {
      await this.accessory.commandQueue.enqueue(() =>
        this.accessory.client.setHomeSettings({
          airflow: { mode: 'VAR', value: unitPercent },
          heater: { autoActive: currentSettings.heater.autoActive },
          boost: { mins: currentSettings.boost.mins },
          filter: { resetMonths: currentSettings.filter.resetMonths },
          summerBypass: { summerShutdown: currentSettings.summerBypass.summerShutdown },
        }),
      );

      // Optimistic update
      this.accessory.unitState.applyOptimistic({
        airflow: { mode: 'VAR', value: unitPercent, active: true },
      });
    } catch (err) {
      this.accessory.platform.log.error('Failed to set airflow:', err);
    }
  }

  private getCurrentFanState(): CharacteristicValue {
    const Characteristic = this.accessory.platform.Characteristic;
    const settings = this.accessory.unitState.settings;
    if (!settings || !this.accessory.unitState.connected) {
      return Characteristic.CurrentFanState.INACTIVE;
    }
    return settings.airflow.active
      ? Characteristic.CurrentFanState.BLOWING_AIR
      : Characteristic.CurrentFanState.IDLE;
  }

  /**
   * Map unit percentage (within min-max range) to HomeKit 0-100%.
   * E.g., if unit range is 20-100%, unit value 60% → HomeKit 50%.
   */
  private unitPercentToHomeKit(unitValue: number, min: number, max: number): number {
    if (max <= min) return 50;
    const normalized = ((unitValue - min) / (max - min)) * 100;
    return Math.round(Math.max(0, Math.min(100, normalized)));
  }

  /**
   * Map HomeKit 0-100% to unit percentage (within min-max range).
   * Uses Math.floor so that low slider values (e.g. 1%) clamp to the unit's
   * minimum (24%) rather than rounding up to 25%.
   */
  private homeKitToUnitPercent(homeKitValue: number, min: number, max: number): number {
    if (homeKitValue >= 100) return max;
    const unitValue = min + (homeKitValue / 100) * (max - min);
    return Math.floor(Math.max(min, Math.min(max, unitValue)));
  }
}
