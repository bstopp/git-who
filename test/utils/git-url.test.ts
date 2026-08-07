import assert from 'node:assert/strict';
import { parseSshUrl } from '../../src/utils/git-url.ts';

describe('utils/git-url.ts', () => {
  describe('parseSshUrl', () => {
    it('returns the host and path for a git@host:path url', () => {
      const result = parseSshUrl('git@github-work:org/repo.git');
      assert.deepEqual(result, { host: 'github-work', path: 'org/repo.git' });
    });

    it('returns the host and path for a ssh://git@host/path url', () => {
      const result = parseSshUrl('ssh://git@github.com/org/repo.git');
      assert.deepEqual(result, { host: 'github.com', path: 'org/repo.git' });
    });

    it('returns the host and path for a ssh://git@host:port/path url', () => {
      const result = parseSshUrl('ssh://git@github.com:1234/org/repo.git');
      assert.deepEqual(result, { host: 'github.com', path: 'org/repo.git' });
    });

    it('returns undefined for a url that is not either supported form', () => {
      const result = parseSshUrl('https://github.com/org/repo.git');
      assert.equal(result, undefined);
    });
  });
});
