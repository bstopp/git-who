import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import type { SimpleGit } from 'simple-git';

type Mocks = Record<string, object>;
type ConfigCall = { key: string; value: string };

const HOOK_NAME = 'git-who';
const COMMAND_KEY = `hook.${HOOK_NAME}.command`;
const EVENT_KEY = `hook.${HOOK_NAME}.event`;

describe('commands/hook.ts', async () => {
  let isRepo = true;
  let installedCommand: string | null = null;
  let listOutput: string | Error = `${HOOK_NAME}\n`;
  const addConfigCalls: ConfigCall[] = [];
  const rawCalls: string[][] = [];
  const simpleGitCalls: (string | undefined)[] = [];
  const logInfoCalls: string[] = [];

  const fakeGit = {
    checkIsRepo: async () => isRepo,
    getConfig: async (key: string, scope: string) => {
      assert.equal(scope, 'local');
      return { value: key === COMMAND_KEY ? installedCommand : null };
    },
    addConfig: async (key: string, value: string, append: boolean, scope: string) => {
      assert.equal(append, false);
      assert.equal(scope, 'local');
      addConfigCalls.push({ key, value });
      return '';
    },
    raw: async (args: string[]) => {
      rawCalls.push(args);
      if (args[0] === 'hook') {
        assert.deepEqual(args, ['hook', 'list', 'pre-commit']);
        if (listOutput instanceof Error) {
          throw listOutput;
        }
        return listOutput;
      }
      return '';
    },
  } as unknown as SimpleGit;

  const simpleGitMock = { 'simple-git': {
    simpleGit: (baseDir?: string) => {
      simpleGitCalls.push(baseDir);
      return fakeGit;
    },
  } };

  const logMock = {
    '../../src/utils/log.ts': {
      default: { info: (msg: string) => logInfoCalls.push(msg) },
    },
  };

  const loadHook = (overrides: Mocks = {}) => esmock<typeof import('../../src/commands/hook.ts')>(
    '../../src/commands/hook.ts',
    { ...simpleGitMock, ...logMock, ...overrides },
  );

  // The calls that take the hook out of the config again, by the command that does it.
  const removalCalls = [
    ['config', '--local', '--unset', COMMAND_KEY],
    ['config', '--local', '--unset-all', EVENT_KEY],
  ];

  beforeEach(() => {
    isRepo = true;
    installedCommand = null;
    listOutput = `${HOOK_NAME}\n`;
    addConfigCalls.length = 0;
    rawCalls.length = 0;
    simpleGitCalls.length = 0;
    logInfoCalls.length = 0;
  });

  describe('install', () => {
    it('throws when the current directory is not a git repo', async () => {
      isRepo = false;
      const { install } = await loadHook();
      await assert.rejects(() => install(), { message: 'The current directory must have a git repository to install the hook.' });
      assert.deepEqual(addConfigCalls, []);
    });

    it('sets the command and the event in the local config, then checks that git lists the hook', async () => {
      const { install } = await loadHook();
      await assert.doesNotReject(() => install());
      assert.deepEqual(addConfigCalls, [
        { key: COMMAND_KEY, value: 'git who check' },
        { key: EVENT_KEY, value: 'pre-commit' },
      ]);
      assert.deepEqual(rawCalls, [['hook', 'list', 'pre-commit']]);
      assert.deepEqual(logInfoCalls, ['Installed the pre-commit hook. Commits in this repo now run `git who check`.']);
    });

    it('works in the given directory instead of the current one', async () => {
      const { install } = await loadHook();
      await assert.doesNotReject(() => install('repo'));
      assert.deepEqual(simpleGitCalls, ['repo']);
    });

    it('is not fooled by other hooks that are listed', async () => {
      listOutput = `husky\n${HOOK_NAME}\n`;
      const { install } = await loadHook();
      await assert.doesNotReject(() => install());
    });

    for (const [name, output] of [
      ['lists nothing', ''],
      ['only lists other hooks', `${HOOK_NAME}-other\nhusky\n`],
      ['cannot list hooks, as when none are found or it is too old', new Error('warning: no hooks found for event')],
    ] as const) {
      it(`takes the hook out of the config and throws when git ${name}`, async () => {
        listOutput = output;
        const { install } = await loadHook();
        await assert.rejects(() => install(), {
          message: 'Git did not list the hook once it was installed, so it may be too old to run config hooks (hook.<name>.*). The hook was not installed.',
        });
        assert.deepEqual(rawCalls, [['hook', 'list', 'pre-commit'], ...removalCalls]);
        assert.deepEqual(logInfoCalls, []);
      });
    }
  });

  describe('uninstall', () => {
    it('throws when the current directory is not a git repo', async () => {
      isRepo = false;
      const { uninstall } = await loadHook();
      await assert.rejects(() => uninstall(), { message: 'The current directory must have a git repository to uninstall the hook.' });
      assert.deepEqual(rawCalls, []);
    });

    it('says so, and changes nothing, when the hook is not installed', async () => {
      const { uninstall } = await loadHook();
      await assert.doesNotReject(() => uninstall());
      assert.deepEqual(rawCalls, []);
      assert.deepEqual(logInfoCalls, ['The pre-commit hook is not installed.']);
    });

    it('takes the command and the event out of the local config', async () => {
      installedCommand = 'git who check';
      const { uninstall } = await loadHook();
      await assert.doesNotReject(() => uninstall());
      assert.deepEqual(rawCalls, removalCalls);
      assert.deepEqual(logInfoCalls, ['Removed the pre-commit hook.']);
    });
  });
});
