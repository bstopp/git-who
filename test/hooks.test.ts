import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';

describe('test/hooks.ts', () => {
  const names = ['exec', 'execFile', 'execFileSync', 'execSync', 'fork', 'spawn', 'spawnSync'] as const;

  for (const name of names) {
    it(`blocks child_process.${name}()`, () => {
      // Looked up per test: the guard is installed in a root hook, after the tests are collected.
      const spawner = childProcess[name] as (...args: unknown[]) => unknown;
      assert.throws(() => spawner('git', ['--version']), {
        message: new RegExp(`child_process\\.${name}\\(\\) was called in a test`),
      });
    });
  }
});
