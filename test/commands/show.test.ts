import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import type { SimpleGit } from 'simple-git';
import {
  multiProfiles,
  personalProfile,
  validProfile,
  validProfileWithGpgKey,
  validProfileWithSshKey,
  sshKeys,
  gpgKeys,
} from '../fixtures.ts';
import { Profile, SIGNING_METHOD } from '../../src/profile.ts';
import type { ProfileMismatches, SigningKeyStatus } from '../../src/utils/display.ts';
import type { ResolvedInfo } from '../../src/utils/repo-profile.ts';

type PrintProfile = typeof import('../../src/utils/display.ts').printProfile;
type PrintProfileCall = { profile: Profile; opts?: Parameters<PrintProfile>[1] };
type Mocks = Record<string, object>;

describe('commands/show.ts', async () => {
  let printProfileParam: PrintProfileCall | undefined;
  let profiles: Profile[] = multiProfiles;
  let resolved: ResolvedInfo | Error = { profile: validProfile, derived: false, mismatches: {} };
  let resolveCalls = 0;
  const logWarnCalls: string[] = [];
  const logJsonCalls: unknown[] = [];

  const fakeGit = {
    checkIsRepo: async () => true,
  } as SimpleGit;

  const profilesMock = {
    '../../src/utils/profiles.ts': {
      loadProfiles: async () => profiles,
    },
  };

  const repoProfileMock = {
    '../../src/utils/repo-profile.ts': {
      resolveFromGit: async (given: Profile[]) => {
        assert.equal(given, profiles, 'resolveFromGit should receive the loaded profiles');
        resolveCalls++;
        if (resolved instanceof Error) {
          throw resolved;
        }
        return resolved;
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

  // JSON output goes to stdout and carries the warnings as fields, so nothing is warned about on stderr.
  const logJsonMock = {
    '../../src/utils/log.ts': {
      default: {
        json: (value: unknown) => logJsonCalls.push(value),
        warn: () => {
          assert.fail('log warn should not be called.');
        },
      },
    },
  };

  const loadShow = async (overrides: Mocks = {}) => {
    const { default: show } = await esmock<typeof import('../../src/commands/show.ts')>(
      '../../src/commands/show.ts',
      {
        ...profilesMock,
        ...repoProfileMock,
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
    profiles = multiProfiles;
    resolved = { profile: validProfile, derived: false, mismatches: {} };
    resolveCalls = 0;
    logWarnCalls.length = 0;
    logJsonCalls.length = 0;
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

  it('throws when the profile for the repo cannot be resolved', async () => {
    resolved = new Error('No profile set and none found matching the current git config.');
    const show = await loadShow({
      ...printProfileFail,
    });
    await assert.rejects(() => show(), { message: resolved instanceof Error ? resolved.message : '' });
  });

  it('calls print profile for named profile (no key), without resolving from the repo', async () => {
    const show = await loadShow();
    await assert.doesNotReject(() => show(validProfile.name));
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: validProfile });
    assert.equal(resolveCalls, 0);
  });

  it('passes the mismatches of the profile for the repo to print profile', async () => {
    const mismatches: ProfileMismatches = { username: personalProfile.username, email: undefined };
    resolved = { profile: validProfile, derived: false, mismatches };
    const show = await loadShow();
    await assert.doesNotReject(() => show());
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: validProfile, opts: { mismatches } });
  });

  it('passes no extras to print profile when the repo matches its profile', async () => {
    const show = await loadShow();
    await assert.doesNotReject(() => show());
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: validProfile });
  });

  it('warns when the profile for the repo was derived from git config', async () => {
    resolved = { profile: personalProfile, derived: true, mismatches: {} };
    const show = await loadShow({
      ...logMock,
    });
    await assert.doesNotReject(() => show());
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: personalProfile });
    assert.deepEqual(logWarnCalls, ['Profile derived from git config — not explicitly set via gitwho.profile']);
  });

  it('shows the mismatches and the signing key status of a derived profile', async () => {
    const mismatches: ProfileMismatches = {
      signingKey: validProfileWithSshKey.signingKey,
      signingMethod: SIGNING_METHOD.SSH,
    };
    resolved = { profile: validProfileWithGpgKey, derived: true, mismatches };
    let listGpgKeysCalled = false;
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
    const signingKeyStatus: SigningKeyStatus = {
      found: true,
      uids: gpgKeys[0].uids,
    };
    await assert.doesNotReject(() => show());
    assert.ok(listGpgKeysCalled, 'listGpgKeys was not called');
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, { profile: validProfileWithGpgKey, opts: { mismatches, signingKeyStatus } });
    assert.equal(logWarnCalls.length, 1);
  });

  it('looks up the signing key of the profile for the repo', async () => {
    const mismatches: ProfileMismatches = { signingKey: undefined, signingMethod: undefined };
    resolved = { profile: validProfileWithSshKey, derived: false, mismatches };
    const show = await loadShow({
      '../../src/utils/ssh.ts': {
        listSshKeys: async () => sshKeys,
      },
    });
    const signingKeyStatus: SigningKeyStatus = { found: true };

    await assert.doesNotReject(() => show());
    assert.ok(printProfileParam, 'printProfile was not called');
    assert.deepEqual(printProfileParam, {
      profile: validProfileWithSshKey,
      opts: { mismatches, signingKeyStatus },
    });
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

  describe('with json', () => {
    const showJson = async (name?: string, overrides: Mocks = {}) => {
      const show = await loadShow({ ...printProfileFail, ...logJsonMock, ...overrides });
      return show(name, { json: true });
    };

    it('prints a named profile, which has nothing to compare against', async () => {
      await assert.doesNotReject(() => showJson(validProfile.name));
      assert.deepEqual(logJsonCalls, [{
        profile: validProfile,
        derived: false,
        signingKeyStatus: undefined,
        mismatches: undefined,
      }]);
    });

    it('prints no mismatches when the repo config matches the profile', async () => {
      await assert.doesNotReject(() => showJson());
      assert.deepEqual(logJsonCalls, [{
        profile: validProfile,
        derived: false,
        signingKeyStatus: undefined,
        mismatches: {},
      }]);
    });

    it('marks the fields git has nothing for as null, so they are not dropped', async () => {
      resolved = { profile: validProfile, derived: false, mismatches: { username: undefined, email: undefined } };
      await assert.doesNotReject(() => showJson());
      assert.deepEqual(logJsonCalls, [{
        profile: validProfile,
        derived: false,
        signingKeyStatus: undefined,
        mismatches: { username: null, email: null },
      }]);
    });

    it('prints the values git has where they differ from the profile', async () => {
      resolved = {
        profile: validProfile,
        derived: false,
        mismatches: { username: personalProfile.username, email: personalProfile.email },
      };
      await assert.doesNotReject(() => showJson());
      assert.deepEqual(logJsonCalls, [{
        profile: validProfile,
        derived: false,
        signingKeyStatus: undefined,
        mismatches: { username: personalProfile.username, email: personalProfile.email },
      }]);
    });

    it('flags a profile derived from the git config, without warning', async () => {
      resolved = { profile: validProfile, derived: true, mismatches: {} };
      await assert.doesNotReject(() => showJson());
      assert.deepEqual(logJsonCalls, [{
        profile: validProfile,
        derived: true,
        signingKeyStatus: undefined,
        mismatches: {},
      }]);
    });

    it('includes the status of an ssh signing key', async () => {
      profiles = [validProfileWithSshKey];
      await assert.doesNotReject(() => showJson(validProfileWithSshKey.name, {
        '../../src/utils/ssh.ts': { listSshKeys: async () => sshKeys },
      }));
      assert.deepEqual(logJsonCalls, [{
        profile: validProfileWithSshKey,
        derived: false,
        signingKeyStatus: { found: true },
        mismatches: undefined,
      }]);
    });

    it('includes the status and identities of a gpg signing key', async () => {
      profiles = [validProfileWithGpgKey];
      await assert.doesNotReject(() => showJson(validProfileWithGpgKey.name, {
        '../../src/utils/gpg.ts': { listGpgKeys: async () => gpgKeys },
      }));
      assert.deepEqual(logJsonCalls, [{
        profile: validProfileWithGpgKey,
        derived: false,
        signingKeyStatus: { found: true, uids: gpgKeys[0].uids },
        mismatches: undefined,
      }]);
    });

    it('reports a signing key that is not found', async () => {
      profiles = [validProfileWithSshKey];
      await assert.doesNotReject(() => showJson(validProfileWithSshKey.name, {
        '../../src/utils/ssh.ts': { listSshKeys: async () => [] },
      }));
      assert.deepEqual(logJsonCalls, [{
        profile: validProfileWithSshKey,
        derived: false,
        signingKeyStatus: { found: false },
        mismatches: undefined,
      }]);
    });

    it('prints nothing when the profile cannot be found', async () => {
      profiles = [];
      await assert.rejects(() => showJson('not-found'), { message: 'Profile not-found not found.' });
      assert.deepEqual(logJsonCalls, []);
    });
  });
});
