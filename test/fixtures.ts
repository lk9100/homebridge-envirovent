/**
 * Shared test fixtures — single source of truth for mock data used across test files.
 */
import * as net from 'node:net';

// ─── Wire-format response fixture ──────────────────────────────────

/** Realistic GetCurrentSettings response from a PIV unit (wire format with 0/1 booleans). */
export const pivSettingsResponse = {
  success: 1,
  unitType: 'piv',
  settings: {
    airflow: { mode: 'VAR', value: 45, active: 1 },
    heater: { autoActive: 1, temperature: 12 },
    boost: { enabled: 0, mins: 20 },
    boostInput: { enabled: 0 },
    filter: { remainingDays: 180, resetMonths: 12 },
    summerBypass: { active: 0, temperature: 22, summerShutdown: 1 },
    spigot: { type: 1, canChange: 0 },
    kickUp: { active: 0 },
    hoursRun: 8760,
  },
  airflowConfiguration: {
    maps: [
      { mark: 1, percent: 20 },
      { mark: 2, percent: 40 },
      { mark: 3, percent: 60 },
      { mark: 4, percent: 80 },
      { mark: 5, percent: 100 },
    ],
  },
};

// ─── TCP mock server helpers ───────────────────────────────────────

/** Create a TCP server that invokes `handler` with raw socket + received data. */
export const createMockTcpServer = (
  handler: (socket: net.Socket, data: string) => void,
): Promise<{ server: net.Server; port: number }> =>
  new Promise((resolve) => {
    const server = net.createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (chunk) => {
        chunks.push(chunk);
        const data = Buffer.concat(chunks).toString('utf8');
        handler(socket, data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });
  });

/** Create a TCP server that parses JSON commands and returns JSON responses. */
export const createMockUnit = (
  handler: (command: Record<string, unknown>) => Record<string, unknown>,
): Promise<{ server: net.Server; port: number }> =>
  createMockTcpServer((socket, data) => {
    try {
      const cmd = JSON.parse(data) as Record<string, unknown>;
      const response = handler(cmd);
      socket.end(JSON.stringify(response));
    } catch {
      // Wait for more data (incomplete JSON)
    }
  });

export const closeTcpServer = (server: net.Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));
