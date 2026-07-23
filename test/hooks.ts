import { unlink } from 'node:fs/promises';

export const CFG_PATH = '/tmp/git-who-test.cfg.json';

process.env.GIT_WHO_CFG = CFG_PATH;

export const mochaHooks = {
  afterEach: async () => {
    process.env.GIT_WHO_CFG = CFG_PATH;
    await unlink(CFG_PATH).catch(() => {});
  },
};
