import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import type { SimpleGit } from 'simple-git';
import {
  ambiguousProfiles,
  gpgKeys,
  multiProfiles,
  personalProfile,
  validProfile,
  validProfileWithGpgKey,
  validProfileWithSshKey,
  validProfiles,
} from '../fixtures.ts';
import { SIGNING_METHOD, type Profile } from '../../src/profile.ts';
import type { ProfileMismatches } from '../../src/utils/display.ts';

describe('utils/repo-profile.ts', async () => {
  let userName: string | null = null;
  let userEmail: string | null = null;
  let commitSign: string | null = null;
  let userSigningKey: string | null = null;
  let gpgFormat: string | null = null;
  let gitwhoProfile: string | null = null;

  const fakeGit = {
    getConfig: async (key: string, scope: string) => {
      assert.equal(scope, 'local');
      if (key === 'user.name') {
        return { value: userName };
      } else if (key === 'user.email') {
        return { value: userEmail };
      } else if (key === 'commit.gpgsign') {
        return { value: commitSign };
      } else if (key === 'user.signingKey') {
        return { value: userSigningKey };
      } else if (key === 'gpg.format') {
        return { value: gpgFormat };
      }
      return { value: null };
    },
  } as SimpleGit;

  const loadResolveFromGit = async () => {
    const { resolveFromGit } = await esmock<typeof import('../../src/utils/repo-profile.ts')>(
      '../../src/utils/repo-profile.ts',
      {
        'simple-git': { simpleGit: () => fakeGit },
        '../../src/utils/profiles.ts': {
          getActiveProfileName: async (git: SimpleGit) => {
            assert.equal(git, fakeGit, 'getActiveProfileName should receive the simpleGit instance');
            return gitwhoProfile;
          },
        },
      },
    );
    return resolveFromGit;
  };

  beforeEach(() => {
    userName = null;
    userEmail = null;
    commitSign = null;
    userSigningKey = null;
    gpgFormat = null;
    gitwhoProfile = null;
  });

  describe('when it cannot resolve a profile', () => {
    it('throws when no profile is set and none match', async () => {
      const resolveFromGit = await loadResolveFromGit();
      await assert.rejects(() => resolveFromGit(multiProfiles), { message: 'No profile set and none found matching the current git config.' });
    });

    it('throws when no profile is set and several match', async () => {
      userName = validProfile.username;
      userEmail = validProfile.email;
      const resolveFromGit = await loadResolveFromGit();
      await assert.rejects(() => resolveFromGit(ambiguousProfiles), { message: 'Multiple profiles match the current git config — set one explicitly with `git who use <profile>`.' });
    });

    it('throws when gitwho.profile names a missing profile and nothing else matches', async () => {
      userName = personalProfile.username;
      userEmail = personalProfile.email;
      gitwhoProfile = 'missing';
      const resolveFromGit = await loadResolveFromGit();
      await assert.rejects(() => resolveFromGit(validProfiles), { message: `Active profile '${gitwhoProfile}' not found — it may have been deleted.` });
    });

    it('blames the missing profile, not the multiple matches, when both apply', async () => {
      userName = validProfile.username;
      userEmail = validProfile.email;
      gitwhoProfile = 'missing';
      const resolveFromGit = await loadResolveFromGit();
      await assert.rejects(() => resolveFromGit(ambiguousProfiles), { message: `Active profile '${gitwhoProfile}' not found — it may have been deleted.` });
    });
  });

  describe('with an active profile', () => {
    const resolveActive = async (profile: Profile, profiles: Profile[]) => {
      gitwhoProfile = profile.name;
      const resolveFromGit = await loadResolveFromGit();
      return resolveFromGit(profiles);
    };

    it('finds no mismatches when the git config matches the profile', async () => {
      userName = validProfile.username;
      userEmail = validProfile.email;
      assert.deepEqual(await resolveActive(validProfile, multiProfiles), { profile: validProfile, derived: false, mismatches: {} });
    });

    it('identifies mismatches when git config values are missing', async () => {
      const mismatches: ProfileMismatches = { username: undefined, email: undefined };
      assert.deepEqual(await resolveActive(validProfile, multiProfiles), { profile: validProfile, derived: false, mismatches });
    });

    it('identifies mismatches when git config differs from the profile', async () => {
      userName = personalProfile.username;
      userEmail = personalProfile.email;
      const mismatches: ProfileMismatches = { username: personalProfile.username, email: personalProfile.email };
      assert.deepEqual(await resolveActive(validProfile, multiProfiles), { profile: validProfile, derived: false, mismatches });
    });

    it('identifies mismatches when git config indicates signing but the profile does not', async () => {
      userName = validProfile.username;
      userEmail = validProfile.email;
      commitSign = 'true';
      userSigningKey = gpgKeys[1].keyId;
      gpgFormat = 'openpgp';
      const mismatches: ProfileMismatches = { signingKey: gpgKeys[1].keyId, signingMethod: SIGNING_METHOD.GPG };
      assert.deepEqual(await resolveActive(validProfile, ambiguousProfiles), { profile: validProfile, derived: false, mismatches });
    });

    it('treats git signing with no gpg.format as gpg', async () => {
      userName = validProfile.username;
      userEmail = validProfile.email;
      commitSign = 'true';
      userSigningKey = gpgKeys[1].keyId;
      const mismatches: ProfileMismatches = { signingKey: gpgKeys[1].keyId, signingMethod: SIGNING_METHOD.GPG };
      assert.deepEqual(await resolveActive(validProfile, ambiguousProfiles), { profile: validProfile, derived: false, mismatches });
    });

    it('treats a gpg.format git does not support, such as x509, as git not signing', async () => {
      userName = validProfileWithGpgKey.username;
      userEmail = validProfileWithGpgKey.email;
      commitSign = 'true';
      userSigningKey = validProfileWithGpgKey.signingKey!;
      gpgFormat = 'x509';
      const mismatches: ProfileMismatches = { signingMethod: undefined };
      assert.deepEqual(await resolveActive(validProfileWithGpgKey, validProfiles), { profile: validProfileWithGpgKey, derived: false, mismatches });
    });

    it('treats signing keys as not signing when commit.gpgsign is not true', async () => {
      userName = validProfileWithSshKey.username;
      userEmail = validProfileWithSshKey.email;
      userSigningKey = validProfileWithSshKey.signingKey!;
      gpgFormat = 'ssh';
      commitSign = 'false';
      const mismatches: ProfileMismatches = { signingMethod: undefined };
      assert.deepEqual(await resolveActive(validProfileWithSshKey, validProfiles), { profile: validProfileWithSshKey, derived: false, mismatches });
    });

    it('identifies mismatches when the profile signs but git config does not', async () => {
      userName = validProfileWithSshKey.username;
      userEmail = validProfileWithSshKey.email;
      const mismatches: ProfileMismatches = { signingKey: undefined, signingMethod: undefined };
      assert.deepEqual(await resolveActive(validProfileWithSshKey, [validProfileWithSshKey]), { profile: validProfileWithSshKey, derived: false, mismatches });
    });

    it('identifies a signing method mismatch (profile gpg, git ssh)', async () => {
      userName = validProfileWithGpgKey.username;
      userEmail = validProfileWithGpgKey.email;
      commitSign = 'true';
      gpgFormat = 'ssh';
      userSigningKey = validProfileWithSshKey.signingKey!;
      const mismatches: ProfileMismatches = { signingKey: validProfileWithSshKey.signingKey, signingMethod: SIGNING_METHOD.SSH };
      assert.deepEqual(await resolveActive(validProfileWithGpgKey, [validProfileWithGpgKey]), { profile: validProfileWithGpgKey, derived: false, mismatches });
    });
  });

  describe('without an active profile', () => {
    it('derives the profile that matches the git config', async () => {
      userName = personalProfile.username;
      userEmail = personalProfile.email;
      const resolveFromGit = await loadResolveFromGit();
      assert.deepEqual(await resolveFromGit(multiProfiles), { profile: personalProfile, derived: true, mismatches: {} });
    });

    it('derives the profile when gitwho.profile names a missing one but the git config matches', async () => {
      userName = personalProfile.username;
      userEmail = personalProfile.email;
      gitwhoProfile = 'invalid';
      const resolveFromGit = await loadResolveFromGit();
      assert.deepEqual(await resolveFromGit(multiProfiles), { profile: personalProfile, derived: true, mismatches: {} });
    });

    it('identifies a signing mismatch on a derived profile (git signs, profile does not)', async () => {
      userName = validProfile.username;
      userEmail = validProfile.email;
      commitSign = 'true';
      userSigningKey = validProfileWithSshKey.signingKey!;
      gpgFormat = 'ssh';
      const mismatches: ProfileMismatches = { signingKey: validProfileWithSshKey.signingKey, signingMethod: SIGNING_METHOD.SSH };
      const resolveFromGit = await loadResolveFromGit();
      assert.deepEqual(await resolveFromGit([validProfile]), { profile: validProfile, derived: true, mismatches });
    });
  });
});
