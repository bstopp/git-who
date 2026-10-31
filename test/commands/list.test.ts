import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import type { SimpleGit } from 'simple-git';
import { ambiguousProfiles } from '../fixtures.ts';
import type { Profile } from '../../src/profile.ts';

type Mocks = Record<string, object>;

describe('commands/list.ts', async () => {
  let profiles: Profile[] = ambiguousProfiles;
  let activeName: string | undefined;
  let logInfo: string = '';
  let logJson: unknown;

  const fakeGit = {} as SimpleGit;

  const profilesMock = {
    '../../src/utils/profiles.ts': {
      loadProfiles: async () => profiles,
      getActiveProfileName: async (git: SimpleGit) => {
        assert.equal(git, fakeGit, 'getActiveProfileName should receive the simpleGit instance');
        return activeName;
      },
    },
  };

  const profilesFail = {
    '../../src/utils/profiles.ts': {
      loadProfiles: async () => {
        throw new Error('config is corrupt');
      },
      getActiveProfileName: async () => {
        assert.fail('getActiveProfileName should not be called');
      },
    },
  };

  const logMock = {
    '../../src/utils/log.ts': {
      default: {
        info: (msg: string) => logInfo = msg,
        json: (value: unknown) => logJson = value,
      },
    },
  };

  const simpleGitMock = {
    'simple-git': {
      simpleGit: () => fakeGit,
    },
  };

  const chalkFail = {
    chalk: {
      default: {
        bold: () => {
          assert.fail('chalk.bold should not be called');
        },
      },
    },
  };

  const chalkMock = {
    chalk: {
      default: {
        bold: (text: string) => `[bold]${text}[/bold]`,
      },
    },
  };

  const loadList = async (overrides: Mocks = {}) => {
    const { default: list } = await esmock<typeof import('../../src/commands/list.ts')>(
      '../../src/commands/list.ts',
      {
        ...profilesMock,
        ...logMock,
        ...simpleGitMock,
        ...chalkFail,
        ...overrides, // same key wins, so it replaces the default
      },
    );
    return list;
  };

  beforeEach(async () => {
    profiles = ambiguousProfiles;
    activeName = undefined;
    logInfo = '';
    logJson = undefined;
  });

  it('passes through loadProfiles failures', async () => {
    const list = await loadList({
      ...profilesFail,
    });
    await assert.rejects(() => list(), { message: 'config is corrupt' });
  });

  it('prints all profiles', async () => {
    const list = await loadList();
    await assert.doesNotReject(() => list());
    const lines: string[] = logInfo.split('\n');
    assert.equal(lines.length, 4);
    assert(lines.some((line) => line === 'Known profiles:'));
    assert(lines.some((line) => line === '  - work (github-work)'));
    assert(lines.some((line) => line === '  - work-gpg-signed (github-work)'));
    assert(lines.some((line) => line === '  - work-ssh-signed (github-work)'));
  });

  it('highlights active profile via gitwho.profile', async () => {
    activeName = ambiguousProfiles[1].name;
    const list = await loadList({
      ...chalkMock,
    });
    await assert.doesNotReject(() => list());
    const lines: string[] = logInfo.split('\n');
    assert.equal(lines.length, 4);
    assert(lines.some((line) => line === 'Known profiles:'));
    assert(lines.some((line) => line === '  - work (github-work)'));
    assert(lines.some((line) => line === '[bold]  - work-gpg-signed (github-work)[/bold]'));
    assert(lines.some((line) => line === '  - work-ssh-signed (github-work)'));
  });

  describe('with json', () => {
    it('prints every profile with its fields and flags the active one', async () => {
      activeName = ambiguousProfiles[1].name;
      const list = await loadList();
      await assert.doesNotReject(() => list({ json: true }));
      assert.deepEqual(logJson, ambiguousProfiles.map((p) => ({ ...p, active: p.name === activeName })));
      assert.equal(logInfo, '', 'the text listing should not be printed');
    });

    it('flags no profile as active when none is set', async () => {
      const list = await loadList();
      await assert.doesNotReject(() => list({ json: true }));
      assert.deepEqual(logJson, ambiguousProfiles.map((p) => ({ ...p, active: false })));
    });

    it('passes through loadProfiles failures without printing anything', async () => {
      const list = await loadList({
        ...profilesFail,
      });
      await assert.rejects(() => list({ json: true }), { message: 'config is corrupt' });
      assert.equal(logJson, undefined);
    });
  });
});
