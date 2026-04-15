import { describe, it, expect } from 'vitest';
import { createFilterService } from '../../../src/homebridge/services/filter.js';
import { createUnitState } from '../../../src/state/unit-state.js';
import { createCommandQueue } from '../../../src/state/command-queue.js';
import { createMockSettings, createMockAccessory, MockService } from '../mock-homebridge.js';
import type { EnviroventClient } from '../../../src/api/client.js';
import type { EnviroventAccessoryContext } from '../../../src/homebridge/accessory.js';

const buildTestAccessory = (filterOverrides?: { remainingDays?: number; resetMonths?: number } | null) => {
  const settings = filterOverrides === null ? undefined : createMockSettings({
    filter: {
      remainingDays: filterOverrides?.remainingDays ?? 180,
      resetMonths: filterOverrides?.resetMonths ?? 12,
    },
  });
  const mockClient = {} as unknown as EnviroventClient;

  const { platform, accessory } = createMockAccessory();
  // Add fan service first (so filter can link to it)
  accessory.addService('Fanv2', 'Fan');

  const unitState = createUnitState(mockClient, { failureThreshold: 3, initialSettings: settings });

  const fakeAccessory = {
    platform,
    accessory,
    client: mockClient,
    commandQueue: createCommandQueue({ retries: 0 }),
    unitState,
  } as unknown as EnviroventAccessoryContext;

  return { fakeAccessory, platform };
};

describe('FilterService', () => {
  it('reports FILTER_OK when remainingDays > 0', () => {
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: 180 });
    createFilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    const indication = service?.getCharacteristic(platform.Characteristic.FilterChangeIndication);
    expect(indication?.simulateGet()).toBe(0); // FILTER_OK
  });

  it('reports CHANGE_FILTER when remainingDays is 0', () => {
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: 0 });
    createFilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    const indication = service?.getCharacteristic(platform.Characteristic.FilterChangeIndication);
    expect(indication?.simulateGet()).toBe(1); // CHANGE_FILTER
  });

  it('calculates FilterLifeLevel as percentage of total days', () => {
    // 12 months = 360 days total. 180 remaining = 50%
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: 180, resetMonths: 12 });
    createFilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    const level = service?.getCharacteristic(platform.Characteristic.FilterLifeLevel);
    expect(level?.simulateGet()).toBe(50);
  });

  it('reports 100% when filter is fresh', () => {
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: 360, resetMonths: 12 });
    createFilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    const level = service?.getCharacteristic(platform.Characteristic.FilterLifeLevel);
    expect(level?.simulateGet()).toBe(100);
  });

  it('reports 0% when filter is expired', () => {
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: 0, resetMonths: 12 });
    createFilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    const level = service?.getCharacteristic(platform.Characteristic.FilterLifeLevel);
    expect(level?.simulateGet()).toBe(0);
  });

  it('clamps negative remainingDays to 0%', () => {
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: -10, resetMonths: 12 });
    createFilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    const level = service?.getCharacteristic(platform.Characteristic.FilterLifeLevel);
    expect(level?.simulateGet()).toBe(0);
  });

  it('update() pushes current filter state to characteristics', () => {
    const { fakeAccessory, platform } = buildTestAccessory({ remainingDays: 0, resetMonths: 12 });
    const filterService = createFilterService(fakeAccessory);

    filterService.update();

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    expect(service?.getCharacteristic(platform.Characteristic.FilterChangeIndication).getValue()).toBe(1);
    expect(service?.getCharacteristic(platform.Characteristic.FilterLifeLevel).getValue()).toBe(0);
  });

  it('returns FILTER_OK and 100% when settings are null', () => {
    const { fakeAccessory, platform } = buildTestAccessory(null);
    createFilterService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Filter') as unknown as MockService;
    expect(service?.getCharacteristic(platform.Characteristic.FilterChangeIndication).simulateGet()).toBe(0);
    expect(service?.getCharacteristic(platform.Characteristic.FilterLifeLevel).simulateGet()).toBe(100);
  });

  it('handles missing fan service gracefully (no linked service)', () => {
    // Create accessory WITHOUT adding Fanv2 first — filter should not throw
    const settings = createMockSettings({ filter: { remainingDays: 180, resetMonths: 12 } });
    const mockClient = {} as unknown as EnviroventClient;
    const { platform, accessory } = createMockAccessory();
    // Deliberately NOT adding Fanv2 service here

    const unitState = createUnitState(mockClient, { failureThreshold: 3, initialSettings: settings });

    const fakeAccessory = {
      platform,
      accessory,
      client: mockClient,
      commandQueue: createCommandQueue({ retries: 0 }),
      unitState,
    } as unknown as EnviroventAccessoryContext;

    // Should not throw even without fan service to link to
    expect(() => createFilterService(fakeAccessory)).not.toThrow();
  });
});
