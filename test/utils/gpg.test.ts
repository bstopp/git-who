import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';

describe('utils/gpg.ts', () => {
  describe('listGpgKeys', () => {
    it('throws a clear error when gpg is not installed', async () => {
      const { listGpgKeys } = await esmock<typeof import('../../src/utils/gpg.ts')>('../../src/utils/gpg.ts', {
        'node:child_process': {
          execFileSync: (cmd: string, args: Array<string>, opts: object) => {
            assert.equal(cmd, 'gpg');
            assert.deepEqual(args, ['--list-secret-keys', '--with-colons', '--keyid-format=long']);
            assert.deepEqual(opts, { encoding: 'utf8' });
            const err = new Error('spawnSync gpg ENOENT') as NodeJS.ErrnoException;
            err.code = 'ENOENT';
            throw err;
          },
        },
      });
      assert.throws(
        () => listGpgKeys(),
        { message: 'gpg is required but was not found on PATH. Please install GnuPG.' },
      );
    });

    it('propagates other gpg failures unmodified', async () => {
      const message = 'Command failed: gpg --list-secret-keys\ngpg: keybox locked';
      const { listGpgKeys } = await esmock<typeof import('../../src/utils/gpg.ts')>('../../src/utils/gpg.ts', {
        'node:child_process': {
          execFileSync: () => {
            const err = new Error(message) as Error & { stderr: string };
            err.stderr = 'gpg: keybox locked';
            throw err;
          },
        },
      });
      assert.throws(
        () => listGpgKeys('bryan@work.com'), { message },
      );
    });

    it('returns an empty array when query matches no key', async () => {
      const stdout = [
        'sec:u:4096:1:1234567890ABCDEF:1234567890::u:::scESC:',
        'uid:u::::1234567890::jkl::Bryan Stopp <bryan@work.com>:::::::::0:',
      ].join('\n');
      const { listGpgKeys } = await esmock<typeof import('../../src/utils/gpg.ts')>('../../src/utils/gpg.ts', {
        'node:child_process': {
          execFileSync: () => {
            return stdout;
          },
        },
      });
      const actual = listGpgKeys('nobody@example.com');
      assert.deepEqual(actual, []);
    });

    it('correctly parses the gpg entry - with query', async () => {
      const stdout = [
        'sec:u:4096:1:1234567890ABCDEF:1234567890::u:::scESC:',
        'uid:u::::1234567890::abc::NoEmailHere::::::::::0:',
        'uid:e::::1234567890::def::Expired Name <expired@example.com>:::::::::0:',
        'uid:r::::1234567890::ghi::Old Name <old@example.com>:::::::::0:',
        'uid:u::::1234567890::jkl::Bryan Stopp <bryan@work.com>:::::::::0:',
        'uid:u::::1234567890::jkl::Bryan Stopp <bryan@personal.com>:::::::::0:',
      ].join('\n');
      const { listGpgKeys } = await esmock<typeof import('../../src/utils/gpg.ts')>('../../src/utils/gpg.ts', {
        'node:child_process': {
          execFileSync: () => {
            return stdout;
          },
        },
      });

      const keys = listGpgKeys('1234567890ABCDEF');
      // No Revoked
      // No Expired
      // Must have an email.
      assert.deepEqual(keys, [
        {
          keyId: '1234567890ABCDEF',
          uids: [
            { name: 'Bryan Stopp', email: 'bryan@work.com' },
            { name: 'Bryan Stopp', email: 'bryan@personal.com' },
          ],
        },
      ], 'Incorrect filtered results');
    });

    it('correctly parses the gpg entry - no query', async () => {
      const stdout = [
        'sec:u:4096:1:1234567890ABCDEF:1234567890::u:::scESC:',
        'uid:u::::1234567890::abc::NoEmailHere::::::::::0:',
        'uid:e::::1234567890::def::Expired Name <expired@example.com>:::::::::0:',
        'uid:r::::1234567890::ghi::Old Name <old@example.com>:::::::::0:',
        'uid:u::::1234567890::jkl::Bryan Stopp <bryan@work.com>:::::::::0:',
        'uid:u::::1234567890::jkl::Bryan Stopp <bryan@personal.com>:::::::::0:',
        'sec:u:4096:1:FEDCBA0987654321:1234567890::u:::scESC:',
        'uid:u::::1234567890::ghi::Jane Doe <jane@work.com>:::::::::0:',
      ].join('\n');

      const { listGpgKeys } = await esmock<typeof import('../../src/utils/gpg.ts')>('../../src/utils/gpg.ts', {
        'node:child_process': {
          execFileSync: () => {
            return stdout;
          },
        },
      });

      const keys = listGpgKeys();
      // No Revoked
      // No Expired
      // Must have an email.
      assert.deepEqual(keys, [
        {
          keyId: '1234567890ABCDEF',
          uids: [
            { name: 'Bryan Stopp', email: 'bryan@work.com' },
            { name: 'Bryan Stopp', email: 'bryan@personal.com' },
          ],
        },
        {
          keyId: 'FEDCBA0987654321',
          uids: [
            { name: 'Jane Doe', email: 'jane@work.com' },
          ],
        },
      ], 'Incorrect results');
    });

    it('correctly parses a name containing a stray "<"', async () => {
      const stdout = [
        'sec:u:4096:1:1234567890ABCDEF:1234567890::u:::scESC:',
        'uid:u::::1234567890::jkl::Bob <3 Smith <bob@x.com>:::::::::0:',
      ].join('\n');

      const { listGpgKeys } = await esmock<typeof import('../../src/utils/gpg.ts')>('../../src/utils/gpg.ts', {
        'node:child_process': {
          execFileSync: () => {
            return stdout;
          },
        },
      });

      const keys = listGpgKeys();
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
      const stdout = [
        'sec:u:4096:1:FEDCBA0987654321:1234567890::u:::scESC:',
        'uid:r::::1234567890::abc::Revoked <revoked@example.com>:::::::::0:',
        'uid:e::::1234567890::def::Jane Doe <jane@work.com>:::::::::0:',
      ].join('\n');

      const { listGpgKeys } = await esmock<typeof import('../../src/utils/gpg.ts')>('../../src/utils/gpg.ts', {
        'node:child_process': {
          execFileSync: () => {
            return stdout;
          },
        },
      });

      const keys = listGpgKeys('jane@work.com');
      assert.deepEqual(keys, [], 'Incorrect filtered results');
    });
  });
});
