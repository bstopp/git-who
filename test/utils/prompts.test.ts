import { ExitPromptError } from '@inquirer/core';
import realInput from '@inquirer/input';
import realSelect from '@inquirer/select';

type InputArgs = Parameters<typeof realInput>; // [InputConfig, Context?]
type SelectArgs = Parameters<typeof realSelect>;

import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import { render } from '@inquirer/testing';

import {
  gpgKeys,
  sshHosts,
  sshKeys,
  validProfiles,
  validProfileWithGpgKey,
  validProfileWithSshKey,
} from '../fixtures.ts';
import * as validators from '../../src/utils/validators.ts';
import { Profile, SIGNING_METHOD } from '../../src/profile.ts';

describe('utils/prompts.ts', () => {
  describe('prompt', () => {
    const loadProfiles = {
      '../../src/utils/profiles.ts': {
        loadProfiles: () => Promise.resolve(validProfiles),
      },
    };
    describe('prompt validations', () => {
      it('validates profile name', async () => {
        let validateProfileNameCalled = false;
        let validateUniqueCalled = false;
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '../../src/utils/validators.ts': {
            ...validators,
            validateProfileName: () => {
              validateProfileNameCalled = true;
            },
            validateUnique: () => {
              validateUniqueCalled = true;
            },
          },
          '@inquirer/select': {
            default: async () => {
              throw new ExitPromptError();
            },
          },
          '@inquirer/input': {
            default: async (config: InputArgs[0], context: InputArgs[1]) => {
              const { answer, events } = await render(realInput, config, context);
              events.type('personal');
              events.keypress('enter');
              return answer;
            },
          },
        });
        await assert.rejects(pf(), ExitPromptError);
        assert.ok(validateProfileNameCalled, 'validateProfileName not called');
        assert.ok(validateUniqueCalled, 'validateUnique not called');
      });

      it('validates username', async () => {
        let validateUsernameCalled = false;
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '../../src/utils/validators.ts': {
            ...validators,
            validateUsername: () => {
              validateUsernameCalled = true;
            },
          },
          '@inquirer/select': {
            default: async (config: InputArgs[0]) => {
              if (config.message === 'SSH Host:') {
                return 'github-work';
              } else if (config.message === 'Sign Commits?') {
                return 'no';
              }
              assert.fail('Unknown select prompt: ' + config.message);
            },
          },
          '@inquirer/input': {
            default: async (config: InputArgs[0], context: InputArgs[1]) => {
              if (config.message === 'Git user.email:') {
                throw new ExitPromptError();
              }
              if (config.message === 'Git user.name:') {
                const { answer, events } = await render(realInput, config, context);
                events.type('Foo Bar');
                events.keypress('enter');
                return answer;
              } else {
                return 'ignored';
              }
            },
          },
        });
        await assert.rejects(pf());
        assert.ok(validateUsernameCalled, 'validateUsername not called');
      });

      it('validates email', async () => {
        let validateEmailCalled = false;
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '../../src/utils/validators.ts': {
            ...validators,
            validateEmail: () => {
              validateEmailCalled = true;
            },
          },
          '@inquirer/select': {
            default: async () => 'github-work',
          },
          '@inquirer/input': {
            default: async (config: InputArgs[0], context: InputArgs[1]) => {
              if (config.message === 'Git user.email:') {
                const { answer, events } = await render(realInput, config, context);
                events.type('foobar@example.com');
                events.keypress('enter');
                return answer;
              } else {
                return 'ignored';
              }
            },
          },
        });
        const profile = await pf();
        assert.equal(profile.email, 'foobar@example.com');
        assert.ok(validateEmailCalled, 'validateEmail not called');
      });
    });

    describe('prompting flow', () => {
      it('converts validation throws to inquirer messages', async () => {
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '@inquirer/select': {
            default: async () => {
              throw new ExitPromptError();
            },
          },
          '@inquirer/input': {
            default: async (config: InputArgs[0], context: InputArgs[1]) => {
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
          },
        });
        await assert.rejects(pf(), ExitPromptError);
      });

      it('propagates the error when user presses Ctrl+C during a prompt', async () => {
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '@inquirer/input': {
            default: async () => {
              throw new ExitPromptError();
            },
          },
        });
        await assert.rejects(pf(), ExitPromptError);
      });

      it('propagates errors when listSshHosts throws', async () => {
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '../../src/utils/ssh.ts': {
            listSshHosts: () => {
              throw new Error('no hosts');
            },
            listSshKeys: () => assert.fail('listSshKeys was called'),
          },
          '@inquirer/input': {
            default: async () => {
              return '';
            },
          },
        });
        await assert.rejects(pf(), { message: 'no hosts' });
      });

      it('propagates errors when gpg but listGpgKeys throws', async () => {
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '../../src/utils/ssh.ts': {
            listSshHosts: () => sshHosts,
            listSshKeys: () => assert.fail('listSshKeys was called'),
          },
          '../../src/utils/gpg.ts': {
            listGpgKeys: () => {
              throw new Error('gpg locked');
            },
          },
          '@inquirer/select': {
            default: async (config: InputArgs[0]) => {
              if (config.message === 'SSH Host:') {
                return 'github-work';
              } else if (config.message === 'Sign Commits?') {
                return SIGNING_METHOD.GPG;
              }
              assert.fail('Unknown select prompt: ' + config.message);
            },
          },
          '@inquirer/input': {
            default: async () => {
              return 'ignored';
            },
          },
        });
        await assert.rejects(pf(), { message: 'gpg locked' });
      });

      it('throws when gpg but no keys exist', async () => {
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '../../src/utils/ssh.ts': {
            listSshHosts: () => sshHosts,
            listSshKeys: () => assert.fail('listSshKeys was called'),
          },
          '../../src/utils/gpg.ts': {
            listGpgKeys: () => [],
          },
          '@inquirer/select': {
            default: async (config: InputArgs[0]) => {
              if (config.message === 'SSH Host:') {
                return 'github-work';
              } else if (config.message === 'Sign Commits?') {
                return SIGNING_METHOD.GPG;
              }
              assert.fail('Unknown select prompt: ' + config.message);
            },
          },
          '@inquirer/input': {
            default: async () => {
              return 'ignored';
            },
          },
        });
        await assert.rejects(pf(), { message: 'No GPG keys found on this system.' });
      });

      it('throws when ssh but no keys exist', async () => {
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '../../src/utils/ssh.ts': {
            listSshHosts: () => sshHosts,
            listSshKeys: () => [],
          },
          '../../src/utils/gpg.ts': {
            listGpgKeys: () => assert.fail('listGpgKeys was called'),
          },
          '@inquirer/select': {
            default: async (config: InputArgs[0]) => {
              if (config.message === 'SSH Host:') {
                return 'github-work';
              } else if (config.message === 'Sign Commits?') {
                return SIGNING_METHOD.SSH;
              }
              assert.fail('Unknown select prompt: ' + config.message);
            },
          },
          '@inquirer/input': {
            default: async () => {
              return 'ignored';
            },
          },
        });
        await assert.rejects(pf(), { message: 'No SSH keys found on this system.' });
      });

      it('creates a minimum profile', async () => {
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '../../src/utils/ssh.ts': {
            listSshHosts: () => sshHosts,
            listSshKeys: () => [],
          },
          '@inquirer/input': {
            default: async (config: InputArgs[0], context: InputArgs[1]) => {
              const { answer, events } = await render(realInput, config, context);
              if (config.message === 'Profile name:') {
                assert.equal(config.default, undefined);
                events.type('profile-name');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Git user.name:') {
                assert.equal(config.default, undefined);
                events.type('Git Username');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Git user.email:') {
                assert.equal(config.default, undefined);
                events.type('email@git.com');
                events.keypress('enter');
                return answer;
              }
              assert.fail('Unknown input prompt: ' + config.message);
            },
          },
          '@inquirer/select': {
            default: async (config: SelectArgs[0], context: SelectArgs[1]) => {
              if (config.message === 'SSH Host:') {
                const { answer, events, getScreen } = await render(realSelect, config, context);
                const screen = getScreen();
                assert.match(screen, /github-work\s\(github.com\)/i);
                assert.match(screen, /github-personal\s\(github.com\)/i);
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Sign Commits?') {
                return 'no';
              }
              assert.fail('Unknown select prompt: ' + config.message);
            },
          },
        });
        const profile = await pf();
        assert.deepEqual(profile,
          new Profile('profile-name', {
            host: 'github-personal',
            username: 'Git Username',
            email: 'email@git.com',
          }),
        );
      });

      it('creates a profile with ssh signing', async () => {
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '../../src/utils/ssh.ts': {
            listSshHosts: () => sshHosts,
            listSshKeys: () => sshKeys,
          },
          '@inquirer/input': {
            default: async (config: InputArgs[0]) => {
              if (config.message === 'Profile name:') {
                return 'profile-name';
              } else if (config.message === 'Git user.name:') {
                return 'Git Username';
              } else if (config.message === 'Git user.email:') {
                return 'email@git.com';
              }
              assert.fail('Unknown input prompt: ' + config.message);
            },
          },
          '@inquirer/select': {
            default: async (config: SelectArgs[0], context: SelectArgs[1]) => {
              if (config.message === 'SSH Host:') {
                return 'github-personal';
              } else if (config.message === 'Sign Commits?') {
                return SIGNING_METHOD.SSH;
              } else if (config.message === 'Select an SSH key:') {
                const { answer, events, getScreen } = await render(realSelect, config, context);
                const screen = getScreen();
                assert.match(screen, new RegExp('/home/user/.ssh/id_personal.pub'));
                assert.match(screen, new RegExp('/home/user/.ssh/id_work.pub'));
                events.keypress('down');
                events.keypress('enter');
                return answer;
              }
              assert.fail('Unknown select prompt: ' + config.message);
            },
          },
        });
        const profile = await pf();
        assert.deepEqual(profile,
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
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '../../src/utils/ssh.ts': {
            listSshHosts: () => sshHosts,
            listSshKeys: () => assert.fail('listSshKeys was called'),
          },
          '../../src/utils/gpg.ts': {
            listGpgKeys: () => gpgKeys,
          },
          '@inquirer/input': {
            default: async (config: InputArgs[0], context: InputArgs[1]) => {
              const { answer, events } = await render(realInput, config, context);
              if (config.message === 'Profile name:') {
                return 'github-personal';
              } else if (config.message === 'Git user.name:') {
                assert.equal(config.default, 'Bryan Personal');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Git user.email:') {
                assert.equal(config.default, 'bryan@personal.com');
                events.keypress('enter');
                return answer;
              }
              assert.fail('Unknown input prompt: ' + config.message);
            },
          },
          '@inquirer/select': {
            default: async (config: SelectArgs[0], context: SelectArgs[1]) => {
              if (config.message === 'SSH Host:') {
                return 'github-personal';
              } else if (config.message === 'Sign Commits?') {
                return SIGNING_METHOD.GPG;
              } else if (config.message === 'Select a GPG key:') {
                const { answer, events, getScreen } = await render(realSelect, config, context);
                const screen = getScreen();
                assert.match(screen, /FEDCBA0987654321\s—\sBryan Work \(bryan@work.com\)/i);
                assert.match(screen, /1234567890ABCDEF\s—\sBryan Personal \(bryan@personal.com\),\sBryan Work \(bryan@work.com\)/i);
                events.keypress('down');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Select an identity:') {
                const { answer, events, getScreen } = await render(realSelect, config, context);
                const screen = getScreen();
                assert.match(screen, /Bryan Personal \(bryan@personal.com\)/i);
                assert.match(screen, /Bryan Work \(bryan@work.com\)/i);
                events.keypress('enter');
                return answer;
              }
              assert.fail('Unknown select prompt: ' + config.message);
            },
          },
        });
        const profile = await pf();
        assert.deepEqual(profile,
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
        const logInfo: string[] = [];
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          '../../src/utils/log.ts': { info: (msg: string) => logInfo.push(msg) },
          ...loadProfiles,
          '../../src/utils/ssh.ts': {
            listSshHosts: () => sshHosts,
            listSshKeys: () => assert.fail('listSshKeys was called'),
          },
          '../../src/utils/gpg.ts': {
            listGpgKeys: () => gpgKeys,
          },
          '@inquirer/input': {
            default: async (config: InputArgs[0], context: InputArgs[1]) => {
              const { answer, events } = await render(realInput, config, context);
              if (config.message === 'Profile name:') {
                return 'github-work';
              } else if (config.message === 'Git user.name:') {
                assert.equal(config.default, 'Bryan Work');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Git user.email:') {
                assert.equal(config.default, 'bryan@work.com');
                events.keypress('enter');
                return answer;
              }
              assert.fail('Unknown input prompt: ' + config.message);
            },
          },
          '@inquirer/select': {
            default: async (config: SelectArgs[0], context: SelectArgs[1]) => {
              if (config.message === 'SSH Host:') {
                return 'github-work';
              } else if (config.message === 'Sign Commits?') {
                return SIGNING_METHOD.GPG;
              } else if (config.message === 'Select a GPG key:') {
                const { answer, events, getScreen } = await render(realSelect, config, context);
                const screen = getScreen();
                assert.match(screen, /FEDCBA0987654321\s—\sBryan Work \(bryan@work.com\)/i);
                assert.match(screen, /1234567890ABCDEF\s—\sBryan Personal \(bryan@personal.com\),\sBryan Work \(bryan@work.com\)/i);
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Select an identity:') {
                assert.fail('Select an identity should not have been prompted.');
              }
              assert.fail('Unknown select prompt: ' + config.message);
            },
          },
        });
        const profile = await pf();
        assert.deepEqual(profile,
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
        const logInfo: string[] = [];
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          '../../src/utils/log.ts': { info: (msg: string) => logInfo.push(msg) },
          ...loadProfiles,
          '../../src/utils/ssh.ts': {
            listSshHosts: () => sshHosts,
            listSshKeys: () => assert.fail('listSshKeys was called'),
          },
          '../../src/utils/gpg.ts': {
            listGpgKeys: () => [gpgKeys[1]],
          },
          '@inquirer/input': {
            default: async (config: InputArgs[0], context: InputArgs[1]) => {
              const { answer, events } = await render(realInput, config, context);
              if (config.message === 'Profile name:') {
                return 'github-personal';
              } else if (config.message === 'Git user.name:') {
                assert.equal(config.default, 'Bryan Personal');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Git user.email:') {
                assert.equal(config.default, 'bryan@personal.com');
                events.keypress('enter');
                return answer;
              }
              assert.fail('Unknown input prompt: ' + config.message);
            },
          },
          '@inquirer/select': {
            default: async (config: SelectArgs[0], context: SelectArgs[1]) => {
              if (config.message === 'SSH Host:') {
                return 'github-personal';
              } else if (config.message === 'Sign Commits?') {
                return SIGNING_METHOD.GPG;
              } else if (config.message === 'Select a GPG key:') {
                assert.fail('Select a gpg key should not have been prompted.');
              } else if (config.message === 'Select an identity:') {
                const { answer, events, getScreen } = await render(realSelect, config, context);
                const screen = getScreen();
                assert.match(screen, /Bryan Personal \(bryan@personal.com\)/i);
                assert.match(screen, /Bryan Work \(bryan@work.com\)/i);
                events.keypress('enter');
                return answer;
              }
              assert.fail('Unknown select prompt: ' + config.message);
            },
          },
        });
        const profile = await pf();
        assert.deepEqual(profile,
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
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '../../src/utils/ssh.ts': {
            listSshHosts: () => sshHosts,
            listSshKeys: () => [],
          },
          '../../src/utils/gpg.ts': {
            listGpgKeys: () => gpgKeys,
          },
          '@inquirer/input': {
            default: async (config: InputArgs[0], context: InputArgs[1]) => {
              const { answer, events } = await render(realInput, config, context);
              if (config.message === 'Profile name:') {
                assert.equal(config.default, 'work-gpg-signed');
                events.type('profile-name');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Git user.name:') {
                assert.equal(config.default, 'Bryan Work');
                events.type('Git Username');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Git user.email:') {
                assert.equal(config.default, 'bryan@work.com');
                events.type('email@git.com');
                events.keypress('enter');
                return answer;
              }
              assert.fail('Unknown input prompt: ' + config.message);
            },
          },
          '@inquirer/select': {
            default: async (config: SelectArgs[0], context: SelectArgs[1]) => {
              const { answer, events, getScreen } = await render(realSelect, config, context);
              if (config.message === 'SSH Host:') {
                assert.equal(config.default, 'github-work');
                const screen = getScreen();
                assert.match(screen, /github-work\s\(github.com\)/i);
                assert.match(screen, /github-personal\s\(github.com\)/i);
                events.keypress('down');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Sign Commits?') {
                assert.equal(config.default, 'gpg');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Select a GPG key:') {
                assert.equal(config.default, 'FEDCBA0987654321');
                const screen = getScreen();
                assert.match(screen, /FEDCBA0987654321\s—\sBryan Work \(bryan@work.com\)/i);
                assert.match(screen, /1234567890ABCDEF\s—\sBryan Personal \(bryan@personal.com\),\sBryan Work \(bryan@work.com\)/i);
                events.keypress('enter');
                return answer;
              }
              assert.fail('Unknown select prompt: ' + config.message);
            },
          },
        });
        const profile = await pf(validProfileWithGpgKey);
        assert.deepEqual(profile,
          new Profile('profile-name', {
            host: 'github-personal',
            username: 'Git Username',
            email: 'email@git.com',
          }, {
            method: 'gpg',
            key: 'FEDCBA0987654321',
          }),
        );
      });

      it('prepopulates when provided a profile (ssh)', async () => {
        const { prompt: pf } = await esmock('../../src/utils/prompts.ts', {
          ...loadProfiles,
          '../../src/utils/ssh.ts': {
            listSshHosts: () => sshHosts,
            listSshKeys: () => sshKeys,
          },
          '../../src/utils/gpg.ts': {
            listGpgKeys: () => gpgKeys,
          },
          '@inquirer/input': {
            default: async (config: InputArgs[0], context: InputArgs[1]) => {
              const { answer, events } = await render(realInput, config, context);
              if (config.message === 'Profile name:') {
                assert.equal(config.default, 'work-ssh-signed');
                events.type('profile-name');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Git user.name:') {
                assert.equal(config.default, 'Bryan Work');
                events.type('Git Username');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Git user.email:') {
                assert.equal(config.default, 'bryan@work.com');
                events.type('email@git.com');
                events.keypress('enter');
                return answer;
              }
              assert.fail('Unknown input prompt: ' + config.message);
            },
          },
          '@inquirer/select': {
            default: async (config: SelectArgs[0], context: SelectArgs[1]) => {
              const { answer, events, getScreen } = await render(realSelect, config, context);
              if (config.message === 'SSH Host:') {
                assert.equal(config.default, 'github-work');
                const screen = getScreen();
                assert.match(screen, /github-work\s\(github.com\)/i);
                assert.match(screen, /github-personal\s\(github.com\)/i);
                events.keypress('down');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Sign Commits?') {
                assert.equal(config.default, 'ssh');
                events.keypress('enter');
                return answer;
              } else if (config.message === 'Select an SSH key:') {
                assert.equal(config.default, '/home/user/.ssh/id_work.pub');
                const screen = getScreen();
                assert.match(screen, new RegExp('/home/user/.ssh/id_personal.pub'));
                assert.match(screen, new RegExp('/home/user/.ssh/id_work.pub'));
                events.keypress('enter');
                return answer;
              }
              assert.fail('Unknown select prompt: ' + config.message);
            },
          },
        });
        const profile = await pf(validProfileWithSshKey);
        assert.deepEqual(profile,
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
    });
  });
});
