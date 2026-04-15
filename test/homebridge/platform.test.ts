import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnviroventPlatform } from '../../src/homebridge/platform.js';
import type { API, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

// ─── Mock createEnviroventAccessory to avoid real TCP/timer side-effects
vi.mock('../../src/homebridge/accessory.js', () => ({
  createEnviroventAccessory: vi.fn(() => ({
    client: {},
    commandQueue: {},
    unitState: {},
    dispose: vi.fn(),
  })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────

const createMockAPI = () => {
  const listeners: Record<string, (() => void)[]> = {};

  const mockAccessory = (displayName: string, uuid: string) => ({
    displayName,
    UUID: uuid,
    context: {} as Record<string, unknown>,
    getService: vi.fn(() => null),
    addService: vi.fn(),
  });

  const api = {
    hap: {
      Service: {},
      Characteristic: {},
      uuid: {
        generate: vi.fn((input: string) => `uuid-${input}`),
      },
    },
    on(event: string, handler: () => void) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    platformAccessory: vi.fn((displayName: string, uuid: string) => mockAccessory(displayName, uuid)),
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    /** Test helper: fire a registered event. */
    _emit(event: string) {
      for (const handler of listeners[event] ?? []) handler();
    },
  } as unknown as API & { _emit: (event: string) => void };

  return api;
};

const createMockLog = (): Logging =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }) as unknown as Logging;

// ─── Tests ────────────────────────────────────────────────────────────

describe('EnviroventPlatform', () => {
  let api: ReturnType<typeof createMockAPI>;
  let log: Logging;

  beforeEach(() => {
    api = createMockAPI();
    log = createMockLog();
    vi.clearAllMocks();
  });

  it('stores Service and Characteristic from api.hap', () => {
    const config = { platform: 'EnviroventPIV', host: '10.0.0.1' } as PlatformConfig;
    const platform = new EnviroventPlatform(log, config, api);

    expect(platform.Service).toBe(api.hap.Service);
    expect(platform.Characteristic).toBe(api.hap.Characteristic);
  });

  it('configureAccessory caches restored accessories', () => {
    const config = { platform: 'EnviroventPIV', host: '10.0.0.1' } as PlatformConfig;
    const platform = new EnviroventPlatform(log, config, api);

    const mockAccessory = {
      displayName: 'Cached PIV',
      UUID: 'cached-uuid',
      context: {},
    } as unknown as PlatformAccessory;

    platform.configureAccessory(mockAccessory);
    expect(log.info).toHaveBeenCalledWith('Restoring cached accessory:', 'Cached PIV');
  });

  it('logs error and returns early when no host configured', () => {
    const config = { platform: 'EnviroventPIV' } as PlatformConfig;
    new EnviroventPlatform(log, config, api);

    // Trigger didFinishLaunching
    api._emit('didFinishLaunching');

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No host configured'));
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
  });

  it('creates and registers a new accessory when no cached accessory exists', async () => {
    const { createEnviroventAccessory } = await import('../../src/homebridge/accessory.js');

    const config = { platform: 'EnviroventPIV', host: '10.0.0.1' } as PlatformConfig;
    new EnviroventPlatform(log, config, api);

    api._emit('didFinishLaunching');

    expect(api.hap.uuid.generate).toHaveBeenCalledWith('envirovent-piv-10.0.0.1:1337');
    expect(api.platformAccessory).toHaveBeenCalledWith('Envirovent PIV', expect.any(String));
    expect(api.registerPlatformAccessories).toHaveBeenCalled();
    expect(createEnviroventAccessory).toHaveBeenCalled();
  });

  it('uses configured port in UUID generation', () => {
    const config = { platform: 'EnviroventPIV', host: '10.0.0.1', port: 9999 } as unknown as PlatformConfig;
    new EnviroventPlatform(log, config, api);

    api._emit('didFinishLaunching');

    expect(api.hap.uuid.generate).toHaveBeenCalledWith('envirovent-piv-10.0.0.1:9999');
  });

  it('uses configured name for display', () => {
    const config = { platform: 'EnviroventPIV', host: '10.0.0.1', name: 'My PIV' } as unknown as PlatformConfig;
    new EnviroventPlatform(log, config, api);

    api._emit('didFinishLaunching');

    expect(api.platformAccessory).toHaveBeenCalledWith('My PIV', expect.any(String));
  });

  it('restores cached accessory instead of creating new one', async () => {
    const { createEnviroventAccessory } = await import('../../src/homebridge/accessory.js');

    const config = { platform: 'EnviroventPIV', host: '10.0.0.1' } as PlatformConfig;
    const platform = new EnviroventPlatform(log, config, api);

    const uuid = 'uuid-envirovent-piv-10.0.0.1:1337';
    const cachedAccessory = {
      displayName: 'Envirovent PIV',
      UUID: uuid,
      context: {} as Record<string, unknown>,
      getService: vi.fn(() => null),
    } as unknown as PlatformAccessory;

    platform.configureAccessory(cachedAccessory);

    api._emit('didFinishLaunching');

    // Should NOT create a new platformAccessory
    expect(api.platformAccessory).not.toHaveBeenCalled();
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    // Should still wire up the accessory
    expect(createEnviroventAccessory).toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('Restoring existing accessory from cache:', expect.any(String));
  });

  it('removes orphaned cached accessories', () => {
    const config = { platform: 'EnviroventPIV', host: '10.0.0.1' } as PlatformConfig;
    const platform = new EnviroventPlatform(log, config, api);

    // Cache an accessory with a UUID that won't match the discovered device
    const orphanedAccessory = {
      displayName: 'Old Device',
      UUID: 'orphaned-uuid',
      context: {},
      getService: vi.fn(() => null),
    } as unknown as PlatformAccessory;

    platform.configureAccessory(orphanedAccessory);

    api._emit('didFinishLaunching');

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-envirovent',
      'EnviroventPIV',
      [orphanedAccessory],
    );
    expect(log.info).toHaveBeenCalledWith('Removing orphaned accessory:', 'Old Device');
  });

  it('sets host and port on accessory context', async () => {
    const config = { platform: 'EnviroventPIV', host: '10.0.0.1', port: 5000 } as unknown as PlatformConfig;
    new EnviroventPlatform(log, config, api);

    api._emit('didFinishLaunching');

    // The mock platformAccessory constructor returns an object with context
    const createdAccessory = (api.platformAccessory as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(createdAccessory.context.host).toBe('10.0.0.1');
    expect(createdAccessory.context.port).toBe(5000);
  });
});
