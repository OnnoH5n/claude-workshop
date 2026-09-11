// Flat-file persistence. store.json is runtime state (gitignored); seed.json is the
// committed known-good state `make reset` restores from.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Portfolio } from '../shared/types.ts';

const DATA_DIR = join(import.meta.dirname, '..', 'data');
const SEED = join(DATA_DIR, 'seed.json');
const STORE = join(DATA_DIR, 'store.json');

export function read(): Portfolio {
  if (!existsSync(STORE)) copyFileSync(SEED, STORE);
  return JSON.parse(readFileSync(STORE, 'utf8')) as Portfolio;
}

export function write(state: Portfolio): void {
  writeFileSync(STORE, `${JSON.stringify(state, null, 2)}\n`);
}

/** Restore runtime state from the committed seed. Powers `make reset` and test isolation. */
export function reset(): Portfolio {
  copyFileSync(SEED, STORE);
  return read();
}
