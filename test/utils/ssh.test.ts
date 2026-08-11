import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import { sshKeys } from '../fixtures.ts';

const invalidConfig = `
Host *.example.com

Host web?

Host !foo.example.com # Not foo.
    
Host *
    ServerAliveInterval 60
`;

const validConfig = `
Host github-work\twork # Work Profile
    User git
    IdentityFile ~/.ssh/id_work

Host  github-personal # Personal Profile
    IdentityFile ~/.ssh/id_personal

Host github*
    HostName github.com
    User git

Host github.com github-personal
    User git
`;

const fullConfig = `
${validConfig}
${invalidConfig}
`;

describe('utils/ssh.ts', () => {
  describe('listSshHosts', () => {
    const readFileSuccess = (config: string) => {
      return async (path: string) => {
        assert.strictEqual(path, '/home/user/.ssh/config');
        return config;
      };
    };

    const readdirFail = () => {
      return () => assert.fail('readdir should not have been called.');
    };

    const fsPromises = (config: string) => {
      return {
        'node:fs/promises': {
          readFile: readFileSuccess(config),
          readdir: readdirFail(),
        },
      };
    };

    const homedir = { 'node:os': { homedir: () => '/home/user' } };

    it('propagates a read error unmodified', async () => {
      const { listSshHosts } = await esmock<typeof import('../../src/utils/ssh.ts')>('../../src/utils/ssh.js', {
        'node:fs/promises': {
          readFile: async () => {
            throw new Error('An Error');
          },
          readdir: readdirFail(),
        },
      });
      await assert.rejects(listSshHosts(), { message: 'An Error' });
    });

    it('throws when config has no valid Host entries', async () => {
      const { listSshHosts } = await esmock<typeof import('../../src/utils/ssh.ts')>('../../src/utils/ssh.js', {
        ...fsPromises(invalidConfig),
        ...homedir,
      });
      await assert.rejects(listSshHosts(), { message: 'No SSH host aliases found in ~/.ssh/config.' });
    });

    it('throws when no ssh -G succeeds', async () => {
      const logWarnCalls: string[] = [];
      const { listSshHosts } = await esmock<typeof import('../../src/utils/ssh.ts')>('../../src/utils/ssh.js', {
        ...fsPromises(validConfig),
        ...homedir,
        'node:util': {
          promisify: () => async (cmd: string) => {
            assert.equal(cmd, 'ssh');
            throw new Error('ssh not found.');
          },
        },
        '../../src/utils/log.ts': {
          default: {
            warn: (msg: string) => logWarnCalls.push(msg),
          },
        },
      });
      await assert.rejects(listSshHosts(), { message: 'No SSH host aliases found in ~/.ssh/config.' });
      assert.equal(logWarnCalls.length, 4);
      assert.ok(logWarnCalls.find((call) => call.includes("Unable to look up host 'github-work':")));
      assert.ok(logWarnCalls.find((call) => call.includes("Unable to look up host 'work':")));
      assert.ok(logWarnCalls.find((call) => call.includes("Unable to look up host 'github-personal':")));
      assert.ok(logWarnCalls.find((call) => call.includes("Unable to look up host 'github.com':")));
    });

    it('builds a single entry result', async () => {
      const { listSshHosts } = await esmock<typeof import('../../src/utils/ssh.ts')>('../../src/utils/ssh.js', {
        'node:fs/promises': {
          readFile: async (path: string) => {
            assert.strictEqual(path, '/home/user/.ssh/config');
            return 'Host github-work # Work Profile\nUser git\nIdentityFile ~/.ssh/id_work';
          },
          readdir: readdirFail(),
        },
        ...homedir,
        'node:util': {
          promisify: () => async (cmd: string, args: string[]) => {
            assert.equal(cmd, 'ssh');
            assert.deepEqual(args, ['-G', 'github-work']);
            return { stdout: 'hostname github.com\n', stderr: '' };
          },
        },
      });
      const hosts = await listSshHosts();
      assert.deepEqual(hosts, [{ host: 'github-work', hostname: 'github.com' }]);
    });

    it('builds map of hosts & hostnames', async () => {
      const { listSshHosts } = await esmock<typeof import('../../src/utils/ssh.ts')>('../../src/utils/ssh.js', {
        ...fsPromises(fullConfig),
        ...homedir,
        'node:util': {
          promisify: () => async (cmd: string, args: string[]) => {
            assert.equal(cmd, 'ssh');
            if (JSON.stringify(args) === JSON.stringify(['-G', 'github-work'])) {
              return { stdout: 'hostname github-work.github.com\n', stderr: '' };
            } else if (JSON.stringify(args) === JSON.stringify(['-G', 'work'])) {
              return { stdout: 'hostname work.github.com\n', stderr: '' };
            } else if (JSON.stringify(args) === JSON.stringify(['-G', 'github-personal'])) {
              return { stdout: 'hostname github-personal.github.com\n', stderr: '' };
            } else if (JSON.stringify(args) === JSON.stringify(['-G', 'github.com'])) {
              return { stdout: 'hostname github.com\n', stderr: '' };
            } else {
              assert.fail('Invalid args found.');
            }
          },
        },
      });
      const hosts = await listSshHosts();
      assert.equal(hosts.length, 4);
      assert.deepEqual(
        hosts.find((h) => h.host === 'github-work'),
        { host: 'github-work', hostname: 'github-work.github.com' },
        'Github work not found.',
      );
      assert.deepEqual(
        hosts.find((h) => h.host === 'work'),
        { host: 'work', hostname: 'work.github.com' },
        'Github.com work not found.',
      );
      assert.deepEqual(
        hosts.find((h) => h.host === 'github-personal'),
        { host: 'github-personal', hostname: 'github-personal.github.com' },
        'Github personal not found.',
      );
      assert.deepEqual(
        hosts.find((h) => h.host === 'github.com'),
        { host: 'github.com', hostname: 'github.com' },
        'Github.com not found.',
      );
    });

    it('logs error if one fails', async () => {
      const logWarnCalls: string[] = [];
      const { listSshHosts } = await esmock<typeof import('../../src/utils/ssh.ts')>('../../src/utils/ssh.js', {
        ...fsPromises(validConfig),
        ...homedir,
        'node:util': {
          promisify: () => async (cmd: string, args: string[]) => {
            assert.equal(cmd, 'ssh');
            if (JSON.stringify(args) === JSON.stringify(['-G', 'github-work'])) {
              return { stdout: 'hostname github-work.github.com\n', stderr: '' };
            } else if (JSON.stringify(args) === JSON.stringify(['-G', 'work'])) {
              throw Error('ssh -G work failed.');
            } else if (JSON.stringify(args) === JSON.stringify(['-G', 'github-personal'])) {
              return { stdout: 'hostname github-personal.github.com\n', stderr: '' };
            } else if (JSON.stringify(args) === JSON.stringify(['-G', 'github.com'])) {
              return { stdout: 'hostname github.com\n', stderr: '' };
            } else {
              assert.fail('Invalid args found.');
            }
          },
        },
        '../../src/utils/log.ts': {
          default: {
            warn: (msg: string) => logWarnCalls.push(msg),
          },
        },
      });

      const hosts = await listSshHosts();
      assert.equal(hosts.length, 3);
      assert.deepEqual(
        hosts.find((h) => h.host === 'github-work'),
        { host: 'github-work', hostname: 'github-work.github.com' },
        'Github work not found.',
      );
      assert.deepEqual(
        hosts.find((h) => h.host === 'github-personal'),
        { host: 'github-personal', hostname: 'github-personal.github.com' },
        'Github personal not found.',
      );
      assert.deepEqual(
        hosts.find((h) => h.host === 'github.com'),
        { host: 'github.com', hostname: 'github.com' },
        'Github.com not found.',
      );
      assert.ok(logWarnCalls.find((call) => call.includes("Unable to look up host 'work':")));
    });
  });

  describe('listSshKeys', () => {
    const readFileFail = () => {
      return () => assert.fail('readFile should not have been called.');
    };

    const readdirSuccess = (files: string[]) => {
      return () => files;
    };

    const fsPromises = (files: string[]) => {
      return {
        'node:fs/promises': {
          readFile: readFileFail(),
          readdir: readdirSuccess(files),
        },
      };
    };

    const homedir = { 'node:os': { homedir: () => '/home/user' } };

    it('propagates a readdir error unmodified', async () => {
      const { listSshKeys } = await esmock<typeof import('../../src/utils/ssh.ts')>('../../src/utils/ssh.js', {
        'node:fs/promises': {
          readFile: readFileFail(),
          readdir: () => {
            throw new Error('readdir failed');
          },
        },
        ...homedir,
      });
      await assert.rejects(listSshKeys(), { message: 'readdir failed' });
    });

    it('returns an empty array when there are no keys', async () => {
      const files = ['config', '.pub.foo'];
      const { listSshKeys } = await esmock<typeof import('../../src/utils/ssh.ts')>('../../src/utils/ssh.js', {
        ...fsPromises(files),
        ...homedir,
      });
      const actual = await listSshKeys();
      assert.deepEqual(actual, []);
    });

    it('returns found & filtered keys', async () => {
      const files = ['id_work.pub', 'id_personal.pub', 'config', '.pub.foo'];
      const { listSshKeys } = await esmock<typeof import('../../src/utils/ssh.ts')>('../../src/utils/ssh.js', {
        ...fsPromises(files),
        ...homedir,
      });
      const actual = await listSshKeys();
      assert.deepEqual(actual, sshKeys);
    });
  });
});
