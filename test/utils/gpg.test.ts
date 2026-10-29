import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';

const workKeyLines = [
  'sec:u:4096:1:1234567890ABCDEF:1234567890::u:::scESC:',
  'uid:u::::1234567890::abc::NoEmailHere::::::::::0:',
  'uid:e::::1234567890::def::Expired Name <expired@example.com>:::::::::0:',
  'uid:r::::1234567890::ghi::Old Name <old@example.com>:::::::::0:',
  'uid:u::::1234567890::jkl::Bryan Work <bryan@work.com>:::::::::0:',
  'uid:u::::1234567890::jkl::Bryan Personal <bryan@personal.com>:::::::::0:',
];

const janeKeyLines = [
  'sec:u:4096:1:FEDCBA0987654321:1234567890::u:::scESC:',
  'uid:u::::1234567890::ghi::Jane Doe <jane@work.com>:::::::::0:',
];

// No Revoked, No Expired, and a uid must have an email.
const workKey = {
  keyId: '1234567890ABCDEF',
  uids: [
    { name: 'Bryan Work', email: 'bryan@work.com' },
    { name: 'Bryan Personal', email: 'bryan@personal.com' },
  ],
};

const janeKey = {
  keyId: 'FEDCBA0987654321',
  uids: [
    { name: 'Jane Doe', email: 'jane@work.com' },
  ],
};

describe('utils/gpg.ts', () => {
  let gpgStdout = '';
  let gpgError: Error | undefined;

  const utilMock = {
    'node:util': {
      promisify: () => async (cmd: string, args: Array<string>, opts: object) => {
        assert.equal(cmd, 'gpg');
        assert.deepEqual(args, ['--list-secret-keys', '--with-colons', '--keyid-format=long']);
        assert.deepEqual(opts, { encoding: 'utf8' });
        if (gpgError) {
          throw gpgError;
        }
        return { stdout: gpgStdout };
      },
    },
  };

  const loadGpg = async () => {
    return esmock<typeof import('../../src/utils/gpg.ts')>(
      '../../src/utils/gpg.ts',
      {
        ...utilMock,
      },
    );
  };

  beforeEach(() => {
    gpgStdout = '';
    gpgError = undefined;
  });

  describe('listGpgKeys', () => {
    it('throws a clear error when gpg is not installed', async () => {
      const err = new Error('gpg not found.') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      gpgError = err;
      const { listGpgKeys } = await loadGpg();
      await assert.rejects(listGpgKeys(),
        { message: 'gpg is required but was not found on PATH. Please install.' },
      );
    });

    it('propagates other gpg failures unmodified', async () => {
      const message = 'Command failed: gpg --list-secret-keys\ngpg: keybox locked';
      const err = new Error(message) as Error & { stderr: string };
      err.stderr = 'gpg: keybox locked';
      gpgError = err;
      const { listGpgKeys } = await loadGpg();
      await assert.rejects(listGpgKeys('bryan@work.com'), { message });
    });

    it('returns an empty array when query matches no key', async () => {
      gpgStdout = [
        'sec:u:4096:1:1234567890ABCDEF:1234567890::u:::scESC:',
        'uid:u::::1234567890::jkl::Bryan Work <bryan@work.com>:::::::::0:',
      ].join('\n');
      const { listGpgKeys } = await loadGpg();
      const actual = await listGpgKeys('nobody@example.com');
      assert.deepEqual(actual, []);
    });

    it('correctly parses the gpg entry - with query', async () => {
      gpgStdout = workKeyLines.join('\n');
      const { listGpgKeys } = await loadGpg();
      const keys = await listGpgKeys(workKey.keyId);
      assert.deepEqual(keys, [workKey], 'Incorrect filtered results');
    });

    it('correctly parses the gpg entry - no query', async () => {
      gpgStdout = [...workKeyLines, ...janeKeyLines].join('\n');
      const { listGpgKeys } = await loadGpg();
      const keys = await listGpgKeys();
      assert.deepEqual(keys, [workKey, janeKey], 'Incorrect results');
    });

    it('correctly parses a name containing a stray "<"', async () => {
      gpgStdout = [
        'sec:u:4096:1:1234567890ABCDEF:1234567890::u:::scESC:',
        'uid:u::::1234567890::jkl::Bob <3 Smith <bob@x.com>:::::::::0:',
      ].join('\n');
      const { listGpgKeys } = await loadGpg();
      const keys = await listGpgKeys();
      assert.deepEqual(keys, [
        {
          keyId: '1234567890ABCDEF',
          uids: [
            { name: 'Bob <3 Smith', email: 'bob@x.com' },
          ],
        },
      ], 'Incorrect parsed name/email');
    });

    it('skips keys where all uids are invalid', async () => {
      gpgStdout = [
        'sec:u:4096:1:FEDCBA0987654321:1234567890::u:::scESC:',
        'uid:r::::1234567890::abc::Revoked <revoked@example.com>:::::::::0:',
        'uid:e::::1234567890::def::Jane Doe <jane@work.com>:::::::::0:',
      ].join('\n');
      const { listGpgKeys } = await loadGpg();
      const keys = await listGpgKeys('jane@work.com');
      assert.deepEqual(keys, [], 'Incorrect filtered results');
    });
  });
});
