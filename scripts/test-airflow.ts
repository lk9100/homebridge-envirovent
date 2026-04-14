/**
 * Test: Can the unit accept airflow percentages below the first preset (24%)?
 *
 * Plan:
 *   1. Read current state (baseline)
 *   2. Set VAR mode at 15%
 *   3. Read state — did it accept it?
 *   4. Restore original setting (SET mark 1)
 *   5. Read state — confirm restoration
 */

import { EnviroventClient } from '../src/api/client.js';

const host = process.argv[2] ?? '192.168.1.160';
const client = new EnviroventClient({ host });

async function readAndPrint(label: string) {
  const result = await client.getSettings();
  console.log(`\n[${label}]`);
  console.log(`  airflow.mode  = ${result.settings.airflow.mode}`);
  console.log(`  airflow.value = ${result.settings.airflow.value}`);
  console.log(`  airflow.active = ${result.settings.airflow.active}`);
  console.log(`  boost.enabled = ${result.settings.boost.enabled}`);
  return result;
}

try {
  // 1. Baseline
  const baseline = await readAndPrint('BASELINE');
  const s = baseline.settings;

  // 2. Set VAR mode at 15%
  console.log('\n--- Setting airflow to VAR 15% ---');
  const setResult = await client.setHomeSettings({
    airflow: { mode: 'VAR', value: 15 },
    heater: { autoActive: s.heater.autoActive },
    boost: { mins: s.boost.mins },
    filter: { resetMonths: s.filter.resetMonths },
    summerBypass: { summerShutdown: s.summerBypass.summerShutdown },
  });
  console.log(`  setHomeSettings result: success=${setResult.success}`);

  // 3. Read back — did it accept 15%?
  await readAndPrint('AFTER SET VAR 15%');

  // 4. Restore original setting
  console.log('\n--- Restoring original: SET mark 1 ---');
  const restoreResult = await client.setHomeSettings({
    airflow: { mode: 'SET', value: 1 },
    heater: { autoActive: s.heater.autoActive },
    boost: { mins: s.boost.mins },
    filter: { resetMonths: s.filter.resetMonths },
    summerBypass: { summerShutdown: s.summerBypass.summerShutdown },
  });
  console.log(`  restore result: success=${restoreResult.success}`);

  // 5. Confirm restoration
  await readAndPrint('AFTER RESTORE');

  console.log('\nDone.');
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}
