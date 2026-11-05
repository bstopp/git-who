import assert from 'node:assert/strict';
import { parseLog } from '../../scripts/release-needed.ts';

describe('scripts/release-needed.ts', () => {
  describe('parseLog', () => {
    it('splits the log into one message per commit', () => {
      assert.deepEqual(parseLog('feat: add a command (#8)\0fix: handle an empty config (#7)\0'), [
        'feat: add a command (#8)',
        'fix: handle an empty config (#7)',
      ]);
    });

    it('keeps a message with a body in one piece', () => {
      const message = 'feat: rename the config file (#9)\n\nBREAKING CHANGE: the file is now .git-who.json';
      assert.deepEqual(parseLog(`${message}\n\0`), [message]);
    });

    it('is empty when there are no commits', () => {
      assert.deepEqual(parseLog(''), []);
      assert.deepEqual(parseLog('\n'), []);
    });
  });
});
