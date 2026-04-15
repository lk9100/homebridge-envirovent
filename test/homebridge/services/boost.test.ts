import { describe, it, expect, vi } from 'vitest';
import { BoostService } from '../../../src/homebridge/services/boost.js';
import { UnitState } from '../../../src/state/unit-state.js';
import { CommandQueue } from '../../../src/state/command-queue.js';
import { createMockSettings, createMockAccessory, MockService } from '../mock-homebridge.js';
import type { EnviroventClient } from '../../../src/api/client.js';
import type { EnviroventAccessory } from '../../../src/homebridge/accessory.js';

const buildTestAccessory = (boostEnabled = false) => {
  const settings = createMockSettings({
    boost: { enabled: boostEnabled, mins: 20 },
  });
  const mockClient = {
    getSettings: vi.fn(),
    setBoost: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as EnviroventClient;

  const { platform, accessory } = createMockAccessory();
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

  return { fakeAccessory, platform, mockClient };
};

describe('BoostService', () => {
  it('reports On=false when boost is disabled', () => {
    const { fakeAccessory, platform } = buildTestAccessory(false);
    const _boostService = new BoostService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    expect(on?.simulateGet()).toBe(false);
  });

  it('reports On=true when boost is enabled', () => {
    const { fakeAccessory, platform } = buildTestAccessory(true);
    const _boostService = new BoostService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    expect(on?.simulateGet()).toBe(true);
  });

  it('calls setBoost(true) when turned on', async () => {
    const { fakeAccessory, platform, mockClient } = buildTestAccessory(false);
    const _boostService = new BoostService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    await on?.simulateSet(true);

    // Wait for command queue to process
    await new Promise((r) => setTimeout(r, 50));
    expect(mockClient.setBoost).toHaveBeenCalledWith(true);
  });

  it('calls setBoost(false) when turned off', async () => {
    const { fakeAccessory, platform, mockClient } = buildTestAccessory(true);
    const _boostService = new BoostService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    await on?.simulateSet(false);

    await new Promise((r) => setTimeout(r, 50));
    expect(mockClient.setBoost).toHaveBeenCalledWith(false);
  });

  it('update() pushes current boost state to characteristic', () => {
    const { fakeAccessory, platform } = buildTestAccessory(true);
    const boostService = new BoostService(fakeAccessory);

    boostService.update();

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    expect(on?.getValue()).toBe(true);
  });

  it('logs error and does not apply optimistic update when setBoost fails', async () => {
    const { fakeAccessory, platform, mockClient } = buildTestAccessory(false);
    (mockClient.setBoost as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('TCP timeout'));
    new BoostService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    await on?.simulateSet(true);
    await new Promise((r) => setTimeout(r, 50));

    expect(platform.log.error).toHaveBeenCalledWith('Failed to set boost:', expect.any(Error));
    // Boost should NOT have been optimistically updated since TCP failed
    expect(fakeAccessory.unitState.settings!.boost.enabled).toBe(false);
  });
});
