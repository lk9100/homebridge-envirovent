/**
 * Test: Does the unit support fine-grained VAR percentages within the valid range?
 *
 * Hypothesis: VAR mode supports 1% increments from 24% upward.
 * The previous test (15%) was below the floor, so it got clamped to 24%.
 *
 * Plan:
 *   1. Read baseline
 *   2. Set VAR 33% (between presets 24% and 37% — not a preset mark)
 *   3. Read back — does it stay at 33% or snap to 37%?
 *   4. Set VAR 51% (between presets 50% and 66%)
 *   5. Read back
 *   6. Restore original (SET mark 1)
 */

import { EnviroventClient } from '../src/api/client.js';

const host = process.argv[2] ?? '192.168.1.160';
const client = new EnviroventClient({ host });

async function readAirflow(label: string) {
  const result = await client.getSettings();
  const a = result.settings.airflow;
  console.log(`[${label}] mode=${a.mode} value=${a.value} active=${a.active}`);
  return result;
}

try {
  const baseline = await readAirflow('BASELINE');
  const s = baseline.settings;

  // Preserve all other settings for each setHomeSettings call
  const otherSettings = {
    heater: { autoActive: s.heater.autoActive },
    boost: { mins: s.boost.mins },
    filter: { resetMonths: s.filter.resetMonths },
    summerBypass: { summerShutdown: s.summerBypass.summerShutdown },
  };

  // Test 1: 33% (between preset marks 24% and 37%)
  console.log('\n--- Setting VAR 33% ---');
  await client.setHomeSettings({ airflow: { mode: 'VAR', value: 33 }, ...otherSettings });
  await readAirflow('AFTER VAR 33%');

  // Test 2: 51% (between preset marks 50% and 66%)
  console.log('\n--- Setting VAR 51% ---');
  await client.setHomeSettings({ airflow: { mode: 'VAR', value: 51 }, ...otherSettings });
  await readAirflow('AFTER VAR 51%');

  // Test 3: 24% exactly (the floor)
  console.log('\n--- Setting VAR 24% ---');
  await client.setHomeSettings({ airflow: { mode: 'VAR', value: 24 }, ...otherSettings });
  await readAirflow('AFTER VAR 24%');

  // Test 4: 25% (one above floor)
  console.log('\n--- Setting VAR 25% ---');
  await client.setHomeSettings({ airflow: { mode: 'VAR', value: 25 }, ...otherSettings });
  await readAirflow('AFTER VAR 25%');

  // Restore
  console.log('\n--- Restoring SET mark 1 ---');
  await client.setHomeSettings({ airflow: { mode: 'SET', value: 1 }, ...otherSettings });
  await readAirflow('RESTORED');

  console.log('\nDone.');
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}
