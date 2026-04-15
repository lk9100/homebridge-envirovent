import type { CharacteristicValue, Service } from 'homebridge';
import type { EnviroventAccessoryContext } from '../accessory.js';

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
export const createFanService = (ctx: EnviroventAccessoryContext) => {
  const { platform, accessory, client, commandQueue, unitState } = ctx;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const settings = unitState.settings;
  // Use the unit's real range, or sensible defaults before first poll
  const varMin = settings?.airflowConfiguration.varMinPercentage ?? 24;
  const varMax = settings?.airflowConfiguration.maxPercentage ?? 100;

  /**
   * Cached HK slider value from the last user-initiated set. Returned by
   * getRotationSpeed as long as the polled unit value matches what we sent
   * (within ±1 rounding tolerance). This eliminates slider drift caused
   * by the lossy HK↔unit round-trip.
   *
   * Cleared when a poll shows the unit's value has diverged (external change).
   */
  let _cachedHK: number | null = null;
  let _lastSentUnit: number | null = null;

  const service: Service =
    accessory.getService(platform.Service.Fanv2) ??
    accessory.addService(platform.Service.Fanv2, 'Fan');

  // ─── Mapping helpers ──────────────────────────────────────────────

  /** Convert a unit percentage (24-100) to a HomeKit percentage (0-100). */
  const unitToHK = (unitPercent: number): number => {
    const clamped = Math.max(varMin, Math.min(varMax, unitPercent));
    return Math.round(((clamped - varMin) / (varMax - varMin)) * 100);
  };

  /** Convert a HomeKit percentage (0-100) to a unit percentage (24-100). */
  const hkToUnit = (hkPercent: number): number => {
    const clamped = Math.max(0, Math.min(100, hkPercent));
    return Math.round(varMin + (clamped / 100) * (varMax - varMin));
  };

  // ─── Characteristic handlers ──────────────────────────────────────

  const getActive = (): CharacteristicValue => 1;

  const setActive = async (value: CharacteristicValue): Promise<void> => {
    // PIV units cannot turn off. Push Active=1 back after HAP finishes the
    // SET, and set RotationSpeed=1 (HK 1% = minimum, not 0% which implies off).
    setTimeout(() => {
      service.updateCharacteristic(platform.Characteristic.Active, 1);
      service.updateCharacteristic(platform.Characteristic.RotationSpeed, 1);
    }, 50);

    if (value === 0) {
      _cachedHK = 1;
      _lastSentUnit = varMin;
      const currentSettings = unitState.settings;
      if (currentSettings) {
        platform.log.info('PIV unit cannot turn off. Setting to minimum airflow (1%).');
        void sendAirflowUpdate(varMin, currentSettings);
      }
    }
  };

  const getRotationSpeed = (): CharacteristicValue => {
    const currentSettings = unitState.settings;
    if (!currentSettings) return _cachedHK ?? 0;

    // Resolve the unit's current airflow percentage
    let unitPercent: number;
    if (currentSettings.airflow.mode === 'VAR') {
      unitPercent = currentSettings.airflow.value;
    } else {
      const map = currentSettings.airflowConfiguration.maps.find((m) => m.mark === currentSettings.airflow.value);
      unitPercent = map ? map.percent : varMin;
    }

    // If we have a cached HK value and the unit still matches what we sent
    // (within ±1 rounding tolerance), return the cached value to avoid drift.
    // If the unit's value diverged, an external change happened — clear cache.
    if (_cachedHK !== null && _lastSentUnit !== null) {
      if (Math.abs(unitPercent - _lastSentUnit) <= 1) {
        return _cachedHK;
      }
      _cachedHK = null;
      _lastSentUnit = null;
    }

    return unitToHK(unitPercent);
  };

  const setRotationSpeed = async (value: CharacteristicValue): Promise<void> => {
    const hkPercent = value as number;
    const currentSettings = unitState.settings;
    if (!currentSettings) return;

    const unitPercent = hkToUnit(hkPercent);

    // Cache the HK value so getRotationSpeed returns it exactly,
    // avoiding drift from the lossy HK→unit→HK round-trip.
    _cachedHK = hkPercent;
    _lastSentUnit = unitPercent;

    // Debounce rapid slider changes (300ms)
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void sendAirflowUpdate(unitPercent, currentSettings);
    }, 300);
  };

  const sendAirflowUpdate = async (unitPercent: number, currentSettings: NonNullable<typeof unitState.settings>): Promise<void> => {
    if (!currentSettings) return;

    try {
      await commandQueue.enqueue(async () =>
        client.setHomeSettings({
          airflow: { mode: 'VAR', value: unitPercent },
          heater: { autoActive: currentSettings.heater.autoActive },
          boost: { mins: currentSettings.boost.mins },
          filter: { resetMonths: currentSettings.filter.resetMonths },
          summerBypass: { summerShutdown: currentSettings.summerBypass.summerShutdown },
        }),
      );

      // Optimistic update
      unitState.applyOptimistic({
        airflow: { mode: 'VAR', value: unitPercent, active: true },
      });
    } catch (err) {
      platform.log.error('Failed to set airflow:', err);
    }
  };

  const getCurrentFanState = (): CharacteristicValue => {
    const Characteristic = platform.Characteristic;
    const currentSettings = unitState.settings;
    if (!currentSettings || !unitState.connected) {
      return Characteristic.CurrentFanState.INACTIVE;
    }
    return Characteristic.CurrentFanState.BLOWING_AIR;
  };

  // ─── Register HAP handlers ────────────────────────────────────────

  service
    .getCharacteristic(platform.Characteristic.Active)
    .onGet(() => getActive())
    .onSet(async (value) => setActive(value));

  service
    .getCharacteristic(platform.Characteristic.RotationSpeed)
    .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
    .onGet(() => getRotationSpeed())
    .onSet(async (value) => setRotationSpeed(value));

  service
    .getCharacteristic(platform.Characteristic.CurrentFanState)
    .onGet(() => getCurrentFanState());

  // ─── Public API ───────────────────────────────────────────────────

  const update = (): void => {
    service.updateCharacteristic(platform.Characteristic.Active, 1);
    service.updateCharacteristic(platform.Characteristic.RotationSpeed, getRotationSpeed());
    service.updateCharacteristic(platform.Characteristic.CurrentFanState, getCurrentFanState());
  };

  const dispose = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
  };

  return { update, dispose };
};
