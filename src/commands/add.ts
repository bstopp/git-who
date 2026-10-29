import chalk from 'chalk';
import confirm from '@inquirer/confirm';
import log from '../utils/log.ts';
import { addProfile } from '../utils/profiles.ts';
import { promptForProfile } from '../utils/prompts.ts';
import { printProfile } from '../utils/display.ts';

export default async function add() {
  const profile = await promptForProfile();
  printProfile(profile);
  if (await confirm({ message: 'Save this profile?', default: true })) {
    await addProfile(profile);
    log.info(`Profile ${chalk.bold(profile.name)} added.`);
  } else {
    log.warn('Profile not added.');
  }
}
