import * as net from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';
import { sendCommand } from '../../src/api/connection.js';
import { ConnectionError, TimeoutError, NoResponseError } from '../../src/api/errors.js';

function createMockServer(handler: (socket: net.Socket, data: string) => void): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
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
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

let testServer: net.Server | undefined;

afterEach(async () => {
  if (testServer) {
    await closeServer(testServer);
    testServer = undefined;
  }
});

describe('sendCommand', () => {
  it('sends a JSON payload and receives a response', async () => {
    const { server, port } = await createMockServer((socket, data) => {
      const cmd = JSON.parse(data);
      expect(cmd.command).toBe('GetStatus');
      socket.end(JSON.stringify({ success: 1 }));
    });
    testServer = server;

    const result = await sendCommand('127.0.0.1', port, '{"command":"GetStatus"}');
    expect(JSON.parse(result)).toEqual({ success: 1 });
  });

  it('handles large responses correctly', async () => {
    const largePayload = { success: 1, data: 'x'.repeat(2000) };
    const { server, port } = await createMockServer((socket) => {
      socket.end(JSON.stringify(largePayload));
    });
    testServer = server;

    const result = await sendCommand('127.0.0.1', port, '{"command":"GetCurrentSettings"}');
    expect(JSON.parse(result)).toEqual(largePayload);
  });

  it('throws ConnectionError when connection is refused', async () => {
    // Use a port that nothing is listening on
    await expect(
      sendCommand('127.0.0.1', 19999, '{}', 2000),
    ).rejects.toThrow(ConnectionError);
  });

  it('throws TimeoutError when server does not respond', async () => {
    const { server, port } = await createMockServer(() => {
      // Intentionally never respond
    });
    testServer = server;

    await expect(
      sendCommand('127.0.0.1', port, '{"command":"GetStatus"}', 500),
    ).rejects.toThrow(TimeoutError);
  });

  it('throws NoResponseError when server closes connection with no data', async () => {
    const { server, port } = await createMockServer((socket) => {
      socket.end(); // Close immediately with no data
    });
    testServer = server;

    await expect(
      sendCommand('127.0.0.1', port, '{"command":"GetStatus"}'),
    ).rejects.toThrow(NoResponseError);
  });

  it('resolves with data when server closes connection after sending', async () => {
    const { server, port } = await createMockServer((socket) => {
      socket.end('{"success":1}');
    });
    testServer = server;

    const result = await sendCommand('127.0.0.1', port, '{"command":"GetStatus"}');
    expect(JSON.parse(result)).toEqual({ success: 1 });
  });

  it('handles exactly-1024-byte response by using timeout fallback', async () => {
    // If the response is exactly 1024 bytes, the < 1024 check doesn't trigger.
    // The socket timeout should kick in and resolve with whatever data we have.
    const paddedResponse = JSON.stringify({ success: 1, pad: 'x'.repeat(990) });
    // Make payload exactly 1024 bytes
    const exactPayload = paddedResponse.padEnd(1024, ' ');
    expect(exactPayload.length).toBe(1024);

    const { server, port } = await createMockServer((socket) => {
      socket.write(exactPayload);
      // Don't close — let the read timeout resolve it
    });
    testServer = server;

    const result = await sendCommand('127.0.0.1', port, '{"command":"GetStatus"}', 1000);
    expect(result.trim()).toBe(paddedResponse);
  });
});
