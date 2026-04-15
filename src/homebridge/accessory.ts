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
}

const MIN_POLL_INTERVAL = 5;

export const createEnviroventAccessory = (
  platform: EnviroventPlatform,
  accessory: PlatformAccessory,
): EnviroventAccessoryContext => {
  const host = accessory.context.host as string;
  const port = (accessory.context.port as number) ?? DEFAULTS.PORT;

  const client = createEnviroventClient({ host, port });
  const commandQueue = createCommandQueue({ retries: 1, retryDelay: 1000 });
  const unitState = createUnitState(client, { failureThreshold: 3 });

  const ctx: EnviroventAccessoryContext = { platform, accessory, client, commandQueue, unitState };

  // ─── Accessory information ─────────────────────────────────
  const infoService = accessory.getService(platform.Service.AccessoryInformation);
  if (infoService) {
    infoService
      .setCharacteristic(platform.Characteristic.Manufacturer, 'Envirovent')
      .setCharacteristic(platform.Characteristic.Model, 'Atmos PIV')
      .setCharacteristic(platform.Characteristic.SerialNumber, `${host}:${port}`);
  }

  // ─── Register services ─────────────────────────────────────
  const services: { update(): void }[] = [];
  services.push(createFanService(ctx));
  services.push(createFilterService(ctx));

  const showBoost = platform.config.showBoostSwitch ?? true;
  if (showBoost) {
    services.push(createBoostService(ctx));
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
  unitState.poll().catch((err) => {
    platform.log.error('Initial poll failed:', err);
  });

  setInterval(() => {
    unitState.poll().catch((err) => {
      platform.log.debug('Poll failed:', err);
    });
  }, intervalMs);

  return ctx;
};
