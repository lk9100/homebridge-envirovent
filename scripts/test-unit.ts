/**
 * Quick test script — connects to a real Envirovent unit and dumps its settings.
 * Read-only: only sends GetCurrentSettings, does NOT change anything.
 *
 * Usage: npx tsx scripts/test-unit.ts <ip> [port]
 */

import { sendCommand } from '../src/api/connection.js';
import { parseGetCurrentSettings } from '../src/api/commands.js';
import { DEFAULTS } from '../src/api/types.js';

const host = process.argv[2];
const port = Number(process.argv[3]) || DEFAULTS.PORT;

if (!host) {
  console.error('Usage: npx tsx scripts/test-unit.ts <ip> [port]');
  process.exit(1);
}

console.log(`Connecting to ${host}:${port}...`);
console.log(`Sending: {"command":"GetCurrentSettings"}`);
console.log('---');

try {
  const raw = await sendCommand(host, port, '{"command":"GetCurrentSettings"}', DEFAULTS.TIMEOUT);
  console.log('Raw response:');
  console.log(raw);
  console.log('---');

  const parsed = parseGetCurrentSettings(raw);
  console.log('Parsed settings:');
  console.log(JSON.stringify(parsed, null, 2));
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}
