import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import type { SimpleGit } from 'simple-git';
import type confirm from '@inquirer/confirm';
import { personalProfile, validProfile, validProfiles } from '../fixtures.ts';
import type { Profile } from '../../src/profile.ts';

type ConfirmConfig = Parameters<typeof confirm>[0];
type Mocks = Record<string, object>;

describe('commands/remove.ts', () => {
  let loadProfilesError: Error | undefined;
  let selected: Profile = validProfile;
  let selectProfileCall: { profiles: Profile[]; name?: string } | undefined;
  let activeName: string | undefined;
  let confirmContinue: boolean | undefined;
  let confirmRemove: boolean | undefined;
  let confirmCalls: ConfirmConfig[] = [];
  let removeProfileParam: string | undefined;
  let printProfileParam: Profile | undefined;
  let rawError: Error | undefined;
  const rawCalls: string[][] = [];
  const logInfoCalls: string[] = [];
  const logWarnCalls: string[] = [];

  const continueMessage = (profile: Profile) => `Profile '${profile.name}' is the active profile. Continue?`;
  const removeMessage = (profile: Profile) => `Remove profile '${profile.name}'?`;

  // Runs the message style the command passed to confirm. PartialDeep types the function as `{}`, hence the cast.
  const styled = (config: ConfirmConfig) => {
    const style = config.theme?.style?.message as ((text: string, status: 'idle') => string) | undefined;
    return style?.('text', 'idle');
  };

  const fakeGit = {
    raw: async (args: string[]) => {
      rawCalls.push(args);
      if (rawError) {
        throw rawError;
      }
    },
  } as unknown as SimpleGit;

  const profilesMock = {
    '../../src/utils/profiles.ts': {
      loadProfiles: async () => {
        if (loadProfilesError) {
          throw loadProfilesError;
        }
        return validProfiles;
      },
      getActiveProfileName: async (git: SimpleGit) => {
        assert.equal(git, fakeGit, 'getActiveProfileName should receive the simpleGit instance');
        return activeName;
      },
      removeProfile: async (name: string) => {
        removeProfileParam = name;
      },
    },
  };

  const removeProfileFail = {
    '../../src/utils/profiles.ts': {
      ...profilesMock['../../src/utils/profiles.ts'],
      removeProfile: async () => {
        assert.fail('removeProfile should not be called');
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

  const displayMock = {
    '../../src/utils/display.ts': {
      printProfile: (profile: Profile) => {
        printProfileParam = profile;
      },
    },
  };

  const displayFail = {
    '../../src/utils/display.ts': {
      printProfile: () => {
        assert.fail('printProfile should not be called');
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
      default: async (config: ConfirmConfig) => {
        confirmCalls.push(config);
        let answer: boolean | undefined;
        if (config.message === continueMessage(selected)) {
          answer = confirmContinue;
        } else if (config.message === removeMessage(selected)) {
          answer = confirmRemove;
        }
        if (answer === undefined) {
          assert.fail('Unexpected confirm prompt: ' + config.message);
        }
        return answer;
      },
    },
  };

  const chalkMock = {
    chalk: {
      default: {
        yellow: (text: string) => `[yellow]${text}[/yellow]`,
        red: (text: string) => `[red]${text}[/red]`,
      },
    },
  };

  const simpleGitMock = {
    'simple-git': {
      simpleGit: () => fakeGit,
    },
  };

  const loadRemove = async (overrides: Mocks = {}) => {
    const { default: remove } = await esmock<typeof import('../../src/commands/remove.ts')>(
      '../../src/commands/remove.ts',
      {
        ...profilesMock,
        ...promptsMock,
        ...displayMock,
        ...logMock,
        ...confirmMock,
        ...chalkMock,
        ...simpleGitMock,
        ...overrides, // same key wins, so it replaces the default
      },
    );
    return remove;
  };

  beforeEach(() => {
    loadProfilesError = undefined;
    selected = validProfile;
    selectProfileCall = undefined;
    activeName = undefined;
    confirmContinue = undefined;
    confirmRemove = undefined;
    confirmCalls = [];
    removeProfileParam = undefined;
    printProfileParam = undefined;
    rawError = undefined;
    rawCalls.length = 0;
    logInfoCalls.length = 0;
    logWarnCalls.length = 0;
  });

  it('passes through loadProfiles failures', async () => {
    loadProfilesError = new Error('config is corrupt');
    const remove = await loadRemove();
    await assert.rejects(() => remove(), { message: 'config is corrupt' });
    assert.equal(selectProfileCall, undefined);
  });

  it('removes the named profile after it is confirmed', async () => {
    activeName = personalProfile.name;
    confirmRemove = true;
    const remove = await loadRemove();
    await assert.doesNotReject(() => remove(selected.name));
    assert.deepEqual(selectProfileCall, { profiles: validProfiles, name: selected.name });
    assert.equal(printProfileParam, selected);
    assert.deepEqual(confirmCalls.map((c) => c.message), [removeMessage(selected)]);
    assert.equal(removeProfileParam, selected.name);
    assert.deepEqual(rawCalls, []);
    assert.deepEqual(logInfoCalls, [`Profile '${selected.name}' has been removed.`]);
    assert.deepEqual(logWarnCalls, []);
  });

  it('does not remove the profile if the removal is not confirmed', async () => {
    confirmRemove = false;
    const remove = await loadRemove({
      ...removeProfileFail,
    });
    await assert.doesNotReject(() => remove());
    assert.deepEqual(selectProfileCall, { profiles: validProfiles, name: undefined });
    assert.equal(printProfileParam, selected);
    const [config] = confirmCalls;
    assert.equal(config.default, false);
    assert.equal(styled(config), '[red]text[/red]');
    assert.deepEqual(rawCalls, []);
    assert.deepEqual(logInfoCalls, []);
    assert.deepEqual(logWarnCalls, [`Profile '${selected.name}' not removed.`]);
  });

  it('does not remove the active profile if continuing is declined', async () => {
    activeName = selected.name;
    confirmContinue = false;
    const remove = await loadRemove({
      ...removeProfileFail,
      ...displayFail,
    });
    await assert.doesNotReject(() => remove());
    assert.deepEqual(confirmCalls.map((c) => c.message), [continueMessage(selected)]);
    const [config] = confirmCalls;
    assert.equal(config.default, false);
    assert.equal(styled(config), '[yellow]text[/yellow]');
    assert.deepEqual(rawCalls, []);
    assert.deepEqual(logInfoCalls, []);
    assert.deepEqual(logWarnCalls, [`Profile '${selected.name}' not removed, as it is currently active.`]);
  });

  it('removes the active profile and unsets gitwho.profile when both prompts are confirmed', async () => {
    activeName = selected.name;
    confirmContinue = true;
    confirmRemove = true;
    const remove = await loadRemove();
    await assert.doesNotReject(() => remove());
    assert.deepEqual(confirmCalls.map((c) => c.message), [continueMessage(selected), removeMessage(selected)]);
    assert.equal(printProfileParam, selected);
    assert.equal(removeProfileParam, selected.name);
    assert.deepEqual(rawCalls, [['config', '--local', '--unset', 'gitwho.profile']]);
    assert.deepEqual(logInfoCalls, [`Profile '${selected.name}' has been removed.`]);
    assert.deepEqual(logWarnCalls, []);
  });

  it('keeps the active profile if continuing is confirmed but the removal is not', async () => {
    activeName = selected.name;
    confirmContinue = true;
    confirmRemove = false;
    const remove = await loadRemove({
      ...removeProfileFail,
    });
    await assert.doesNotReject(() => remove());
    assert.deepEqual(confirmCalls.map((c) => c.message), [continueMessage(selected), removeMessage(selected)]);
    assert.deepEqual(rawCalls, []);
    assert.deepEqual(logInfoCalls, []);
    assert.deepEqual(logWarnCalls, [`Profile '${selected.name}' not removed.`]);
  });

  it('warns but still reports removal when gitwho.profile cannot be unset', async () => {
    activeName = selected.name;
    confirmContinue = true;
    confirmRemove = true;
    rawError = new Error('could not unset');
    const remove = await loadRemove();
    await assert.doesNotReject(() => remove());
    assert.equal(removeProfileParam, selected.name);
    assert.deepEqual(rawCalls, [['config', '--local', '--unset', 'gitwho.profile']]);
    assert.deepEqual(logWarnCalls, ["Unable to unset 'gitwho.profile' git config value."]);
    assert.deepEqual(logInfoCalls, [`Profile '${selected.name}' has been removed.`]);
  });
});
