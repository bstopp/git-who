import assert from 'node:assert/strict';
import {
  validateProfileName,
  validateHost,
  validateUsername,
  validateEmail,
  validateGpgSigningKey,
  validateSshSigningKey,
  validateUnique,
} from '../../src/utils/validators.ts';

describe('utils/validators.ts', () => {
  describe('validateProfileName', () => {
    it('does not throw for a valid profile name', () => {
      assert.doesNotThrow(() => validateProfileName('work-.1_profile'));
    });

    it('throws for an invalid profile name', () => {
      assert.throws(() => validateProfileName('bad name!'), Error);
    });

    it('throws for an empty profile name', () => {
      assert.throws(() => validateProfileName(''), Error);
    });
  });

  describe('validateHost', () => {
    it('does not throw for a valid host', () => {
      assert.doesNotThrow(() => validateHost('git-hub_work1.com'));
    });

    it('throws for an invalid host', () => {
      assert.throws(() => validateHost('bad host!'), Error);
    });

    it('throws for an empty host', () => {
      assert.throws(() => validateHost(''), Error);
    });
  });

  describe('validateName', () => {
    it('does not throw for a valid name', () => {
      assert.doesNotThrow(() => validateUsername('Mr. Foo-Bar1'));
    });

    it('throws for an empty name', () => {
      assert.throws(() => validateUsername('   '), Error);
    });
  });

  describe('validateEmail', () => {
    it('does not throw for a valid email', () => {
      assert.doesNotThrow(() => validateEmail('bryan@work.com'));
    });

    it('throws for an invalid email', () => {
      assert.throws(() => validateEmail('not-an-email'), Error);
    });

    it('throws for an empty email', () => {
      assert.throws(() => validateEmail(''), Error);
    });
  });

  describe('validateGpgSigningKey', () => {
    it('does not throw for a valid signing key', () => {
      assert.doesNotThrow(() => validateGpgSigningKey('ABC123'));
      assert.doesNotThrow(() => validateGpgSigningKey('DEADBEEF'));
    });

    it('throws for an empty signing key', () => {
      assert.throws(() => validateGpgSigningKey(''), Error);
    });

    it('throws for a signing key with lowercase letters', () => {
      assert.throws(() => validateGpgSigningKey('abc123'), Error);
    });

    it('throws for a signing key with special characters', () => {
      assert.throws(() => validateGpgSigningKey('ABC!123'), Error);
    });

    it('throws for an empty signing key', () => {
      assert.throws(() => validateGpgSigningKey(''), Error);
    });
  });

  describe('validateSSHSigningKey', () => {
    it('does not throw for a valid signing key', () => {
      assert.doesNotThrow(() => validateSshSigningKey('~/.ssh/foo.pub'));
    });

    it('throws for an empty signing key', () => {
      assert.throws(() => validateSshSigningKey(''), Error);
    });
  });

  describe('validateUnique', () => {
    const profiles = [
      { name: 'work' },
      { name: 'work-gpg-signed' },
      { name: 'work-ssh-signed' },
    ];
    it('does not throw for a name not in the existing map', () => {
      assert.doesNotThrow(() => validateUnique(profiles, 'home'));
    });

    it('throws for a name that already exists', () => {
      assert.throws(
        () => validateUnique(profiles, 'work'),
        { name: 'Error', message: "Profile 'work' already exists." },
      );
    });
  });
});
