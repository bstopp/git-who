import { readFile } from 'node:fs/promises';
import { analyzeCommits } from '@semantic-release/commit-analyzer';

export type ReleaseType = 'major' | 'minor' | 'patch';

// An HTML comment, so it is not shown on the page, but the workflow can find the comment it posted by it.
export const MARKER = '<!-- release-preview -->';

const ANALYZER = '@semantic-release/commit-analyzer';
const VERSION = /^(v?)(\d+)\.(\d+)\.(\d+)$/;

/**
 * The config that `.releaserc.json` gives the commit analyzer, so the preview follows the release rules the release
 * itself uses. The analyzer is listed either by name or as `[name, config]`, and is empty config when not listed.
 */
export function analyzerConfig(releaserc: { plugins?: unknown[] }): object {
  const entry = (releaserc.plugins ?? []).find((plugin) => plugin === ANALYZER || (Array.isArray(plugin) && plugin[0] === ANALYZER));
  return Array.isArray(entry) ? entry[1] ?? {} : {};
}

/**
 * The release a pull request title makes, which is what semantic-release decides from the squash commit that has the
 * title as its message.
 */
export async function releaseType(title: string, config: object = {}): Promise<ReleaseType | null> {
  const logger = { log: () => {} };
  return analyzeCommits(config, { commits: [{ message: title }], logger, cwd: process.cwd() });
}

/**
 * The version after a release of the given type, keeping the `v` of the tag if it has one. Like semantic-release, it
 * treats a 0.x version as any other, so a breaking change makes 1.0.0.
 *
 * @throws {Error} If the tag is not `major.minor.patch`.
 */
export function nextVersion(tag: string, type: ReleaseType): string {
  const match = VERSION.exec(tag);
  if (!match) {
    throw new Error(`Cannot read a version from the tag '${tag}'.`);
  }
  const [major, minor, patch] = match.slice(2).map(Number);
  const next = {
    major: [major + 1, 0, 0],
    minor: [major, minor + 1, 0],
    patch: [major, minor, patch + 1],
  }[type];
  return `${match[1]}${next.join('.')}`;
}

/**
 * The text of the pull request comment. It has none of the title in it, so a title cannot add links or mentions to it.
 */
export function comment(type: ReleaseType | null, latestTag?: string): string {
  const versions = latestTag && type ? `: ${latestTag} → ${nextVersion(latestTag, type)}` : '';
  const outcome = type ? `publish a **${type}** release${versions}` : 'not publish a release';
  return [
    MARKER,
    `**Release preview:** merging this pull request will ${outcome}.`,
    '',
    'This follows the pull request title, which becomes the commit message when the pull request is squash merged, and it updates when the title changes.',
  ].join('\n');
}

if (import.meta.main) {
  const releaserc = JSON.parse(await readFile('.releaserc.json', 'utf8'));
  const type = await releaseType(process.env.TITLE ?? '', analyzerConfig(releaserc));
  console.log(comment(type, process.env.LATEST_TAG || undefined));
}
