import chalk from 'chalk';
import confirm from '@inquirer/confirm';
import { makeTheme } from '@inquirer/core';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { Profile } from '../profile.ts';
import log from '../utils/log.ts';
import { selectProfile } from '../utils/prompts.ts';
import { applyProfile, loadProfiles, verifySigningKey } from '../utils/profiles.ts';
import { parseSshUrl } from '../utils/git-url.ts';

const HTTPS_URL_PATTERN = /^https?:\/\/[^/]+\/(.+)$/;

function extractRepoPath(url: string) {
  return parseSshUrl(url)?.path ?? url.match(HTTPS_URL_PATTERN)?.[1];
}

type OriginMismatch = { current: string; expected: string };

/**
 * Find where the origin remote differs from the url the profile's ssh host would give it, `git@<host>:<path>`.
 *
 * @returns The current and expected urls, or `undefined` when there is no origin or it already matches.
 * @throws {Error} If the origin is neither an ssh nor an http(s) url, so its repo path cannot be determined.
 */
async function checkOrigin(git: SimpleGit, profile: Profile): Promise<OriginMismatch | undefined> {
  const { value: current } = await git.getConfig('remote.origin.url', 'local');
  if (!current) {
    return undefined;
  }
  const path = extractRepoPath(current);
  if (!path) {
    throw new Error(`Unable to determine the repo path from origin remote '${current}'.`);
  }
  const expected = `git@${profile.host}:${path}`;
  return expected === current ? undefined : { current, expected };
}

function confirmOriginUpdate(profile: Profile, { current, expected }: OriginMismatch): Promise<boolean> {
  const { style } = makeTheme();
  return confirm({
    message: `Origin remote is ${style.highlight(current)}, but profile '${profile.name}' expects ${style.highlight(expected)}. Update origin to match?`,
    default: true,
  });
}

/**
 * Look a profile up by name without falling back to a prompt, for output that nobody is there to answer.
 */
function findProfile(profiles: Profile[], name?: string): Profile {
  if (!name) {
    throw new Error('A profile name is required with --json.');
  }
  const profile = profiles.find((p) => p.name === name);
  if (!profile) {
    throw new Error(`Profile ${name} not found.`);
  }
  return profile;
}

/**
 * Apply a profile to the current repo, either the one given by name or one picked from a prompt. A mismatched origin is
 * rewritten when `updateOrigin` is set, otherwise the user is asked, except with `json`, which never prompts: it needs
 * a name and leaves the origin alone unless `updateOrigin` is set.
 *
 * @throws {Error} If the current directory is not a git repo, `json` has no name or the name is unknown, the profile's
 * signing key is missing or cannot be looked up, the origin remote url cannot be parsed, or applying the profile fails.
 * The signing key is checked first and its failure is thrown as is, because nothing has been written by then. A failure
 * to apply is wrapped with its `cause`, since the git config may be left partly updated.
 */
export default async function use(
  name?: string,
  options: { json?: boolean; updateOrigin?: boolean } = {},
): Promise<void> {
  const git = simpleGit();
  if (!await git.checkIsRepo()) {
    throw new Error('The current directory must have a git repository to use a profile.');
  }
  const profiles = await loadProfiles();
  const profile = options.json ? findProfile(profiles, name) : await selectProfile(profiles, name);
  await verifySigningKey(profile);
  const origin = await checkOrigin(git, profile);
  const updateOrigin = origin !== undefined
    && (options.updateOrigin || (!options.json && await confirmOriginUpdate(profile, origin)));
  try {
    await applyProfile(git, profile, updateOrigin ? origin.expected : undefined);
  } catch (error) {
    throw new Error(`Failed to apply profile '${profile.name}'. Git config may be partly updated; re-run to retry.`, { cause: error });
  }
  if (options.json) {
    log.json({ profile, originUpdated: updateOrigin, origin });
  } else {
    log.info(`Now using profile '${chalk.bold(profile.name)}'.`);
  }
}
