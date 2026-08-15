import { describe, it, expect, vi } from 'vitest';
import { createSummerShutdownService } from '../../../src/homebridge/services/summer-shutdown.js';
import { createUnitState } from '../../../src/state/unit-state.js';
import { createCommandQueue } from '../../../src/state/command-queue.js';
import { createMockSettings, createMockAccessory, MockService } from '../mock-homebridge.js';
import type { EnviroventClient } from '../../../src/api/client.js';
import type { EnviroventAccessoryContext } from '../../../src/homebridge/accessory.js';

const buildTestAccessory = (summerShutdown = false) => {
  const settings = createMockSettings({
    summerBypass: { active: false, temperature: 22, summerShutdown },
  });
  const mockClient = {
    getSettings: vi.fn(),
    setSummerBypass: vi.fn().mockResolvedValue({ success: true }),
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

describe('SummerShutdownService', () => {
  it('reports On=false when summer shutdown is disabled', () => {
    const { fakeAccessory, platform } = buildTestAccessory(false);
    createSummerShutdownService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Summer Shutdown') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    expect(on?.simulateGet()).toBe(false);
  });

  it('reports On=true when summer shutdown is enabled', () => {
    const { fakeAccessory, platform } = buildTestAccessory(true);
    createSummerShutdownService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Summer Shutdown') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    expect(on?.simulateGet()).toBe(true);
  });

  it('calls setSummerBypass(true) when turned on', async () => {
    const { fakeAccessory, platform, mockClient } = buildTestAccessory(false);
    createSummerShutdownService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Summer Shutdown') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    await on?.simulateSet(true);

    // Wait for command queue to process
    await new Promise((r) => setTimeout(r, 50));
    expect(mockClient.setSummerBypass).toHaveBeenCalledWith(true);
  });

  it('calls setSummerBypass(false) when turned off', async () => {
    const { fakeAccessory, platform, mockClient } = buildTestAccessory(true);
    createSummerShutdownService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Summer Shutdown') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    await on?.simulateSet(false);

    await new Promise((r) => setTimeout(r, 50));
    expect(mockClient.setSummerBypass).toHaveBeenCalledWith(false);
  });

  it('applies optimistic update on success', async () => {
    const { fakeAccessory, platform } = buildTestAccessory(false);
    createSummerShutdownService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Summer Shutdown') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    await on?.simulateSet(true);

    await new Promise((r) => setTimeout(r, 50));
    expect(fakeAccessory.unitState.settings!.summerBypass.summerShutdown).toBe(true);
  });

  it('optimistic update preserves sibling summer bypass settings', async () => {
    const { fakeAccessory, platform } = buildTestAccessory(false);
    createSummerShutdownService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Summer Shutdown') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    await on?.simulateSet(true);

    await new Promise((r) => setTimeout(r, 50));
    const bypass = fakeAccessory.unitState.settings!.summerBypass;
    expect(bypass.summerShutdown).toBe(true);
    expect(bypass.active).toBe(false);
    expect(bypass.temperature).toBe(22);
  });

  it('update() pushes current summer shutdown state to characteristic', () => {
    const { fakeAccessory, platform } = buildTestAccessory(true);
    const summerShutdownService = createSummerShutdownService(fakeAccessory);

    summerShutdownService.update();

    const service = fakeAccessory.accessory.getService('Summer Shutdown') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    expect(on?.getValue()).toBe(true);
  });

  it('update() pushes false when summer shutdown is off', () => {
    const { fakeAccessory, platform } = buildTestAccessory(false);
    const summerShutdownService = createSummerShutdownService(fakeAccessory);

    summerShutdownService.update();

    const service = fakeAccessory.accessory.getService('Summer Shutdown') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    expect(on?.getValue()).toBe(false);
  });

  it('reports On=false when settings are null', () => {
    const mockClient = {
      getSettings: vi.fn(),
      setSummerBypass: vi.fn().mockResolvedValue({ success: true }),
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

    createSummerShutdownService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Summer Shutdown') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    expect(on?.simulateGet()).toBe(false);
  });

  it('skips optimistic update when settings are null during setOn', async () => {
    const mockClient = {
      getSettings: vi.fn(),
      setSummerBypass: vi.fn().mockResolvedValue({ success: true }),
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

    createSummerShutdownService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Summer Shutdown') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    await on?.simulateSet(true);

    await new Promise((r) => setTimeout(r, 50));
    expect(mockClient.setSummerBypass).toHaveBeenCalledWith(true);
    // applyOptimistic is a no-op when settings are null, so settings should remain null
    expect(unitState.settings).toBeNull();
  });

  it('logs error and does not apply optimistic update when setSummerBypass fails', async () => {
    const { fakeAccessory, platform, mockClient } = buildTestAccessory(false);
    (mockClient.setSummerBypass as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('TCP timeout'));
    createSummerShutdownService(fakeAccessory);

    const service = fakeAccessory.accessory.getService('Summer Shutdown') as unknown as MockService;
    const on = service?.getCharacteristic(platform.Characteristic.On);
    await on?.simulateSet(true);
    await new Promise((r) => setTimeout(r, 50));

    expect(platform.log.error).toHaveBeenCalledWith('❌ Could not toggle summer shutdown:', expect.any(Error));
    // Summer shutdown should NOT have been optimistically updated since TCP failed
    expect(fakeAccessory.unitState.settings!.summerBypass.summerShutdown).toBe(false);
  });
});
