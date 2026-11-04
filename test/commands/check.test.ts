import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import type { SimpleGit } from 'simple-git';
import { personalProfile, validProfile, validProfileWithSshKey, multiProfiles } from '../fixtures.ts';
import { SIGNING_METHOD, type Profile } from '../../src/profile.ts';
import type { ProfileMismatches } from '../../src/utils/display.ts';

type Mocks = Record<string, object>;
type Resolved = { profile: Profile; derived: boolean; mismatches?: ProfileMismatches };

describe('commands/check.ts', async () => {
  let isRepo = true;
  let profiles: Profile[] = multiProfiles;
  let resolved: Resolved | Error = { profile: validProfile, derived: false, mismatches: {} };
  const logJsonCalls: unknown[] = [];

  const fakeGit = { checkIsRepo: async () => isRepo } as SimpleGit;

  const simpleGitMock = { 'simple-git': { simpleGit: () => fakeGit } };

  const profilesMock = { '../../src/utils/profiles.ts': { loadProfiles: async () => profiles } };

  const showMock = {
    '../../src/utils/repo-profile.ts': {
      resolveFromGit: async (given: Profile[]) => {
        assert.equal(given, profiles, 'resolveFromGit should receive the loaded profiles');
        if (resolved instanceof Error) {
          throw resolved;
        }
        return resolved;
      },
    },
  };

  // A passing check is quiet, so a commit hook adds no noise, and --json prints only the result.
  const logMock = {
    '../../src/utils/log.ts': {
      default: {
        json: (value: unknown) => logJsonCalls.push(value),
        info: () => assert.fail('log info should not be called.'),
        warn: () => assert.fail('log warn should not be called.'),
      },
    },
  };

  const loadCheck = async (overrides: Mocks = {}) => {
    const { default: check } = await esmock<typeof import('../../src/commands/check.ts')>(
      '../../src/commands/check.ts',
      { ...simpleGitMock, ...profilesMock, ...showMock, ...logMock, ...overrides },
    );
    return check;
  };

  beforeEach(() => {
    isRepo = true;
    profiles = multiProfiles;
    resolved = { profile: validProfile, derived: false, mismatches: {} };
    logJsonCalls.length = 0;
  });

  it('throws when the current directory is not a git repo', async () => {
    isRepo = false;
    const check = await loadCheck();
    await assert.rejects(() => check(), { message: 'The current directory must have a git repository to check a profile.' });
  });

  it('throws when no profile can be resolved for the repo', async () => {
    resolved = new Error('No profile set and none found matching the current git config.');
    const check = await loadCheck();
    await assert.rejects(() => check(), { message: resolved instanceof Error ? resolved.message : '' });
  });

  it('passes quietly when the git config matches the profile', async () => {
    const check = await loadCheck();
    await assert.doesNotReject(() => check());
    assert.deepEqual(logJsonCalls, []);
  });

  it('passes for a profile derived from the git config, as long as it matches', async () => {
    resolved = { profile: personalProfile, derived: true, mismatches: {} };
    const check = await loadCheck();
    await assert.doesNotReject(() => check());
  });

  it('throws naming each git setting that differs from the profile', async () => {
    resolved = {
      profile: validProfile,
      derived: false,
      mismatches: { username: personalProfile.username, email: undefined },
    };
    const check = await loadCheck();
    await assert.rejects(() => check(), {
      message: [
        `Git config does not match profile '${validProfile.name}':`,
        `  user.name: expected '${validProfile.username}', found '${personalProfile.username}'`,
        `  user.email: expected '${validProfile.email}', found (not set)`,
      ].join('\n'),
    });
  });

  it('throws naming the signing settings that differ from the profile', async () => {
    resolved = {
      profile: validProfileWithSshKey,
      derived: false,
      mismatches: { signingKey: undefined, signingMethod: undefined },
    };
    const check = await loadCheck();
    await assert.rejects(() => check(), {
      message: [
        `Git config does not match profile '${validProfileWithSshKey.name}':`,
        `  user.signingKey: expected '${validProfileWithSshKey.signingKey}', found (not set)`,
        `  commit signing: expected '${SIGNING_METHOD.SSH}', found (not set)`,
      ].join('\n'),
    });
  });

  it('expects no signing when the profile has no signing key', async () => {
    resolved = {
      profile: validProfile,
      derived: false,
      mismatches: { signingKey: 'ABCD', signingMethod: SIGNING_METHOD.GPG },
    };
    const check = await loadCheck();
    await assert.rejects(() => check(), {
      message: [
        `Git config does not match profile '${validProfile.name}':`,
        `  user.signingKey: expected (not set), found 'ABCD'`,
        `  commit signing: expected (not set), found '${SIGNING_METHOD.GPG}'`,
      ].join('\n'),
    });
  });

  describe('with json', () => {
    it('prints the profile and whether it was derived when the config matches', async () => {
      const check = await loadCheck();
      await assert.doesNotReject(() => check({ json: true }));
      assert.deepEqual(logJsonCalls, [{ profile: validProfile, derived: false }]);
    });

    it('prints nothing when the config does not match, and throws like the text output', async () => {
      resolved = { profile: validProfile, derived: false, mismatches: { email: personalProfile.email } };
      const check = await loadCheck();
      await assert.rejects(() => check({ json: true }), {
        message: [
          `Git config does not match profile '${validProfile.name}':`,
          `  user.email: expected '${validProfile.email}', found '${personalProfile.email}'`,
        ].join('\n'),
      });
      assert.deepEqual(logJsonCalls, []);
    });
  });
});
