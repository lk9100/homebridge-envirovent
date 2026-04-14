import type { CharacteristicValue, Service } from 'homebridge';
import type { EnviroventAccessory } from '../accessory.js';

/**
 * Switch service — boost mode toggle.
 *
 * Appears as a separate switch tile in HomeKit.
 * Users can hide it and use it in scenes/automations (e.g., "Boost" scene).
 * Polling detects when the boost timer expires and turns the switch off.
 */
export class BoostService {
  private readonly service: Service;

  constructor(private readonly accessory: EnviroventAccessory) {
    const platform = accessory.platform;

    this.service =
      accessory.accessory.getService('Boost') ??
      accessory.accessory.addService(platform.Service.Switch, 'Boost', 'boost-switch');

    this.service
      .getCharacteristic(platform.Characteristic.On)
      .onGet(() => this.getOn())
      .onSet((value) => this.setOn(value));
  }

  update(): void {
    this.service.updateCharacteristic(
      this.accessory.platform.Characteristic.On,
      this.getOn(),
    );
  }

  private getOn(): CharacteristicValue {
    const settings = this.accessory.unitState.settings;
    return settings?.boost.enabled ?? false;
  }

  private async setOn(value: CharacteristicValue): Promise<void> {
    const enabled = value as boolean;
    try {
      await this.accessory.commandQueue.enqueue(() =>
        this.accessory.client.setBoost(enabled),
      );

      // Optimistic update
      this.accessory.unitState.applyOptimistic({
        boost: {
          enabled,
          mins: this.accessory.unitState.settings?.boost.mins ?? 20,
        },
      });
    } catch (err) {
      this.accessory.platform.log.error('Failed to set boost:', err);
    }
  }
}
