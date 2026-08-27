/**
 * governor-status.ts — `pnpm governor:status`.
 *
 * Prints the quota governor's view of the world: how much of the Claude window
 * the daemon has spent, where autonomy stops, and which backends are cooling.
 */

import { existsSync } from 'node:fs';
import { killSwitchFilePath, ledgerFilePath, status } from './quota-governor';

const s = status();

console.log('\n=== Quota Governor ===');
console.table({
  enabled: s.enabled,
  killSwitch: s.killSwitch,
  window: `${s.windowHours}h`,
  used: `${s.used} / ${s.max}`,
  autonomyFloor: s.reserveFloor,
  remainingForAutonomy: s.remainingForAutonomy,
  reserveForAlex: s.max - s.reserveFloor,
});

console.log('Backends:');
console.table(s.backends);

console.log(
  `ledger:      ${ledgerFilePath()}${existsSync(ledgerFilePath()) ? '' : ' (not created yet)'}`,
);
console.log(`kill switch: touch ${killSwitchFilePath()} to stop all autonomous spawns`);
console.log('');
