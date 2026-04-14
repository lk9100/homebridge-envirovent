import type { CharacteristicValue, Service } from 'homebridge';
import type { EnviroventAccessory } from '../accessory.js';

/**
 * Fanv2 service — main fan control with airflow speed slider.
 *
 * HomeKit's RotationSpeed slider runs 0-100% (standard full range).
 * We map it linearly to the unit's acceptable range (e.g. 24-100%):
 *
 *   HK 0%   → unit varMin (24%)
 *   HK 100% → unit varMax (100%)
 *
 * PIV units are always physically on — the Active characteristic always
 * reports 1. Tapping "off" pushes Active back to 1 and sets the fan to
 * minimum speed (HK 1%).
 */
export class FanService {
  private readonly service: Service;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private readonly varMin: number;
  private readonly varMax: number;

  /**
   * Cached HK slider value from the last user-initiated set. Returned by
   * getRotationSpeed as long as the polled unit value matches what we sent
   * (within ±1 rounding tolerance). This eliminates slider drift caused
   * by the lossy HK↔unit round-trip.
   *
   * Cleared when a poll shows the unit's value has diverged (external change).
   */
  private _cachedHK: number | null = null;
  private _lastSentUnit: number | null = null;

  constructor(private readonly accessory: EnviroventAccessory) {
    const platform = accessory.platform;
    const settings = accessory.unitState.settings;

    // Use the unit's real range, or sensible defaults before first poll
    this.varMin = settings?.airflowConfiguration.varMinPercentage ?? 24;
    this.varMax = settings?.airflowConfiguration.maxPercentage ?? 100;

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
    this.service.updateCharacteristic(platform.Characteristic.Active, 1);
    this.service.updateCharacteristic(platform.Characteristic.RotationSpeed, this.getRotationSpeed());
    this.service.updateCharacteristic(platform.Characteristic.CurrentFanState, this.getCurrentFanState());
  }

  // ─── Mapping helpers ──────────────────────────────────────────────

  /** Convert a unit percentage (24-100) to a HomeKit percentage (0-100). */
  private unitToHK(unitPercent: number): number {
    const clamped = Math.max(this.varMin, Math.min(this.varMax, unitPercent));
    return Math.round(((clamped - this.varMin) / (this.varMax - this.varMin)) * 100);
  }

  /** Convert a HomeKit percentage (0-100) to a unit percentage (24-100). */
  private hkToUnit(hkPercent: number): number {
    const clamped = Math.max(0, Math.min(100, hkPercent));
    return Math.round(this.varMin + (clamped / 100) * (this.varMax - this.varMin));
  }

  // ─── Characteristic handlers ──────────────────────────────────────

  private getActive(): CharacteristicValue {
    return 1;
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    // PIV units cannot turn off. Push Active=1 back after HAP finishes the
    // SET, and set RotationSpeed=1 (HK 1% = minimum, not 0% which implies off).
    setTimeout(() => {
      this.service.updateCharacteristic(this.accessory.platform.Characteristic.Active, 1);
      this.service.updateCharacteristic(this.accessory.platform.Characteristic.RotationSpeed, 1);
    }, 50);

    if (value === 0) {
      this._cachedHK = 1;
      this._lastSentUnit = this.varMin;
      const settings = this.accessory.unitState.settings;
      if (settings) {
        this.accessory.platform.log.info('PIV unit cannot turn off. Setting to minimum airflow (1%).');
        this.sendAirflowUpdate(this.varMin, settings);
      }
    }
  }

  private getRotationSpeed(): CharacteristicValue {
    const settings = this.accessory.unitState.settings;
    if (!settings) return this._cachedHK ?? 0;

    // Resolve the unit's current airflow percentage
    let unitPercent: number;
    if (settings.airflow.mode === 'VAR') {
      unitPercent = settings.airflow.value;
    } else {
      const map = settings.airflowConfiguration.maps.find((m) => m.mark === settings.airflow.value);
      unitPercent = map ? map.percent : this.varMin;
    }

    // If we have a cached HK value and the unit still matches what we sent
    // (within ±1 rounding tolerance), return the cached value to avoid drift.
    // If the unit's value diverged, an external change happened — clear cache.
    if (this._cachedHK !== null && this._lastSentUnit !== null) {
      if (Math.abs(unitPercent - this._lastSentUnit) <= 1) {
        return this._cachedHK;
      }
      this._cachedHK = null;
      this._lastSentUnit = null;
    }

    return this.unitToHK(unitPercent);
  }

  private async setRotationSpeed(value: CharacteristicValue): Promise<void> {
    const hkPercent = value as number;
    const settings = this.accessory.unitState.settings;
    if (!settings) return;

    const unitPercent = this.hkToUnit(hkPercent);

    // Cache the HK value so getRotationSpeed returns it exactly,
    // avoiding drift from the lossy HK→unit→HK round-trip.
    this._cachedHK = hkPercent;
    this._lastSentUnit = unitPercent;

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
}
