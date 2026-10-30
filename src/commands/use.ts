import chalk from 'chalk';
import confirm from '@inquirer/confirm';
import { makeTheme } from '@inquirer/core';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { Profile } from '../profile.ts';
import log from '../utils/log.ts';
import { selectProfile } from '../utils/prompts.ts';
import { applyProfile, loadProfiles, SigningKeyNotFoundError } from '../utils/profiles.ts';
import { parseSshUrl } from '../utils/git-url.ts';

const HTTPS_URL_PATTERN = /^https?:\/\/[^/]+\/(.+)$/;

function extractRepoPath(url: string) {
  return parseSshUrl(url)?.path ?? url.match(HTTPS_URL_PATTERN)?.[1];
}

/**
 * Work out the origin remote url to set, if any. When the origin does not use the profile's ssh host, the user is asked
 * whether to rewrite it to `git@<host>:<path>`.
 *
 * @returns The url to set, or `undefined` to leave the origin alone (no origin, already matching, or declined).
 * @throws {Error} If the origin is neither an ssh nor an http(s) url, so its repo path cannot be determined.
 */
async function resolveOriginUrl(git: SimpleGit, profile: Profile): Promise<string | undefined> {
  const { value: currentUrl } = await git.getConfig('remote.origin.url', 'local');
  if (!currentUrl) {
    return undefined;
  }
  const path = extractRepoPath(currentUrl);
  if (!path) {
    throw new Error(`Unable to determine the repo path from origin remote '${currentUrl}'.`);
  }
  const desiredUrl = `git@${profile.host}:${path}`;
  if (desiredUrl === currentUrl) {
    return undefined;
  }
  const { style } = makeTheme();
  const updateOrigin = await confirm({
    message: `Origin remote is ${style.highlight(currentUrl)}, but profile '${profile.name}' expects ${style.highlight(desiredUrl)}. Update origin to match?`,
    default: true,
  });
  return updateOrigin ? desiredUrl : undefined;
}

/**
 * Apply a profile to the current repo, either the one given by name or one picked from a prompt.
 *
 * @throws {Error} If the current directory is not a git repo, the origin remote url cannot be parsed, or applying the
 * profile fails. A failure other than a missing signing key is wrapped with its `cause`, since the git config may be
 * left partly updated; a missing signing key is thrown as is because nothing has been written by then.
 */
export default async function use(name?: string): Promise<void> {
  const git = simpleGit();
  if (!await git.checkIsRepo()) {
    throw new Error('The current directory must have a git repository to use a profile.');
  }
  const profiles = await loadProfiles();
  const profile = await selectProfile(profiles, name);
  const originUrl = await resolveOriginUrl(git, profile);
  try {
    await applyProfile(git, profile, originUrl);
  } catch (error) {
    if (error instanceof SigningKeyNotFoundError) {
      throw error;
    }
    throw new Error(`Failed to apply profile '${profile.name}'. Git config may be partly updated; re-run to retry.`, { cause: error });
  }
  log.info(`Now using profile '${chalk.bold(profile.name)}'.`);
}
