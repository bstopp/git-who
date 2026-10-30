import childProcess from 'node:child_process';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

export let tmpHome = '';

const SPAWNERS = ['exec', 'execFile', 'execFileSync', 'execSync', 'fork', 'spawn', 'spawnSync'] as const;

/**
 * Swap every child_process spawner for one that throws, so a test that forgets to mock a dependency fails instead of
 * running a real command. Builtin ESM exports are re-synced so modules that imported them by name see the swap.
 */
function blockSpawners() {
  const target = childProcess as unknown as Record<string, unknown>;
  for (const name of SPAWNERS) {
    target[name] = () => {
      throw new Error(`child_process.${name}() was called in a test. Mock the dependency that spawns it.`);
    };
  }
  module.syncBuiltinESMExports();
}

// Installed at load, not in a root hook: mocha loads this file before any spec, but a root hook would run after the specs
// were collected, and modules imported by then (e.g. gpg.ts doing promisify(execFile)) would already hold the real ones.
blockSpawners();

export const mochaHooks = {
  beforeEach: async () => {
    tmpHome = await mkdtemp(path.join(os.tmpdir(), 'git-who-test-'));
  },
  afterEach: async () => {
    await rm(tmpHome, { recursive: true, force: true });
  },
};
