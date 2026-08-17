import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

export let tmpHome = '';

export const mochaHooks = {
  beforeEach: async () => {
    tmpHome = await mkdtemp(path.join(os.tmpdir(), 'git-who-test-'));
  },
  afterEach: async () => {
    await rm(tmpHome, { recursive: true, force: true });
  },
};
