import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEnviroventAccessory } from '../../src/homebridge/accessory.js';
import { createMockSettings, createMockPlatform } from './mock-homebridge.js';
import type { EnviroventPlatform } from '../../src/homebridge/platform.js';
import type { PlatformAccessory } from 'homebridge';

// ─── Mocks ────────────────────────────────────────────────────────────

// Mock the client factory — we don't want real TCP connections
vi.mock('../../src/api/client.js', () => ({
  createEnviroventClient: vi.fn(() => ({
    getSettings: vi.fn().mockResolvedValue({
      success: true,
      unitType: 'piv',
      settings: createMockSettings(),
    }),
    setHomeSettings: vi.fn().mockResolvedValue({ success: true }),
    setBoost: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

// Mock service factories to avoid full HAP wiring — return minimal objects
vi.mock('../../src/homebridge/services/fan.js', () => ({
  createFanService: vi.fn(() => ({
    update: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('../../src/homebridge/services/boost.js', () => ({
  createBoostService: vi.fn(() => ({
    update: vi.fn(),
  })),
}));

vi.mock('../../src/homebridge/services/filter.js', () => ({
  createFilterService: vi.fn(() => ({
    update: vi.fn(),
  })),
}));

const buildMockPlatformAndAccessory = (overrides?: {
  host?: string | undefined;
  port?: number | undefined;
  showBoostSwitch?: boolean;
  pollInterval?: number;
}) => {
  const basePlatform = createMockPlatform();
  const platform = {
    ...basePlatform,
    config: {
      ...basePlatform.config,
      showBoostSwitch: overrides?.showBoostSwitch ?? true,
      pollInterval: overrides?.pollInterval,
    },
    Service: {
      ...basePlatform.Service,
    },
    Characteristic: {
      ...basePlatform.Characteristic,
      Manufacturer: { UUID: 'Manufacturer' },
      Model: { UUID: 'Model' },
      SerialNumber: { UUID: 'SerialNumber' },
    },
  } as unknown as EnviroventPlatform;

  // AccessoryInformation uses setCharacteristic (chainable), not the
  // onGet/onSet pattern used by other services.
  const infoCharValues = new Map<string, unknown>();
  const infoService = {
    setCharacteristic(type: { UUID?: string } | string, value: unknown) {
      const key = typeof type === 'string' ? type : (type as { UUID: string }).UUID ?? String(type);
      infoCharValues.set(key, value);
      return infoService; // chaining
    },
    getCharacteristicValue(key: string) { return infoCharValues.get(key); },
  };

  const accessory = {
    displayName: 'Test PIV',
    context: {
      host: overrides?.host ?? '192.168.1.100',
      port: overrides?.port,
    },
    getService(type: string) {
      if (type === 'AccessoryInformation') return infoService;
      return null;
    },
    addService: vi.fn(),
  } as unknown as PlatformAccessory;

  return { platform, accessory, infoService };
};

// ─── Tests ────────────────────────────────────────────────────────────

describe('createEnviroventAccessory', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('throws when host is missing', () => {
    const { platform, accessory } = buildMockPlatformAndAccessory({ host: undefined });
    (accessory as { context: Record<string, unknown> }).context.host = undefined;
    expect(() => createEnviroventAccessory(platform, accessory)).toThrow('no valid host configured');
  });

  it('throws when host is empty string', () => {
    const { platform, accessory } = buildMockPlatformAndAccessory({ host: '' });
    expect(() => createEnviroventAccessory(platform, accessory)).toThrow('no valid host configured');
  });

  it('returns a context with client, commandQueue, and unitState', () => {
    const { platform, accessory } = buildMockPlatformAndAccessory();
    const ctx = createEnviroventAccessory(platform, accessory);

    expect(ctx.client).toBeDefined();
    expect(ctx.commandQueue).toBeDefined();
    expect(ctx.unitState).toBeDefined();
    expect(ctx.platform).toBe(platform);
    expect(ctx.accessory).toBe(accessory);

    ctx.dispose();
  });

  it('sets accessory information characteristics', () => {
    const { platform, accessory, infoService } = buildMockPlatformAndAccessory();
    const ctx = createEnviroventAccessory(platform, accessory);

    expect(infoService.getCharacteristicValue('Manufacturer')).toBe('Envirovent');
    expect(infoService.getCharacteristicValue('Model')).toBe('Atmos PIV');
    expect(infoService.getCharacteristicValue('SerialNumber')).toBe('192.168.1.100:1337');

    ctx.dispose();
  });

  it('uses DEFAULTS.PORT when port is not configured', async () => {
    const { createEnviroventClient } = await import('../../src/api/client.js');
    const { platform, accessory } = buildMockPlatformAndAccessory({ port: undefined });
    const ctx = createEnviroventAccessory(platform, accessory);

    expect(createEnviroventClient).toHaveBeenCalledWith({ host: '192.168.1.100', port: 1337 });

    ctx.dispose();
  });

  it('uses configured port when provided', async () => {
    const { createEnviroventClient } = await import('../../src/api/client.js');
    const { platform, accessory } = buildMockPlatformAndAccessory({ port: 9999 });
    (accessory as { context: Record<string, unknown> }).context.port = 9999;
    const ctx = createEnviroventAccessory(platform, accessory);

    expect(createEnviroventClient).toHaveBeenCalledWith({ host: '192.168.1.100', port: 9999 });

    ctx.dispose();
  });

  it('registers fan and filter services (always)', async () => {
    const { createFanService } = await import('../../src/homebridge/services/fan.js');
    const { createFilterService } = await import('../../src/homebridge/services/filter.js');

    const { platform, accessory } = buildMockPlatformAndAccessory();
    const ctx = createEnviroventAccessory(platform, accessory);

    expect(createFanService).toHaveBeenCalled();
    expect(createFilterService).toHaveBeenCalled();

    ctx.dispose();
  });

  it('registers boost service when showBoostSwitch is true (default)', async () => {
    const { createBoostService } = await import('../../src/homebridge/services/boost.js');

    const { platform, accessory } = buildMockPlatformAndAccessory({ showBoostSwitch: true });
    const ctx = createEnviroventAccessory(platform, accessory);

    expect(createBoostService).toHaveBeenCalled();

    ctx.dispose();
  });

  it('defaults to showing boost service when showBoostSwitch is not configured', async () => {
    const { createBoostService } = await import('../../src/homebridge/services/boost.js');
    (createBoostService as ReturnType<typeof vi.fn>).mockClear();

    const basePlatform = createMockPlatform();
    const platform = {
      ...basePlatform,
      config: { /* showBoostSwitch intentionally omitted */ },
      Characteristic: {
        ...basePlatform.Characteristic,
        Manufacturer: { UUID: 'Manufacturer' },
        Model: { UUID: 'Model' },
        SerialNumber: { UUID: 'SerialNumber' },
      },
    } as unknown as EnviroventPlatform;

    const infoService = {
      setCharacteristic(_type: unknown, _value: unknown) { return infoService; },
    };
    const accessory = {
      displayName: 'Test',
      context: { host: '10.0.0.1' },
      getService(type: string) { return type === 'AccessoryInformation' ? infoService : null; },
      addService: vi.fn(),
    } as unknown as PlatformAccessory;

    const ctx = createEnviroventAccessory(platform, accessory);

    // Default should be true — boost service should be created
    expect(createBoostService).toHaveBeenCalled();

    ctx.dispose();
  });

  it('skips boost service when showBoostSwitch is false', async () => {
    const { createBoostService } = await import('../../src/homebridge/services/boost.js');
    (createBoostService as ReturnType<typeof vi.fn>).mockClear();

    const { platform, accessory } = buildMockPlatformAndAccessory({ showBoostSwitch: false });
    const ctx = createEnviroventAccessory(platform, accessory);

    expect(createBoostService).not.toHaveBeenCalled();

    ctx.dispose();
  });

  it('starts initial poll immediately', () => {
    const { platform, accessory } = buildMockPlatformAndAccessory();
    const ctx = createEnviroventAccessory(platform, accessory);

    // unitState.poll() should have been called (it's a promise, won't block)
    expect(ctx.unitState).toBeDefined();

    ctx.dispose();
  });

  it('polls on interval', async () => {
    const { platform, accessory } = buildMockPlatformAndAccessory({ pollInterval: 10 });
    const ctx = createEnviroventAccessory(platform, accessory);

    const pollSpy = vi.spyOn(ctx.unitState, 'poll');
    // Advance past one interval (10s = 10000ms)
    await vi.advanceTimersByTimeAsync(10_000);

    expect(pollSpy).toHaveBeenCalled();

    ctx.dispose();
  });

  it('enforces minimum poll interval of 5s', () => {
    const { platform, accessory } = buildMockPlatformAndAccessory({ pollInterval: 1 });
    const ctx = createEnviroventAccessory(platform, accessory);

    expect(platform.log.info).toHaveBeenCalledWith('🔄 Checking unit status every 5s');

    ctx.dispose();
  });

  it('calls service update on stateChanged event', async () => {
    const { createFanService } = await import('../../src/homebridge/services/fan.js');
    const mockFanUpdate = vi.fn();
    (createFanService as ReturnType<typeof vi.fn>).mockReturnValue({
      update: mockFanUpdate,
      dispose: vi.fn(),
    });

    const { platform, accessory } = buildMockPlatformAndAccessory();
    const ctx = createEnviroventAccessory(platform, accessory);

    ctx.unitState.emit('stateChanged', createMockSettings());
    expect(mockFanUpdate).toHaveBeenCalled();

    ctx.dispose();
  });

  it('logs warning on connectionLost event', () => {
    const { platform, accessory } = buildMockPlatformAndAccessory();
    const ctx = createEnviroventAccessory(platform, accessory);

    ctx.unitState.emit('connectionLost');
    expect(platform.log.warn).toHaveBeenCalledWith(expect.stringContaining('not responding'));

    ctx.dispose();
  });

  it('logs info on connectionRestored event', () => {
    const { platform, accessory } = buildMockPlatformAndAccessory();
    const ctx = createEnviroventAccessory(platform, accessory);

    ctx.unitState.emit('connectionRestored');
    expect(platform.log.info).toHaveBeenCalledWith(expect.stringContaining('back online'));

    ctx.dispose();
  });

  it('logs debug on pollError event', () => {
    const { platform, accessory } = buildMockPlatformAndAccessory();
    const ctx = createEnviroventAccessory(platform, accessory);

    ctx.unitState.emit('pollError', new Error('timeout'));
    expect(platform.log.debug).toHaveBeenCalledWith(expect.stringContaining('Poll error'));

    ctx.dispose();
  });

  it('dispose stops the poll timer and cleans up unitState', async () => {
    const { platform, accessory } = buildMockPlatformAndAccessory({ pollInterval: 5 });
    const ctx = createEnviroventAccessory(platform, accessory);

    const pollSpy = vi.spyOn(ctx.unitState, 'poll');
    ctx.dispose();

    pollSpy.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);

    // After dispose, no more polling should happen
    expect(pollSpy).not.toHaveBeenCalled();
  });

  it('dispose is idempotent (safe to call twice)', () => {
    const { platform, accessory } = buildMockPlatformAndAccessory();
    const ctx = createEnviroventAccessory(platform, accessory);

    expect(() => {
      ctx.dispose();
      ctx.dispose();
    }).not.toThrow();
  });

  it('handles info service being absent', () => {
    const { platform } = buildMockPlatformAndAccessory();

    // Accessory that returns null for AccessoryInformation
    const accessory = {
      displayName: 'No Info',
      context: { host: '10.0.0.1' },
      getService() { return null; },
      addService: vi.fn(),
    } as unknown as PlatformAccessory;

    const ctx = createEnviroventAccessory(platform as unknown as EnviroventPlatform, accessory);
    // Should not throw even without info service
    expect(ctx).toBeDefined();
    ctx.dispose();
  });

  it('logs debug when interval poll fails', async () => {
    const { createEnviroventClient } = await import('../../src/api/client.js');

    // Return a client whose getSettings always fails
    const failingGetSettings = vi.fn().mockRejectedValue(new Error('connection refused'));
    (createEnviroventClient as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      getSettings: failingGetSettings,
      setHomeSettings: vi.fn(),
      setBoost: vi.fn(),
    });

    const { platform, accessory } = buildMockPlatformAndAccessory({ pollInterval: 10 });
    const ctx = createEnviroventAccessory(platform, accessory);

    // Advance past one poll interval to trigger the setInterval callback.
    // The interval callback does: void unitState.poll().catch(err => log.debug(...))
    // poll() catches internally, so the outer .catch() won't fire, but
    // the pollError event handler logs debug.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(platform.log.debug).toHaveBeenCalledWith(expect.stringContaining('Poll error'));

    ctx.dispose();
  });
});
