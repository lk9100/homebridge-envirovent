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
import { createSummerShutdownService } from './services/summer-shutdown.js';

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

  const showSummerShutdown = platform.config.advanced?.showSummerShutdownSwitch ?? false;
  if (showSummerShutdown) {
    services.push(createSummerShutdownService(ctx));
  }

  // Register service dispose functions
  for (const service of services) {
    if (service.dispose) disposables.push(service.dispose);
  }

  // ─── State event handlers ──────────────────────────────────
  /**
   * When the summer shutdown switch is hidden, the unit's summer shutdown
   * mode must stay off: nothing is exposed to control it. On failure the
   * state is left untouched, so the next event retries (self-healing).
   */
  const enforceSummerShutdownOff = async (): Promise<void> => {
    try {
      await commandQueue.enqueue(async () => client.setSummerBypass(false));
      // Preserve sibling fields — same one-level merge applyOptimistic performs
      const currentSummerBypass = unitState.settings?.summerBypass;
      unitState.applyOptimistic({
        summerBypass: {
          active: currentSummerBypass?.active ?? false,
          temperature: currentSummerBypass?.temperature ?? 22,
          summerShutdown: false,
        },
      });
      platform.log.info(`✅ ${accessory.displayName}: summer shutdown disabled (switch hidden)`);
    } catch (err) {
      platform.log.warn(`⚠️ ${accessory.displayName}: could not disable summer shutdown: ${(err as Error).message}`);
    }
  };

  const enforceHiddenSummerShutdown = (): void => {
    if (showSummerShutdown) return;
    if (unitState.settings?.summerBypass.summerShutdown === true) {
      void enforceSummerShutdownOff();
    }
  };

  unitState.on('stateChanged', () => {
    for (const service of services) {
      service.update();
    }
    enforceHiddenSummerShutdown();
  });

  unitState.on('connectionLost', () => {
    platform.log.warn(`⚠️ ${accessory.displayName} is not responding (${host}:${port})`);
  });

  unitState.on('connectionRestored', () => {
    platform.log.info(`✅ ${accessory.displayName} is back online`);
    enforceHiddenSummerShutdown();
  });

  unitState.on('pollError', (err: Error) => {
    platform.log.debug(`Poll error: ${err.message}`);
  });

  // ─── Start polling ─────────────────────────────────────────
  const configInterval = platform.config.pollInterval ?? MIN_POLL_INTERVAL;
  const intervalSec = Math.max(configInterval, MIN_POLL_INTERVAL);
  const intervalMs = intervalSec * 1000;

  platform.log.info(`🔄 Checking unit status every ${intervalSec}s`);

  // Initial poll
  void unitState.poll().catch((err: Error) => {
    /* v8 ignore next */
    platform.log.error('❌ Could not reach unit on first attempt — will keep trying:', err.message);
  });

  const pollTimer = setInterval(() => {
    void unitState.poll().catch((err: Error) => {
      /* v8 ignore next */
      platform.log.debug('Poll failed:', err);
    });
  }, intervalMs);

  disposables.push(() => clearInterval(pollTimer));
  disposables.push(() => unitState.dispose());

  return ctx;
};
