import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import type { SimpleGit } from 'simple-git';
import { personalProfile, validProfile, validProfiles } from '../fixtures.ts';
import type { Profile } from '../../src/profile.ts';

type Mocks = Record<string, object>;

describe('commands/use.ts', () => {
  let isRepo = true;
  let loadProfilesError: Error | undefined;
  let selected: Profile = validProfile;
  let selectProfileCall: { profiles: Profile[]; name?: string } | undefined;
  let originUrl: string | null = null;
  let confirmAnswer: boolean | undefined;
  let confirmCalls: { message: string; default: boolean }[] = [];
  let verifySigningKeyError: Error | undefined;
  let applyProfileError: Error | undefined;
  let events: string[] = [];
  let applyProfileCall: { git: SimpleGit; profile: Profile; originUrl?: string } | undefined;
  const logInfoCalls: string[] = [];
  const logWarnCalls: string[] = [];

  const highlight = (text: string) => `[hl]${text}[/hl]`;

  const fakeGit = {
    checkIsRepo: async () => isRepo,
    getConfig: async (key: string, scope: string) => {
      assert.equal(key, 'remote.origin.url');
      assert.equal(scope, 'local');
      return { value: originUrl };
    },
  } as unknown as SimpleGit;

  const simpleGitMock = {
    'simple-git': {
      simpleGit: () => fakeGit,
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
        events.push(`verifySigningKey:${profile.name}`);
        if (verifySigningKeyError) {
          throw verifySigningKeyError;
        }
      },
      applyProfile: async (git: SimpleGit, profile: Profile, url?: string) => {
        events.push('applyProfile');
        applyProfileCall = { git, profile, originUrl: url };
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
        return selected;
      },
    },
  };

  const logMock = {
    '../../src/utils/log.ts': {
      default: {
        info: (msg: string) => logInfoCalls.push(msg),
        warn: (msg: string) => logWarnCalls.push(msg),
      },
    },
  };

  const confirmMock = {
    '@inquirer/confirm': {
      default: async (config: { message: string; default: boolean }) => {
        events.push('confirm');
        confirmCalls.push(config);
        if (confirmAnswer === undefined) {
          assert.fail('Unexpected confirm prompt: ' + config.message);
        }
        return confirmAnswer;
      },
    },
  };

  const coreMock = {
    '@inquirer/core': {
      makeTheme: () => ({ style: { highlight } }),
    },
  };

  const chalkMock = {
    chalk: {
      default: {
        bold: (text: string) => `[bold]${text}[/bold]`,
      },
    },
  };

  const loadUse = async (overrides: Mocks = {}) => {
    const { default: use } = await esmock<typeof import('../../src/commands/use.ts')>(
      '../../src/commands/use.ts',
      {
        ...simpleGitMock,
        ...profilesMock,
        ...promptsMock,
        ...logMock,
        ...confirmMock,
        ...coreMock,
        ...chalkMock,
        ...overrides, // same key wins, so it replaces the default
      },
    );
    return use;
  };

  const updatePrompt = (current: string, desired: string) => {
    return `Origin remote is ${highlight(current)}, but profile '${selected.name}' expects ${highlight(desired)}. Update origin to match?`;
  };

  beforeEach(() => {
    isRepo = true;
    loadProfilesError = undefined;
    selected = validProfile;
    selectProfileCall = undefined;
    originUrl = null;
    confirmAnswer = undefined;
    confirmCalls = [];
    verifySigningKeyError = undefined;
    applyProfileError = undefined;
    applyProfileCall = undefined;
    events = [];
    logInfoCalls.length = 0;
    logWarnCalls.length = 0;
  });

  it('throws when the current directory is not a git repository', async () => {
    isRepo = false;
    const use = await loadUse();
    await assert.rejects(() => use(), { message: 'The current directory must have a git repository to use a profile.' });
    assert.equal(selectProfileCall, undefined);
    assert.equal(applyProfileCall, undefined);
  });

  it('passes through loadProfiles failures', async () => {
    loadProfilesError = new Error('config is corrupt');
    const use = await loadUse();
    await assert.rejects(() => use(), { message: 'config is corrupt' });
    assert.equal(selectProfileCall, undefined);
  });

  it('applies the selected profile when the repo has no origin remote', async () => {
    const use = await loadUse();
    await assert.doesNotReject(() => use(selected.name));
    assert.deepEqual(selectProfileCall, { profiles: validProfiles, name: selected.name });
    assert.deepEqual(applyProfileCall, { git: fakeGit, profile: selected, originUrl: undefined });
    assert.deepEqual(confirmCalls, []);
    assert.deepEqual(logInfoCalls, [`Now using profile '[bold]${selected.name}[/bold]'.`]);
    assert.deepEqual(logWarnCalls, []);
  });

  it('does not prompt when the origin already uses the profile host', async () => {
    originUrl = `git@${selected.host}:org/repo.git`;
    const use = await loadUse();
    await assert.doesNotReject(() => use());
    assert.deepEqual(selectProfileCall, { profiles: validProfiles, name: undefined });
    assert.deepEqual(applyProfileCall, { git: fakeGit, profile: selected, originUrl: undefined });
    assert.deepEqual(confirmCalls, []);
  });

  it('updates an ssh origin that uses a different host when confirmed', async () => {
    originUrl = `git@${personalProfile.host}:org/repo.git`;
    const desiredUrl = `git@${selected.host}:org/repo.git`;
    confirmAnswer = true;
    const use = await loadUse();
    await assert.doesNotReject(() => use());
    assert.deepEqual(confirmCalls, [{ message: updatePrompt(originUrl, desiredUrl), default: true }]);
    assert.deepEqual(applyProfileCall, { git: fakeGit, profile: selected, originUrl: desiredUrl });
    assert.deepEqual(logInfoCalls, [`Now using profile '[bold]${selected.name}[/bold]'.`]);
  });

  it('keeps the origin when updating it is declined', async () => {
    originUrl = `git@${personalProfile.host}:org/repo.git`;
    confirmAnswer = false;
    const use = await loadUse();
    await assert.doesNotReject(() => use());
    assert.equal(confirmCalls.length, 1);
    assert.deepEqual(applyProfileCall, { git: fakeGit, profile: selected, originUrl: undefined });
    assert.deepEqual(logInfoCalls, [`Now using profile '[bold]${selected.name}[/bold]'.`]);
  });

  it('converts an https origin to the profile ssh host when confirmed', async () => {
    originUrl = 'https://github.com/org/repo.git';
    const desiredUrl = `git@${selected.host}:org/repo.git`;
    confirmAnswer = true;
    const use = await loadUse();
    await assert.doesNotReject(() => use());
    assert.deepEqual(confirmCalls, [{ message: updatePrompt(originUrl, desiredUrl), default: true }]);
    assert.deepEqual(applyProfileCall, { git: fakeGit, profile: selected, originUrl: desiredUrl });
  });

  it('throws when the repo path cannot be determined from the origin remote', async () => {
    originUrl = '/local/path/repo';
    const use = await loadUse();
    await assert.rejects(() => use(), { message: `Unable to determine the repo path from origin remote '${originUrl}'.` });
    assert.deepEqual(confirmCalls, []);
    assert.equal(applyProfileCall, undefined);
  });

  it('verifies the signing key before asking about the origin or applying the profile', async () => {
    originUrl = `git@${personalProfile.host}:org/repo.git`;
    confirmAnswer = true;
    const use = await loadUse();
    await assert.doesNotReject(() => use());
    assert.deepEqual(events, [`verifySigningKey:${selected.name}`, 'confirm', 'applyProfile']);
  });

  it('passes through a signing key failure as is, before anything is asked or applied', async () => {
    originUrl = `git@${personalProfile.host}:org/repo.git`;
    verifySigningKeyError = new Error('gpg is required but was not found on PATH.');
    const use = await loadUse();
    await assert.rejects(() => use(), verifySigningKeyError);
    assert.deepEqual(events, [`verifySigningKey:${selected.name}`]);
    assert.deepEqual(confirmCalls, []);
    assert.equal(applyProfileCall, undefined);
    assert.deepEqual(logWarnCalls, []);
    assert.deepEqual(logInfoCalls, []);
  });

  it('wraps other apply errors, noting the git config may be partly updated', async () => {
    const cause = new Error('addConfig failed');
    applyProfileError = cause;
    const use = await loadUse();
    await assert.rejects(() => use(), (err: Error) => {
      assert.equal(err.message, `Failed to apply profile '${selected.name}'. Git config may be partly updated; re-run to retry.`);
      assert.equal(err.cause, cause);
      return true;
    });
    assert.deepEqual(logWarnCalls, []);
    assert.deepEqual(logInfoCalls, []);
  });
});
