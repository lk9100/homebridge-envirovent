import type { CharacteristicValue, Service } from 'homebridge';
import type { EnviroventAccessoryContext } from '../accessory.js';

/**
 * Switch service — summer shutdown toggle.
 *
 * Appears as a separate switch tile in HomeKit.
 * Users can hide it and use it in scenes/automations (e.g., "Away" scene).
 * Polling detects when the unit's own logic changes the state and updates
 * the switch accordingly.
 */
export const createSummerShutdownService = (ctx: EnviroventAccessoryContext) => {
  const { platform, accessory, client, commandQueue, unitState } = ctx;

  const service: Service =
    accessory.getService('Summer Shutdown') ??
    accessory.addService(platform.Service.Switch, 'Summer Shutdown', 'summer-shutdown-switch');

  const getOn = (): CharacteristicValue => {
    const settings = unitState.settings;
    return settings?.summerBypass.summerShutdown ?? false;
  };

  const setOn = async (value: CharacteristicValue): Promise<void> => {
    const enabled = value as boolean;
    try {
      await commandQueue.enqueue(async () => client.setSummerBypass(enabled));

      // Optimistic update — spread current settings so sibling fields survive
      const currentSummerBypass = unitState.settings?.summerBypass;
      unitState.applyOptimistic({
        summerBypass: {
          active: currentSummerBypass?.active ?? false,
          temperature: currentSummerBypass?.temperature ?? 22,
          summerShutdown: enabled,
        },
      });
    } catch (err) {
      platform.log.error('❌ Could not toggle summer shutdown:', err);
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
