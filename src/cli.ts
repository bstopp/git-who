import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import show from './commands/show.ts';
import list from './commands/list.ts';
import use from './commands/use.ts';
import add from './commands/add.ts';
import edit from './commands/edit.ts';
import remove from './commands/remove.ts';
import clone from './commands/clone.ts';
import log from './utils/log.ts';

export const program = new Command();

program
  .name('git who')
  .usage('[options] <command>')
  .description('Manage git profiles for per-project SSH account configuration')
  .version(pkg.version);

program
  .command('show [name]')
  .description('Show the current git profile for this repo')
  .action(show);

program
  .command('list')
  .description('List all available profiles')
  .action(list);

program
  .command('use [name]')
  .description('Set the profile for this repo.')
  .action(use);

program
  .command('add')
  .description('Add a new profile.')
  .action(add);

program
  .command('edit [name]')
  .description('Edit an existing profile.')
  .action(edit);

program
  .command('remove [name]')
  .description('Remove a profile.')
  .action(remove);

program
  .command('clone <repo> [name]')
  .description('Clone a remote repo using a specific profile.')
  .action(clone);
/**
 * Join an error's message with those of its `cause` chain, one per line, so wrapped failures show the real reason.
 */
function describeError(err: unknown): string {
  const lines: string[] = [];
  let current = err;
  while (current instanceof Error) {
    lines.push(lines.length === 0 ? current.message : `Caused by: ${current.message}`);
    current = current.cause;
  }
  return lines.length > 0 ? lines.join('\n') : String(err);
}

/**
 * Run the cli, printing any failure (with its cause chain) and setting a non-zero exit code.
 */
export async function run(argv: string[]): Promise<void> {
  try {
    await program.parseAsync(argv);
  } catch (err) {
    log.error(describeError(err));
    process.exitCode = 1;
  }
}
