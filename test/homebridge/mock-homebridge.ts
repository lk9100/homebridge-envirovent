/**
 * Lightweight Homebridge mocks for testing service handlers.
 *
 * We mock just enough of the Homebridge API to test characteristic
 * get/set handlers and update calls without a real HAP stack.
 */
import { vi } from 'vitest';
import type { PivSettings, AirflowMode, SpigotType } from '../../src/api/types.js';

export const createMockSettings = (overrides?: Partial<PivSettings>): PivSettings => ({
  airflow: { mode: 'VAR' as AirflowMode, value: 45, active: true },
  airflowConfiguration: {
    maps: [
      { mark: 1, percent: 40 },
      { mark: 2, percent: 60 },
      { mark: 3, percent: 80 },
    ],
    minPercentage: 8,
    maxPercentage: 100,
    varMinPercentage: 24,
  },
  heater: { autoActive: true, temperature: 12 },
  boost: { enabled: false, mins: 20 },
  boostInput: { enabled: false },
  filter: { remainingDays: 180, resetMonths: 12 },
  summerBypass: { active: false, temperature: 22, summerShutdown: true },
  spigot: { type: 1 as SpigotType, canChange: false },
  kickUp: { active: false },
  hoursRun: 8760,
  ...overrides,
});

// Mock characteristic that stores handlers
export const createMockCharacteristic = () => {
  let getHandler: (() => unknown) | undefined;
  let setHandler: ((value: unknown) => Promise<void>) | undefined;
  let value: unknown = null;
  let props: Record<string, unknown> = {};

  const self = {
    onGet(handler: () => unknown) { getHandler = handler; return self; },
    onSet(handler: (value: unknown) => Promise<void>) { setHandler = handler; return self; },
    setProps(p: Record<string, unknown>) { props = p; return self; },
    updateValue(v: unknown) { value = v; },
    // Test helpers
    simulateGet(): unknown { return getHandler?.(); },
    async simulateSet(v: unknown): Promise<void> { await setHandler?.(v); },
    getValue(): unknown { return value; },
    getProps(): Record<string, unknown> { return props; },
  };
  return self;
};

export type MockCharacteristic = ReturnType<typeof createMockCharacteristic>;

// Mock service
export interface MockService {
  displayName: string;
  getCharacteristic(type: { UUID?: string } | string): MockCharacteristic;
  updateCharacteristic(type: { UUID?: string } | string, value: unknown): MockService;
  addLinkedService(service: unknown): MockService;
}

export const createMockService = (displayName: string = ''): MockService => {
  const characteristics = new Map<string, MockCharacteristic>();
  const linkedServices: MockService[] = [];

  const self: MockService = {
    displayName,
    getCharacteristic(type: { UUID?: string } | string): MockCharacteristic {
      const key = typeof type === 'string' ? type : (type as { UUID: string }).UUID ?? String(type);
      if (!characteristics.has(key)) {
        characteristics.set(key, createMockCharacteristic());
      }
      return characteristics.get(key)!;
    },
    updateCharacteristic(type: { UUID?: string } | string, value: unknown): MockService {
      self.getCharacteristic(type).updateValue(value);
      return self;
    },
    addLinkedService(service: unknown) {
      linkedServices.push(service as MockService);
      return self;
    },
  };
  return self;
};

// Mock platform with minimal Characteristic/Service references
export const createMockPlatform = () => {
  // Characteristic constants — using objects with UUID so they can be used as Map keys
  const ActiveChar = { UUID: 'Active', ACTIVE: 1, INACTIVE: 0 };
  const RotationSpeedChar = { UUID: 'RotationSpeed' };
  const CurrentFanStateChar = {
    UUID: 'CurrentFanState',
    INACTIVE: 0,
    IDLE: 1,
    BLOWING_AIR: 2,
  };
  const OnChar = { UUID: 'On' };
  const FilterChangeIndicationChar = {
    UUID: 'FilterChangeIndication',
    FILTER_OK: 0,
    CHANGE_FILTER: 1,
  };
  const FilterLifeLevelChar = { UUID: 'FilterLifeLevel' };

  return {
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    Service: {
      Fanv2: 'Fanv2',
      Switch: 'Switch',
      FilterMaintenance: 'FilterMaintenance',
      AccessoryInformation: 'AccessoryInformation',
    },
    Characteristic: {
      Active: ActiveChar,
      RotationSpeed: RotationSpeedChar,
      CurrentFanState: CurrentFanStateChar,
      On: OnChar,
      FilterChangeIndication: FilterChangeIndicationChar,
      FilterLifeLevel: FilterLifeLevelChar,
    },
    config: {
      showBoostSwitch: true,
    },
  };
};

export const createMockAccessory = (platformOverrides?: Partial<ReturnType<typeof createMockPlatform>>) => {
  const platform = { ...createMockPlatform(), ...platformOverrides };
  const services = new Map<string, MockService>();

  const accessory = {
    getService(type: string) {
      return services.get(type) ?? null;
    },
    addService(type: string, name: string, subtype?: string) {
      const service = createMockService(name);
      // Register by type so getService(platform.Service.Fanv2) works
      services.set(type, service);
      // Also register by name for getService('Boost') lookups
      services.set(name, service);
      if (subtype) services.set(subtype, service);
      return service;
    },
  };

  return { platform, accessory, services };
};
