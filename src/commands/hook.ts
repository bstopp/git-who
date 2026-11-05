import { simpleGit, type SimpleGit } from 'simple-git';
import log from '../utils/log.ts';

const EVENT = 'pre-commit';
const HOOK_NAME = 'git-who';
const COMMAND = 'git who check';
const COMMAND_KEY = `hook.${HOOK_NAME}.command`;
const EVENT_KEY = `hook.${HOOK_NAME}.event`;

/**
 * Whether git will run the hook for the event. A git that has no config hooks does not list it, and silently never
 * runs it, so the install is only trusted once git says it sees the hook. `git hook list` also fails when nothing is
 * listed, so a failure reads as not listed.
 */
async function isListed(git: SimpleGit): Promise<boolean> {
  try {
    const output = await git.raw(['hook', 'list', EVENT]);
    return output.split('\n').some((line) => line.trim() === HOOK_NAME);
  } catch {
    return false;
  }
}

async function removeConfig(git: SimpleGit) {
  await git.raw(['config', '--local', '--unset', COMMAND_KEY]);
  await git.raw(['config', '--local', '--unset-all', EVENT_KEY]);
}

/**
 * Make the current repo run `git who check` before each commit, using git's config hooks, so any `pre-commit` hook
 * file the repo already has (such as husky's) keeps running too. Installing again is harmless.
 *
 * @throws {Error} If the current directory is not a git repo, or git does not list the hook once it is set, which
 * means it is too old to run config hooks. The config is put back in that case.
 * @param baseDir - The directory of the repo to install it in, instead of the current directory.
 */
export async function install(baseDir?: string): Promise<void> {
  const git = simpleGit(baseDir);
  if (!await git.checkIsRepo()) {
    throw new Error('The current directory must have a git repository to install the hook.');
  }
  await git.addConfig(COMMAND_KEY, COMMAND, false, 'local');
  await git.addConfig(EVENT_KEY, EVENT, false, 'local');
  if (!await isListed(git)) {
    await removeConfig(git);
    throw new Error('Git did not list the hook once it was installed, so it may be too old to run config hooks (hook.<name>.*). The hook was not installed.');
  }
  log.info(`Installed the ${EVENT} hook. Commits in this repo now run \`${COMMAND}\`.`);
}

/**
 * Take the hook that `install` set out of the current repo's config. A `pre-commit` hook file is never touched.
 *
 * @throws {Error} If the current directory is not a git repo.
 */
export async function uninstall(): Promise<void> {
  const git = simpleGit();
  if (!await git.checkIsRepo()) {
    throw new Error('The current directory must have a git repository to uninstall the hook.');
  }
  const { value } = await git.getConfig(COMMAND_KEY, 'local');
  if (!value) {
    log.info(`The ${EVENT} hook is not installed.`);
    return;
  }
  await removeConfig(git);
  log.info(`Removed the ${EVENT} hook.`);
}
