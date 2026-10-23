import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import type { SimpleGit } from 'simple-git';
import {
  ambiguousProfiles,
  multiProfiles,
  personalProfile,
  validProfile,
  validProfiles,
  validProfileWithGpgKey,
  validProfileWithSshKey,
  sshKeys,
  gpgKeys,
} from '../fixtures.ts';
import { Profile, SIGNING_METHOD } from '../../src/profile.ts';
import type { ProfileMismatches, SigningKeyStatus } from '../../src/utils/display.ts';

type PrintProfile = typeof import('../../src/utils/display.ts').printProfile;
type PrintProfileCall = { profile: Profile; opts?: Parameters<PrintProfile>[1] };
type Mocks = Record<string, object>;

describe('commands/show.ts', async () => {
  let printProfileParam: PrintProfileCall | undefined;
  let userName: string | null = null;
  let userEmail: string | null = null;
  let commitSign: string | null = null;
  let userSigningKey: string | null = null;
  let gpgFormat: string | null = null;
  let profiles: Profile[] = multiProfiles;
  let gitwhoProfile: string | null = null;
  const logWarnCalls: string[] = [];

  const fakeGit = {
    checkIsRepo: async () => true,
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

  const profilesMock = {
    '../../src/utils/profiles.ts': {
      loadProfiles: async () => profiles,
      getActiveProfileName: async (git: SimpleGit) => {
        assert.equal(git, fakeGit, 'getActiveProfileName should receive the simpleGit instance');
        return gitwhoProfile;
      },
    },
  };

  const printProfileMock = {
    '../../src/utils/display.ts': {
      printProfile: async (profile: Profile, opts?: {
        signingKeyStatus?: SigningKeyStatus;
        mismatches?: ProfileMismatches;
      }) => {
        printProfileParam = {
          profile,
        };
        if (opts) {
          printProfileParam.opts = opts;
        }
      },
    },
  };

  const printProfileFail = {
    '../../src/utils/display.ts': {
      printProfile: async () => {
        assert.fail('printProfile should not be called.');
      },
    },
  };

  const simpleGitMock = {
    'simple-git': {
      simpleGit: () => fakeGit,
    },
  };

  const listSshKeysMock = {
    '../../src/utils/ssh.ts': {
      listSshKeys: async () => {
        assert.fail('listSshKeys should not be called.');
      },
    },
  };

  const listGpgKeysMock = {
    '../../src/utils/gpg.ts': {
      listGpgKeys: async () => {
        assert.fail('listGpgKeys should not be called.');
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

  const loadShow = async (overrides: Mocks = {}) => {
    const { default: show } = await esmock<typeof import('../../src/commands/show.ts')>(
      '../../src/commands/show.ts',
      {
        ...profilesMock,
        ...printProfileMock,
        ...simpleGitMock,
        ...listSshKeysMock,
        ...listGpgKeysMock,
        ...logFail,
        ...overrides, // same key wins, so it replaces the default
      },
    );
    return show;
  };

  beforeEach(async () => {
    printProfileParam = undefined;
    userName = null;
    userEmail = null;
    commitSign = null;
    gpgFormat = null;
    userSigningKey = null;
    profiles = multiProfiles;
    gitwhoProfile = null;
    logWarnCalls.length = 0;
  });

  it('throws when named profile is not found', async () => {
    const show = await loadShow({
      ...printProfileFail,
    });
    const name = 'not-found';
    profiles = [];
    await assert.rejects(() => show(name), { message: `Profile ${name} not found.` });
  });

  it('throws error when not in valid context for command', async () => {
    const isNotRepoGitMock = {
      checkIsRepo: async () => Promise.resolve(false),
    } as SimpleGit;
    const show = await loadShow({
      ...printProfileFail,
      'simple-git': {
        simpleGit: () => isNotRepoGitMock,
      },
    });
    await assert.rejects(() => show(), { message: 'You must provide a profile name, or invoke the show command from a git repo.' });
  });

  it('throws when unable to find a profile', async () => {
    gitwhoProfile = null;
    const show = await loadShow({
      ...printProfileFail,
    });
    await assert.rejects(() => show(), { message: 'No profile set and none found matching the current git config.' });
  });

  it('throws when unable to derive unique profile', async () => {
    profiles = ambiguousProfiles;
    userName = validProfile.username;
    userEmail = validProfile.email;
    const show = await loadShow({
      ...printProfileFail,
    });
    await assert.rejects(() => show(), { message: 'Multiple profiles match the current git config — set one explicitly with `git who use <profile>`.' });
  });

  it('throws when gitwho.profile is set but invalid and derivation fails', async () => {
    profiles = validProfiles;
    userName = personalProfile.username;
    userEmail = personalProfile.email;
    gitwhoProfile = 'missing';
    const show = await loadShow({
      ...printProfileFail,
    });
    await assert.rejects(() => show(), { message: `Active profile '${gitwhoProfile}' not found — it may have been deleted.` });
  });

  it('throws when gitwho.profile is set but invalid but multiple matches exist', async () => {
    profiles = ambiguousProfiles;
    userName = validProfile.username;
    userEmail = validProfile.email;
    gitwhoProfile = 'missing';
    const show = await loadShow({
      ...printProfileFail,
    });
    await assert.rejects(() => show(), { message: `Active profile '${gitwhoProfile}' not found — it may have been deleted.` });
  });

  it('calls print profile for named profile (no key)', async () => {
    const show = await loadShow();
    await assert.doesNotReject(() => show(validProfile.name));
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: validProfile });
  });

  it('identifies mismatches when git config values are missing', async () => {
    gitwhoProfile = validProfile.name;
    const show = await loadShow();
    await assert.doesNotReject(() => show());
    assert.ok(printProfileParam, 'printProfile was not called');
    const mismatches: ProfileMismatches = {
      username: undefined,
      email: undefined,
    };

    assert.deepEqual(printProfileParam, { profile: validProfile, opts: { mismatches } });
  });

  it('identifies mismatches when git config differs from profile', async () => {
    userName = personalProfile.username;
    userEmail = personalProfile.email;
    profiles = multiProfiles;
    gitwhoProfile = validProfile.name;
    const show = await loadShow();
    const mismatches: ProfileMismatches = {
      username: personalProfile.username,
      email: personalProfile.email,
    };

    await assert.doesNotReject(() => show());
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: validProfile, opts: { mismatches } });
  });

  it('identifies mismatches when git config indicates signing but profile does not', async () => {
    userName = validProfile.username;
    userEmail = validProfile.email;
    commitSign = 'true';
    userSigningKey = gpgKeys[1].keyId;
    gpgFormat = 'openpgp';
    profiles = ambiguousProfiles;
    gitwhoProfile = validProfile.name;
    const show = await loadShow();

    const mismatches: ProfileMismatches = {
      signingKey: gpgKeys[1].keyId,
      signingMethod: SIGNING_METHOD.GPG,
    };

    await assert.doesNotReject(() => show());
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: validProfile, opts: { mismatches } });
  });

  it('treats git signing with no gpg.format as gpg', async () => {
    userName = validProfile.username;
    userEmail = validProfile.email;
    commitSign = 'true';
    userSigningKey = gpgKeys[1].keyId;
    profiles = ambiguousProfiles;
    gitwhoProfile = validProfile.name;
    const show = await loadShow();

    const mismatches: ProfileMismatches = {
      signingKey: gpgKeys[1].keyId,
      signingMethod: SIGNING_METHOD.GPG,
    };

    await assert.doesNotReject(() => show());
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: validProfile, opts: { mismatches } });
  });

  it('identifies mismatches when profile signs but git config does not', async () => {
    userName = validProfileWithSshKey.username;
    userEmail = validProfileWithSshKey.email;
    profiles = [validProfileWithSshKey];
    gitwhoProfile = validProfileWithSshKey.name;
    const show = await loadShow({
      '../../src/utils/ssh.ts': {
        listSshKeys: async () => sshKeys,
      },
    });

    const mismatches: ProfileMismatches = {
      signingKey: undefined,
      signingMethod: undefined,
    };
    const signingKeyStatus: SigningKeyStatus = { found: true };

    await assert.doesNotReject(() => show());
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, {
      profile: validProfileWithSshKey,
      opts: { mismatches, signingKeyStatus },
    });
  });

  it('derives profile from git config', async () => {
    userName = personalProfile.username;
    userEmail = personalProfile.email;
    profiles = multiProfiles;
    const show = await loadShow({
      ...logMock,
    });
    await assert.doesNotReject(() => show());
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: personalProfile });
    assert.ok(logWarnCalls.includes('Profile derived from git config — not explicitly set via gitwho.profile'));
  });

  it('derives profile from git config when gitwho.profile is invalid', async () => {
    userName = personalProfile.username;
    userEmail = personalProfile.email;
    profiles = multiProfiles;
    gitwhoProfile = 'invalid';
    const show = await loadShow({
      ...logMock,
    });
    await assert.doesNotReject(() => show());
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: personalProfile });
    assert.ok(logWarnCalls.includes('Profile derived from git config — not explicitly set via gitwho.profile'));
  });

  it('displays message that signing method is mismatch from derived profile (git set, profile not)', async () => {
    userName = validProfile.username;
    userEmail = validProfile.email;
    commitSign = 'true';
    userSigningKey = validProfileWithSshKey.signingKey!;
    gpgFormat = 'ssh';
    profiles = [validProfile];
    const show = await loadShow({
      ...logMock,
    });
    const mismatches: ProfileMismatches = {
      signingKey: validProfileWithSshKey.signingKey,
      signingMethod: SIGNING_METHOD.SSH,
    };

    await assert.doesNotReject(() => show());
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: validProfile, opts: { mismatches } });
    assert.ok(logWarnCalls.includes('Profile derived from git config — not explicitly set via gitwho.profile'));
  });

  it('displays message that signing method is mismatch from git config (profile gpg, git ssh)', async () => {
    let listGpgKeysCalled = false;
    userName = validProfile.username;
    userEmail = validProfile.email;
    commitSign = 'true';
    gpgFormat = 'ssh';
    userSigningKey = validProfileWithSshKey.signingKey!;
    profiles = [validProfileWithGpgKey];
    const show = await loadShow({
      '../../src/utils/gpg.ts': {
        listGpgKeys: async (query: string) => {
          assert.equal(query, validProfileWithGpgKey.signingKey);
          listGpgKeysCalled = true;
          return [gpgKeys[0]];
        },
      },
      ...logMock,
    });

    const mismatches: ProfileMismatches = {
      signingKey: validProfileWithSshKey.signingKey,
      signingMethod: SIGNING_METHOD.SSH,
    };
    const signingKeyStatus: SigningKeyStatus = {
      found: true,
      uids: gpgKeys[0].uids,
    };
    await assert.doesNotReject(() => show());
    assert.ok(listGpgKeysCalled, 'listGpgKeys was not called');
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: validProfileWithGpgKey, opts: { mismatches, signingKeyStatus } });
    assert.ok(logWarnCalls.includes('Profile derived from git config — not explicitly set via gitwho.profile'));
  });

  it('calls print profile for named profile (ssh key)', async () => {
    profiles = [validProfileWithSshKey];
    let listSshKeysCalled = false;
    const show = await loadShow({
      '../../src/utils/ssh.ts': {
        listSshKeys: async () => {
          listSshKeysCalled = true;
          return sshKeys;
        },
      },
    });
    await assert.doesNotReject(() => show(validProfileWithSshKey.name));
    assert.ok(listSshKeysCalled, 'listSshKeys was not called');
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, {
      profile: validProfileWithSshKey,
      opts: { signingKeyStatus: { found: true } },
    });
  });

  it('identifies that ssh key does not exist for profile', async () => {
    profiles = [validProfileWithSshKey];
    let listSshKeysCalled = false;

    const show = await loadShow({
      '../../src/utils/ssh.ts': {
        listSshKeys: async () => {
          listSshKeysCalled = true;
          return [];
        },
      },
    });
    await assert.doesNotReject(() => show(validProfileWithSshKey.name));
    assert.ok(listSshKeysCalled, 'listSshKeys was not called');
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, {
      profile: validProfileWithSshKey,
      opts: { signingKeyStatus: { found: false } },
    });
  });

  it('calls print profile for named profile (gpg key)', async () => {
    profiles = [validProfileWithGpgKey];
    let listGpgKeysCalled = false;
    const show = await loadShow({
      '../../src/utils/gpg.ts': {
        listGpgKeys: async (query: string) => {
          assert.equal(query, validProfileWithGpgKey.signingKey);
          listGpgKeysCalled = true;
          return gpgKeys;
        },
      },
    });
    const signingKeyStatus: SigningKeyStatus = {
      found: true,
      uids: gpgKeys[0].uids,
    };
    await assert.doesNotReject(() => show(validProfileWithGpgKey.name));
    assert.ok(listGpgKeysCalled, 'listGpgKeys was not called');
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: validProfileWithGpgKey, opts: { signingKeyStatus } });
  });

  it('calls print profile for named profile (gpg key with multiple uids)', async () => {
    const profile = new Profile(validProfileWithGpgKey.name, validProfile, {
      method: SIGNING_METHOD.GPG,
      key: gpgKeys[1].keyId,
    });
    profiles = [profile];
    let listGpgKeysCalled = false;
    const show = await loadShow({
      '../../src/utils/gpg.ts': {
        listGpgKeys: async (query: string) => {
          assert.equal(query, profile.signingKey);
          listGpgKeysCalled = true;
          return [gpgKeys[1]];
        },
      },
    });
    const signingKeyStatus: SigningKeyStatus = {
      found: true,
      uids: gpgKeys[1].uids,
    };
    await assert.doesNotReject(() => show(profile.name));
    assert.ok(listGpgKeysCalled, 'listGpgKeys was not called');
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile, opts: { signingKeyStatus } });
  });

  it('identifies that a gpg key does not exist for profile', async () => {
    profiles = [validProfileWithGpgKey];
    let listGpgKeysCalled = false;
    const show = await loadShow({
      '../../src/utils/gpg.ts': {
        listGpgKeys: async (query: string) => {
          assert.equal(query, validProfileWithGpgKey.signingKey);
          listGpgKeysCalled = true;
          return [];
        },
      },
    });
    const signingKeyStatus: SigningKeyStatus = {
      found: false,
    };
    await assert.doesNotReject(() => show(validProfileWithGpgKey.name));
    assert.ok(listGpgKeysCalled, 'listGpgKeys was not called');
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: validProfileWithGpgKey, opts: { signingKeyStatus } });
  });
});
