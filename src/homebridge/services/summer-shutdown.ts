import type { CharacteristicValue, Service } from 'homebridge';
import type { EnviroventAccessoryContext } from '../accessory.js';

/**
 * Switch service — summer shutdown mode toggle.
 *
 * Appears as a separate switch tile in HomeKit.
 * When enabled, the unit stops airflow when the intake temperature
 * rises above the summer bypass threshold.
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

      // Optimistic update
      unitState.applyOptimistic({
        summerBypass: {
          active: unitState.settings?.summerBypass.active ?? false,
          temperature: unitState.settings?.summerBypass.temperature ?? 22,
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
