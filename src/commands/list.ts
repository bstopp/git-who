import chalk from 'chalk';
import { simpleGit } from 'simple-git';
import log from '../utils/log.ts';
import { loadProfiles, getActiveProfileName } from '../utils/profiles.ts';

export default async function list(options: { json?: boolean } = {}) {
  const profiles = await loadProfiles();
  const activeName = await getActiveProfileName(simpleGit());
  if (options.json) {
    log.json(profiles.map((p) => ({ ...p, active: p.name === activeName })));
    return;
  }
  const lines = profiles.map((p) => {
    if (p.name === activeName) {
      return chalk.bold(`  - ${p.name} (${p.host})`);
    }
    return `  - ${p.name} (${p.host})`;
  });
  lines.unshift('Known profiles:');
  log.info(lines.join('\n'));
}
