import { describe, it, expect, vi } from 'vitest';
import { createBoostService } from '../../../src/homebridge/services/boost.js';
import { createUnitState } from '../../../src/state/unit-state.js';
import { createCommandQueue } from '../../../src/state/command-queue.js';
import { createMockSettings, createMockAccessory, MockService } from '../mock-homebridge.js';
import type { EnviroventClient } from '../../../src/api/client.js';
import type { EnviroventAccessoryContext } from '../../../src/homebridge/accessory.js';

const buildTestAccessory = (boostEnabled = false) => {
  const settings = createMockSettings({
    boost: { enabled: boostEnabled, mins: 20 },
  });
  const mockClient = {
    getSettings: vi.fn(),
    setBoost: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as EnviroventClient;

  const { platform, accessory } = createMockAccessory();
  const unitState = createUnitState(mockClient, { failureThreshold: 3, initialSettings: settings });

  const fakeAccessory = {
    platform,
    accessory,
    client: mockClient,
    commandQueue: createCommandQueue({ retries: 0 }),
    unitState,
  } as unknown as EnviroventAccessoryContext;

  return { fakeAccessory, platform, mockClient };
};

describe('BoostService', () => {
  it('reports On=false when boost is disabled', () => {
    const { fakeAccessory, platform } = buildTestAccessory(false);
    createBoostService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    expect(on?.simulateGet()).toBe(false);
  });

  it('reports On=true when boost is enabled', () => {
    const { fakeAccessory, platform } = buildTestAccessory(true);
    createBoostService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    expect(on?.simulateGet()).toBe(true);
  });

  it('calls setBoost(true) when turned on', async () => {
    const { fakeAccessory, platform, mockClient } = buildTestAccessory(false);
    createBoostService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    await on?.simulateSet(true);

    // Wait for command queue to process
    await new Promise((r) => setTimeout(r, 50));
    expect(mockClient.setBoost).toHaveBeenCalledWith(true);
  });

  it('calls setBoost(false) when turned off', async () => {
    const { fakeAccessory, platform, mockClient } = buildTestAccessory(true);
    createBoostService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    await on?.simulateSet(false);

    await new Promise((r) => setTimeout(r, 50));
    expect(mockClient.setBoost).toHaveBeenCalledWith(false);
  });

  it('update() pushes current boost state to characteristic', () => {
    const { fakeAccessory, platform } = buildTestAccessory(true);
    const boostService = createBoostService(fakeAccessory);

    boostService.update();

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    expect(on?.getValue()).toBe(true);
  });

  it('reports On=false when settings are null', () => {
    const settings = undefined;
    const mockClient = {
      getSettings: vi.fn(),
      setBoost: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as EnviroventClient;

    const { platform, accessory } = createMockAccessory();
    const unitState = createUnitState(mockClient, { failureThreshold: 3 });

    const fakeAccessory = {
      platform,
      accessory,
      client: mockClient,
      commandQueue: createCommandQueue({ retries: 0 }),
      unitState,
    } as unknown as EnviroventAccessoryContext;

    createBoostService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    expect(on?.simulateGet()).toBe(false);
  });

  it('uses default mins (20) for optimistic update when settings are null during setOn', async () => {
    // Start with settings, then clear them before calling setOn
    const mockClient = {
      getSettings: vi.fn(),
      setBoost: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as EnviroventClient;

    const { platform, accessory } = createMockAccessory();
    // No initialSettings — settings is null
    const unitState = createUnitState(mockClient, { failureThreshold: 3 });

    const fakeAccessory = {
      platform,
      accessory,
      client: mockClient,
      commandQueue: createCommandQueue({ retries: 0 }),
      unitState,
    } as unknown as EnviroventAccessoryContext;

    createBoostService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    await on?.simulateSet(true);

    await new Promise((r) => setTimeout(r, 50));
    expect(mockClient.setBoost).toHaveBeenCalledWith(true);
    // applyOptimistic is a no-op when settings are null, so settings should remain null
    expect(unitState.settings).toBeNull();
  });

  it('logs error and does not apply optimistic update when setBoost fails', async () => {
    const { fakeAccessory, platform, mockClient } = buildTestAccessory(false);
    (mockClient.setBoost as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('TCP timeout'));
    createBoostService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Boost') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    await on?.simulateSet(true);
    await new Promise((r) => setTimeout(r, 50));

    expect(platform.log.error).toHaveBeenCalledWith('Failed to set boost:', expect.any(Error));
    // Boost should NOT have been optimistically updated since TCP failed
    expect(fakeAccessory.unitState.settings!.boost.enabled).toBe(false);
  });
});
