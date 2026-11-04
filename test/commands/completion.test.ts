import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import { SHELLS, type Shell } from '../../src/utils/completion.ts';

describe('commands/completion.ts', async () => {
  const logRawCalls: string[] = [];
  const scripts: Record<Shell, string> = { zsh: 'zsh script', bash: 'bash script' };

  const loadCompletion = async () => {
    const { default: completion } = await esmock<typeof import('../../src/commands/completion.ts')>(
      '../../src/commands/completion.ts',
      {
        '../../src/utils/completion.ts': { script: (shell: Shell) => scripts[shell] },
        '../../src/utils/log.ts': { default: { raw: (text: string) => logRawCalls.push(text) } },
      },
    );
    return completion;
  };

  beforeEach(() => {
    logRawCalls.length = 0;
  });

  for (const shell of SHELLS) {
    it(`prints the ${shell} script and nothing else`, async () => {
      const completion = await loadCompletion();
      completion(shell);
      assert.deepEqual(logRawCalls, [scripts[shell]]);
    });
  }
});
