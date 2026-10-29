import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import { Profile, SIGNING_METHOD, type SigningMethod } from '../src/profile.ts';

type Validator = (value: string) => void;

const name = 'work';
const validData = { host: 'github-work', username: 'Bryan Work', email: 'bryan@work.com' };
const sshKey = '~/.ssh/id_ed25519.pub';
const gpgKey = 'ABCDEFGHIJKLMN12345';

describe('profile.ts', () => {
  let validatorCalls: string[] = [];

  // Records the call and checks the value it was given.
  const expectValue = (validator: string, expected: string): Validator => (value) => {
    assert.equal(value, expected);
    validatorCalls.push(validator);
  };

  const validatorsFail = (validator: string): Validator => () => {
    assert.fail(`${validator} called`);
  };

  const validatorsMock = (overrides: Record<string, Validator> = {}) => ({
    '../src/utils/validators.ts': {
      validateProfileName: expectValue('validateProfileName', name),
      validateHost: expectValue('validateHost', validData.host),
      validateUsername: expectValue('validateUsername', validData.username),
      validateEmail: expectValue('validateEmail', validData.email),
      validateSshSigningKey: validatorsFail('validateSshSigningKey'),
      validateGpgSigningKey: validatorsFail('validateGpgSigningKey'),
      ...overrides, // same key wins, so it replaces the default
    },
  });

  const loadProfile = async (overrides: Record<string, Validator> = {}) => {
    const { Profile: MockedProfile } = await esmock<typeof import('../src/profile.ts')>(
      '../src/profile.ts',
      {
        ...validatorsMock(overrides),
      },
    );
    return MockedProfile;
  };

  const assertBaseFields = (p: Profile) => {
    assert.equal(p.name, name);
    assert.equal(p.host, validData.host);
    assert.equal(p.username, validData.username);
    assert.equal(p.email, validData.email);
  };

  beforeEach(() => {
    validatorCalls = [];
  });

  describe('error cases', () => {
    it('should throw error cases', () => {
      assert.throws(() => new Profile('Iv@lid Name', validData));
    });

    it('throws when invalid signing method', () => {
      const method = 'unknown' as SigningMethod;
      assert.throws(
        () => new Profile(name, validData, { method, key: 'doesnotexist' }),
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
    const baseCalls = ['validateProfileName', 'validateHost', 'validateUsername', 'validateEmail'];

    it('constructs with valid fields', async () => {
      const MockedProfile = await loadProfile();
      const p = new MockedProfile(name, validData);
      assertBaseFields(p);
      assert.equal(p.signingKey, undefined);
      assert.deepEqual(validatorCalls, baseCalls);
    });

    it('constructs with valid fields & SSH Signing Key', async () => {
      const MockedProfile = await loadProfile({
        validateSshSigningKey: expectValue('validateSshSigningKey', sshKey),
      });
      const p = new MockedProfile(name, validData, { method: 'ssh', key: sshKey });
      assertBaseFields(p);
      assert.equal(p.signingMethod, SIGNING_METHOD.SSH);
      assert.equal(p.signingKey, sshKey);
      assert.deepEqual(validatorCalls, [...baseCalls, 'validateSshSigningKey']);
    });

    it('constructs with valid fields & GPG Signing Key', async () => {
      const MockedProfile = await loadProfile({
        validateGpgSigningKey: expectValue('validateGpgSigningKey', gpgKey),
      });
      const p = new MockedProfile(name, validData, { method: 'gpg', key: gpgKey });
      assertBaseFields(p);
      assert.equal(p.signingMethod, SIGNING_METHOD.GPG);
      assert.equal(p.signingKey, gpgKey);
      assert.deepEqual(validatorCalls, [...baseCalls, 'validateGpgSigningKey']);
    });

    it('serializes to JSON', () => {
      const p = new Profile(name, validData);
      assert.deepEqual(JSON.parse(JSON.stringify(p)), {
        name,
        ...validData,
      });
    });

    it('serializes to JSON with ssh signingKey when present', () => {
      const p = new Profile(name, validData, { method: 'ssh', key: sshKey });
      assert.deepEqual(JSON.parse(JSON.stringify(p)), {
        name,
        ...validData,
        signingMethod: 'ssh',
        signingKey: sshKey,
      });
    });

    it('serializes to JSON with gpg signingKey when present', () => {
      const p = new Profile(name, validData, { method: 'gpg', key: gpgKey });
      assert.deepEqual(JSON.parse(JSON.stringify(p)), {
        name,
        ...validData,
        signingMethod: 'gpg',
        signingKey: gpgKey,
      });
    });
  });
});
