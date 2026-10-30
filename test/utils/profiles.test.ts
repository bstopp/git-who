import os from 'node:os';
import path from 'node:path';
import { access, chmod, constants, readFile, writeFile } from 'node:fs/promises';

import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import type { SimpleGit } from 'simple-git';

import { Profile } from '../../src/profile.ts';
type ProfilesModule = typeof import('../../src/utils/profiles.ts');
type Mocks = Record<string, object>;
import {
  multiProfiles,
  personalProfile,
  validProfile,
  validProfiles,
  validProfileWithGpgKey,
  validProfileWithSshKey,
  sshKeys,
} from '../fixtures.ts';
import { tmpHome } from '../hooks.ts';

const clearUndefined = (source: Profile[]): [] => {
  return JSON.parse(JSON.stringify(source));
};

describe('utils/profiles.ts', () => {
  let loadProfiles: ProfilesModule['loadProfiles'];
  let addProfile: ProfilesModule['addProfile'];
  let updateProfile: ProfilesModule['updateProfile'];
  let removeProfile: ProfilesModule['removeProfile'];
  let getActiveProfileName: ProfilesModule['getActiveProfileName'];
  let applyProfile: ProfilesModule['applyProfile'];
  let NoProfilesError: ProfilesModule['NoProfilesError'];
  let CONFIG_PATH: string;

  const osMock = {
    'node:os': { homedir: () => tmpHome },
  };

  const listGpgKeysFail = {
    '../../src/utils/gpg.ts': {
      listGpgKeys: async () => assert.fail('listGpgKeys should not be called'),
    },
  };

  const listSshKeysFail = {
    '../../src/utils/ssh.ts': {
      listSshKeys: async () => assert.fail('listSshKeys should not be called'),
    },
  };

  const loadProfilesModule = async (overrides: Mocks = {}) => {
    return esmock<ProfilesModule>(
      '../../src/utils/profiles.ts',
      {
        ...osMock,
        ...listGpgKeysFail,
        ...listSshKeysFail,
        ...overrides, // same key wins, so it replaces the default
      },
    );
  };

  beforeEach(async () => {
    // I really, really want to make sure that tests don't run if they arent using the tmpdir
    assert.ok(tmpHome.startsWith(os.tmpdir()));
    ({ loadProfiles, addProfile, updateProfile, removeProfile, getActiveProfileName, applyProfile, NoProfilesError }
      = await loadProfilesModule());
    CONFIG_PATH = path.join(tmpHome, '.git-who.cfg.json');
  });

  const writeConfig = (contents: unknown) => writeFile(CONFIG_PATH, JSON.stringify(contents));

  const readConfig = async () => JSON.parse(await readFile(CONFIG_PATH, 'utf8'));

  const withConfigMode = async (mode: number, func: () => Promise<unknown>) => {
    await chmod(CONFIG_PATH, mode);
    try {
      await func();
    } finally {
      await chmod(CONFIG_PATH, 0o644);
    }
  };

  const readPropagationError = async (func: () => Promise<unknown>) => {
    await writeConfig(validProfiles);
    await withConfigMode(0o000, () => assert.rejects(func, { message: /^Config file could not be read: / }));
  };

  describe('loadProfiles', () => {
    it('throws NoProfilesError if the config file does not exist', async () => {
      await assert.rejects(() => loadProfiles(), NoProfilesError);
    });

    it('throws if the config file exists but cannot be read', async () => {
      await writeConfig(validProfiles);
      await withConfigMode(0o000, () => assert.rejects(() => loadProfiles(), (err: Error) => {
        assert.match(err.message, /^Config file could not be read: /);
        assert.equal((err.cause as NodeJS.ErrnoException).code, 'EACCES');
        return true;
      }));
    });

    it('throws if the config file is corrupt, keeping the parse error as the cause', async () => {
      await writeFile(CONFIG_PATH, 'not valid json');
      await assert.rejects(() => loadProfiles(), (err: Error) => {
        assert.match(err.message, /^Config file could not be parsed: /);
        assert.ok(err.cause instanceof SyntaxError);
        return true;
      });
    });

    it('throws if the config file contains a primitive', async () => {
      await writeFile(CONFIG_PATH, '"a string"');
      await assert.rejects(() => loadProfiles(), { message: /^Config file could not be parsed: / });
    });

    it('throws if the config file contains an object', async () => {
      await writeFile(CONFIG_PATH, '{}');
      await assert.rejects(() => loadProfiles(), { message: /^Config file could not be parsed: / });
    });

    it('throws NoProfilesError if the config file is empty', async () => {
      await writeFile(CONFIG_PATH, 'null');
      await assert.rejects(() => loadProfiles(), NoProfilesError);
    });

    it('throws if any profile fails validation', async () => {
      const bad = [{ name: 'work', host: 'github work!', username: 'Bryan', email: 'bryan@work.com' }];
      await writeConfig(bad);
      await assert.rejects(() => loadProfiles());
    });

    it('throws if any profile signing fails validation', async () => {
      const bad = [{ name: 'work', host: 'work', username: 'Bryan', email: 'bryan@work.com', signingMethod: 'gpg' }];
      await writeConfig(bad);
      await assert.rejects(() => loadProfiles());
    });

    describe('with a malformed profile entry', () => {
      const invalidAt = (position: number, reason: string) => {
        return `Config file has an invalid profile at position ${position}: ${reason} (${CONFIG_PATH})`;
      };

      for (const [label, entry] of [['null', null], ['a string', 'work'], ['a number', 1], ['an array', []]] as const) {
        it(`throws naming the config file if an entry is ${label}`, async () => {
          await writeConfig([validProfile, entry]);
          await assert.rejects(() => loadProfiles(), { message: invalidAt(2, 'expected an object.') });
        });
      }

      for (const field of ['name', 'host', 'username', 'email'] as const) {
        it(`throws naming the config file if '${field}' is missing`, async () => {
          await writeConfig([{ ...validProfile, [field]: undefined }]);
          await assert.rejects(() => loadProfiles(), { message: invalidAt(1, `'${field}' must be a string.`) });
        });
      }

      it('throws naming the config file if a required field is not a string', async () => {
        await writeConfig([{ ...validProfile, host: 7 }]);
        await assert.rejects(() => loadProfiles(), { message: invalidAt(1, "'host' must be a string.") });
      });

      it('throws naming the config file if signingMethod is not a string', async () => {
        await writeConfig([{ ...validProfileWithSshKey, signingMethod: 7 }]);
        await assert.rejects(() => loadProfiles(), { message: invalidAt(1, "'signingMethod' must be a string.") });
      });

      it('throws naming the config file if signingMethod is set without a signingKey', async () => {
        await writeConfig([{ ...validProfileWithSshKey, signingKey: undefined }]);
        await assert.rejects(() => loadProfiles(), {
          message: invalidAt(1, "'signingKey' must be a string when 'signingMethod' is set."),
        });
      });

      it('wraps a validation failure with its cause, naming the config file and position', async () => {
        const bad = { ...personalProfile, host: 'github personal!' };
        await writeConfig([validProfile, bad]);
        const expected = (() => {
          try {
            new Profile(bad.name, bad);
          } catch (err) {
            return err as Error;
          }
          return assert.fail('the bad profile should not validate');
        })();
        await assert.rejects(() => loadProfiles(), (err: Error) => {
          assert.equal(err.message, `Config file has an invalid profile at position 2 (${CONFIG_PATH})`);
          assert.deepEqual(err.cause, expected);
          return true;
        });
      });
    });

    it('returns all profiles when file is valid', async () => {
      await writeConfig(validProfiles);
      const profiles = await loadProfiles();
      assert.deepEqual(profiles, validProfiles);
    });

    it('preserves gpg signingKey when present', async () => {
      await writeConfig([validProfileWithGpgKey]);
      const profiles = await loadProfiles();
      assert.deepEqual(profiles, [validProfileWithGpgKey]);
    });

    it('preserves ssh signingKey when present', async () => {
      await writeConfig([validProfileWithSshKey]);
      const profiles = await loadProfiles();
      assert.deepEqual(profiles, [validProfileWithSshKey]);
    });

    it('strips unknown fields from profiles on load', async () => {
      const dirty = [{ ...validProfile, unknown: 'value', extra: 123 }];
      await writeConfig(dirty);
      const profiles = await loadProfiles();
      assert.deepEqual(profiles, [validProfile]);
    });

    it('loads from cache if already in memory', async () => {
      await writeConfig(validProfiles);
      const profiles = await loadProfiles();
      await writeConfig([validProfileWithSshKey]);
      const reloaded = await loadProfiles();
      assert.deepEqual(profiles, reloaded);
    });

    it('does not duplicate profiles in the cache when loadProfiles is called concurrently', async () => {
      await writeConfig(validProfiles);
      await Promise.all([loadProfiles(), loadProfiles()]); // both start before either resolves
      const third = await loadProfiles(); // now reads from cache
      assert.deepEqual(third, validProfiles);
    });
  });

  describe('addProfiles', () => {
    it('propagates a read error if the config file exists but cannot be read', async () => {
      return readPropagationError(() => {
        return addProfile(personalProfile);
      });
    });

    it('throws if profile name already exists', async () => {
      await writeConfig(multiProfiles);
      await assert.rejects(addProfile(personalProfile), { message: /already exists/ });
    });

    it('throws if the config file cannot be written', async () => {
      await writeConfig(validProfiles);
      await withConfigMode(0o444, async () => {
        await assert.rejects(() => addProfile(personalProfile), (err: Error) => {
          assert.match(err.message, /^Config file could not be written: /);
          assert.equal((err.cause as NodeJS.ErrnoException).code, 'EACCES');
          return true;
        });
        const profiles = await loadProfiles();
        // validate cache wasn't updated
        assert.deepEqual(clearUndefined(profiles), clearUndefined(validProfiles));
      });
    });

    it('creates the config file with the new profile if it does not exist', async () => {
      await addProfile(validProfile);
      assert.deepEqual(await readConfig(), clearUndefined([validProfile]));
    });

    it('appends to existing profiles', async () => {
      await writeConfig(validProfiles);
      await addProfile(personalProfile);
      assert.deepEqual(await readConfig(), clearUndefined([...validProfiles, personalProfile]));
    });

    it('appends to cache', async () => {
      await writeConfig(validProfiles);
      await addProfile(personalProfile);
      assert.deepEqual(await loadProfiles(), [...validProfiles, personalProfile]);
    });
  });

  describe('updateProfile', () => {
    it('propagates a read error if the config file exists but cannot be read', async () => {
      return readPropagationError(() => {
        return updateProfile(personalProfile, validProfile);
      });
    });

    it('throws if profile does not exist', async () => {
      await writeConfig(validProfiles);
      const doesnotexist = new Profile('doesnotexist', validProfile);
      await assert.rejects(updateProfile(doesnotexist, validProfile), { message: /not found/ });
    });

    it('throws if the config file cannot be written', async () => {
      await writeConfig(validProfiles);
      await withConfigMode(0o444, () => {
        return assert.rejects(() => updateProfile(validProfile, personalProfile), { message: /^Config file could not be written: / });
      });
    });

    it('replaces an existing profile', async () => {
      await writeConfig(validProfiles);
      const profile = new Profile('work', personalProfile);
      await updateProfile(validProfile, profile);
      assert.deepEqual(await readConfig(), clearUndefined([profile, validProfileWithGpgKey, validProfileWithSshKey]));
    });

    it('replaces an existing profile in cached', async () => {
      await writeConfig(validProfiles);
      const profile = new Profile('work', personalProfile);
      await updateProfile(validProfile, profile);
      const result = await loadProfiles();
      assert.deepEqual(result, [profile, validProfileWithGpgKey, validProfileWithSshKey]);
    });
  });

  describe('removeProfile', () => {
    it('propagates a read error if the config file exists but cannot be read', async () => {
      return readPropagationError(() => {
        return removeProfile(validProfile.name);
      });
    });

    it('throws if the config file cannot be written', async () => {
      await writeConfig(multiProfiles);
      await withConfigMode(0o444, () => {
        return assert.rejects(() => removeProfile('work'), { message: /^Config file could not be written: / });
      });
    });

    it('is a noop if the name is not valid', async () => {
      await assert.doesNotReject(() => removeProfile(''));
    });

    it('is a noop if the config file does not exist', async () => {
      await assert.rejects(access(CONFIG_PATH, constants.F_OK));
      await assert.doesNotReject(() => removeProfile('work'));
    });

    it('is a noop if the profile does not exist', async () => {
      await writeConfig(multiProfiles);
      await assert.doesNotReject(() => removeProfile('nonexistent'));
      const result = await loadProfiles();
      assert.deepEqual(result, multiProfiles);
    });

    it('removes an existing profile', async () => {
      await writeConfig(multiProfiles);
      await removeProfile('work');
      assert.deepEqual(await readConfig(), clearUndefined([personalProfile]));
    });

    it('removes an existing profile from cache', async () => {
      await writeConfig(multiProfiles);
      await removeProfile('work');
      const result = await loadProfiles();
      assert.deepEqual(result, [personalProfile]);
    });
  });

  describe('getActiveProfileName', () => {
    let isRepo = true;
    let checkIsRepoError: Error | undefined;
    let activeProfile: string | null = null;
    const getConfigCalls: [string, string][] = [];

    const fakeGit = {
      checkIsRepo: async () => {
        if (checkIsRepoError) {
          throw checkIsRepoError;
        }
        return isRepo;
      },
      getConfig: async (key: string, scope: string) => {
        getConfigCalls.push([key, scope]);
        return { value: activeProfile };
      },
    } as unknown as SimpleGit;

    beforeEach(() => {
      isRepo = true;
      checkIsRepoError = undefined;
      activeProfile = null;
      getConfigCalls.length = 0;
    });

    it('propagates the error when reading git state fails', async () => {
      checkIsRepoError = new Error('checkIsRepo failed');
      await assert.rejects(
        () => getActiveProfileName(fakeGit),
        { message: 'checkIsRepo failed' },
      );
      assert.deepEqual(getConfigCalls, []);
    });

    it('returns undefined without reading config when not in a git repo', async () => {
      isRepo = false;
      const result = await getActiveProfileName(fakeGit);
      assert.equal(result, undefined);
      assert.deepEqual(getConfigCalls, []);
    });

    it('returns the configured profile name when in a repo', async () => {
      activeProfile = personalProfile.name;
      const result = await getActiveProfileName(fakeGit);
      assert.equal(result, personalProfile.name);
      assert.deepEqual(getConfigCalls, [['gitwho.profile', 'local']]);
    });

    it('returns undefined when in a repo but gitwho.profile is unset', async () => {
      const result = await getActiveProfileName(fakeGit);
      assert.equal(result, undefined);
      assert.deepEqual(getConfigCalls, [['gitwho.profile', 'local']]);
    });
  });

  describe('applyProfile', () => {
    const addConfigCalls: [string, string, boolean, string][] = [];
    const rawCalls: string[][] = [];
    const mockGit = {
      addConfig: (key: string, value: string, append: boolean, scope: string) => {
        addConfigCalls.push([key, value, append, scope]);
        return Promise.resolve();
      },
      raw: (args: string[]) => {
        rawCalls.push(args);
        return Promise.resolve();
      },
      remote: () => assert.fail('remote should not be called.'),
    } as unknown as SimpleGit;

    const untouchedGit = {
      addConfig: () => assert.fail('addConfig should not be called'),
      raw: () => assert.fail('raw should not be called'),
    } as unknown as SimpleGit;

    const gpgKeysMock = (keys: { keyId: string; uids: string[] }[]) => ({
      '../../src/utils/gpg.ts': { listGpgKeys: async () => keys },
    });

    const sshKeysMock = (keys: string[]) => ({
      '../../src/utils/ssh.ts': { listSshKeys: async () => keys },
    });

    beforeEach(() => {
      addConfigCalls.length = 0;
      rawCalls.length = 0;
    });

    it('throws a SigningKeyNotFoundError when the gpg key for profile.signingKey is not found', async () => {
      const { applyProfile: apply, SigningKeyNotFoundError } = await loadProfilesModule({
        ...gpgKeysMock([]),
      });
      await assert.rejects(
        () => apply(untouchedGit, validProfileWithGpgKey),
        (err: NodeJS.ErrnoException) => {
          assert.ok(err instanceof SigningKeyNotFoundError);
          assert.equal(err.message, `GPG key '${validProfileWithGpgKey.signingKey}' not found for profile '${validProfileWithGpgKey.name}'.`);
          return true;
        },
      );
    });

    it('throws a SigningKeyNotFoundError when the ssh key for profile.signingKey is not found, without touching git config', async () => {
      const { applyProfile: apply, SigningKeyNotFoundError } = await loadProfilesModule({
        ...sshKeysMock([]),
      });
      await assert.rejects(
        () => apply(untouchedGit, validProfileWithSshKey),
        (err: NodeJS.ErrnoException) => {
          assert.ok(err instanceof SigningKeyNotFoundError);
          assert.equal(err.message, `SSH key '${validProfileWithSshKey.signingKey}' not found for profile '${validProfileWithSshKey.name}'.`);
          return true;
        },
      );
    });

    it('propagates the error when a git config update fails', async () => {
      const git = {
        addConfig: () => Promise.reject(new Error('addConfig failed')),
        raw: () => Promise.resolve(),
      } as unknown as SimpleGit;
      await assert.rejects(
        () => applyProfile(git, validProfile),
        { message: 'addConfig failed' },
      );
    });

    it('sets gitwho.profile, user.name, and user.email, and clears singning info config when profile has no signingMethod', async () => {
      await applyProfile(mockGit, validProfile);
      assert.deepEqual(addConfigCalls, [
        ['gitwho.profile', validProfile.name, false, 'local'],
        ['user.name', validProfile.username, false, 'local'],
        ['user.email', validProfile.email, false, 'local'],
      ]);
      assert.deepEqual(rawCalls, [
        ['config', '--local', '--unset', 'user.signingKey'],
        ['config', '--local', '--unset', 'commit.gpgsign'],
        ['config', '--local', '--unset', 'gpg.format'],
      ]);
    });

    it('sets user.signingKey and commit.gpgsign when profile has a signing method === gpg', async () => {
      const { applyProfile: apply } = await loadProfilesModule({
        ...gpgKeysMock([{ keyId: validProfileWithGpgKey.signingKey!, uids: [] }]),
      });
      await apply(mockGit, validProfileWithGpgKey);
      assert.deepEqual(addConfigCalls, [
        ['gitwho.profile', validProfileWithGpgKey.name, false, 'local'],
        ['user.name', validProfileWithGpgKey.username, false, 'local'],
        ['user.email', validProfileWithGpgKey.email, false, 'local'],
        ['user.signingKey', validProfileWithGpgKey.signingKey, false, 'local'],
        ['commit.gpgsign', 'true', false, 'local'],
      ]);
      assert.deepEqual(rawCalls, [
        ['config', '--local', '--unset', 'gpg.format'],
      ]);
    });

    it('sets user.signingKey, commit.gpgsign, gpg.format when profile has a signing method === ssh', async () => {
      const { applyProfile: apply } = await loadProfilesModule({
        ...sshKeysMock(sshKeys),
      });
      await apply(mockGit, validProfileWithSshKey);
      assert.deepEqual(addConfigCalls, [
        ['gitwho.profile', validProfileWithSshKey.name, false, 'local'],
        ['user.name', validProfileWithSshKey.username, false, 'local'],
        ['user.email', validProfileWithSshKey.email, false, 'local'],
        ['user.signingKey', validProfileWithSshKey.signingKey, false, 'local'],
        ['commit.gpgsign', 'true', false, 'local'],
        ['gpg.format', 'ssh', false, 'local'],
      ]);
      assert.deepEqual(rawCalls, []);
    });

    it('sets the origin remote url when originUrl is provided', async () => {
      const remoteCalls: string[][] = [];
      const git = {
        ...mockGit,
        remote: (args: string[]) => {
          remoteCalls.push(args);
          return Promise.resolve();
        },
      } as unknown as SimpleGit;
      const originUrl = 'git@github-work:org/repo.git';
      await applyProfile(git, validProfile, originUrl);
      assert.deepEqual(remoteCalls, [['set-url', 'origin', originUrl]]);
    });
  });
});
