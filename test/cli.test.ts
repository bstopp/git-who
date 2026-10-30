import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import { ExitPromptError } from '@inquirer/core';

type Call = unknown[];

describe('cli.ts', () => {
  const commands = ['show', 'list', 'use', 'add', 'edit', 'remove', 'clone'] as const;
  let calls: Record<string, Call[]>;
  let showError: unknown;
  let logErrorCalls: string[];

  const loadCli = async () => {
    const commandMocks = Object.fromEntries(commands.map((name) => [
      `../src/commands/${name}.ts`,
      {
        default: async (...args: unknown[]) => {
          calls[name].push(args);
          if (name === 'show' && showError) {
            throw showError;
          }
        },
      },
    ]));
    return esmock<typeof import('../src/cli.ts')>('../src/cli.ts', {
      ...commandMocks,
      '../src/utils/log.ts': { default: { error: (msg: string) => logErrorCalls.push(msg) } },
    });
  };

  const parse = async (argv: string[]) => {
    const { program } = await loadCli();
    await program.parseAsync(['node', 'git-who', ...argv]);
  };

  beforeEach(() => {
    calls = Object.fromEntries(commands.map((name) => [name, []]));
    showError = undefined;
    logErrorCalls = [];
  });

  describe('routing', () => {
    for (const name of ['show', 'use', 'edit', 'remove'] as const) {
      it(`calls ${name} without a name when none is given`, async () => {
        await parse([name]);
        assert.equal(calls[name].length, 1);
        assert.equal(calls[name][0][0], undefined);
      });

      it(`calls ${name} with the given profile name`, async () => {
        await parse([name, 'work']);
        assert.equal(calls[name].length, 1);
        assert.equal(calls[name][0][0], 'work');
      });
    }

    for (const name of ['list', 'add'] as const) {
      it(`calls ${name}`, async () => {
        await parse([name]);
        assert.equal(calls[name].length, 1);
      });
    }

    it('calls clone with the repo and no name when only the repo is given', async () => {
      await parse(['clone', 'org/repo']);
      assert.equal(calls.clone.length, 1);
      assert.deepEqual(calls.clone[0].slice(0, 2), ['org/repo', undefined]);
    });

    it('calls clone with the repo and the profile name', async () => {
      await parse(['clone', 'org/repo', 'work']);
      assert.deepEqual(calls.clone[0].slice(0, 2), ['org/repo', 'work']);
    });
  });

  describe('run', () => {
    afterEach(() => {
      process.exitCode = undefined; // a failing run sets it, which would otherwise fail the mocha process
    });

    it('leaves the exit code alone and logs nothing on success', async () => {
      const { run } = await loadCli();
      await run(['node', 'git-who', 'show']);
      assert.equal(process.exitCode, undefined);
      assert.deepEqual(logErrorCalls, []);
    });

    it('logs the message and sets a failing exit code when a command throws', async () => {
      const error = new Error('config is corrupt');
      showError = error;
      const { run } = await loadCli();
      await run(['node', 'git-who', 'show']);
      assert.equal(process.exitCode, 1);
      assert.deepEqual(logErrorCalls, [error.message]);
    });

    it('logs every message in the cause chain, outermost first', async () => {
      const root = new Error('ENOENT: gpg');
      const middle = new Error('Failed to list keys', { cause: root });
      showError = new Error('Failed to apply profile', { cause: middle });
      const { run } = await loadCli();
      await run(['node', 'git-who', 'show']);
      assert.deepEqual(logErrorCalls, [
        `Failed to apply profile\nCaused by: ${middle.message}\nCaused by: ${root.message}`,
      ]);
    });

    it('exits quietly with the SIGINT exit code when a prompt is cancelled', async () => {
      showError = new ExitPromptError();
      const { run } = await loadCli();
      await run(['node', 'git-who', 'show']);
      assert.equal(process.exitCode, 130);
      assert.deepEqual(logErrorCalls, []);
    });

    it('still logs an error that only looks like a cancelled prompt', async () => {
      const lookalike = new Error('User force closed the prompt');
      showError = lookalike;
      const { run } = await loadCli();
      await run(['node', 'git-who', 'show']);
      assert.equal(process.exitCode, 1);
      assert.deepEqual(logErrorCalls, [lookalike.message]);
    });

    it('logs a non-Error rejection as a string', async () => {
      showError = 'boom';
      const { run } = await loadCli();
      await run(['node', 'git-who', 'show']);
      assert.equal(process.exitCode, 1);
      assert.deepEqual(logErrorCalls, ['boom']);
    });
  });
});
