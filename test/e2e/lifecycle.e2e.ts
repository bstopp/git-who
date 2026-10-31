import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { mock } from 'node:test';
import { render } from '@inquirer/testing';
import type { Prompt } from '@inquirer/type';
import realConfirm from '@inquirer/confirm';
import realInput from '@inquirer/input';
import realSelect from '@inquirer/select';
import type { SimpleGit } from 'simple-git';
import { Profile, SIGNING_METHOD } from '../../src/profile.ts';
import { gpgKeys, personalProfile, sshHosts, sshKeys, validProfile } from '../fixtures.ts';
import { tmpHome } from '../hooks.ts';

// Runs in its own mocha process (`npm run test:e2e`) with --experimental-test-module-mocks. mock.module can only replace
// a module that nothing has loaded yet, so nothing in src/ may be imported statically here, and the unit tests, which
// load src/ modules, must not share the process.

type Events = Awaited<ReturnType<typeof render>>['events'];
type Interaction = (events: Events, screen: string) => void;
type Script = Record<string, Interaction>;
type GpgKey = (typeof gpgKeys)[number];

const identity = (text: string) => text;

const shows = (screen: string, text: string) => assert.ok(screen.includes(text));

const down = (events: Events, times: number) => {
  for (let i = 0; i < times; i++) {
    events.keypress('down');
  }
};

const asJson = (profiles: Profile[]) => JSON.parse(JSON.stringify(profiles));

/**
 * An in-memory stand-in for the parts of simple-git that the commands use. Tests may not spawn a process, so the git
 * config is kept in a map rather than in a real repo.
 */
function createFakeGit() {
  const config = new Map<string, string>();
  const git = {
    checkIsRepo: async () => true,
    getConfig: async (key: string, scope: string) => {
      assert.equal(scope, 'local');
      return { value: config.get(key) ?? null };
    },
    addConfig: async (key: string, value: string, append: boolean, scope: string) => {
      assert.equal(append, false);
      assert.equal(scope, 'local');
      config.set(key, value);
    },
    raw: async (args: string[]) => {
      assert.deepEqual(args.slice(0, 3), ['config', '--local', '--unset']);
      config.delete(args[3]);
    },
  } as unknown as SimpleGit;
  return { git, config };
}

describe('git-who end-to-end profile lifecycle', () => {
  const fake = createFakeGit();
  const logs = { info: [] as string[], warn: [] as string[], error: [] as string[] };
  let script: Script = {};
  let originalHome: string | undefined;

  /**
   * Wrap a real prompt so it is rendered and answered by the script entry for its message, then submitted. A prompt
   * the script does not know about fails the test.
   */
  const driven = <Value, Config extends { message: string }>(real: Prompt<Value, Config>) => {
    return async (config: Config) => {
      const interaction = script[config.message];
      assert.ok(interaction, `unexpected prompt: ${config.message}`);
      const { answer, events, getScreen } = await render(real, config);
      interaction(events, getScreen());
      events.keypress('enter');
      return answer;
    };
  };

  const mockModules = () => {
    mock.module('chalk', { exports: { default: { bold: identity, yellow: identity, red: identity } } });
    mock.module('simple-git', { exports: { simpleGit: () => fake.git } });
    mock.module('@inquirer/confirm', { exports: { default: driven(realConfirm) } });
    mock.module('@inquirer/input', { exports: { default: driven(realInput) } });
    mock.module('@inquirer/select', { exports: { default: driven(realSelect) } });
    mock.module('../../src/utils/ssh.ts', {
      exports: { listSshHosts: async () => sshHosts, listSshKeys: async () => sshKeys },
    });
    mock.module('../../src/utils/gpg.ts', {
      exports: {
        listGpgKeys: async (query?: string) => query
          ? gpgKeys.filter((k) => k.keyId === query || k.uids.some((u) => u.email === query))
          : gpgKeys,
      },
    });
    mock.module('../../src/utils/log.ts', {
      exports: {
        default: {
          info: (msg: string) => logs.info.push(msg),
          warn: (msg: string) => logs.warn.push(msg),
          error: (msg: string) => logs.error.push(msg),
        },
      },
    });
  };

  const savedProfiles = async () => {
    return JSON.parse(await readFile(path.join(tmpHome, '.git-who.cfg.json'), 'utf8'));
  };

  const gitConfig = (key: string) => fake.config.get(key);

  // The config file's location comes from the home directory, which is read as src/ loads.
  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    fake.config.clear();
  });

  afterEach(() => {
    mock.reset();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  /** Answers for `add`, choosing the target's host and, when a key is given, signing with it over GPG. */
  const addScript = (target: Profile, gpgKey?: GpgKey): Script => {
    const uid = gpgKey?.uids.find((u) => u.email === target.email);
    const gpgScript: Script = {};
    if (gpgKey && uid) {
      gpgScript['Select a GPG key:'] = (events, screen) => {
        shows(screen, gpgKey.keyId);
        down(events, gpgKeys.indexOf(gpgKey));
      };
      gpgScript['Select an identity:'] = (events, screen) => {
        shows(screen, `${uid.name} (${uid.email})`);
        down(events, gpgKey.uids.indexOf(uid));
      };
    }
    return {
      'Profile name:': (events) => events.type(target.name),
      'SSH Host:': (events, screen) => {
        sshHosts.forEach((entry) => shows(screen, `${entry.host} (${entry.hostname})`));
        down(events, sshHosts.findIndex((entry) => entry.host === target.host));
      },
      'Sign Commits?': (events, screen) => {
        ['Use SSH', 'Use GPG', 'No'].forEach((choice) => shows(screen, choice));
        down(events, gpgKey ? 1 : 2);
      },
      ...gpgScript,
      'Git user.name:': (events) => events.type(target.username),
      'Git user.email:': (events) => events.type(target.email),
      'Save this profile?': (_events, screen) => shows(screen, 'Save this profile? (Y/n)'),
    };
  };

  const confirmYes: Interaction = (events) => events.type('y');

  it('walks through the full profile lifecycle', async () => {
    const personalGpgKey = gpgKeys.find((k) => k.uids.some((u) => u.email === personalProfile.email))!;
    const signedPersonal = new Profile(personalProfile.name, personalProfile, {
      method: SIGNING_METHOD.GPG,
      key: personalGpgKey.keyId,
    });
    const editedWork = new Profile(validProfile.name, { ...validProfile, username: 'Bryan S.' });

    mockModules();
    const { program } = await import('../../src/cli.ts');
    const { NoProfilesError } = await import('../../src/utils/profiles.ts');

    /**
     * Run one command, answering the prompts it shows from the script. Returns what the command logged with `info`, and
     * fails if it logged a warning or an error.
     */
    const run = async (interactions: Script, ...args: string[]) => {
      script = interactions;
      logs.info = [];
      logs.warn = [];
      logs.error = [];
      await program.parseAsync(['node', 'git-who', ...args]);
      assert.deepEqual(logs.warn, []);
      assert.deepEqual(logs.error, []);
      return logs.info;
    };

    // 1. show fails with no profiles
    await assert.rejects(() => run({}, 'show'), { message: new NoProfilesError().message });

    // 2. adds the work profile (no signing)
    let info = await run(addScript(validProfile), 'add');
    assert.equal(info.at(-1), `Profile ${validProfile.name} added.`);
    assert.deepEqual(await savedProfiles(), asJson([validProfile]));

    // 3. list shows the work profile
    info = await run({}, 'list');
    assert.equal(info.at(-1), `Known profiles:\n  - ${validProfile.name} (${validProfile.host})`);

    // 4. show displays the work profile by name
    info = await run({}, 'show', validProfile.name);
    assert.equal(info.at(-1), [
      `Profile:      ${validProfile.name}`,
      `Host:         ${validProfile.host}`,
      `Name:         ${validProfile.username}`,
      `Email:        ${validProfile.email}`,
      'Sign Commits: No',
    ].join('\n'));

    // 5. adds the personal profile, signing with a GPG key
    info = await run(addScript(personalProfile, personalGpgKey), 'add');
    assert.equal(info.at(-1), `Profile ${personalProfile.name} added.`);
    assert.deepEqual(await savedProfiles(), asJson([validProfile, signedPersonal]));

    // 6. list shows both profiles
    info = await run({}, 'list');
    assert.equal(info.at(-1), [
      'Known profiles:',
      `  - ${validProfile.name} (${validProfile.host})`,
      `  - ${personalProfile.name} (${personalProfile.host})`,
    ].join('\n'));

    // 7. show displays the personal profile by name, including its signing key
    info = await run({}, 'show', personalProfile.name);
    assert.equal(info.at(-1), [
      `Profile:      ${personalProfile.name}`,
      `Host:         ${personalProfile.host}`,
      `Name:         ${personalProfile.username}`,
      `Email:        ${personalProfile.email}`,
      'Sign Commits: Using gpg',
      [
        `Signing Key:  ${personalGpgKey.keyId}`,
        ...personalGpgKey.uids.map((u) => `  ${u.name} (${u.email})`),
      ].join('\n'),
    ].join('\n'));

    // 8. edit changes the work profile's username, and every prompt starts on the current value
    info = await run({
      'Profile name:': (_events, screen) => shows(screen, validProfile.name),
      'SSH Host:': (_events, screen) => shows(screen, validProfile.host),
      'Sign Commits?': (_events, screen) => shows(screen, 'No'),
      'Git user.name:': (events, screen) => {
        shows(screen, validProfile.username);
        events.type(editedWork.username);
      },
      'Git user.email:': (_events, screen) => shows(screen, validProfile.email),
      'Save this profile?': (_events, screen) => shows(screen, 'Save this profile? (Y/n)'),
    }, 'edit', validProfile.name);
    assert.equal(info.at(-1), `Profile ${editedWork.name} updated.`);
    assert.deepEqual(await savedProfiles(), asJson([editedWork, signedPersonal]));

    // 9. use with no name shows the picker, and selecting work applies it to the repo
    info = await run({
      'Select profile:': (_events, screen) => {
        shows(screen, validProfile.name);
        shows(screen, personalProfile.name);
      },
    }, 'use');
    assert.equal(info.at(-1), `Now using profile '${validProfile.name}'.`);
    assert.equal(gitConfig('gitwho.profile'), validProfile.name);
    assert.equal(gitConfig('user.name'), editedWork.username);
    assert.equal(gitConfig('user.email'), validProfile.email);
    assert.equal(gitConfig('user.signingKey'), undefined);
    assert.equal(gitConfig('commit.gpgsign'), undefined);

    // 10. use with a name switches to the other profile with no picker, and sets its signing
    info = await run({}, 'use', personalProfile.name);
    assert.equal(info.at(-1), `Now using profile '${personalProfile.name}'.`);
    assert.equal(gitConfig('gitwho.profile'), personalProfile.name);
    assert.equal(gitConfig('user.name'), personalProfile.username);
    assert.equal(gitConfig('user.email'), personalProfile.email);
    assert.equal(gitConfig('user.signingKey'), personalGpgKey.keyId);
    assert.equal(gitConfig('commit.gpgsign'), 'true');
    assert.equal(gitConfig('gpg.format'), undefined);

    // 11. remove asks twice for the active profile (personal), and clears it from the repo
    info = await run({
      [`Profile '${personalProfile.name}' is the active profile. Continue?`]: confirmYes,
      [`Remove profile '${personalProfile.name}'?`]: confirmYes,
    }, 'remove', personalProfile.name);
    assert.equal(info.at(-1), `Profile '${personalProfile.name}' has been removed.`);
    assert.equal(gitConfig('gitwho.profile'), undefined);
    assert.deepEqual(await savedProfiles(), asJson([editedWork]));

    // 12. remove asks once for a profile that is not active (work)
    info = await run({ [`Remove profile '${validProfile.name}'?`]: confirmYes }, 'remove', validProfile.name);
    assert.equal(info.at(-1), `Profile '${validProfile.name}' has been removed.`);
    assert.deepEqual(await savedProfiles(), []);
  });
});
