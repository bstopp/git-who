import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import { Profile, SIGNING_METHOD, type SigningMethod } from '../src/profile.ts';

const validData = { host: 'github-work', username: 'Bryan Stopp', email: 'bryan@work.com' };

describe('profile.ts', () => {
  describe('error cases', () => {
    it('should throw error cases', () => {
      assert.throws(() => new Profile('Iv@lid Name', validData));
    });

    it('throws when invalid signing method', () => {
      const method = 'unknown' as SigningMethod;
      assert.throws(
        () => new Profile('work', validData, { method, key: 'doesnotexist' }),
        (error: Error) => {
          assert.ok(error.message.includes(`Invalid signing method: '${method}'. Value must be one of:`));
          assert.ok(error.message.includes("'gpg'"));
          assert.ok(error.message.includes("'ssh'"));
          return true;
        },
      );
    });
  });

  describe('success cases', () => {
    it('constructs with valid fields', async () => {
      const actual: string[] = [];
      const { Profile: MockedProfile } = await esmock('../src/profile.ts', {
        '../src/utils/validators.ts': {
          validateProfileName: (name: string) => {
            assert.equal(name, 'work');
            actual.push('validateProfileName');
          },
          validateHost: (host: string) => {
            assert.equal(host, 'github-work');
            actual.push('validateHost');
          },
          validateUsername: (name: string) => {
            assert.equal(name, 'Bryan Stopp');
            actual.push('validateUsername');
          },
          validateEmail: (email: string) => {
            assert.equal(email, 'bryan@work.com');
            actual.push('validateEmail');
          },
          validateSshSigningKey: () => {
            assert.fail('validateSshSigningKey called');
          },
          validateGpgSigningKey: () => {
            assert.fail('validateGpgSigningKey called');
          },
        },
      });

      const p = new MockedProfile('work', validData);
      assert.equal(p.name, 'work');
      assert.equal(p.host, 'github-work');
      assert.equal(p.username, 'Bryan Stopp');
      assert.equal(p.email, 'bryan@work.com');
      assert.equal(p.signingKey, undefined);
      assert.deepEqual(actual, ['validateProfileName', 'validateHost', 'validateUsername', 'validateEmail']);
    });

    it('constructs with valid fields & SSH Signing Key', async () => {
      const actual: string[] = [];
      const { Profile: MockedProfile } = await esmock('../src/profile.ts', {
        '../src/utils/validators.ts': {
          validateProfileName: (name: string) => {
            assert.equal(name, 'work');
            actual.push('validateProfileName');
          },
          validateHost: (host: string) => {
            assert.equal(host, 'github-work');
            actual.push('validateHost');
          },
          validateUsername: (name: string) => {
            assert.equal(name, 'Bryan Stopp');
            actual.push('validateUsername');
          },
          validateEmail: (email: string) => {
            assert.equal(email, 'bryan@work.com');
            actual.push('validateEmail');
          },
          validateSshSigningKey: (key: string) => {
            assert.equal(key, '~/.ssh/id_ed25519.pub');
            actual.push('validateSshSigningKey');
          },
          validateGpgSigningKey: () => {
            assert.fail('validateGpgSigningKey called');
          },
        },
      });

      const p = new MockedProfile('work', validData, { method: 'ssh', key: '~/.ssh/id_ed25519.pub' });
      assert.equal(p.name, 'work');
      assert.equal(p.host, 'github-work');
      assert.equal(p.username, 'Bryan Stopp');
      assert.equal(p.email, 'bryan@work.com');
      assert.equal(p.signingMethod, SIGNING_METHOD.SSH);
      assert.equal(p.signingKey, '~/.ssh/id_ed25519.pub');
      assert.deepEqual(actual, ['validateProfileName', 'validateHost', 'validateUsername', 'validateEmail', 'validateSshSigningKey']);
    });

    it('constructs with valid fields & SSH Signing Key', async () => {
      const actual: string[] = [];
      const { Profile: MockedProfile } = await esmock('../src/profile.ts', {
        '../src/utils/validators.ts': {
          validateProfileName: (name: string) => {
            assert.equal(name, 'work');
            actual.push('validateProfileName');
          },
          validateHost: (host: string) => {
            assert.equal(host, 'github-work');
            actual.push('validateHost');
          },
          validateUsername: (name: string) => {
            assert.equal(name, 'Bryan Stopp');
            actual.push('validateUsername');
          },
          validateEmail: (email: string) => {
            assert.equal(email, 'bryan@work.com');
            actual.push('validateEmail');
          },
          validateSshSigningKey: () => {
            assert.fail('validateSshSigningKey called');
          },
          validateGpgSigningKey: (key: string) => {
            assert.equal(key, 'ABCDEFGHIJKLMN12345');
            actual.push('validateGpgSigningKey');
          },
        },
      });

      const p = new MockedProfile('work', validData, { method: 'gpg', key: 'ABCDEFGHIJKLMN12345' });
      assert.equal(p.name, 'work');
      assert.equal(p.host, 'github-work');
      assert.equal(p.username, 'Bryan Stopp');
      assert.equal(p.email, 'bryan@work.com');
      assert.equal(p.signingMethod, SIGNING_METHOD.GPG);
      assert.equal(p.signingKey, 'ABCDEFGHIJKLMN12345');
      assert.deepEqual(actual, ['validateProfileName', 'validateHost', 'validateUsername', 'validateEmail', 'validateGpgSigningKey']);
    });

    it('serializes to JSON', () => {
      const p = new Profile('work', validData);
      assert.deepEqual(JSON.parse(JSON.stringify(p)), {
        name: 'work',
        host: 'github-work',
        username: 'Bryan Stopp',
        email: 'bryan@work.com',
      });
    });

    it('serializes to JSON with ssh signingKey when present', () => {
      const p = new Profile('work', validData, { method: 'ssh', key: '~/.ssh/id_ed25519.pub' });
      assert.deepEqual(JSON.parse(JSON.stringify(p)), {
        name: 'work',
        host: 'github-work',
        username: 'Bryan Stopp',
        email: 'bryan@work.com',
        signingMethod: 'ssh',
        signingKey: '~/.ssh/id_ed25519.pub',
      });
    });

    it('serializes to JSON with gpg signingKey when present', () => {
      const p = new Profile('work', validData, { method: 'gpg', key: 'ABCDEFGHIJKLMN12345' });
      assert.deepEqual(JSON.parse(JSON.stringify(p)), {
        name: 'work',
        host: 'github-work',
        username: 'Bryan Stopp',
        email: 'bryan@work.com',
        signingMethod: 'gpg',
        signingKey: 'ABCDEFGHIJKLMN12345',
      });
    });
  });
});
