import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateNotes } from '@semantic-release/release-notes-generator';

// Renders release notes with the plugin and the config that the release uses. A preset that the plugin's writer cannot
// render, such as a major version that needs a newer writer, throws here, so a dependency update that would break the
// release fails this test instead.
describe('.releaserc.json release notes', () => {
  const notes = '@semantic-release/release-notes-generator';
  const feature = 'add a command';
  const fix = 'handle an empty config';
  const breakingNote = 'the file is now .git-who.json';

  const commit = (hash: string, message: string) => ({
    hash,
    message,
    committerDate: '2026-11-04T00:00:00Z',
    author: { name: 'author' },
    committer: { name: 'committer' },
  });

  it('renders the features, fixes and breaking changes of a release', async () => {
    const releaserc = JSON.parse(await readFile('.releaserc.json', 'utf8'));
    const entry = releaserc.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === notes);
    assert.ok(entry, 'the release notes generator should be listed with its config');

    const text = await generateNotes(entry[1], {
      commits: [
        commit('1'.repeat(40), `feat!: rename the config file (#9)\n\nBREAKING CHANGE: ${breakingNote}`),
        commit('2'.repeat(40), `feat: ${feature} (#8)`),
        commit('3'.repeat(40), `fix: ${fix} (#7)`),
      ],
      cwd: process.cwd(),
      logger: { log: () => {} },
      lastRelease: { gitTag: 'v0.3.0', version: '0.3.0' },
      nextRelease: { gitTag: 'v1.0.0', version: '1.0.0', gitHead: '9'.repeat(40) },
      options: { repositoryUrl: 'https://github.com/bstopp/git-who.git' },
    });

    assert.match(text, /### Features/);
    assert.ok(text.includes(feature));
    assert.match(text, /### Bug Fixes/);
    assert.ok(text.includes(fix));
    assert.match(text, /BREAKING CHANGES/);
    assert.ok(text.includes(breakingNote));
  });
});
