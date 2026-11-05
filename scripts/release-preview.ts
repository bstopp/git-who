import { releaseTypeOf, repoAnalyzerConfig, type ReleaseType } from './release-analysis.ts';

// An HTML comment, so it is not shown on the page, but the workflow can find the comment it posted by it.
export const MARKER = '<!-- release-preview -->';

const VERSION = /^(v?)(\d+)\.(\d+)\.(\d+)$/;

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
  return [MARKER, `**Release preview:** merging this pull request will ${outcome}.`].join('\n');
}

// The squash commit has the pull request title as its message, so the title is the only commit to analyze.
if (import.meta.main) {
  const type = await releaseTypeOf([process.env.TITLE ?? ''], repoAnalyzerConfig());
  console.log(comment(type, process.env.LATEST_TAG || undefined));
}
