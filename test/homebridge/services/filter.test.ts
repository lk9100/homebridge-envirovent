import { describe, it, expect, vi } from 'vitest';
import { FilterService } from '../../../src/homebridge/services/filter.js';
import { UnitState } from '../../../src/state/unit-state.js';
import { CommandQueue } from '../../../src/state/command-queue.js';
import { createMockSettings, createMockAccessory, MockService } from '../mock-homebridge.js';
import type { EnviroventClient } from '../../../src/api/client.js';
import type { EnviroventAccessory } from '../../../src/homebridge/accessory.js';

function buildTestAccessory(filterOverrides?: { remainingDays?: number; resetMonths?: number }) {
  const settings = createMockSettings({
    filter: {
      remainingDays: filterOverrides?.remainingDays ?? 180,
      resetMonths: filterOverrides?.resetMonths ?? 12,
    },
  });
  const mockClient = {} as unknown as EnviroventClient;

  const { platform, accessory } = createMockAccessory();
  // Add fan service first (so filter can link to it)
  accessory.addService('Fanv2', 'Fan');

  const unitState = new UnitState(mockClient, { failureThreshold: 3 });
  (unitState as unknown as { _settings: typeof settings })._settings = settings;
  (unitState as unknown as { _connected: boolean })._connected = true;

  const fakeAccessory = {
    platform,
    accessory,
    client: mockClient,
    commandQueue: new CommandQueue({ retries: 0 }),
    unitState,
  } as unknown as EnviroventAccessory;

  return { fakeAccessory, platform };
}

describe('FilterService', () => {
  it('reports FILTER_OK when remainingDays > 0', () => {
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: 180 });
    const filterService = new FilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    const indication = service?.getCharacteristic(platform.Characteristic.FilterChangeIndication);
    expect(indication?.simulateGet()).toBe(0); // FILTER_OK
  });

  it('reports CHANGE_FILTER when remainingDays is 0', () => {
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: 0 });
    const filterService = new FilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    const indication = service?.getCharacteristic(platform.Characteristic.FilterChangeIndication);
    expect(indication?.simulateGet()).toBe(1); // CHANGE_FILTER
  });

  it('calculates FilterLifeLevel as percentage of total days', () => {
    // 12 months = 360 days total. 180 remaining = 50%
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: 180, resetMonths: 12 });
    const filterService = new FilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    const level = service?.getCharacteristic(platform.Characteristic.FilterLifeLevel);
    expect(level?.simulateGet()).toBe(50);
  });

  it('reports 100% when filter is fresh', () => {
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: 360, resetMonths: 12 });
    const filterService = new FilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    const level = service?.getCharacteristic(platform.Characteristic.FilterLifeLevel);
    expect(level?.simulateGet()).toBe(100);
  });

  it('reports 0% when filter is expired', () => {
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: 0, resetMonths: 12 });
    const filterService = new FilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    const level = service?.getCharacteristic(platform.Characteristic.FilterLifeLevel);
    expect(level?.simulateGet()).toBe(0);
  });

  it('clamps negative remainingDays to 0%', () => {
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: -10, resetMonths: 12 });
    const filterService = new FilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    const level = service?.getCharacteristic(platform.Characteristic.FilterLifeLevel);
    expect(level?.simulateGet()).toBe(0);
  });

  it('update() pushes current filter state to characteristics', () => {
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: 0, resetMonths: 12 });
    const filterService = new FilterService(fakeAccessory);

    filterService.update();

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    expect(service?.getCharacteristic(platform.Characteristic.FilterChangeIndication).getValue()).toBe(1);
    expect(service?.getCharacteristic(platform.Characteristic.FilterLifeLevel).getValue()).toBe(0);
  });

  it('returns FILTER_OK and 100% when settings are null', () => {
    const { fakeAccessory, platform } = buildTestAccessory();
    // Clear settings
    const unitState = fakeAccessory.unitState;
    (unitState as unknown as { _settings: null })._settings = null;
    const filterService = new FilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    expect(service?.getCharacteristic(platform.Characteristic.FilterChangeIndication).simulateGet()).toBe(0);
    expect(service?.getCharacteristic(platform.Characteristic.FilterLifeLevel).simulateGet()).toBe(100);
  });
});
