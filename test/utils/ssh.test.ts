import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import { sshKeys } from '../fixtures.ts';

type Mocks = Record<string, object>;

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

// What `ssh -G` resolves each host in validConfig to, in the order they appear.
const hostnames: Record<string, string> = {
  'github-work': 'github-work.github.com',
  work: 'work.github.com',
  'github-personal': 'github-personal.github.com',
  'github.com': 'github.com',
};

const hostEntries = (hosts: Record<string, string>) => {
  return Object.entries(hosts).map(([host, hostname]) => ({ host, hostname }));
};

describe('utils/ssh.ts', () => {
  // undefined means the call is not expected, Error means it throws
  let configContents: string | Error | undefined;
  let dirFiles: string[] | Error | undefined;
  let sshResults: Record<string, string | Error>;
  const logWarnCalls: string[] = [];

  const homedirMock = { 'node:os': { homedir: () => '/home/user' } };

  const fsPromisesMock = {
    'node:fs/promises': {
      readFile: async (path: string) => {
        assert.equal(path, '/home/user/.ssh/config');
        if (configContents === undefined) {
          assert.fail('readFile should not have been called.');
        }
        if (configContents instanceof Error) {
          throw configContents;
        }
        return configContents;
      },
      readdir: async (path: string) => {
        assert.equal(path, '/home/user/.ssh');
        if (dirFiles === undefined) {
          assert.fail('readdir should not have been called.');
        }
        if (dirFiles instanceof Error) {
          throw dirFiles;
        }
        return dirFiles;
      },
    },
  };

  const utilMock = {
    'node:util': {
      promisify: () => async (cmd: string, args: string[]) => {
        assert.equal(cmd, 'ssh');
        assert.equal(args.length, 2);
        assert.equal(args[0], '-G');
        const result = sshResults[args[1]];
        if (result === undefined) {
          assert.fail('Invalid args found.');
        }
        if (result instanceof Error) {
          throw result;
        }
        return { stdout: `hostname ${result}\n`, stderr: '' };
      },
    },
  };

  const logFail = {
    '../../src/utils/log.ts': {
      default: {
        warn: () => {
          assert.fail('log warn should not be called.');
        },
      },
    },
  };

  const logMock = {
    '../../src/utils/log.ts': {
      default: {
        warn: (msg: string) => logWarnCalls.push(msg),
      },
    },
  };

  const loadSsh = async (overrides: Mocks = {}) => {
    return esmock<typeof import('../../src/utils/ssh.ts')>(
      '../../src/utils/ssh.ts',
      {
        ...homedirMock,
        ...fsPromisesMock,
        ...utilMock,
        ...logFail,
        ...overrides, // same key wins, so it replaces the default
      },
    );
  };

  beforeEach(() => {
    configContents = undefined;
    dirFiles = undefined;
    sshResults = {};
    logWarnCalls.length = 0;
  });

  describe('listSshHosts', () => {
    it('propagates a read error unmodified', async () => {
      configContents = new Error('An Error');
      const { listSshHosts } = await loadSsh();
      await assert.rejects(listSshHosts(), { message: 'An Error' });
    });

    it('throws when config has no valid Host entries', async () => {
      configContents = invalidConfig;
      const { listSshHosts } = await loadSsh();
      await assert.rejects(listSshHosts(), { message: 'No SSH host aliases found in ~/.ssh/config.' });
    });

    it('throws when no ssh -G succeeds', async () => {
      configContents = validConfig;
      sshResults = Object.fromEntries(Object.keys(hostnames).map((host) => [host, new Error('ssh not found.')]));
      const { listSshHosts } = await loadSsh({
        ...logMock,
      });
      await assert.rejects(listSshHosts(), { message: 'No SSH host aliases found in ~/.ssh/config.' });
      assert.equal(logWarnCalls.length, Object.keys(hostnames).length);
      for (const host of Object.keys(hostnames)) {
        assert.ok(logWarnCalls.find((call) => call.includes(`Unable to look up host '${host}':`)));
      }
    });

    it('builds a single entry result', async () => {
      configContents = 'Host github-work # Work Profile\nUser git\nIdentityFile ~/.ssh/id_work';
      sshResults = { 'github-work': 'github.com' };
      const { listSshHosts } = await loadSsh();
      const hosts = await listSshHosts();
      assert.deepEqual(hosts, [{ host: 'github-work', hostname: 'github.com' }]);
    });

    it('builds map of hosts & hostnames', async () => {
      configContents = fullConfig;
      sshResults = { ...hostnames };
      const { listSshHosts } = await loadSsh();
      const hosts = await listSshHosts();
      assert.deepEqual(hosts, hostEntries(hostnames));
    });

    it('logs error if one fails', async () => {
      configContents = validConfig;
      sshResults = { ...hostnames, work: new Error('ssh -G work failed.') };
      const { listSshHosts } = await loadSsh({
        ...logMock,
      });

      const hosts = await listSshHosts();
      const { work: _, ...expected } = hostnames;
      assert.deepEqual(hosts, hostEntries(expected));
      assert.ok(logWarnCalls.find((call) => call.includes("Unable to look up host 'work':")));
    });
  });

  describe('listSshKeys', () => {
    it('propagates a readdir error unmodified', async () => {
      dirFiles = new Error('readdir failed');
      const { listSshKeys } = await loadSsh();
      await assert.rejects(listSshKeys(), { message: 'readdir failed' });
    });

    it('returns an empty array when there are no keys', async () => {
      dirFiles = ['config', '.pub.foo'];
      const { listSshKeys } = await loadSsh();
      const actual = await listSshKeys();
      assert.deepEqual(actual, []);
    });

    it('returns found & filtered keys', async () => {
      dirFiles = ['id_work.pub', 'id_personal.pub', 'config', '.pub.foo'];
      const { listSshKeys } = await loadSsh();
      const actual = await listSshKeys();
      assert.deepEqual(actual, sshKeys);
    });
  });
});
