import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import type { Command } from 'commander';
import { multiProfiles } from '../fixtures.ts';
import type { Profile } from '../../src/profile.ts';

type Mocks = Record<string, object>;
type CompleteCall = { root: Command; words: string[]; profiles: string[] };

describe('commands/complete.ts', async () => {
  let profiles: Profile[] | Error = multiProfiles;
  let candidates: string[] = [];
  const completeCalls: CompleteCall[] = [];
  const logRawCalls: string[] = [];

  const root = { name: () => 'git who' } as Command;
  const command = { parent: root } as Command;

  const profilesMock = {
    '../../src/utils/profiles.ts': {
      loadProfiles: async () => {
        if (profiles instanceof Error) {
          throw profiles;
        }
        return profiles;
      },
    },
  };

  const completionMock = {
    '../../src/utils/completion.ts': {
      complete: (given: Command, words: string[], names: string[]) => {
        completeCalls.push({ root: given, words, profiles: names });
        return candidates;
      },
    },
  };

  const logMock = {
    '../../src/utils/log.ts': {
      default: { raw: (text: string) => logRawCalls.push(text) },
    },
  };

  const loadComplete = async (overrides: Mocks = {}) => {
    const { default: complete } = await esmock<typeof import('../../src/commands/complete.ts')>(
      '../../src/commands/complete.ts',
      { ...profilesMock, ...completionMock, ...logMock, ...overrides },
    );
    return complete;
  };

  beforeEach(() => {
    profiles = multiProfiles;
    candidates = [];
    completeCalls.length = 0;
    logRawCalls.length = 0;
  });

  it('completes the words against the root command and the profile names', async () => {
    const words = ['use', ''];
    const complete = await loadComplete();
    await complete(words, {}, command);
    assert.deepEqual(completeCalls, [{ root, words, profiles: multiProfiles.map((p) => p.name) }]);
  });

  it('prints one candidate per line', async () => {
    candidates = ['work', 'work-gpg'];
    const complete = await loadComplete();
    await complete(['use', 'w'], {}, command);
    assert.deepEqual(logRawCalls, [candidates.join('\n')]);
  });

  it('prints nothing when there are no candidates, rather than an empty line', async () => {
    const complete = await loadComplete();
    await complete(['list', ''], {}, command);
    assert.deepEqual(logRawCalls, []);
  });

  it('completes without profile names when the config cannot be loaded', async () => {
    profiles = new Error('config is corrupt');
    candidates = ['use'];
    const complete = await loadComplete();
    await assert.doesNotReject(() => complete(['u'], {}, command));
    assert.deepEqual(completeCalls[0].profiles, []);
    assert.deepEqual(logRawCalls, ['use']);
  });
});
