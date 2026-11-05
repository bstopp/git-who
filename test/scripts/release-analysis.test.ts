import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzerConfig, releaseTypeOf, repoAnalyzerConfig, type ReleaseType } from '../../scripts/release-analysis.ts';

describe('scripts/release-analysis.ts', () => {
  const analyzer = '@semantic-release/commit-analyzer';
  const notes = '@semantic-release/release-notes-generator';
  type Releaserc = { plugins: unknown[] };
  let releaserc: Releaserc;
  let repoConfig: object;

  // The config the release itself uses, so that these tests describe what the release really does here.
  before(async () => {
    releaserc = JSON.parse(await readFile('.releaserc.json', 'utf8'));
    repoConfig = analyzerConfig(releaserc);
  });

  const pluginConfig = (name: string) => {
    const entry = releaserc.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === name);
    return Array.isArray(entry) ? entry[1] : undefined;
  };

  describe('analyzerConfig', () => {
    it('is empty when the analyzer is listed by name only', () => {
      assert.deepEqual(analyzerConfig({ plugins: ['@semantic-release/npm', analyzer] }), {});
    });

    it('is the config the analyzer is listed with', () => {
      const config = { releaseRules: [{ type: 'docs', release: 'patch' }] };
      assert.deepEqual(analyzerConfig({ plugins: [[analyzer, config]] }), config);
    });

    it('is empty when the analyzer is not listed, or there are no plugins', () => {
      assert.deepEqual(analyzerConfig({ plugins: ['@semantic-release/npm'] }), {});
      assert.deepEqual(analyzerConfig({}), {});
    });
  });

  describe('repoAnalyzerConfig', () => {
    it('is the analyzer config from .releaserc.json in the current directory', () => {
      assert.deepEqual(repoAnalyzerConfig(), repoConfig);
    });
  });

  describe('releaseTypeOf', () => {
    const cases: [string, ReleaseType | null][] = [
      ['feat: add a command', 'minor'],
      ['feat(cli): add a command', 'minor'],
      ['fix: handle an empty config', 'patch'],
      ['perf: read the config once', 'patch'],
      ['feat!: rename the config file', 'major'],
      ['fix(cli)!: change the exit code', 'major'],
      ['docs: describe the build step', null],
      ['chore: update dependencies', null],
      ['ci: pin the actions', null],
      ['test: cover the hook', null],
      ['refactor: move the resolution', null],
      ['build: compile to dist', null],
      ['style: format', null],
      ['not a conventional commit', null],
    ];

    for (const [title, expected] of cases) {
      it(`reads '${title}' as ${expected ?? 'no release'}`, async () => {
        assert.equal(await releaseTypeOf([title], repoConfig), expected);
      });
    }

    it('reads a BREAKING CHANGE footer as a major release, whatever the type', async () => {
      assert.equal(await releaseTypeOf(['feat: rename the config file\n\nBREAKING CHANGE: the file is now .git-who.json'], repoConfig), 'major');
      assert.equal(await releaseTypeOf(['chore: x\n\nBREAKING CHANGE: y'], repoConfig), 'major');
    });

    it('follows the config it is given', async () => {
      const config = { releaseRules: [{ type: 'docs', release: 'patch' }] };
      assert.equal(await releaseTypeOf(['docs: describe the build step'], config), 'patch');
    });

    it('is no release when there are no commits', async () => {
      assert.equal(await releaseTypeOf([], repoConfig), null);
    });

    it('is the highest release of the commits', async () => {
      assert.equal(await releaseTypeOf(['fix: a', 'feat: b', 'docs: c'], repoConfig), 'minor');
      assert.equal(await releaseTypeOf(['fix: a', 'feat!: b'], repoConfig), 'major');
      assert.equal(await releaseTypeOf(['docs: a', 'ci: b'], repoConfig), null);
    });

    // A merge that does not release must not hide an earlier one that is still waiting, such as after a skipped run.
    it('finds a releasing commit among ones that do not release', async () => {
      assert.equal(await releaseTypeOf(['docs: a', 'feat: b', 'ci: c'], repoConfig), 'minor');
    });
  });

  describe('.releaserc.json', () => {
    it('gives the commit analyzer and the release notes the same preset, so they read commits the same way', () => {
      const analyzerPreset = (pluginConfig(analyzer) as { preset?: string } | undefined)?.preset;
      const notesPreset = (pluginConfig(notes) as { preset?: string } | undefined)?.preset;
      assert.ok(analyzerPreset, 'the commit analyzer should name a preset');
      assert.equal(notesPreset, analyzerPreset);
    });
  });
});
