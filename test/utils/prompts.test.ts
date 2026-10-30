import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import { render } from '@inquirer/testing';

import {
  gpgKeys,
  sshHosts,
  sshKeys,
  validProfile,
  validProfiles,
  validProfileWithGpgKey,
  validProfileWithSshKey,
} from '../fixtures.ts';
import * as validators from '../../src/utils/validators.ts';
import { Profile, SIGNING_METHOD } from '../../src/profile.ts';
import { NoProfilesError } from '../../src/utils/profiles.ts';

import { ExitPromptError } from '@inquirer/core';
import realInput from '@inquirer/input';
import realSelect from '@inquirer/select';

type InputArgs = Parameters<typeof realInput>; // [InputConfig, Context?]
type SelectArgs = Parameters<typeof realSelect>;
type InputHandler = (config: InputArgs[0], context: InputArgs[1]) => Promise<string>;
type SelectHandler = (config: SelectArgs[0], context: SelectArgs[1]) => Promise<unknown>;
type Mocks = Record<string, object>;

describe('utils/prompts.ts', () => {
  let loadProfilesError: Error | undefined;
  let logInfo: string[] = [];
  let logWarn: string[] = [];

  const profilesMock = {
    '../../src/utils/profiles.ts': {
      loadProfiles: async () => {
        if (loadProfilesError) {
          throw loadProfilesError;
        }
        return validProfiles;
      },
      NoProfilesError: NoProfilesError,
    },
  };

  const logFail = {
    '../../src/utils/log.ts': {
      default: {
        info: () => {
          assert.fail('log info should not be called.');
        },
        warn: () => {
          assert.fail('log warn should not be called.');
        },
      },
    },
  };

  const logMock = {
    '../../src/utils/log.ts': {
      default: {
        info: (msg: string) => logInfo.push(msg),
        warn: (msg: string) => logWarn.push(msg),
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

  const sshMock = {
    '../../src/utils/ssh.ts': {
      listSshHosts: () => sshHosts,
      listSshKeys: () => assert.fail('listSshKeys was called'),
    },
  };

  const sshKeysMock = (keys: string[]) => ({
    '../../src/utils/ssh.ts': {
      listSshHosts: () => sshHosts,
      listSshKeys: () => keys,
    },
  });

  const gpgFail = {
    '../../src/utils/gpg.ts': {
      listGpgKeys: () => assert.fail('listGpgKeys was called'),
    },
  };

  const gpgKeysMock = (keys: typeof gpgKeys) => ({
    '../../src/utils/gpg.ts': {
      listGpgKeys: () => keys,
    },
  });

  const validatorsMock = (overrides: Partial<typeof validators>) => ({
    '../../src/utils/validators.ts': {
      ...validators,
      ...overrides,
    },
  });

  const inputFail = {
    '@inquirer/input': {
      default: async () => assert.fail('input should not be prompted.'),
    },
  };

  const selectFail = {
    '@inquirer/select': {
      default: async () => assert.fail('select should not be prompted.'),
    },
  };

  // Routes each prompt to the handler registered for its message.
  const inputMock = (handlers: Record<string, InputHandler>) => ({
    '@inquirer/input': {
      default: async (config: InputArgs[0], context: InputArgs[1]) => {
        const handler = handlers[config.message];
        if (!handler) {
          assert.fail('Unknown input prompt: ' + config.message);
        }
        return handler(config, context);
      },
    },
  });

  const selectMock = (handlers: Record<string, SelectHandler>) => ({
    '@inquirer/select': {
      default: async (config: SelectArgs[0], context: SelectArgs[1]) => {
        const handler = handlers[config.message];
        if (!handler) {
          assert.fail('Unknown select prompt: ' + config.message);
        }
        return handler(config, context);
      },
    },
  });

  // Answers without rendering the prompt.
  const pick = (value: string) => async () => value;

  const exitPrompt = async () => {
    throw new ExitPromptError();
  };

  // Renders the input, checks the default it was given, types `text` and submits.
  const answerInput = (text: string, expectedDefault?: string): InputHandler => async (config, context) => {
    const { answer, events } = await render(realInput, config, context);
    assert.equal(config.default, expectedDefault);
    if (text) {
      events.type(text);
    }
    events.keypress('enter');
    return answer;
  };

  // Renders the select, checks its default and screen, presses `keys` then enter.
  const selectChoice = (
    opts: { default?: string; screen?: RegExp[]; keys?: string[] } = {},
  ): SelectHandler => async (config, context) => {
    const { answer, events, getScreen } = await render(realSelect, config, context);
    assert.equal(config.default, opts.default);
    const screen = getScreen();
    for (const pattern of opts.screen ?? []) {
      assert.match(screen, pattern);
    }
    for (const key of opts.keys ?? []) {
      events.keypress(key);
    }
    events.keypress('enter');
    return answer;
  };

  const hostScreen = [/github-work\s\(github.com\)/i, /github-personal\s\(github.com\)/i];
  const gpgKeyScreen = [
    /FEDCBA0987654321\s—\sBryan Work \(bryan@work.com\)/i,
    /1234567890ABCDEF\s—\sBryan Personal \(bryan@personal.com\),\sBryan Work \(bryan@work.com\)/i,
  ];
  const identityScreen = [/Bryan Personal \(bryan@personal.com\)/i, /Bryan Work \(bryan@work.com\)/i];
  const sshKeyScreen = [new RegExp('/home/user/.ssh/id_personal.pub'), new RegExp('/home/user/.ssh/id_work.pub')];

  const ignoredInputs = inputMock({
    'Profile name:': pick('ignored'),
    'Git user.name:': pick('ignored'),
    'Git user.email:': pick('ignored'),
  });

  const loadPrompts = async (overrides: Mocks = {}) => {
    return esmock<typeof import('../../src/utils/prompts.ts')>(
      '../../src/utils/prompts.ts',
      {
        ...logFail,
        ...profilesMock,
        ...sshMock,
        ...gpgFail,
        ...inputFail,
        ...selectFail,
        ...overrides, // same key wins, so it replaces the default
      },
    );
  };

  const loadPromptForProfile = async (overrides: Mocks = {}) => {
    const { promptForProfile } = await loadPrompts(overrides);
    return promptForProfile;
  };

  const loadSelectProfile = async (overrides: Mocks = {}) => {
    const { selectProfile } = await loadPrompts(overrides);
    return selectProfile;
  };

  beforeEach(() => {
    loadProfilesError = undefined;
    logInfo = [];
    logWarn = [];
  });

  describe('promptForProfile', () => {
    describe('validations', () => {
      it('validates profile name', async () => {
        let validateProfileNameCalled = false;
        let validateUniqueCalled = false;
        const promptForProfile = await loadPromptForProfile({
          ...validatorsMock({
            validateProfileName: () => {
              validateProfileNameCalled = true;
            },
            validateUnique: () => {
              validateUniqueCalled = true;
            },
          }),
          ...selectMock({ 'SSH Host:': exitPrompt }),
          ...inputMock({ 'Profile name:': answerInput('personal') }),
        });
        await assert.rejects(promptForProfile(), ExitPromptError);
        assert.ok(validateProfileNameCalled, 'validateProfileName not called');
        assert.ok(validateUniqueCalled, 'validateUnique not called');
      });

      it('validates username', async () => {
        let validateUsernameCalled = false;
        const promptForProfile = await loadPromptForProfile({
          ...validatorsMock({
            validateUsername: () => {
              validateUsernameCalled = true;
            },
          }),
          ...selectMock({
            'SSH Host:': pick('github-work'),
            'Sign Commits?': pick('no'),
          }),
          ...inputMock({
            'Profile name:': pick('ignored'),
            'Git user.name:': answerInput('Foo Bar'),
            'Git user.email:': exitPrompt,
          }),
        });
        await assert.rejects(promptForProfile());
        assert.ok(validateUsernameCalled, 'validateUsername not called');
      });

      it('validates email', async () => {
        let validateEmailCalled = false;
        const promptForProfile = await loadPromptForProfile({
          ...validatorsMock({
            validateEmail: () => {
              validateEmailCalled = true;
            },
          }),
          ...selectMock({
            'SSH Host:': pick('github-work'),
            'Sign Commits?': pick('no'),
          }),
          ...inputMock({
            'Profile name:': pick('ignored'),
            'Git user.name:': pick('ignored'),
            'Git user.email:': answerInput('foobar@example.com'),
          }),
        });
        const profile = await promptForProfile();
        assert.equal(profile.email, 'foobar@example.com');
        assert.ok(validateEmailCalled, 'validateEmail not called');
      });
    });

    describe('prompting flow', () => {
      const minimumFlowMocks = {
        ...inputMock({
          'Profile name:': answerInput('profile-name'),
          'Git user.name:': answerInput('Git Username'),
          'Git user.email:': answerInput('email@git.com'),
        }),
        ...selectMock({
          'SSH Host:': selectChoice({ screen: hostScreen }),
          'Sign Commits?': pick('no'),
        }),
      };

      const minimumProfile = new Profile('profile-name', {
        host: 'github-personal',
        username: 'Git Username',
        email: 'email@git.com',
      });

      it('rethrows error when loadProfiles throws a non-NoProfilesError', async () => {
        loadProfilesError = new Error('Could not open Profiles file.');
        const promptForProfile = await loadPromptForProfile();
        await assert.rejects(promptForProfile(), { message: 'Could not open Profiles file.' });
      });

      it('converts validation throws to inquirer messages', async () => {
        const promptForProfile = await loadPromptForProfile({
          ...selectMock({ 'SSH Host:': exitPrompt }),
          ...inputMock({
            'Profile name:': async (config, context) => {
              const { answer, events, getScreen, nextRender } = await render(realInput, config, context);
              events.type('bad name!');
              events.keypress('enter');
              await nextRender();
              assert.match(getScreen(), /Profile name must contain only letters, numbers, dash, dot, or underscore\./);
              for (const _ of 'bad name!') {
                events.keypress('backspace');
              }
              events.type('valid-name');
              events.keypress('enter');
              return answer;
            },
          }),
        });
        await assert.rejects(promptForProfile(), ExitPromptError);
      });

      it('propagates the error when user presses Ctrl+C during a prompt', async () => {
        const promptForProfile = await loadPromptForProfile({
          ...inputMock({ 'Profile name:': exitPrompt }),
        });
        await assert.rejects(promptForProfile(), ExitPromptError);
      });

      it('propagates errors when listSshHosts throws', async () => {
        const promptForProfile = await loadPromptForProfile({
          '../../src/utils/ssh.ts': {
            listSshHosts: () => {
              throw new Error('no hosts');
            },
            listSshKeys: () => assert.fail('listSshKeys was called'),
          },
          ...inputMock({ 'Profile name:': pick('') }),
        });
        await assert.rejects(promptForProfile(), { message: 'no hosts' });
      });

      it('propagates errors when gpg but listGpgKeys throws', async () => {
        const promptForProfile = await loadPromptForProfile({
          '../../src/utils/gpg.ts': {
            listGpgKeys: () => {
              throw new Error('gpg locked');
            },
          },
          ...selectMock({
            'SSH Host:': pick('github-work'),
            'Sign Commits?': pick(SIGNING_METHOD.GPG),
          }),
          ...ignoredInputs,
        });
        await assert.rejects(promptForProfile(), { message: 'gpg locked' });
      });

      it('throws when gpg but no keys exist', async () => {
        const promptForProfile = await loadPromptForProfile({
          ...gpgKeysMock([]),
          ...selectMock({
            'SSH Host:': pick('github-work'),
            'Sign Commits?': pick(SIGNING_METHOD.GPG),
          }),
          ...ignoredInputs,
        });
        await assert.rejects(promptForProfile(), { message: 'No GPG keys found on this system.' });
      });

      it('throws when ssh but no keys exist', async () => {
        const promptForProfile = await loadPromptForProfile({
          ...sshKeysMock([]),
          ...selectMock({
            'SSH Host:': pick('github-work'),
            'Sign Commits?': pick(SIGNING_METHOD.SSH),
          }),
          ...ignoredInputs,
        });
        await assert.rejects(promptForProfile(), { message: 'No SSH keys found on this system.' });
      });

      it('creates a minimum profile', async () => {
        const promptForProfile = await loadPromptForProfile(minimumFlowMocks);
        assert.deepEqual(await promptForProfile(), minimumProfile);
      });

      it('continues if a NoProfilesError is thrown by loadProfiles', async () => {
        loadProfilesError = new NoProfilesError();
        const promptForProfile = await loadPromptForProfile(minimumFlowMocks);
        assert.deepEqual(await promptForProfile(), minimumProfile);
      });

      it('creates a profile with ssh signing', async () => {
        const promptForProfile = await loadPromptForProfile({
          ...sshKeysMock(sshKeys),
          ...inputMock({
            'Profile name:': pick('profile-name'),
            'Git user.name:': pick('Git Username'),
            'Git user.email:': pick('email@git.com'),
          }),
          ...selectMock({
            'SSH Host:': pick('github-personal'),
            'Sign Commits?': pick(SIGNING_METHOD.SSH),
            'Select an SSH key:': selectChoice({ screen: sshKeyScreen, keys: ['down'] }),
          }),
        });
        assert.deepEqual(await promptForProfile(),
          new Profile(
            'profile-name',
            {
              host: 'github-personal',
              username: 'Git Username',
              email: 'email@git.com',
            },
            {
              method: SIGNING_METHOD.SSH,
              key: '/home/user/.ssh/id_work.pub',
            },
          ),
        );
      });

      it('creates a profile with gpg signing', async () => {
        const promptForProfile = await loadPromptForProfile({
          ...gpgKeysMock(gpgKeys),
          ...inputMock({
            'Profile name:': pick('github-personal'),
            'Git user.name:': answerInput('', 'Bryan Personal'),
            'Git user.email:': answerInput('', 'bryan@personal.com'),
          }),
          ...selectMock({
            'SSH Host:': pick('github-personal'),
            'Sign Commits?': pick(SIGNING_METHOD.GPG),
            'Select a GPG key:': selectChoice({ screen: gpgKeyScreen, keys: ['down'] }),
            'Select an identity:': selectChoice({ screen: identityScreen }),
          }),
        });
        assert.deepEqual(await promptForProfile(),
          new Profile(
            'github-personal',
            {
              host: 'github-personal',
              username: 'Bryan Personal',
              email: 'bryan@personal.com',
            },
            {
              method: SIGNING_METHOD.GPG,
              key: '1234567890ABCDEF',
            },
          ),
        );
      });

      it('skips identity prompt when gpg key only has one', async () => {
        const promptForProfile = await loadPromptForProfile({
          ...logMock,
          ...gpgKeysMock(gpgKeys),
          ...inputMock({
            'Profile name:': pick('github-work'),
            'Git user.name:': answerInput('', 'Bryan Work'),
            'Git user.email:': answerInput('', 'bryan@work.com'),
          }),
          ...selectMock({
            'SSH Host:': pick('github-work'),
            'Sign Commits?': pick(SIGNING_METHOD.GPG),
            'Select a GPG key:': selectChoice({ screen: gpgKeyScreen }),
            'Select an identity:': async () => assert.fail('Select an identity should not have been prompted.'),
          }),
        });
        assert.deepEqual(await promptForProfile(),
          new Profile(
            'github-work',
            {
              host: 'github-work',
              username: 'Bryan Work',
              email: 'bryan@work.com',
            },
            {
              method: SIGNING_METHOD.GPG,
              key: 'FEDCBA0987654321',
            },
          ),
        );
        assert.deepEqual(logInfo, ['Using identity: Bryan Work (bryan@work.com)']);
      });

      it('skips gpg key prompt when gpg key only has one', async () => {
        const promptForProfile = await loadPromptForProfile({
          ...logMock,
          ...gpgKeysMock([gpgKeys[1]]),
          ...inputMock({
            'Profile name:': pick('github-personal'),
            'Git user.name:': answerInput('', 'Bryan Personal'),
            'Git user.email:': answerInput('', 'bryan@personal.com'),
          }),
          ...selectMock({
            'SSH Host:': pick('github-personal'),
            'Sign Commits?': pick(SIGNING_METHOD.GPG),
            'Select a GPG key:': async () => assert.fail('Select a gpg key should not have been prompted.'),
            'Select an identity:': selectChoice({ screen: identityScreen }),
          }),
        });
        assert.deepEqual(await promptForProfile(),
          new Profile(
            'github-personal',
            {
              host: 'github-personal',
              username: 'Bryan Personal',
              email: 'bryan@personal.com',
            },
            {
              method: SIGNING_METHOD.GPG,
              key: '1234567890ABCDEF',
            },
          ),
        );
        assert.deepEqual(logInfo, ['Using GPG key: 1234567890ABCDEF']);
      });

      it('prepopulates when provided a profile (gpg)', async () => {
        const promptForProfile = await loadPromptForProfile({
          ...logMock,
          ...gpgKeysMock(gpgKeys),
          ...inputMock({
            'Profile name:': answerInput('profile-name', 'work-gpg-signed'),
            'Git user.name:': answerInput('Git Username', 'Bryan Work'),
            'Git user.email:': answerInput('email@git.com', 'bryan@work.com'),
          }),
          ...selectMock({
            'SSH Host:': selectChoice({ default: 'github-work', screen: hostScreen, keys: ['down'] }),
            'Sign Commits?': selectChoice({ default: 'gpg' }),
            'Select a GPG key:': selectChoice({ default: 'FEDCBA0987654321', screen: gpgKeyScreen }),
          }),
        });
        assert.deepEqual(await promptForProfile(validProfileWithGpgKey),
          new Profile('profile-name', {
            host: 'github-personal',
            username: 'Git Username',
            email: 'email@git.com',
          }, {
            method: 'gpg',
            key: 'FEDCBA0987654321',
          }),
        );
        assert.deepEqual(logInfo, ['Using identity: Bryan Work (bryan@work.com)']);
      });

      it('prepopulates when provided a profile (ssh)', async () => {
        const promptForProfile = await loadPromptForProfile({
          ...sshKeysMock(sshKeys),
          ...inputMock({
            'Profile name:': answerInput('profile-name', 'work-ssh-signed'),
            'Git user.name:': answerInput('Git Username', 'Bryan Work'),
            'Git user.email:': answerInput('email@git.com', 'bryan@work.com'),
          }),
          ...selectMock({
            'SSH Host:': selectChoice({ default: 'github-work', screen: hostScreen, keys: ['down'] }),
            'Sign Commits?': selectChoice({ default: 'ssh' }),
            'Select an SSH key:': selectChoice({ default: '/home/user/.ssh/id_work.pub', screen: sshKeyScreen }),
          }),
        });
        assert.deepEqual(await promptForProfile(validProfileWithSshKey),
          new Profile('profile-name', {
            host: 'github-personal',
            username: 'Git Username',
            email: 'email@git.com',
          }, {
            method: 'ssh',
            key: '/home/user/.ssh/id_work.pub',
          }),
        );
      });

      it('defaults to not signing when provided a profile without signing', async () => {
        const promptForProfile = await loadPromptForProfile({
          ...inputMock({
            'Profile name:': answerInput('profile-name', validProfile.name),
            'Git user.name:': answerInput('Git Username', validProfile.username),
            'Git user.email:': answerInput('email@git.com', validProfile.email),
          }),
          ...selectMock({
            'SSH Host:': selectChoice({ default: validProfile.host, screen: hostScreen, keys: ['down'] }),
            'Sign Commits?': selectChoice({ default: 'no' }),
          }),
        });
        assert.deepEqual(await promptForProfile(validProfile), minimumProfile);
      });

      it('defaults to ssh signing when creating a new profile', async () => {
        const promptForProfile = await loadPromptForProfile({
          ...sshKeysMock(sshKeys),
          ...inputMock({
            'Profile name:': answerInput('profile-name'),
            'Git user.name:': answerInput('Git Username'),
            'Git user.email:': answerInput('email@git.com'),
          }),
          ...selectMock({
            'SSH Host:': selectChoice({ screen: hostScreen }),
            'Sign Commits?': selectChoice({ default: SIGNING_METHOD.SSH }),
            'Select an SSH key:': selectChoice({ screen: sshKeyScreen }),
          }),
        });
        const profile = await promptForProfile();
        assert.equal(profile.signingMethod, SIGNING_METHOD.SSH);
      });
    });
  });

  describe('selectProfile', () => {
    const profileScreen = validProfiles.map((p) => new RegExp(p.name));

    it('returns the named profile without prompting', async () => {
      const selectProfile = await loadSelectProfile();
      const profile = await selectProfile(validProfiles, validProfileWithGpgKey.name);
      assert.equal(profile, validProfileWithGpgKey);
    });

    it('prompts for a profile when no name is given', async () => {
      const selectProfile = await loadSelectProfile({
        ...selectMock({
          'Select profile:': selectChoice({ screen: profileScreen, keys: ['down'] }),
        }),
      });
      const profile = await selectProfile(validProfiles);
      assert.equal(profile, validProfiles[1]);
    });

    it('warns and prompts when the named profile is not found', async () => {
      const selectProfile = await loadSelectProfile({
        ...logMock,
        ...chalkMock,
        ...selectMock({
          'Select profile:': selectChoice({ screen: profileScreen, keys: ['down', 'down'] }),
        }),
      });
      const profile = await selectProfile(validProfiles, 'missing');
      assert.equal(profile, validProfiles[2]);
      assert.deepEqual(logWarn, ['Profile [bold]missing[/bold] not found, please select one:']);
    });
  });
});
