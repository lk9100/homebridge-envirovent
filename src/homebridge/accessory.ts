import type { PlatformAccessory, Service } from 'homebridge';
import type { EnviroventPlatform } from './platform.js';
import { EnviroventClient } from '../api/client.js';
import { CommandQueue } from '../state/command-queue.js';
import { UnitState } from '../state/unit-state.js';
import { FanService } from './services/fan.js';
import { BoostService } from './services/boost.js';
import { FilterService } from './services/filter.js';

const MIN_POLL_INTERVAL = 5;
const DEFAULT_POLL_INTERVAL = 5;

export class EnviroventAccessory {
  public readonly client: EnviroventClient;
  public readonly commandQueue: CommandQueue;
  public readonly unitState: UnitState;

  private pollTimer?: ReturnType<typeof setInterval>;
  private readonly services: { update(): void }[] = [];

  constructor(
    public readonly platform: EnviroventPlatform,
    public readonly accessory: PlatformAccessory,
  ) {
    const host = accessory.context.host as string;
    const port = (accessory.context.port as number) ?? 1337;

    this.client = new EnviroventClient({ host, port });
    this.commandQueue = new CommandQueue({ retries: 1, retryDelay: 1000 });
    this.unitState = new UnitState(this.client, { failureThreshold: 3 });

    // ─── Accessory information ─────────────────────────────────
    const infoService = this.accessory.getService(this.platform.Service.AccessoryInformation);
    if (infoService) {
      infoService
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Envirovent')
        .setCharacteristic(this.platform.Characteristic.Model, 'Atmos PIV')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, `${host}:${port}`);
    }

    // ─── Register services ─────────────────────────────────────
    this.services.push(new FanService(this));
    this.services.push(new FilterService(this));

    const showBoost = this.platform.config.showBoostSwitch ?? true;
    if (showBoost) {
      this.services.push(new BoostService(this));
    }

    // ─── State event handlers ──────────────────────────────────
    this.unitState.on('stateChanged', () => {
      for (const service of this.services) {
        service.update();
      }
    });

    this.unitState.on('connectionLost', () => {
      this.platform.log.warn(`Lost connection to unit at ${host}:${port}`);
    });

    this.unitState.on('connectionRestored', () => {
      this.platform.log.info(`Connection restored to unit at ${host}:${port}`);
    });

    this.unitState.on('pollError', (err: Error) => {
      this.platform.log.debug(`Poll error: ${err.message}`);
    });

    // ─── Start polling ─────────────────────────────────────────
    this.startPolling();
  }

  private startPolling(): void {
    const configInterval = this.platform.config.pollInterval ?? DEFAULT_POLL_INTERVAL;
    const intervalSec = Math.max(configInterval, MIN_POLL_INTERVAL);
    const intervalMs = intervalSec * 1000;

    this.platform.log.info(`Polling unit every ${intervalSec}s`);

    // Initial poll
    this.unitState.poll().catch((err) => {
      this.platform.log.error('Initial poll failed:', err);
    });

    this.pollTimer = setInterval(() => {
      this.unitState.poll().catch((err) => {
        this.platform.log.debug('Poll failed:', err);
      });
    }, intervalMs);
  }
}
