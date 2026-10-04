import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import type { SimpleGit } from 'simple-git';
import { ambiguousProfiles } from '../fixtures.ts';

const fakeGit = {} as SimpleGit;

describe('commands/list.ts', async () => {
  it('passes through loadProfiles failures', async () => {
    const { default: list } = await esmock<typeof import('../../src/commands/list.ts')>('../../src/commands/list.ts', {
      '../../src/utils/profiles.ts': {
        loadProfiles: async () => {
          throw new Error('config is corrupt');
        },
        getActiveProfileName: async () => {
          assert.fail('getActiveProfileName should not be called');
        },
      },
    });
    await assert.rejects(() => list(), { message: 'config is corrupt' });
  });

  it('prints all profiles', async () => {
    let logInfo: string = '';
    const { default: list } = await esmock<typeof import('../../src/commands/list.ts')>('../../src/commands/list.ts', {
      '../../src/utils/profiles.ts': {
        loadProfiles: async () => ambiguousProfiles,
        getActiveProfileName: async (git: SimpleGit) => {
          assert.equal(git, fakeGit, 'getActiveProfileName should receive the simpleGit instance');
          return undefined;
        },
      },
      '../../src/utils/log.ts': {
        default: {
          info: (msg: string) => logInfo = msg,
        },
      },
      'simple-git': {
        simpleGit: () => fakeGit,
      },
      chalk: {
        default: {
          bold: () => {
            assert.fail('chalk.bold should not be called');
          },
        },
      },
    });
    await assert.doesNotReject(() => list());
    const lines: string[] = logInfo.split('\n');
    assert.equal(lines.length, 4);
    assert(lines.some((line) => line === 'Known profiles:'));
    assert(lines.some((line) => line === '  - work (github-work)'));
    assert(lines.some((line) => line === '  - work-gpg-signed (github-work)'));
    assert(lines.some((line) => line === '  - work-ssh-signed (github-work)'));
  });

  it('highlights active profile via gitwho.profile', async () => {
    let logInfo: string = '';
    const { default: list } = await esmock<typeof import('../../src/commands/list.ts')>('../../src/commands/list.ts', {
      '../../src/utils/profiles.ts': {
        loadProfiles: async () => ambiguousProfiles,
        getActiveProfileName: async (git: SimpleGit) => {
          assert.equal(git, fakeGit, 'getActiveProfileName should receive the simpleGit instance');
          return ambiguousProfiles[1].name;
        },
      },
      '../../src/utils/log.ts': {
        default: {
          info: (msg: string) => logInfo = msg,
        },
      },
      'simple-git': {
        simpleGit: () => fakeGit,
      },
      chalk: {
        default: {
          bold: (text: string) => {
            return `[bold]${text}[/bold]`;
          },
        },
      },
    });
    await assert.doesNotReject(() => list());
    const lines: string[] = logInfo.split('\n');
    assert.equal(lines.length, 4);
    assert(lines.some((line) => line === 'Known profiles:'));
    assert(lines.some((line) => line === '  - work (github-work)'));
    assert(lines.some((line) => line === '[bold]  - work-gpg-signed (github-work)[/bold]'));
    assert(lines.some((line) => line === '  - work-ssh-signed (github-work)'));
  });
});
