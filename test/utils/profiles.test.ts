import os from 'node:os';
import path from 'node:path';
import { access, chmod, constants, readFile, writeFile } from 'node:fs/promises';

import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import type { SimpleGit } from 'simple-git';

import { Profile } from '../../src/profile.ts';
type ProfilesModule = typeof import('../../src/utils/profiles.ts');
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

  beforeEach(async () => {
    // I really, really want to make sure that tests don't run if they arent using the tmpdir
    assert.ok(tmpHome.startsWith(os.tmpdir()));
    ({ loadProfiles, addProfile, updateProfile, removeProfile, getActiveProfileName, applyProfile, NoProfilesError }
      = await esmock('../../src/utils/profiles.ts', {
        'node:os': { homedir: () => tmpHome },
      }));
    CONFIG_PATH = path.join(tmpHome, '.git-who.cfg.json');
  });

  const readPropagationError = async (func: () => Promise<unknown>) => {
    await writeFile(CONFIG_PATH, JSON.stringify(validProfiles));
    await chmod(CONFIG_PATH, 0o000);
    try {
      await assert.rejects(func, { message: /^Config file could not be read: / });
    } finally {
      await chmod(CONFIG_PATH, 0o644);
    }
  };

  describe('loadProfiles', () => {
    it('throws NoProfilesError if the config file does not exist', async () => {
      await assert.rejects(() => loadProfiles(), NoProfilesError);
    });

    it('throws if the config file exists but cannot be read', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify(validProfiles));
      await chmod(CONFIG_PATH, 0o000);
      await assert.rejects(() => loadProfiles(), { message: /^Config file could not be read: / });
    });

    it('throws if the config file is corrupt', async () => {
      await writeFile(CONFIG_PATH, 'not valid json');
      await assert.rejects(() => loadProfiles(), { message: /^Config file could not be parsed: / });
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
      await writeFile(CONFIG_PATH, JSON.stringify(bad));
      await assert.rejects(() => loadProfiles());
    });

    it('throws if any profile signing fails validation', async () => {
      const bad = [{ name: 'work', host: 'work', username: 'Bryan', email: 'bryan@work.com', signingMethod: 'gpg' }];
      await writeFile(CONFIG_PATH, JSON.stringify(bad));
      await assert.rejects(() => loadProfiles());
    });

    it('returns all profiles when file is valid', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify(validProfiles));
      const profiles = await loadProfiles();
      assert.deepEqual(profiles, validProfiles);
    });

    it('preserves gpg signingKey when present', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify([validProfileWithGpgKey]));
      const profiles = await loadProfiles();
      assert.deepEqual(profiles, [validProfileWithGpgKey]);
    });

    it('preserves ssh signingKey when present', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify([validProfileWithSshKey]));
      const profiles = await loadProfiles();
      assert.deepEqual(profiles, [validProfileWithSshKey]);
    });

    it('strips unknown fields from profiles on load', async () => {
      const dirty = [{ ...validProfile, unknown: 'value', extra: 123 }];
      await writeFile(CONFIG_PATH, JSON.stringify(dirty));
      const profiles = await loadProfiles();
      assert.deepEqual(profiles, [validProfile]);
    });

    it('loads from cache if already in memory', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify(validProfiles));
      const profiles = await loadProfiles();
      await writeFile(CONFIG_PATH, JSON.stringify([validProfileWithSshKey]));
      const reloaded = await loadProfiles();
      assert.deepEqual(profiles, reloaded);
    });

    it('does not duplicate profiles in the cache when loadProfiles is called concurrently', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify(validProfiles));
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
      await writeFile(CONFIG_PATH, JSON.stringify(multiProfiles));
      await assert.rejects(addProfile(personalProfile), { message: /already exists/ });
    });

    it('throws if the config file cannot be written', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify(validProfiles));
      await chmod(CONFIG_PATH, 0o444);
      try {
        await assert.rejects(() => addProfile(personalProfile), { message: /^Config file could not be written: / });
        const profiles = await loadProfiles();
        // validate cache wasn't updated
        assert.deepEqual(clearUndefined(profiles), clearUndefined(validProfiles));
      } finally {
        await chmod(CONFIG_PATH, 0o644);
      }
    });

    it('creates the config file with the new profile if it does not exist', async () => {
      await addProfile(validProfile);
      const parsed = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
      assert.deepEqual(parsed, clearUndefined([validProfile]));
    });

    it('appends to existing profiles', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify(validProfiles));
      await addProfile(personalProfile);
      const fileContents = await readFile(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(fileContents);
      assert.deepEqual(parsed, clearUndefined([...validProfiles, personalProfile]));
    });

    it('appends to cache', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify(validProfiles));
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
      await writeFile(CONFIG_PATH, JSON.stringify(validProfiles));
      const doesnotexist = new Profile('doesnotexist', validProfile);
      await assert.rejects(updateProfile(doesnotexist, validProfile), { message: /not found/ });
    });

    it('throws if the config file cannot be written', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify(validProfiles));
      await chmod(CONFIG_PATH, 0o444);
      try {
        await assert.rejects(() => updateProfile(validProfile, personalProfile), { message: /^Config file could not be written: / });
      } finally {
        await chmod(CONFIG_PATH, 0o644);
      }
    });

    it('replaces an existing profile', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify(validProfiles));
      const profile = new Profile('work', personalProfile);
      await updateProfile(validProfile, profile);
      const fileContents = await readFile(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(fileContents);
      assert.deepEqual(parsed, clearUndefined([profile, validProfileWithGpgKey, validProfileWithSshKey]));
    });

    it('replaces an existing profile in cached', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify(validProfiles));
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
      await writeFile(CONFIG_PATH, JSON.stringify(multiProfiles));
      await chmod(CONFIG_PATH, 0o444);
      try {
        await assert.rejects(() => removeProfile('work'), { message: /^Config file could not be written: / });
      } finally {
        await chmod(CONFIG_PATH, 0o644);
      }
    });

    it('is a noop if the name is not valid', async () => {
      await assert.doesNotReject(() => removeProfile(''));
    });

    it('is a noop if the config file does not exist', async () => {
      await assert.rejects(access(CONFIG_PATH, constants.F_OK));
      await assert.doesNotReject(() => removeProfile('work'));
    });

    it('is a noop if the profile does not exist', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify(multiProfiles));
      await assert.doesNotReject(() => removeProfile('nonexistent'));
      const result = await loadProfiles();
      assert.deepEqual(result, multiProfiles);
    });

    it('removes an existing profile', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify(multiProfiles));
      await removeProfile('work');
      const fileContents = await readFile(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(fileContents);
      assert.deepEqual(parsed, clearUndefined([personalProfile]));
    });

    it('removes an existing profile from cache', async () => {
      await writeFile(CONFIG_PATH, JSON.stringify(multiProfiles));
      await removeProfile('work');
      const result = await loadProfiles();
      assert.deepEqual(result, [personalProfile]);
    });
  });

  describe('getActiveProfileName', () => {
    it('propagates the error when reading git state fails', async () => {
      const git = {
        checkIsRepo: async (): Promise<boolean> => {
          throw new Error('checkIsRepo failed');
        },
        getConfig: () => assert.fail('getConfig should not be called.'),
      } as unknown as SimpleGit;
      await assert.rejects(
        () => getActiveProfileName(git),
        { message: 'checkIsRepo failed' },
      );
    });

    it('returns undefined without reading config when not in a git repo', async () => {
      const git = {
        checkIsRepo: () => Promise.resolve(false),
        getConfig: () => assert.fail('getConfig should not be called.'),
      } as unknown as SimpleGit;
      const result = await getActiveProfileName(git);
      assert.equal(result, undefined);
    });

    it('returns the configured profile name when in a repo', async () => {
      const git = {
        checkIsRepo: () => Promise.resolve(true),
        getConfig: (key: string, scope: string) => {
          assert.equal(key, 'gitwho.profile');
          assert.equal(scope, 'local');
          return Promise.resolve({ value: personalProfile.name });
        },
      } as unknown as SimpleGit;
      const result = await getActiveProfileName(git);
      assert.equal(result, personalProfile.name);
    });

    it('returns undefined when in a repo but gitwho.profile is unset', async () => {
      const git = {
        checkIsRepo: () => Promise.resolve(true),
        getConfig: () => Promise.resolve({ value: null }),
      } as unknown as SimpleGit;
      const result = await getActiveProfileName(git);
      assert.equal(result, undefined);
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

    beforeEach(() => {
      addConfigCalls.length = 0;
      rawCalls.length = 0;
    });
    it('throws a SigningKeyNotFoundError when the gpg key for profile.signingKey is not found', async () => {
      const { applyProfile: apply, SigningKeyNotFoundError } = await esmock('../../src/utils/profiles.ts', {
        '../../src/utils/gpg.ts': { listGpgKeys: () => [] },
      });
      const git = {
        addConfig: () => assert.fail('addConfig should not be called'),
        raw: () => assert.fail('raw should not be called'),
      } as unknown as SimpleGit;
      await assert.rejects(
        () => apply(git, validProfileWithGpgKey),
        (err: NodeJS.ErrnoException) => {
          assert.ok(err instanceof SigningKeyNotFoundError);
          assert.equal(err.message, `GPG key '${validProfileWithGpgKey.signingKey}' not found for profile '${validProfileWithGpgKey.name}'.`);
          return true;
        },
      );
    });

    it('throws a SigningKeyNotFoundError when the ssh key for profile.signingKey is not found, without touching git config', async () => {
      const { applyProfile: apply, SigningKeyNotFoundError } = await esmock('../../src/utils/profiles.ts', {
        '../../src/utils/ssh.ts': { listSshKeys: () => [] },
      });
      const git = {
        addConfig: () => assert.fail('addConfig should not be called'),
        raw: () => assert.fail('raw should not be called'),
      } as unknown as SimpleGit;
      await assert.rejects(
        () => apply(git, validProfileWithSshKey),
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
      const { applyProfile: apply } = await esmock('../../src/utils/profiles.ts', {
        '../../src/utils/ssh.ts': {
          listSshKeys: () => assert.fail('listSshKeys should not be called'),
        },
        '../../src/utils/gpg.ts': { listGpgKeys: () => [{ keyId: validProfileWithGpgKey.signingKey, uids: [] }] },
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
      const { applyProfile: apply } = await esmock('../../src/utils/profiles.ts', {
        '../../src/utils/gpg.ts': { listGpgKeys: () => assert.fail('listGpgKeys should not be called') },
        '../../src/utils/ssh.ts': { listSshKeys: async () => sshKeys },
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
