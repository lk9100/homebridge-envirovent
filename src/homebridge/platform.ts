import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { createEnviroventAccessory, type EnviroventAccessoryContext } from './accessory.js';

export interface EnviroventPlatformConfig extends PlatformConfig {
  host?: string;
  port?: number;
  pollInterval?: number;
  showBoostSwitch?: boolean;
  advanced?: {
    showHeaterSwitch?: boolean;
    showSummerShutdownSwitch?: boolean;
  };
}

export class EnviroventPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly cachedAccessories: Map<string, PlatformAccessory> = new Map();
  private readonly activeAccessories: Map<string, EnviroventAccessoryContext> = new Map();

  constructor(
    public readonly log: Logging,
    public readonly config: EnviroventPlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  /**
   * Called by Homebridge when restoring cached accessories from disk.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Restoring cached accessory:', accessory.displayName);
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  private discoverDevices(): void {
    const host = this.config.host;
    if (!host) {
      this.log.error('No host configured. Set "host" in the plugin config to your unit\'s IP address.');
      // TODO: Add mDNS auto-discovery fallback
      return;
    }

    const port = this.config.port ?? 1337;
    const uuid = this.api.hap.uuid.generate(`envirovent-piv-${host}:${port}`);
    const displayName = this.config.name ?? 'Envirovent PIV';

    // Check if we have a cached accessory for this UUID
    let accessory = this.cachedAccessories.get(uuid);
    if (accessory) {
      this.log.info('Restoring existing accessory from cache:', displayName);
    } else {
      this.log.info('Adding new accessory:', displayName);
      accessory = new this.api.platformAccessory(displayName, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    // Store device context for the accessory
    accessory.context.host = host;
    accessory.context.port = port;

    const enviroventAccessory = createEnviroventAccessory(this, accessory);
    this.activeAccessories.set(uuid, enviroventAccessory);

    // Remove any cached accessories that are no longer active
    for (const [cachedUuid, cachedAccessory] of this.cachedAccessories) {
      if (!this.activeAccessories.has(cachedUuid)) {
        this.log.info('Removing orphaned accessory:', cachedAccessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cachedAccessory]);
      }
    }
  }
}
