import * as net from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';
import { EnviroventClient } from '../../src/api/client.js';
import { CommandError, ConnectionError } from '../../src/api/errors.js';
import { pivSettingsResponse, createMockUnit, closeTcpServer } from '../fixtures.js';

let testServer: net.Server | undefined;

afterEach(async () => {
  if (testServer) {
    await closeTcpServer(testServer);
    testServer = undefined;
  }
});

describe('EnviroventClient', () => {
  it('getSettings returns parsed PIV settings', async () => {
    const { server, port } = await createMockUnit((cmd) => {
      expect(cmd.command).toBe('GetCurrentSettings');
      return pivSettingsResponse;
    });
    testServer = server;

    const client = new EnviroventClient({ host: '127.0.0.1', port });
    const result = await client.getSettings();

    expect(result.success).toBe(true);
    expect(result.unitType).toBe('piv');
    expect(result.settings.airflow.mode).toBe('VAR');
    expect(result.settings.airflow.value).toBe(45);
    expect(result.settings.heater.temperature).toBe(12);
  });

  it('setBoost sends correct command and parses response', async () => {
    const { server, port } = await createMockUnit((cmd) => {
      expect(cmd.command).toBe('SetBoost');
      expect(cmd.enabled).toBe(1);
      return { success: 1 };
    });
    testServer = server;

    const client = new EnviroventClient({ host: '127.0.0.1', port });
    const result = await client.setBoost(true);
    expect(result.success).toBe(true);
  });

  it('getStatus works', async () => {
    const { server, port } = await createMockUnit((cmd) => {
      expect(cmd.command).toBe('GetStatus');
      return { success: 1 };
    });
    testServer = server;

    const client = new EnviroventClient({ host: '127.0.0.1', port });
    const result = await client.getStatus();
    expect(result.success).toBe(true);
  });

  it('throws CommandError when unit returns an error', async () => {
    const { server, port } = await createMockUnit(() => {
      return { success: 0, error: 'unit busy' };
    });
    testServer = server;

    const client = new EnviroventClient({ host: '127.0.0.1', port });
    await expect(client.getStatus()).rejects.toThrow(CommandError);
  });

  it('throws ConnectionError when unit is unreachable', async () => {
    const client = new EnviroventClient({ host: '127.0.0.1', port: 19999, timeout: 1000 });
    await expect(client.getSettings()).rejects.toThrow(ConnectionError);
  });

  it('serializes concurrent commands (mutex)', async () => {
    const commandOrder: string[] = [];
    const { server, port } = await createMockUnit((cmd) => {
      commandOrder.push(cmd.command as string);
      return { success: 1 };
    });
    testServer = server;

    const client = new EnviroventClient({ host: '127.0.0.1', port });

    // Fire 3 commands concurrently
    await Promise.all([
      client.getStatus(),
      client.setBoost(true),
      client.setBoost(false),
    ]);

    // All 3 should have executed (in order, one at a time)
    expect(commandOrder).toHaveLength(3);
    expect(commandOrder[0]).toBe('GetStatus');
    expect(commandOrder[1]).toBe('SetBoost');
    expect(commandOrder[2]).toBe('SetBoost');
  });

  it('setHomeSettings sends correct payload', async () => {
    let receivedCmd: Record<string, unknown> = {};
    const { server, port } = await createMockUnit((cmd) => {
      receivedCmd = cmd;
      return { success: 1 };
    });
    testServer = server;

    const client = new EnviroventClient({ host: '127.0.0.1', port });
    await client.setHomeSettings({
      airflow: { mode: 'VAR', value: 60 },
      heater: { autoActive: true },
      boost: { mins: 40 },
      filter: { resetMonths: 24 },
      summerBypass: { summerShutdown: false },
    });

    expect(receivedCmd.command).toBe('SetHomeSettings');
    const settings = receivedCmd.settings as Record<string, unknown>;
    expect(settings).toBeDefined();
  });

  it('filterMaintenanceComplete sends correct command', async () => {
    const { server, port } = await createMockUnit((cmd) => {
      expect(cmd.command).toBe('FilterMaintenanceComplete');
      return { success: 1 };
    });
    testServer = server;

    const client = new EnviroventClient({ host: '127.0.0.1', port });
    const result = await client.filterMaintenanceComplete();
    expect(result.success).toBe(true);
  });

  it('setSummerBypass sends correct command', async () => {
    const { server, port } = await createMockUnit((cmd) => {
      expect(cmd.command).toBe('SetSummerBypass');
      expect(cmd.enabled).toBe(1);
      return { success: 1 };
    });
    testServer = server;

    const client = new EnviroventClient({ host: '127.0.0.1', port });
    const result = await client.setSummerBypass(true);
    expect(result.success).toBe(true);
  });

  it('setInstallerSettings sends correct command', async () => {
    let receivedCmd: Record<string, unknown> = {};
    const { server, port } = await createMockUnit((cmd) => {
      receivedCmd = cmd;
      return { success: 1 };
    });
    testServer = server;

    const client = new EnviroventClient({ host: '127.0.0.1', port });
    await client.setInstallerSettings({
      airflow: { mode: 'SET', value: 3 },
      heater: { autoActive: true, temperature: 10 },
      boost: { mins: 40 },
      filter: { resetMonths: 36 },
      summerBypass: { temperature: 25, summerShutdown: true },
      spigot: { type: 2 },
    });
    expect(receivedCmd.command).toBe('SetInstallerSettings');
  });

  it('setSpigotType sends correct command', async () => {
    const { server, port } = await createMockUnit((cmd) => {
      expect(cmd.command).toBe('SetSpigotType');
      expect(cmd.type).toBe(2);
      return { success: 1 };
    });
    testServer = server;

    const client = new EnviroventClient({ host: '127.0.0.1', port });
    const result = await client.setSpigotType(2);
    expect(result.success).toBe(true);
  });

  it('restoreHomeDefaults sends correct command', async () => {
    const { server, port } = await createMockUnit((cmd) => {
      expect(cmd.command).toBe('RestoreHomeSettingsToFactoryDefaults');
      return { success: 1 };
    });
    testServer = server;

    const client = new EnviroventClient({ host: '127.0.0.1', port });
    const result = await client.restoreHomeDefaults();
    expect(result.success).toBe(true);
  });

  it('restoreInstallerDefaults sends correct command', async () => {
    const { server, port } = await createMockUnit((cmd) => {
      expect(cmd.command).toBe('RestoreInstallerSettingsToFactoryDefaults');
      return { success: 1 };
    });
    testServer = server;

    const client = new EnviroventClient({ host: '127.0.0.1', port });
    const result = await client.restoreInstallerDefaults();
    expect(result.success).toBe(true);
  });

  it('restoreCommissioningDefaults sends correct command', async () => {
    const { server, port } = await createMockUnit((cmd) => {
      expect(cmd.command).toBe('RestoreCommissioningSettingsToFactoryDefaults');
      return { success: 1 };
    });
    testServer = server;

    const client = new EnviroventClient({ host: '127.0.0.1', port });
    const result = await client.restoreCommissioningDefaults();
    expect(result.success).toBe(true);
  });

  it('uses default port 1337', () => {
    const client = new EnviroventClient({ host: '192.168.1.100' });
    expect(client.port).toBe(1337);
  });

  it('uses custom port and timeout', () => {
    const client = new EnviroventClient({ host: '192.168.1.100', port: 9999, timeout: 5000 });
    expect(client.port).toBe(9999);
    expect(client.timeout).toBe(5000);
  });
});
