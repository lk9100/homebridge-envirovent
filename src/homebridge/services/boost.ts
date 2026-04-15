import type { CharacteristicValue, Service } from 'homebridge';
import type { EnviroventAccessoryContext } from '../accessory.js';

/**
 * Switch service — boost mode toggle.
 *
 * Appears as a separate switch tile in HomeKit.
 * Users can hide it and use it in scenes/automations (e.g., "Boost" scene).
 * Polling detects when the boost timer expires and turns the switch off.
 */
export const createBoostService = (ctx: EnviroventAccessoryContext) => {
  const { platform, accessory, client, commandQueue, unitState } = ctx;

  const service: Service =
    accessory.getService('Boost') ??
    accessory.addService(platform.Service.Switch, 'Boost', 'boost-switch');

  const getOn = (): CharacteristicValue => {
    const settings = unitState.settings;
    return settings?.boost.enabled ?? false;
  };

  const setOn = async (value: CharacteristicValue): Promise<void> => {
    const enabled = value as boolean;
    try {
      await commandQueue.enqueue(async () => client.setBoost(enabled));

      // Optimistic update
      unitState.applyOptimistic({
        boost: {
          enabled,
          mins: unitState.settings?.boost.mins ?? 20,
        },
      });
    } catch (err) {
      platform.log.error('❌ Could not toggle boost:', err);
    }
  };

  service
    .getCharacteristic(platform.Characteristic.On)
    .onGet(() => getOn())
    .onSet(async (value) => setOn(value));

  const update = (): void => {
    service.updateCharacteristic(platform.Characteristic.On, getOn());
  };

  return { update };
};
