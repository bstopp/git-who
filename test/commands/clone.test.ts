import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import type { SimpleGit } from 'simple-git';
import { personalProfile, validProfile, validProfiles } from '../fixtures.ts';
import type { Profile } from '../../src/profile.ts';
import { SigningKeyNotFoundError } from '../../src/utils/profiles.ts';

type Mocks = Record<string, object>;

describe('commands/clone.ts', () => {
  let loadProfilesError: Error | undefined;
  let selected: Profile = validProfile;
  let selectProfileError: Error | undefined;
  let selectProfileCall: { profiles: Profile[]; name?: string } | undefined;
  let cloneError: Error | undefined;
  let cloneCalls: { url: string; dir: string }[] = [];
  let simpleGitCalls: (string | undefined)[] = [];
  let verifySigningKeyError: Error | undefined;
  let verifySigningKeyCall: Profile | undefined;
  let events: string[] = [];
  let applyProfileError: Error | undefined;
  let applyProfileCall: { git: SimpleGit; profile: Profile; extraArgs: unknown[] } | undefined;
  const logInfoCalls: string[] = [];

  const cloningGit = {
    clone: async (url: string, dir: string) => {
      events.push('clone');
      cloneCalls.push({ url, dir });
      if (cloneError) {
        throw cloneError;
      }
    },
  } as unknown as SimpleGit;

  const repoGit = {} as SimpleGit;

  const simpleGitMock = {
    'simple-git': {
      // simpleGit() clones into the current directory, simpleGit(dir) works inside the clone.
      simpleGit: (baseDir?: string) => {
        simpleGitCalls.push(baseDir);
        return baseDir === undefined ? cloningGit : repoGit;
      },
    },
  };

  const profilesMock = {
    '../../src/utils/profiles.ts': {
      loadProfiles: async () => {
        if (loadProfilesError) {
          throw loadProfilesError;
        }
        return validProfiles;
      },
      verifySigningKey: async (profile: Profile) => {
        events.push('verifySigningKey');
        verifySigningKeyCall = profile;
        if (verifySigningKeyError) {
          throw verifySigningKeyError;
        }
      },
      applyProfile: async (git: SimpleGit, profile: Profile, ...extraArgs: unknown[]) => {
        applyProfileCall = { git, profile, extraArgs };
        if (applyProfileError) {
          throw applyProfileError;
        }
      },
    },
  };

  const promptsMock = {
    '../../src/utils/prompts.ts': {
      selectProfile: async (profiles: Profile[], name?: string) => {
        selectProfileCall = { profiles, name };
        if (selectProfileError) {
          throw selectProfileError;
        }
        return selected;
      },
    },
  };

  const logMock = {
    '../../src/utils/log.ts': {
      default: {
        info: (msg: string) => logInfoCalls.push(msg),
      },
    },
  };

  const chalkMock = {
    chalk: {
      default: {
        bold: (text: string) => `[bold]${text}[/bold]`,
      },
    },
  };

  const loadClone = async (overrides: Mocks = {}) => {
    const { default: clone } = await esmock<typeof import('../../src/commands/clone.ts')>(
      '../../src/commands/clone.ts',
      {
        ...simpleGitMock,
        ...profilesMock,
        ...promptsMock,
        ...logMock,
        ...chalkMock,
        ...overrides, // same key wins, so it replaces the default
      },
    );
    return clone;
  };

  const doneMessage = (url: string, dir: string) => {
    return `Cloned [bold]${url}[/bold] to ${dir} using profile [bold]${selected.name}[/bold].`;
  };

  const notAppliedMessage = (dir: string) => {
    return `Cloned '${dir}', but profile '${selected.name}' could not be applied. Run \`git who use ${selected.name}\` inside it to retry.`;
  };

  beforeEach(() => {
    loadProfilesError = undefined;
    selected = validProfile;
    selectProfileError = undefined;
    selectProfileCall = undefined;
    cloneError = undefined;
    cloneCalls = [];
    simpleGitCalls = [];
    verifySigningKeyError = undefined;
    verifySigningKeyCall = undefined;
    events = [];
    applyProfileError = undefined;
    applyProfileCall = undefined;
    logInfoCalls.length = 0;
  });

  it('passes through loadProfiles failures', async () => {
    loadProfilesError = new Error('config is corrupt');
    const clone = await loadClone();
    await assert.rejects(() => clone('org/repo'), { message: 'config is corrupt' });
    assert.equal(selectProfileCall, undefined);
    assert.deepEqual(cloneCalls, []);
  });

  it('passes through selectProfile failures', async () => {
    selectProfileError = new Error('prompt cancelled');
    const clone = await loadClone();
    await assert.rejects(() => clone('org/repo'), { message: 'prompt cancelled' });
    assert.deepEqual(cloneCalls, []);
  });

  it('throws before cloning when the repo format is not supported', async () => {
    const repo = 'https://github.com/org/repo';
    const clone = await loadClone();
    await assert.rejects(() => clone(repo, selected.name), { message: `Unsupported repo format: ${repo}` });
    assert.equal(verifySigningKeyCall, undefined);
    assert.deepEqual(cloneCalls, []);
    assert.equal(applyProfileCall, undefined);
  });

  it('verifies the signing key before cloning, passing a failure through without cloning', async () => {
    verifySigningKeyError = new SigningKeyNotFoundError('GPG key not found');
    const clone = await loadClone();
    await assert.rejects(() => clone('org/repo', selected.name), verifySigningKeyError);
    assert.equal(verifySigningKeyCall, selected);
    assert.deepEqual(events, ['verifySigningKey']);
    assert.deepEqual(cloneCalls, []);
    assert.equal(applyProfileCall, undefined);
    assert.deepEqual(logInfoCalls, []);
  });

  it('passes through clone failures without applying the profile', async () => {
    cloneError = new Error('auth failed');
    const clone = await loadClone();
    await assert.rejects(() => clone('org/repo', selected.name), { message: 'auth failed' });
    assert.equal(applyProfileCall, undefined);
    assert.deepEqual(logInfoCalls, []);
  });

  it('clones an ssh url using the profile host, then applies the profile in the clone', async () => {
    const clone = await loadClone();
    await assert.doesNotReject(() => clone(`git@${personalProfile.host}:org/repo.git`, selected.name));
    const url = `git@${selected.host}:org/repo.git`;
    assert.deepEqual(selectProfileCall, { profiles: validProfiles, name: selected.name });
    assert.deepEqual(cloneCalls, [{ url, dir: 'repo' }]);
    assert.deepEqual(simpleGitCalls, [undefined, 'repo']);
    assert.deepEqual(applyProfileCall, { git: repoGit, profile: selected, extraArgs: [] });
    assert.equal(verifySigningKeyCall, selected);
    assert.deepEqual(events, ['verifySigningKey', 'clone']);
    assert.deepEqual(logInfoCalls, [doneMessage(url, 'repo')]);
  });

  it('clones an org/repo shorthand using the profile host', async () => {
    const clone = await loadClone();
    await assert.doesNotReject(() => clone('org/repo'));
    const url = `git@${selected.host}:org/repo`;
    assert.deepEqual(selectProfileCall, { profiles: validProfiles, name: undefined });
    assert.deepEqual(cloneCalls, [{ url, dir: 'repo' }]);
    assert.deepEqual(simpleGitCalls, [undefined, 'repo']);
    assert.deepEqual(logInfoCalls, [doneMessage(url, 'repo')]);
  });

  it('clones an ssh:// url using the profile host', async () => {
    const clone = await loadClone();
    await assert.doesNotReject(() => clone('ssh://git@github.com:1234/org/repo.git', selected.name));
    const url = `git@${selected.host}:org/repo.git`;
    assert.deepEqual(cloneCalls, [{ url, dir: 'repo' }]);
    assert.deepEqual(logInfoCalls, [doneMessage(url, 'repo')]);
  });

  it('ignores trailing slashes so the profile is applied to the cloned directory', async () => {
    const clone = await loadClone();
    await assert.doesNotReject(() => clone(`git@${personalProfile.host}:org/repo/`, selected.name));
    const url = `git@${selected.host}:org/repo`;
    assert.deepEqual(cloneCalls, [{ url, dir: 'repo' }]);
    assert.deepEqual(simpleGitCalls, [undefined, 'repo']);
    assert.deepEqual(logInfoCalls, [doneMessage(url, 'repo')]);
  });

  for (const repo of ['./repo', '../repo', 'org/.', 'org/..']) {
    it(`throws before cloning for the relative path '${repo}'`, async () => {
      const clone = await loadClone();
      await assert.rejects(() => clone(repo, selected.name), { message: `Unsupported repo format: ${repo}` });
      assert.deepEqual(cloneCalls, []);
      assert.equal(applyProfileCall, undefined);
    });
  }

  it('throws before cloning when the repo has no name to clone into', async () => {
    const repo = `git@${personalProfile.host}:/`;
    const clone = await loadClone();
    await assert.rejects(() => clone(repo, selected.name), { message: `Unsupported repo format: ${repo}` });
    assert.deepEqual(cloneCalls, []);
    assert.equal(applyProfileCall, undefined);
  });

  it('wraps a failure to apply the profile after cloning, keeping the cause', async () => {
    const cause = new Error('addConfig failed');
    applyProfileError = cause;
    const clone = await loadClone();
    await assert.rejects(() => clone('org/repo', selected.name), (err: Error) => {
      assert.equal(err.message, notAppliedMessage('repo'));
      assert.equal(err.cause, cause);
      return true;
    });
    assert.deepEqual(cloneCalls, [{ url: `git@${selected.host}:org/repo`, dir: 'repo' }]);
    assert.deepEqual(logInfoCalls, []);
  });
});
