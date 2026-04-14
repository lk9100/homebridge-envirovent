import type { CharacteristicValue, Service } from 'homebridge';
import type { EnviroventAccessory } from '../accessory.js';

/**
 * Fanv2 service — main fan control with airflow speed slider.
 *
 * Maps RotationSpeed to the unit's VAR mode percentage.
 * The unit's VAR range (e.g. 24-100%) is mapped to HomeKit's 0-100%.
 *
 * PIV units are always physically on — the Active characteristic always
 * reports 1, and tapping "off" sets the fan to minimum speed instead.
 */
export class FanService {
  private readonly service: Service;
  private debounceTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly accessory: EnviroventAccessory) {
    const platform = accessory.platform;

    this.service =
      accessory.accessory.getService(platform.Service.Fanv2) ??
      accessory.accessory.addService(platform.Service.Fanv2, 'Fan');

    this.service
      .getCharacteristic(platform.Characteristic.Active)
      .onGet(() => this.getActive())
      .onSet((value) => this.setActive(value));

    this.service
      .getCharacteristic(platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => this.getRotationSpeed())
      .onSet((value) => this.setRotationSpeed(value));

    this.service
      .getCharacteristic(platform.Characteristic.CurrentFanState)
      .onGet(() => this.getCurrentFanState());
  }

  update(): void {
    const platform = this.accessory.platform;
    // Always report as active — the unit physically never turns off
    this.service.updateCharacteristic(platform.Characteristic.Active, 1);
    this.service.updateCharacteristic(platform.Characteristic.RotationSpeed, this.getRotationSpeed());
    this.service.updateCharacteristic(platform.Characteristic.CurrentFanState, this.getCurrentFanState());
  }

  private getActive(): CharacteristicValue {
    // PIV units are always on — always report active
    return 1;
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    if (value === 0) {
      // Can't turn off a PIV — set to minimum speed instead
      const settings = this.accessory.unitState.settings;
      if (settings) {
        const minPercent = settings.airflowConfiguration.varMinPercentage;
        this.accessory.platform.log.info(`PIV unit cannot turn off. Setting to minimum airflow (${minPercent}%).`);
        await this.sendAirflowUpdate(minPercent, settings);
      }
    }

    // Push Active back to 1 after a short delay so HomeKit's UI never shows
    // the grey "off" icon. The delay lets the onSet handler return first,
    // then we override HomeKit's cached state.
    setTimeout(() => {
      this.service.updateCharacteristic(this.accessory.platform.Characteristic.Active, 1);
    }, 100);
  }

  private getRotationSpeed(): CharacteristicValue {
    const settings = this.accessory.unitState.settings;
    if (!settings) return 0;

    const config = settings.airflowConfiguration;
    const currentValue = settings.airflow.value;

    if (settings.airflow.mode === 'VAR') {
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
    return Characteristic.CurrentFanState.BLOWING_AIR;
  }

  /**
   * Map unit percentage (within min-max range) to HomeKit 0-100%.
   * Uses Math.round for a stable round-trip: HomeKit → unit → HomeKit
   * returns the same value.
   */
  private unitPercentToHomeKit(unitValue: number, min: number, max: number): number {
    if (max <= min) return 50;
    const normalized = ((unitValue - min) / (max - min)) * 100;
    return Math.round(Math.max(0, Math.min(100, normalized)));
  }

  /**
   * Map HomeKit 0-100% to unit percentage (within min-max range).
   * Uses Math.round to match unitPercentToHomeKit, ensuring the
   * round-trip is stable (no drift on each poll cycle).
   */
  private homeKitToUnitPercent(homeKitValue: number, min: number, max: number): number {
    const unitValue = min + (homeKitValue / 100) * (max - min);
    return Math.round(Math.max(min, Math.min(max, unitValue)));
  }
}
