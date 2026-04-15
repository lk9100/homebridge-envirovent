import type { PlatformAccessory } from 'homebridge';
import type { EnviroventPlatform } from './platform.js';
import type { EnviroventClient } from '../api/client.js';
import type { CommandQueue } from '../state/command-queue.js';
import type { UnitState } from '../state/unit-state.js';
import { createEnviroventClient } from '../api/client.js';
import { DEFAULTS } from '../api/types.js';
import { createCommandQueue } from '../state/command-queue.js';
import { createUnitState } from '../state/unit-state.js';
import { createFanService } from './services/fan.js';
import { createBoostService } from './services/boost.js';
import { createFilterService } from './services/filter.js';

/** Shape shared between the accessory and all service factories. */
export interface EnviroventAccessoryContext {
  platform: EnviroventPlatform;
  accessory: PlatformAccessory;
  client: EnviroventClient;
  commandQueue: CommandQueue;
  unitState: UnitState;
  dispose: () => void;
}

const MIN_POLL_INTERVAL = 5;

export const createEnviroventAccessory = (
  platform: EnviroventPlatform,
  accessory: PlatformAccessory,
): EnviroventAccessoryContext => {
  const host = accessory.context.host;
  if (typeof host !== 'string' || host.length === 0) {
    throw new Error(`Accessory "${accessory.displayName}" has no valid host configured`);
  }

  const rawPort = accessory.context.port;
  const port = typeof rawPort === 'number' && rawPort > 0 ? rawPort : DEFAULTS.PORT;

  const client = createEnviroventClient({ host, port });
  const commandQueue = createCommandQueue({ retries: 1, retryDelay: 1000 });
  const unitState = createUnitState(client, { failureThreshold: 3 });

  const disposables: (() => void)[] = [];

  const dispose = (): void => {
    for (const fn of disposables) fn();
    disposables.length = 0;
  };

  const ctx: EnviroventAccessoryContext = { platform, accessory, client, commandQueue, unitState, dispose };

  // ─── Accessory information ─────────────────────────────────
  const infoService = accessory.getService(platform.Service.AccessoryInformation);
  if (infoService) {
    infoService
      .setCharacteristic(platform.Characteristic.Manufacturer, 'Envirovent')
      .setCharacteristic(platform.Characteristic.Model, 'Atmos PIV')
      .setCharacteristic(platform.Characteristic.SerialNumber, `${host}:${port}`);
  }

  // ─── Register services ─────────────────────────────────────
  const services: { update(): void; dispose?: () => void }[] = [];
  services.push(createFanService(ctx));
  services.push(createFilterService(ctx));

  const showBoost = platform.config.showBoostSwitch ?? true;
  if (showBoost) {
    services.push(createBoostService(ctx));
  }

  // Register service dispose functions
  for (const service of services) {
    if (service.dispose) disposables.push(service.dispose);
  }

  // ─── State event handlers ──────────────────────────────────
  unitState.on('stateChanged', () => {
    for (const service of services) {
      service.update();
    }
  });

  unitState.on('connectionLost', () => {
    platform.log.warn(`Lost connection to unit at ${host}:${port}`);
  });

  unitState.on('connectionRestored', () => {
    platform.log.info(`Connection restored to unit at ${host}:${port}`);
  });

  unitState.on('pollError', (err: Error) => {
    platform.log.debug(`Poll error: ${err.message}`);
  });

  // ─── Start polling ─────────────────────────────────────────
  const configInterval = platform.config.pollInterval ?? MIN_POLL_INTERVAL;
  const intervalSec = Math.max(configInterval, MIN_POLL_INTERVAL);
  const intervalMs = intervalSec * 1000;

  platform.log.info(`Polling unit every ${intervalSec}s`);

  // Initial poll
  void unitState.poll().catch((err: Error) => {
    platform.log.error('Initial poll failed:', err);
  });

  const pollTimer = setInterval(() => {
    void unitState.poll().catch((err: Error) => {
      platform.log.debug('Poll failed:', err);
    });
  }, intervalMs);

  disposables.push(() => clearInterval(pollTimer));
  disposables.push(() => unitState.dispose());

  return ctx;
};
