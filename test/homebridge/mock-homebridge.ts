/**
 * Lightweight Homebridge mocks for testing service handlers.
 *
 * We mock just enough of the Homebridge API to test characteristic
 * get/set handlers and update calls without a real HAP stack.
 */
import { vi } from 'vitest';
import type { PivSettings, AirflowMode, SpigotType } from '../../src/api/types.js';

export function createMockSettings(overrides?: Partial<PivSettings>): PivSettings {
  return {
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
  };
}

// Mock characteristic that stores handlers
export class MockCharacteristic {
  private getHandler?: () => unknown;
  private setHandler?: (value: unknown) => Promise<void>;
  private value: unknown = null;
  props: Record<string, unknown> = {};

  onGet(handler: () => unknown) {
    this.getHandler = handler;
    return this;
  }

  onSet(handler: (value: unknown) => Promise<void>) {
    this.setHandler = handler;
    return this;
  }

  setProps(props: Record<string, unknown>) {
    this.props = props;
    return this;
  }

  updateValue(value: unknown) {
    this.value = value;
  }

  // Test helpers
  simulateGet(): unknown {
    return this.getHandler?.();
  }

  async simulateSet(value: unknown): Promise<void> {
    await this.setHandler?.(value);
  }

  getValue(): unknown {
    return this.value;
  }
}

// Mock service
export class MockService {
  private characteristics = new Map<string, MockCharacteristic>();
  private linkedServices: MockService[] = [];
  displayName: string;

  constructor(displayName: string = '') {
    this.displayName = displayName;
  }

  getCharacteristic(type: { UUID?: string } | string): MockCharacteristic {
    const key = typeof type === 'string' ? type : (type as { UUID: string }).UUID ?? String(type);
    if (!this.characteristics.has(key)) {
      this.characteristics.set(key, new MockCharacteristic());
    }
    return this.characteristics.get(key)!;
  }

  updateCharacteristic(type: { UUID?: string } | string, value: unknown): MockService {
    this.getCharacteristic(type).updateValue(value);
    return this;
  }

  addLinkedService(service: unknown) {
    this.linkedServices.push(service as MockService);
    return this;
  }
}

// Mock platform with minimal Characteristic/Service references
export function createMockPlatform() {
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
}

export function createMockAccessory(platformOverrides?: Partial<ReturnType<typeof createMockPlatform>>) {
  const platform = { ...createMockPlatform(), ...platformOverrides };
  const services = new Map<string, MockService>();

  const accessory = {
    getService(type: string) {
      return services.get(type) ?? null;
    },
    addService(_type: string, name: string, subtype?: string) {
      const key = subtype ?? name;
      const service = new MockService(name);
      services.set(key, service);
      // Also register by name for getService('Boost') lookups
      services.set(name, service);
      return service;
    },
  };

  return { platform, accessory, services };
}
