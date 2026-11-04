import type { Command } from 'commander';
import log from '../utils/log.ts';
import { loadProfiles } from '../utils/profiles.ts';
import { complete as candidatesFor } from '../utils/completion.ts';

/**
 * The profile names, or none when the config is missing or cannot be read. A completion runs in the middle of typing a
 * command, so a broken config only costs the profile names, and never prints an error into the prompt.
 */
async function profileNames(): Promise<string[]> {
  try {
    return (await loadProfiles()).map((p) => p.name);
  } catch {
    return [];
  }
}

/**
 * Print the completions for `words`, which are the arguments after `git who` ending with the word being typed, one per
 * line. This is the hidden command that the shell completion scripts call. It prints nothing when there is nothing to
 * offer, and it does not fail.
 */
export default async function complete(words: string[], _options: unknown, command: Command): Promise<void> {
  const candidates = candidatesFor(command.parent!, words, await profileNames());
  if (candidates.length > 0) {
    log.raw(candidates.join('\n'));
  }
}
