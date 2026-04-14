import type { CharacteristicValue, Service } from 'homebridge';
import type { EnviroventAccessory } from '../accessory.js';

/**
 * FilterMaintenance service — linked to the Fanv2 service.
 *
 * Shows a "change filter" indicator in HomeKit when remainingDays hits 0.
 * FilterLifeLevel is calculated as a percentage of the reset interval.
 */
export class FilterService {
  private readonly service: Service;

  constructor(private readonly accessory: EnviroventAccessory) {
    const platform = accessory.platform;

    this.service =
      accessory.accessory.getService(platform.Service.FilterMaintenance) ??
      accessory.accessory.addService(platform.Service.FilterMaintenance, 'Filter');

    // Link to the fan service
    const fanService = accessory.accessory.getService(platform.Service.Fanv2);
    if (fanService) {
      fanService.addLinkedService(this.service);
    }

    this.service
      .getCharacteristic(platform.Characteristic.FilterChangeIndication)
      .onGet(() => this.getFilterChangeIndication());

    this.service
      .getCharacteristic(platform.Characteristic.FilterLifeLevel)
      .onGet(() => this.getFilterLifeLevel());
  }

  update(): void {
    const platform = this.accessory.platform;
    this.service.updateCharacteristic(
      platform.Characteristic.FilterChangeIndication,
      this.getFilterChangeIndication(),
    );
    this.service.updateCharacteristic(
      platform.Characteristic.FilterLifeLevel,
      this.getFilterLifeLevel(),
    );
  }

  private getFilterChangeIndication(): CharacteristicValue {
    const Characteristic = this.accessory.platform.Characteristic;
    const settings = this.accessory.unitState.settings;
    if (!settings) {
      return Characteristic.FilterChangeIndication.FILTER_OK;
    }
    return settings.filter.remainingDays <= 0
      ? Characteristic.FilterChangeIndication.CHANGE_FILTER
      : Characteristic.FilterChangeIndication.FILTER_OK;
  }

  private getFilterLifeLevel(): CharacteristicValue {
    const settings = this.accessory.unitState.settings;
    if (!settings || settings.filter.resetMonths <= 0) return 100;

    const totalDays = settings.filter.resetMonths * 30;
    const remaining = Math.max(0, settings.filter.remainingDays);
    const percentage = Math.round((remaining / totalDays) * 100);
    return Math.max(0, Math.min(100, percentage));
  }
}
