import chalk from 'chalk';
import confirm from '@inquirer/confirm';
import type { Profile } from '../profile.ts';
import log from '../utils/log.ts';
import { loadProfiles, updateProfile } from '../utils/profiles.ts';
import { promptForProfile, selectProfile } from '../utils/prompts.ts';
import { printProfile } from '../utils/display.ts';

/**
 * Edit a profile, either the one given by name or one picked from a prompt. The prompts are pre-filled with the current
 * values. If nothing changed the user is offered another pass; otherwise the changes are printed next to their original
 * values and must be confirmed before they are saved. Renaming a profile warns that repos still using the old name need
 * `git who use` to pick up the new one, as the name is what links a repo to its profile.
 *
 * @throws {Error} If the profiles cannot be loaded or the profile cannot be updated.
 */
export default async function edit(name?: string): Promise<void> {
  const profiles = await loadProfiles();
  const selected = await selectProfile(profiles, name);

  let updated: Profile;
  let changed: boolean;
  do {
    updated = await promptForProfile(selected);
    changed = JSON.stringify(selected) !== JSON.stringify(updated);
  } while (!changed && await confirm({ message: 'No changes detected. Return to edit?', default: true }));

  if (changed) {
    printProfile(updated, { original: selected });
    if (await confirm({ message: 'Save this profile?', default: true })) {
      await updateProfile(selected, updated);
      log.info(`Profile ${chalk.bold(updated.name)} updated.`);
      if (updated.name !== selected.name) {
        log.warn(`Profile renamed from '${selected.name}' to '${updated.name}'. Repos still using '${selected.name}' need \`git who use ${updated.name}\` to pick up the new name.`);
      }
      return;
    }
  }
  log.warn('Profile not updated.');
}
