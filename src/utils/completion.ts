import type { Command } from 'commander';

// An argument with this name takes a profile name, so any command that declares one completes profiles for it.
const PROFILE_ARGUMENT = 'name';

export const SHELLS = ['zsh', 'bash'] as const;
export type Shell = (typeof SHELLS)[number];

// Each script is a shim: the words after `who`, the one being typed last, go to the hidden `__complete` command, which
// prints the candidates one per line. The `--` keeps a typed flag such as `--js` from being read as an option.
//
// Git's bash completion calls `_git_who` for `git who`, with `words` and `cword` set, and the candidates go back through
// its `__gitcomp_nl`. Git's zsh wrapper (installed as `_git` by Homebrew) sources that same script and calls the same
// function with the arrays 0-based, as in bash, and its own `__gitcomp_nl` that adds them with `compadd`, so one
// function serves both. The words are copied one by one because slicing an array differs between the two shells.
const GIT_FUNCTION = `_git_who() {
  local i
  local -a args
  for ((i = 2; i <= cword; i++)); do
    args+=("\${words[i]}")
  done
  __gitcomp_nl "$(git who __complete -- "\${args[@]}")"
}`;

// zsh's own `_git`, used when git's wrapper is not installed, calls `_git-who` instead, with 1-based arrays. It finds
// `who` in the words, as `_git` may have shifted them, and unquoted `(f)` splitting drops the empty line that no output
// leaves.
const ZSH_FUNCTION = `_git-who() {
  local -a candidates
  local who=\${words[(i)who]}
  candidates=( \${(f)"$(git who __complete -- "\${(@)words[who+1,CURRENT]}")"} )
  compadd -a candidates
}`;

const SCRIPTS: Record<Shell, string> = {
  zsh: `${GIT_FUNCTION}\n\n${ZSH_FUNCTION}`,
  bash: GIT_FUNCTION,
};

/**
 * The completion script for a shell, to be evaluated from its startup file (`eval "$(git who completion zsh)"`). It has
 * no trailing newline, since printing it adds one.
 */
export function script(shell: Shell): string {
  return SCRIPTS[shell];
}

/**
 * Follow the words that are already complete down the command tree. A word that starts with `-` is a flag, which none
 * of the commands give a value to, so it is skipped. A word that names a subcommand moves into it while no positional
 * argument has been given. Any other word is a positional argument of the command it is in.
 */
function locate(root: Command, completed: string[]) {
  let cmd = root;
  let positionals = 0;
  for (const word of completed) {
    const sub = positionals === 0 ? cmd.commands.find((c) => c.name() === word) : undefined;
    if (word.startsWith('-')) {
      continue;
    }
    if (sub) {
      cmd = sub;
    } else {
      positionals++;
    }
  }
  return { cmd, positionals };
}

/**
 * The completions for the last of `words`, which are the arguments after `git who` and end with the word being typed
 * (empty when nothing is typed yet). Subcommands and flags come from the command tree, so nothing has to be kept in
 * step with it, and hidden commands are left out.
 */
export function complete(root: Command, words: string[], profiles: string[]): string[] {
  const current = words.at(-1) ?? '';
  const { cmd, positionals } = locate(root, words.slice(0, -1));
  const help = cmd.createHelp();

  let candidates: string[] = [];
  if (current.startsWith('-')) {
    candidates = help.visibleOptions(cmd).flatMap((option) => option.long ?? []);
  } else if (positionals === 0 && cmd.commands.length > 0) {
    candidates = help.visibleCommands(cmd).map((sub) => sub.name());
  } else if (cmd.registeredArguments[positionals]?.name() === PROFILE_ARGUMENT) {
    candidates = profiles;
  }
  return candidates.filter((candidate) => candidate.startsWith(current));
}
