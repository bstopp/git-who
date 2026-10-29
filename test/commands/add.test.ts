import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import { personalProfile } from '../fixtures.ts';
import { Profile } from '../../src/profile.ts';

type Mocks = Record<string, object>;

describe('commands/add.ts', () => {
  let logWarnCall: string | undefined = undefined;
  let logInfoCall: string | undefined = undefined;
  let addProfileParam: Profile | undefined = undefined;
  let printProfileParam: Profile | undefined = undefined;
  let confirmAnswer = true;

  const profilesMock = {
    '../../src/utils/profiles.ts': {
      addProfile: async (profile: Profile) => {
        assert.deepEqual(profile, personalProfile);
        addProfileParam = profile;
      },
    },
  };

  const profilesFail = {
    '../../src/utils/profiles.ts': {
      addProfile: async () => {
        assert.fail('addProfile should not be called');
      },
    },
  };

  const promptsMock = {
    '../../src/utils/prompts.ts': {
      prompt: async (editing?: Profile) => {
        assert.equal(editing, undefined);
        return personalProfile;
      },
    },
  };

  const displayMock = {
    '../../src/utils/display.ts': {
      printProfile: (profile: Profile) => {
        assert.deepEqual(profile, personalProfile);
        printProfileParam = profile;
      },
    },
  };

  const logMock = {
    '../../src/utils/log.ts': {
      default: {
        warn: (msg: string) => logWarnCall = msg,
        info: (msg: string) => logInfoCall = msg,
      },
    },
  };

  const confirmMock = {
    '@inquirer/confirm': {
      default: async (config: { message: string; default: boolean }) => {
        assert.deepEqual(config, { message: 'Save this profile?', default: true });
        return confirmAnswer;
      },
    },
  };

  const chalkMock = {
    chalk: {
      default: {
        bold: (msg: string) => `[bold]${msg}[/bold]`,
      },
    },
  };

  const loadAdd = async (overrides: Mocks = {}) => {
    const { default: add } = await esmock<typeof import('../../src/commands/add.ts')>(
      '../../src/commands/add.ts',
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
    return add;
  };

  beforeEach(() => {
    logWarnCall = undefined;
    logInfoCall = undefined;
    addProfileParam = undefined;
    printProfileParam = undefined;
    confirmAnswer = true;
  });

  it('does not save profile if confirm is rejected', async () => {
    confirmAnswer = false;
    const add = await loadAdd({
      ...profilesFail,
    });
    await assert.doesNotReject(() => add());
    assert.deepEqual(printProfileParam, personalProfile);
    assert.equal(logWarnCall, 'Profile not added.');
    assert.equal(logInfoCall, undefined);
  });

  it('saves profile if confirm is accepted', async () => {
    const add = await loadAdd();
    await assert.doesNotReject(() => add());
    assert.deepEqual(printProfileParam, personalProfile);
    assert.equal(addProfileParam, personalProfile);
    assert.equal(logWarnCall, undefined);
    assert.equal(logInfoCall, 'Profile [bold]personal[/bold] added.');
  });
});
