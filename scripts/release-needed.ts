import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { releaseTypeOf, repoAnalyzerConfig } from './release-analysis.ts';

/**
 * The commit messages in the output of `git log --format=%B%x00`, which ends each message with a NUL so that a message
 * with a body, and so blank lines, stays in one piece.
 */
export function parseLog(log: string): string[] {
  return log.split('\0').map((message) => message.trim()).filter(Boolean);
}

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });

/**
 * The highest version tag in the history of the commit, which is what semantic-release releases after.
 */
function lastTag(sha: string): string | undefined {
  return git('tag', '--merged', sha, '--sort=-version:refname', '--list', 'v*').split('\n')[0] || undefined;
}

// Every commit since the last release counts, not just the latest, so a releasing commit that was skipped earlier is still
// released by a later merge that does not release anything itself.
if (import.meta.main) {
  const sha = process.env.SHA ?? 'HEAD';
  const tag = lastTag(sha);
  const messages = parseLog(git('log', '--format=%B%x00', tag ? `${tag}..${sha}` : sha));
  const type = await releaseTypeOf(messages, repoAnalyzerConfig());
  console.log(`${messages.length} commit(s) since ${tag ?? 'the start'}: ${type ? `a ${type} release is needed` : 'nothing to release'}.`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `release=${type !== null}\n`);
  }
}
