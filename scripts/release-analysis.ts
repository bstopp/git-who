import { readFileSync } from 'node:fs';
import { analyzeCommits } from '@semantic-release/commit-analyzer';

export type ReleaseType = 'major' | 'minor' | 'patch';

const ANALYZER = '@semantic-release/commit-analyzer';

/**
 * The config that `.releaserc.json` gives the commit analyzer, so what is worked out here follows the release rules the
 * release itself uses. The analyzer is listed either by name or as `[name, config]`, and is empty config when not listed.
 */
export function analyzerConfig(releaserc: { plugins?: unknown[] }): object {
  const entry = (releaserc.plugins ?? []).find((plugin) => plugin === ANALYZER || (Array.isArray(plugin) && plugin[0] === ANALYZER));
  return Array.isArray(entry) ? entry[1] ?? {} : {};
}

/**
 * The analyzer config from `.releaserc.json` in the current directory.
 */
export function repoAnalyzerConfig(): object {
  return analyzerConfig(JSON.parse(readFileSync('.releaserc.json', 'utf8')));
}

/**
 * The highest release that these commit messages make, or null for no release, which is what semantic-release decides
 * from the same commits with the same analyzer.
 */
export async function releaseTypeOf(messages: string[], config: object = {}): Promise<ReleaseType | null> {
  const logger = { log: () => {} };
  const commits = messages.map((message) => ({ message }));
  return analyzeCommits(config, { commits, logger, cwd: process.cwd() });
}
