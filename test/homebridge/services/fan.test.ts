import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FanService } from '../../../src/homebridge/services/fan.js';
import { UnitState } from '../../../src/state/unit-state.js';
import { CommandQueue } from '../../../src/state/command-queue.js';
import { createMockSettings, createMockAccessory, MockService } from '../mock-homebridge.js';
import type { EnviroventClient } from '../../../src/api/client.js';
import type { EnviroventAccessory } from '../../../src/homebridge/accessory.js';

function buildTestAccessory(settingsOverrides?: Parameters<typeof createMockSettings>[0]) {
  const settings = createMockSettings(settingsOverrides);
  const mockClient = {
    getSettings: vi.fn(),
    setHomeSettings: vi.fn().mockResolvedValue({ success: true }),
    setBoost: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as EnviroventClient;

  const { platform, accessory } = createMockAccessory();
  const unitState = new UnitState(mockClient, { failureThreshold: 3 });
  // Directly set state for testing
  (unitState as unknown as { _settings: typeof settings })._settings = settings;
  (unitState as unknown as { _connected: boolean })._connected = true;

  const fakeAccessory = {
    platform,
    accessory,
    client: mockClient,
    commandQueue: new CommandQueue({ retries: 0 }),
    unitState,
  } as unknown as EnviroventAccessory;

  return { fakeAccessory, platform, unitState, mockClient };
}

describe('FanService', () => {
  it('creates Fanv2 service with correct characteristics', () => {
    const { fakeAccessory } = buildTestAccessory();
    const fanService = new FanService(fakeAccessory);
    // Should not throw
    expect(fanService).toBeDefined();
  });

  it('reports Active=1 when airflow is active', () => {
    const { fakeAccessory, platform } = buildTestAccessory();
    const fanService = new FanService(fakeAccessory);

    // Find the service and check Active
    const service = fakeAccessory.accessory.getService('Fan') as unknown as MockService;
    const active = service?.getCharacteristic(platform.Characteristic.Active);
    expect(active?.simulateGet()).toBe(1);
  });

  it('reports Active=0 when airflow is inactive', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 0, active: false },
    });
    const fanService = new FanService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Fan') as unknown as MockService;
    const active = service?.getCharacteristic(platform.Characteristic.Active);
    expect(active?.simulateGet()).toBe(0);
  });

  it('maps unit VAR percentage to HomeKit 0-100 range', () => {
    // Unit VAR range: 24-100%. Unit value: 62% → (62-24)/(100-24)*100 = 50%
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 62, active: true },
    });
    const fanService = new FanService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Fan') as unknown as MockService;
    const speed = service?.getCharacteristic(platform.Characteristic.RotationSpeed);
    expect(speed?.simulateGet()).toBe(50);
  });

  it('maps unit VAR min (24%) to HomeKit 0%', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 24, active: true },
    });
    const fanService = new FanService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Fan') as unknown as MockService;
    const speed = service?.getCharacteristic(platform.Characteristic.RotationSpeed);
    expect(speed?.simulateGet()).toBe(0);
  });

  it('maps unit max percentage (100%) to HomeKit 100%', () => {
    const { fakeAccessory, platform } = buildTestAccessory({
      airflow: { mode: 'VAR', value: 100, active: true },
    });
    const fanService = new FanService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Fan') as unknown as MockService;
    const speed = service?.getCharacteristic(platform.Characteristic.RotationSpeed);
    expect(speed?.simulateGet()).toBe(100);
  });

  it('reports BLOWING_AIR state when active and connected', () => {
    const { fakeAccessory, platform } = buildTestAccessory();
    const fanService = new FanService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Fan') as unknown as MockService;
    const state = service?.getCharacteristic(platform.Characteristic.CurrentFanState);
    expect(state?.simulateGet()).toBe(2); // BLOWING_AIR
  });

  it('reports 0 for all values when settings are null', () => {
    const { fakeAccessory, platform, unitState } = buildTestAccessory();
    (unitState as unknown as { _settings: null })._settings = null;
    const fanService = new FanService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Fan') as unknown as MockService;
    const active = service?.getCharacteristic(platform.Characteristic.Active);
    const speed = service?.getCharacteristic(platform.Characteristic.RotationSpeed);
    expect(active?.simulateGet()).toBe(0);
    expect(speed?.simulateGet()).toBe(0);
  });
});
