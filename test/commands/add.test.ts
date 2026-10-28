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

  const loadAdd = async (overrides: Mocks = {}) => {
    const { default: add } = await esmock<typeof import('../../src/commands/add.ts')>(
      '../../src/commands/add.ts',
      {
        '../../src/utils/profiles.ts': {
          addProfile: async (profile: Profile) => {
            assert.deepEqual(profile, personalProfile);
            addProfileParam = profile;
          },
        },
        '../../src/utils/prompts.ts': {
          prompt: async (editing?: Profile) => {
            assert.equal(editing, undefined);
            return personalProfile;
          },
        },
        '../../src/utils/display.ts': {
          printProfile: (profile: Profile) => {
            assert.deepEqual(profile, personalProfile);
            printProfileParam = profile;
          },
        },
        '../../src/utils/log.ts': {
          default: {
            warn: (msg: string) => logWarnCall = msg,
            info: (msg: string) => logInfoCall = msg,
          },
        },
        '@inquirer/confirm': {
          default: async (config: { message: string; default: boolean }) => {
            assert.deepEqual(config, { message: 'Save this profile?', default: true });
            return Promise.resolve(true);
          },
        },
        chalk: {
          default: {
            bold: (msg: string) => `[bold]${msg}[/bold]`,
          },
        },
        ...overrides,
      },
    );
    return add;
  };

  beforeEach(() => {
    logWarnCall = undefined;
    logInfoCall = undefined;
    addProfileParam = undefined;
    printProfileParam = undefined;
  });

  it('does not save profile if confirm is rejected', async () => {
    const add = await loadAdd({
      '../../src/utils/profiles.ts': {
        addProfile: async () => {
          assert.fail('addProfile should not be called');
        },
      },
      '@inquirer/confirm': {
        default: async (config: { message: string; default: boolean }) => {
          assert.deepEqual(config, { message: 'Save this profile?', default: true });
          return Promise.resolve(false);
        },
      },
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
