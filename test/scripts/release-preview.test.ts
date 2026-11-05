import assert from 'node:assert/strict';
import { analyzerConfig, comment, MARKER, nextVersion, releaseType, type ReleaseType } from '../../scripts/release-preview.ts';

describe('scripts/release-preview.ts', () => {
  const analyzer = '@semantic-release/commit-analyzer';

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

  describe('releaseType', () => {
    const cases: [string, ReleaseType | null][] = [
      ['feat: add a command', 'minor'],
      ['feat(cli): add a command', 'minor'],
      ['fix: handle an empty config', 'patch'],
      ['perf: read the config once', 'patch'],
      // The default angular preset does not read the ! in a header, so semantic-release makes no release from these,
      // although CONTRIBUTING.md says it makes a major. If the release config changes to read it, these become major.
      ['feat!: rename the config file', null],
      ['fix(cli)!: change the exit code', null],
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
        assert.equal(await releaseType(title), expected);
      });
    }

    it('reads a BREAKING CHANGE footer as a major release', async () => {
      assert.equal(await releaseType('feat: rename the config file\n\nBREAKING CHANGE: the file is now .git-who.json'), 'major');
    });

    it('follows the config it is given', async () => {
      const config = { releaseRules: [{ type: 'docs', release: 'patch' }] };
      assert.equal(await releaseType('docs: describe the build step', config), 'patch');
    });
  });

  describe('nextVersion', () => {
    it('bumps the part the release type names, and zeroes the ones below it', () => {
      assert.equal(nextVersion('v1.2.3', 'patch'), 'v1.2.4');
      assert.equal(nextVersion('v1.2.3', 'minor'), 'v1.3.0');
      assert.equal(nextVersion('v1.2.3', 'major'), 'v2.0.0');
    });

    it('keeps a tag without a v as it was', () => {
      assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
    });

    it('bumps a 0.x version like any other, so a breaking change makes 1.0.0', () => {
      assert.equal(nextVersion('v0.3.0', 'minor'), 'v0.4.0');
      assert.equal(nextVersion('v0.3.0', 'major'), 'v1.0.0');
    });

    it('throws when the tag is not a version', () => {
      assert.throws(() => nextVersion('latest', 'minor'), { message: "Cannot read a version from the tag 'latest'." });
    });
  });

  describe('comment', () => {
    const latest = 'v0.3.0';

    it('starts with the marker that the workflow finds the comment by, which does not show on the page', () => {
      assert.match(MARKER, /^<!-- .+ -->$/);
      for (const type of ['major', 'minor', 'patch', null] as const) {
        assert.ok(comment(type, latest).startsWith(MARKER));
      }
    });

    it('is the marker and one line saying what the release would be, and nothing else', () => {
      for (const type of ['major', 'minor', 'patch', null] as const) {
        const lines = comment(type, latest).split('\n');
        assert.equal(lines.length, 2);
        assert.ok(lines[1].startsWith('**Release preview:**'));
      }
    });

    it('says there is no release when the title does not trigger one', () => {
      assert.match(comment(null, latest), /will not publish a release/);
    });

    for (const type of ['major', 'minor', 'patch'] as const) {
      it(`names the ${type} release and the versions it goes between`, () => {
        const text = comment(type, latest);
        assert.ok(text.includes(`**${type}**`));
        assert.ok(text.includes(`${latest} → ${nextVersion(latest, type)}`));
      });
    }

    it('names the release without versions when there is no earlier release', () => {
      const text = comment('minor');
      assert.ok(text.includes('**minor**'));
      assert.ok(!text.includes('→'));
    });
  });
});
