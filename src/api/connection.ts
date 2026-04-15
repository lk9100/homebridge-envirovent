import * as net from 'node:net';
import { ConnectionError, NoResponseError, TimeoutError } from './errors.js';
import { DEFAULTS } from './types.js';

/**
 * Send a JSON command to the Envirovent unit over a raw TCP socket.
 *
 * Protocol: open socket → write UTF-8 payload → read response → close.
 * Each command is a separate TCP connection (the unit doesn't support keep-alive).
 *
 * The unit has no framing protocol — we read 1024-byte chunks and stop when
 * a chunk is smaller than 1024 bytes (matching the Android app's behavior).
 *
 * Known edge cases from this heuristic:
 * - A response exactly 1024 bytes won't trigger the < 1024 check; the socket
 *   timeout resolves it instead (adds up to `timeout` ms of latency).
 * - If the unit sends a response in multiple small chunks (each < 1024 bytes),
 *   the first chunk would be treated as the complete response. In practice the
 *   unit sends the full response in a single write, so this doesn't occur.
 */
export const sendCommand = async (
  host: string,
  port: number,
  payload: string,
  timeout: number = DEFAULTS.TIMEOUT,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;

    const socket = new net.Socket();
    socket.setTimeout(timeout);

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        fn();
      }
    };

    socket.on('connect', () => {
      socket.write(payload, 'utf8');
    });

    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      // The unit sends the full response in one go. If a chunk is less than
      // 1024 bytes, we've received everything (matching the Android app's read strategy).
      if (chunk.length < 1024) {
        const response = Buffer.concat(chunks).toString('utf8');
        settle(() => resolve(response));
      }
    });

    socket.on('end', () => {
      // Server closed the connection — use whatever we have
      const response = Buffer.concat(chunks).toString('utf8');
      settle(() => {
        if (response.length === 0) {
          reject(new NoResponseError(host, port));
        } else {
          resolve(response);
        }
      });
    });

    socket.on('timeout', () => {
      // If we have data and are waiting for more, treat what we have as complete
      if (chunks.length > 0) {
        const response = Buffer.concat(chunks).toString('utf8');
        settle(() => resolve(response));
      } else {
        settle(() => reject(new TimeoutError(host, port, timeout)));
      }
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      settle(() => reject(new ConnectionError(host, port, err)));
    });

    socket.connect(port, host);
  });
