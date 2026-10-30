import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import { personalProfile, validProfile, validProfiles, validProfileWithSshKey } from '../fixtures.ts';
import { Profile, SIGNING_METHOD } from '../../src/profile.ts';

type PrintProfile = typeof import('../../src/utils/display.ts').printProfile;
type PrintProfileCall = { profile: Profile; opts?: Parameters<PrintProfile>[1] };
type Mocks = Record<string, object>;

const REEDIT_MESSAGE = 'No changes detected. Return to edit?';
const SAVE_MESSAGE = 'Save this profile?';

describe('commands/edit.ts', () => {
  let loadProfilesError: Error | undefined;
  let selected: Profile = validProfile;
  let selectProfileCall: { profiles: Profile[]; name?: string } | undefined;
  let edits: Profile[] = [];
  let promptCalls = 0;
  let reeditAnswers: boolean[] = [];
  let confirmSave: boolean | undefined;
  let confirmCalls: string[] = [];
  let printProfileCall: PrintProfileCall | undefined;
  let updateProfileCall: { original: Profile; update: Profile } | undefined;
  const logInfoCalls: string[] = [];
  const logWarnCalls: string[] = [];

  // Same data as the selected profile, so the edit is a change.
  const updated = new Profile(validProfile.name, personalProfile);

  const profilesMock = {
    '../../src/utils/profiles.ts': {
      loadProfiles: async () => {
        if (loadProfilesError) {
          throw loadProfilesError;
        }
        return validProfiles;
      },
      updateProfile: async (original: Profile, update: Profile) => {
        updateProfileCall = { original, update };
      },
    },
  };

  const updateProfileFail = {
    '../../src/utils/profiles.ts': {
      ...profilesMock['../../src/utils/profiles.ts'],
      updateProfile: async () => {
        assert.fail('updateProfile should not be called');
      },
    },
  };

  const promptsMock = {
    '../../src/utils/prompts.ts': {
      selectProfile: async (profiles: Profile[], name?: string) => {
        selectProfileCall = { profiles, name };
        return selected;
      },
      promptForProfile: async (editing?: Profile) => {
        assert.equal(editing, selected, 'promptForProfile should receive the selected profile');
        promptCalls++;
        const next = edits.shift();
        if (!next) {
          assert.fail('promptForProfile was called more times than expected');
        }
        return next;
      },
    },
  };

  const displayMock = {
    '../../src/utils/display.ts': {
      printProfile: (profile: Profile, opts?: Parameters<PrintProfile>[1]) => {
        printProfileCall = { profile, opts };
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
      default: async (config: { message: string; default: boolean }) => {
        confirmCalls.push(config.message);
        assert.equal(config.default, true);
        if (config.message === REEDIT_MESSAGE) {
          const answer = reeditAnswers.shift();
          if (answer === undefined) {
            assert.fail('Unexpected re-edit prompt');
          }
          return answer;
        } else if (config.message === SAVE_MESSAGE) {
          if (confirmSave === undefined) {
            assert.fail('Unexpected save prompt');
          }
          return confirmSave;
        }
        assert.fail('Unknown confirm prompt: ' + config.message);
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

  const loadEdit = async (overrides: Mocks = {}) => {
    const { default: edit } = await esmock<typeof import('../../src/commands/edit.ts')>(
      '../../src/commands/edit.ts',
      {
        ...profilesMock,
        ...promptsMock,
        ...displayMock,
        ...logMock,
        ...confirmMock,
        ...chalkMock,
        ...overrides, // same key wins, so it replaces the default
      },
    );
    return edit;
  };

  beforeEach(() => {
    loadProfilesError = undefined;
    selected = validProfile;
    selectProfileCall = undefined;
    edits = [];
    promptCalls = 0;
    reeditAnswers = [];
    confirmSave = undefined;
    confirmCalls = [];
    printProfileCall = undefined;
    updateProfileCall = undefined;
    logInfoCalls.length = 0;
    logWarnCalls.length = 0;
  });

  it('passes through loadProfiles failures', async () => {
    loadProfilesError = new Error('config is corrupt');
    const edit = await loadEdit();
    await assert.rejects(() => edit(), { message: 'config is corrupt' });
    assert.equal(selectProfileCall, undefined);
  });

  it('saves the changes after they are confirmed', async () => {
    edits = [updated];
    confirmSave = true;
    const edit = await loadEdit();
    await assert.doesNotReject(() => edit(selected.name));
    assert.deepEqual(selectProfileCall, { profiles: validProfiles, name: selected.name });
    assert.deepEqual(printProfileCall, { profile: updated, opts: { original: selected } });
    assert.deepEqual(confirmCalls, [SAVE_MESSAGE]);
    assert.deepEqual(updateProfileCall, { original: selected, update: updated });
    assert.deepEqual(logInfoCalls, [`Profile [bold]${updated.name}[/bold] updated.`]);
    assert.deepEqual(logWarnCalls, []);
  });

  it('warns that repos using the old name need to be updated when the profile is renamed', async () => {
    const renamed = new Profile(`${selected.name}-renamed`, selected);
    edits = [renamed];
    confirmSave = true;
    const edit = await loadEdit();
    await assert.doesNotReject(() => edit());
    assert.deepEqual(updateProfileCall, { original: selected, update: renamed });
    assert.deepEqual(logInfoCalls, [`Profile [bold]${renamed.name}[/bold] updated.`]);
    assert.deepEqual(logWarnCalls, [
      `Profile renamed from '${selected.name}' to '${renamed.name}'. Repos still using '${selected.name}' need \`git who use ${renamed.name}\` to pick up the new name.`,
    ]);
  });

  it('does not warn about a rename when the changes are not saved', async () => {
    edits = [new Profile(`${selected.name}-renamed`, selected)];
    confirmSave = false;
    const edit = await loadEdit({
      ...updateProfileFail,
    });
    await assert.doesNotReject(() => edit());
    assert.deepEqual(logWarnCalls, ['Profile not updated.']);
  });

  it('does not save the changes if they are not confirmed', async () => {
    edits = [updated];
    confirmSave = false;
    const edit = await loadEdit({
      ...updateProfileFail,
    });
    await assert.doesNotReject(() => edit());
    assert.deepEqual(selectProfileCall, { profiles: validProfiles, name: undefined });
    assert.deepEqual(printProfileCall, { profile: updated, opts: { original: selected } });
    assert.deepEqual(confirmCalls, [SAVE_MESSAGE]);
    assert.deepEqual(logInfoCalls, []);
    assert.deepEqual(logWarnCalls, ['Profile not updated.']);
  });

  it('offers to edit again when nothing changed', async () => {
    edits = [selected, updated];
    reeditAnswers = [true];
    confirmSave = true;
    const edit = await loadEdit();
    await assert.doesNotReject(() => edit());
    assert.equal(promptCalls, 2);
    assert.deepEqual(confirmCalls, [REEDIT_MESSAGE, SAVE_MESSAGE]);
    assert.deepEqual(updateProfileCall, { original: selected, update: updated });
    assert.deepEqual(logInfoCalls, [`Profile [bold]${updated.name}[/bold] updated.`]);
    assert.deepEqual(logWarnCalls, []);
  });

  it('does not update when nothing changed and editing again is declined', async () => {
    edits = [selected];
    reeditAnswers = [false];
    const edit = await loadEdit({
      ...updateProfileFail,
      ...displayFail,
    });
    await assert.doesNotReject(() => edit());
    assert.equal(promptCalls, 1);
    assert.deepEqual(confirmCalls, [REEDIT_MESSAGE]);
    assert.deepEqual(logInfoCalls, []);
    assert.deepEqual(logWarnCalls, ['Profile not updated.']);
  });

  it('treats a separate profile instance with the same values as unchanged', async () => {
    selected = validProfileWithSshKey;
    // Same values, but a different instance and with the git data keys in a different order.
    const copy = new Profile(
      selected.name,
      { email: selected.email, username: selected.username, host: selected.host },
      { key: selected.signingKey!, method: SIGNING_METHOD.SSH },
    );
    assert.notEqual(copy, selected);
    edits = [copy];
    reeditAnswers = [false];
    const edit = await loadEdit({
      ...updateProfileFail,
      ...displayFail,
    });
    await assert.doesNotReject(() => edit());
    assert.deepEqual(confirmCalls, [REEDIT_MESSAGE]);
    assert.deepEqual(logWarnCalls, ['Profile not updated.']);
  });
});
