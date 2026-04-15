import type { CharacteristicValue, Service } from 'homebridge';
import type { EnviroventAccessoryContext } from '../accessory.js';

/**
 * FilterMaintenance service — linked to the Fanv2 service.
 *
 * Shows a "change filter" indicator in HomeKit when remainingDays hits 0.
 * FilterLifeLevel is calculated as a percentage of the reset interval.
 */
export const createFilterService = (ctx: EnviroventAccessoryContext) => {
  const { platform, accessory, unitState } = ctx;

  const service: Service =
    accessory.getService(platform.Service.FilterMaintenance) ??
    accessory.addService(platform.Service.FilterMaintenance, 'Filter');

  // Link to the fan service
  const fanService = accessory.getService(platform.Service.Fanv2);
  if (fanService) {
    fanService.addLinkedService(service);
  }

  const getFilterChangeIndication = (): CharacteristicValue => {
    const Characteristic = platform.Characteristic;
    const settings = unitState.settings;
    if (!settings) {
      return Characteristic.FilterChangeIndication.FILTER_OK;
    }
    return settings.filter.remainingDays <= 0
      ? Characteristic.FilterChangeIndication.CHANGE_FILTER
      : Characteristic.FilterChangeIndication.FILTER_OK;
  };

  const getFilterLifeLevel = (): CharacteristicValue => {
    const settings = unitState.settings;
    if (!settings || settings.filter.resetMonths <= 0) return 100;

    const totalDays = settings.filter.resetMonths * 30;
    const remaining = Math.max(0, settings.filter.remainingDays);
    const percentage = Math.round((remaining / totalDays) * 100);
    return Math.max(0, Math.min(100, percentage));
  };

  service
    .getCharacteristic(platform.Characteristic.FilterChangeIndication)
    .onGet(() => getFilterChangeIndication());

  service
    .getCharacteristic(platform.Characteristic.FilterLifeLevel)
    .onGet(() => getFilterLifeLevel());

  const update = (): void => {
    service.updateCharacteristic(platform.Characteristic.FilterChangeIndication, getFilterChangeIndication());
    service.updateCharacteristic(platform.Characteristic.FilterLifeLevel, getFilterLifeLevel());
  };

  return { update };
};
