import chalk from 'chalk';
import confirm from '@inquirer/confirm';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { Profile } from '../profile.ts';
import log from '../utils/log.ts';
import { loadProfiles, removeProfile, getActiveProfileName } from '../utils/profiles.ts';
import { selectProfile } from '../utils/prompts.ts';
import { printProfile } from '../utils/display.ts';

async function confirmContinue(profile: Profile): Promise<boolean> {
  return confirm({
    message: `Profile '${profile.name}' is the active profile. Continue?`,
    theme: { style: { message: (text: string) => chalk.yellow(text) } },
    default: false,
  });
}

async function confirmRemove(profile: Profile): Promise<boolean> {
  return confirm({
    message: `Remove profile '${profile.name}'?`,
    theme: { style: { message: (text: string) => chalk.red(text) } },
    default: false,
  });
}

async function unsetActive(git: SimpleGit) {
  try {
    await git.raw(['config', '--local', '--unset', 'gitwho.profile']);
  } catch {
    log.warn("Unable to unset 'gitwho.profile' git config value.");
  }
}

/**
 * Remove a profile, either the one given by name or one picked from a prompt. The profile is printed and the removal
 * must be confirmed. Removing the profile that is active in the current repo needs an extra confirmation, and unsets
 * `gitwho.profile` afterwards; a failure to unset it only warns.
 *
 * @throws {Error} If the profiles cannot be loaded or the profile cannot be removed.
 */
export default async function remove(name?: string): Promise<void> {
  const git = simpleGit();
  const profiles = await loadProfiles();
  const selected = await selectProfile(profiles, name);
  const isActive = await getActiveProfileName(git) === selected.name;

  if (isActive && !await confirmContinue(selected)) {
    log.warn(`Profile '${selected.name}' not removed, as it is currently active.`);
    return;
  }
  printProfile(selected);
  if (await confirmRemove(selected)) {
    await removeProfile(selected.name);
    if (isActive) {
      await unsetActive(git);
    }
    log.info(`Profile '${selected.name}' has been removed.`);
  } else {
    log.warn(`Profile '${selected.name}' not removed.`);
  }
}
