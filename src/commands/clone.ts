import chalk from 'chalk';
import { simpleGit } from 'simple-git';
import { applyProfile, loadProfiles } from '../utils/profiles.ts';
import { selectProfile } from '../utils/prompts.ts';
import { parseSshUrl } from '../utils/git-url.ts';
import log from '../utils/log.ts';

const SHORTHAND_PATTERN = /^[^/@.][^/]*\/(?!\.{1,2}$)[^/]+$/;

/**
 * Build the url to clone, using the profile's ssh host, and the directory to clone it into. The directory is passed to
 * git explicitly so the profile is always applied to the directory that was cloned.
 *
 * @throws {Error} If the repo is neither an ssh url nor an `org/repo` shorthand, or has no repo name to clone into.
 */
function getCloneInfo(host: string, repo: string) {
  const rawPath = parseSshUrl(repo)?.path ?? (SHORTHAND_PATTERN.test(repo) ? repo : undefined);
  const path = rawPath?.replace(/\/+$/, '');
  const dir = path?.split('/').pop()!.replace(/\.git$/, '');
  if (!path || !dir) {
    throw new Error(`Unsupported repo format: ${repo}`);
  }
  return { url: `git@${host}:${path}`, dir };
}

/**
 * Clone a repo using a profile's ssh host, then apply the profile to the clone. The profile is the one given by name or
 * one picked from a prompt.
 *
 * @param repo - An ssh url (`git@host:org/repo.git` or `ssh://git@host/org/repo.git`) or an `org/repo` shorthand. The
 * host is always replaced with the profile's.
 * @throws {Error} If the repo format is not supported or the clone fails. A failure to apply the profile after a
 * successful clone is wrapped with its `cause`, as the repo is left cloned without the profile.
 */
export default async function clone(repo: string, name?: string): Promise<void> {
  const profiles = await loadProfiles();
  const profile = await selectProfile(profiles, name);
  const { url, dir } = getCloneInfo(profile.host, repo);
  await simpleGit().clone(url, dir);

  try {
    await applyProfile(simpleGit(dir), profile);
  } catch (error) {
    throw new Error(
      `Cloned '${dir}', but profile '${profile.name}' could not be applied. Run \`git who use ${profile.name}\` inside it to retry.`,
      { cause: error },
    );
  }
  log.info(`Cloned ${chalk.bold(url)} to ${dir} using profile ${chalk.bold(profile.name)}.`);
}
