import type { CharacteristicValue, Service } from 'homebridge';
import type { EnviroventAccessory } from '../accessory.js';

/**
 * Fanv2 service — main fan control with airflow speed slider.
 *
 * RotationSpeed uses the unit's actual VAR percentage range (e.g. 24-100%)
 * directly — no mapping. The slider shows real unit percentages.
 *
 * PIV units are always physically on — the Active characteristic always
 * reports 1, and tapping "off" sets the fan to minimum speed.
 *
 * We intentionally do NOT set minValue on RotationSpeed props. If we did,
 * HAP-NodeJS would reject any value below 24% (e.g. Siri "set to 10%",
 * or the RotationSpeed=0 that HomeKit sends alongside Active=0 when
 * tapping "off") with INVALID_VALUE_IN_REQUEST, which HomeKit renders
 * as "No Response". Instead, we clamp sub-minimum values ourselves and
 * bounce the UI back to varMin.
 */
export class FanService {
  private readonly service: Service;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private varMin: number;
  private varMax: number;

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
      .setProps({ maxValue: this.varMax, minStep: 1 })
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

  private getActive(): CharacteristicValue {
    return 1;
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    // Immediately schedule the bounce-back on next tick — don't wait for TCP.
    // This minimises the grey "off" flash to ~50ms (one event loop tick)
    // instead of ~250ms (waiting for TCP round-trip + delay).
    setTimeout(() => {
      this.service.updateCharacteristic(this.accessory.platform.Characteristic.Active, 1);
      this.service.updateCharacteristic(this.accessory.platform.Characteristic.RotationSpeed, this.varMin);
    }, 50);

    if (value === 0) {
      // Can't turn off a PIV — send minimum speed to unit (fire-and-forget for UX speed)
      const settings = this.accessory.unitState.settings;
      if (settings) {
        this.accessory.platform.log.info(`PIV unit cannot turn off. Setting to minimum airflow (${this.varMin}%).`);
        this.sendAirflowUpdate(this.varMin, settings);
      }
    }
  }

  private getRotationSpeed(): CharacteristicValue {
    const settings = this.accessory.unitState.settings;
    if (!settings) return this.varMin;

    if (settings.airflow.mode === 'VAR') {
      // Direct passthrough — no mapping needed
      return Math.max(this.varMin, Math.min(this.varMax, settings.airflow.value));
    }

    // SET mode — find the percentage for the preset mark from airflow maps
    const map = settings.airflowConfiguration.maps.find((m) => m.mark === settings.airflow.value);
    if (map) {
      return Math.max(this.varMin, Math.min(this.varMax, map.percent));
    }

    return this.varMin;
  }

  private async setRotationSpeed(value: CharacteristicValue): Promise<void> {
    const speed = value as number;
    const settings = this.accessory.unitState.settings;
    if (!settings) return;

    // Clamp to valid range — values below varMin come from Siri/automations
    // or from HomeKit sending RotationSpeed=0 alongside Active=0
    const unitPercent = Math.max(this.varMin, Math.min(this.varMax, Math.round(speed)));

    // If the value was below varMin, bounce the UI back to varMin immediately.
    // We must also apply the optimistic state update NOW (not after the debounce)
    // so that any subsequent getRotationSpeed() call returns varMin instead of
    // the old polled value. Without this, HomeKit verifies the bounce-back by
    // calling getRotationSpeed(), reads the stale value (e.g. 50%), and snaps
    // the slider back there instead of staying at 24%.
    if (speed < this.varMin) {
      this.accessory.unitState.applyOptimistic({
        airflow: { mode: 'VAR', value: this.varMin, active: true },
      });
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.accessory.platform.Characteristic.RotationSpeed,
          this.varMin,
        );
      }, 50);
    }

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
