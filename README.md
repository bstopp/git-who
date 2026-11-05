# git-who

[![CI](https://github.com/bstopp/git-who/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bstopp/git-who/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@bstopp/git-who)](https://www.npmjs.com/package/@bstopp/git-who)
[![License](https://img.shields.io/npm/l/@bstopp/git-who)](LICENSE)
[![Node](https://img.shields.io/node/v/@bstopp/git-who)](https://nodejs.org)

Manage git profiles for per-project SSH account configuration.

If you use more than one git account (work, personal, a client), `git who` keeps each one as a named **profile** and
applies it to a repo in one step: the SSH host, `user.name`, `user.email`, and commit signing. No more commits under the
wrong email.

```
$ git who use work
Now using profile 'work'.
```

## Requirements

- **macOS or Linux.** Windows works through WSL. Native Windows is untested.
- **Node.js 24 or later**
- **git**
- **ssh**: required. Profiles point at host aliases from your `~/.ssh/config`, and `git who` resolves them with `ssh -G`.
- **gpg**: optional. Only needed if a profile signs commits with GPG.

## Installation

```
npm install --global @bstopp/git-who
```

This puts a `git-who` executable on your `PATH`. Git runs any `git-<name>` executable on your `PATH` as `git <name>`,
so the tool is then available as `git who`.

## Quick start

1. Make sure each account has a host alias in `~/.ssh/config`:

   ```
   Host github-work
       HostName github.com
       User git
       IdentityFile ~/.ssh/id_work

   Host github-personal
       HostName github.com
       User git
       IdentityFile ~/.ssh/id_personal
   ```

2. Create a profile for each account. You are prompted for everything:

   ```
   git who add
   ```

3. Use a profile in a repo, or clone with one:

   ```
   cd ~/code/some-work-repo
   git who use work

   git who clone my-org/my-repo work
   ```

## Commands

Any command that takes `[name]` prompts you to pick a profile when the name is left out. If the name you give doesn't
exist, you get a warning and the same prompt.

| Command | What it does |
| --- | --- |
| `git who add` | Create a profile interactively. Shows it for review and asks before saving. |
| `git who list` | List all profiles with their SSH hosts. The profile active in the current repo is in bold. |
| `git who show [name]` | Show a profile. With no name, show the profile for the current repo. |
| `git who use [name]` | Apply a profile to the current repo. |
| `git who check` | Fail if the current repo's git config doesn't match its profile. |
| `git who hook install` | Run `check` before every commit in the current repo. See [Pre-commit hook](#pre-commit-hook). |
| `git who hook uninstall` | Stop running `check` before commits in the current repo. |
| `git who clone <repo> [name]` | Clone a repo using a profile, then apply the profile to the clone. |
| `git who edit [name]` | Edit a profile. The prompts are pre-filled with the current values. |
| `git who remove [name]` | Remove a profile, after confirmation. |
| `git who completion <shell>` | Print the tab completion script for `zsh` or `bash`. See [Shell completion](#shell-completion). |

Run `git who --help` for usage and `git who --version` for the version.

`list`, `show`, `use` and `check` also take `--json`, for scripts and AI agents. See [JSON output](#json-output).

### `add`

Prompts for, in order:

1. **Profile name**: letters, numbers, dash, dot, or underscore. Must be unique.
2. **SSH host**: chosen from the aliases in your `~/.ssh/config`.
3. **Sign commits?**: SSH, GPG, or no.
   - **SSH**: pick one of the public keys (`*.pub`) in `~/.ssh`.
   - **GPG**: pick a secret key, and then an identity on that key. If the key has only one identity it is used
     directly. The identity's name and email become the defaults for the next two prompts.
4. **Git `user.name`** and **`user.email`**.

### `check`

Checks the current repo's git config against its profile (the one named by `gitwho.profile`, or the one matching
`user.name` and `user.email`) and exits non-zero if they differ. It compares `user.name`, `user.email`, `user.signingKey`
and whether commits are signed, and the error names each setting that differs. It prints nothing when the repo matches,
and never prompts.

To stop a commit made under the wrong identity, run it before every commit with a
[pre-commit hook](#pre-commit-hook). A repo with no profile, or whose identity matches none, fails the check too.

### Pre-commit hook

`git who hook install` makes git run `git who check` before every commit in the current repo, and a commit under the
wrong identity is refused with the settings that differ. `git who hook uninstall` takes it out again. Both only touch the
repo's local git config.

It uses git's config hooks (`hook.git-who.command` and `hook.git-who.event`), not a file in `.git/hooks`, so it runs
alongside any `pre-commit` hook the repo already has and never overwrites it. It needs a git recent enough to have them.
After installing, `git who` checks that `git hook list pre-commit` shows the hook, and if it doesn't it removes the
config again and tells you, rather than leaving a hook that never runs.

To do the same by hand:

```
git config --local hook.git-who.command 'git who check'
git config --local hook.git-who.event pre-commit
```

If you use [husky](https://typicode.github.io/husky), the hook above works with it as is. Or put the command in husky's
own hook instead, by adding this line to `.husky/pre-commit`:

```
git who check
```

`git commit --no-verify` skips the hook, because git skips `pre-commit` hooks with it. The hook is a guard against
forgetting to switch profiles, not something that enforces it. It also fails the commit if `git who` isn't on the
`PATH`, such as after uninstalling the tool without running `git who hook uninstall`.

### `use`

Applies a profile to the current repo by writing to its **local** git config:

| Config key | Value |
| --- | --- |
| `gitwho.profile` | The profile name. This is how `git who` knows which profile a repo uses. |
| `user.name`, `user.email` | From the profile. |
| `user.signingKey`, `commit.gpgsign` | Set when the profile signs commits, otherwise removed. |
| `gpg.format` | `ssh` for SSH signing, removed otherwise. |

Notes:

- It must be run inside a git repo.
- If the repo's `origin` doesn't use the profile's SSH host, you are asked whether to rewrite it to
  `git@<host>:<org>/<repo>`. This works whether the current origin is an SSH or an `http(s)` URL. If there is no origin,
  nothing is changed.
- The profile's signing key is checked first. If it can't be found, or can't be looked up (for example, `gpg` isn't
  installed), the command fails **before** anything is written.
- Any failure while writing the config may leave it partly updated. Run the command again to retry.

### `clone`

```
git who clone <repo> [name]
```

`<repo>` can be:

- an `org/repo` shorthand, for example `my-org/my-repo`
- an SSH URL: `git@host:org/repo.git` or `ssh://git@host/org/repo.git`

Whatever host the URL has is **replaced with the profile's host**, so a URL copied from GitHub works with any profile.
`http(s)` URLs are not supported. The repo is cloned into a directory named after it, in the current directory, and the
profile is applied to the clone.

The profile's signing key is checked **before** cloning, so a missing key fails without cloning anything. If the clone
succeeds but writing the profile to its git config then fails, the repo is left cloned. The error tells you to run
`git who use <name>` inside it.

### `show`

```
$ git who show work
Profile:      work
Host:         github-work
Name:         Bryan Work
Email:        bryan@work.com
Sign Commits: Using ssh
Signing Key:  /Users/bryan/.ssh/id_work.pub
```

With a name, it shows that profile. With no name, it works out the profile for the current repo:

1. The profile named by the repo's `gitwho.profile`.
2. Otherwise, the single profile whose `user.name` and `user.email` match the repo's git config. This is flagged as *derived*, with a
   warning that it isn't explicitly set via `gitwho.profile`. Run `git who use` to set it.

When showing the current repo's profile, any value in the repo's git config that differs from the profile is marked with
`*` and listed in a warning, so you can see that a repo has drifted. A signing key that can't be found is marked
`(not found)`.

### `edit`

Pre-fills every prompt with the profile's current values. If you change nothing, you are offered another pass. Otherwise
the changes are shown next to the original values (`(was: …)`) and you confirm before saving.

Editing a profile does **not** update the repos that already use it. Their git config keeps the old values, and `show`
marks the differences. Run `git who use` in a repo to refresh it.

> **Renaming a profile:** the name is what links a repo to its profile. After a rename, repos still using the old name
> need `git who use <new-name>` to pick up the new one. `edit` reminds you when you rename a profile.

### `remove`

Shows the profile and asks for confirmation. If the profile is the active one in the current repo, you are asked a second
time and its `gitwho.profile` is cleared from that repo afterwards. Other repos that still name the removed profile are
not touched.

## Shell completion

`git who <TAB>` can complete commands, flags and profile names, in zsh and bash. Add one line to your shell's startup
file:

```sh
# ~/.zshrc, after compinit
eval "$(git who completion zsh)"

# ~/.bashrc, after git's own completion is loaded
eval "$(git who completion bash)"
```

It works through git's own completion, which has to be loaded for `git who` to complete. In zsh that is `compinit`, with
git's completion on your `fpath` (a Homebrew git puts it there). In bash it is the `git-completion.bash` that comes with
git. Profile names are read from `~/.git-who.cfg.json` each time you press tab, so a new profile completes straight away.
If that file is missing or can't be read, only the profile names are left out.

It is tested in zsh with Homebrew's git. Other setups, such as bash or a zsh without git's wrapper, follow git's
documented conventions but haven't been tried by hand, so they may not complete yet. If one doesn't, an
[issue](https://github.com/bstopp/git-who/issues) with your shell, its version and how git's completion is installed
helps.

## JSON output

`list`, `show`, `use` and `check` take `--json`, which prints the result as JSON on stdout so a script or an AI agent can read it.
With `--json` nothing is printed except the JSON: no blank lines, no colors, and no warnings on stderr. What a warning
would have said is a field in the output instead.

`add`, `edit` and `remove` are interactive and do not take `--json`.

| Command | Output |
| --- | --- |
| `git who list --json` | An array of profiles. Each has the profile's fields and `active`, true for the profile in use in the current repo. |
| `git who show [name] --json` | `{ profile, derived, signingKeyStatus, mismatches }` |
| `git who use <name> --json` | `{ profile, originUpdated, origin }` |
| `git who check --json` | `{ profile, derived }` when the repo matches its profile. A mismatch is an error, like any other failure. |

A field with no value is left out of the object. `signingMethod` and `signingKey` are absent for a profile that doesn't
sign.

```
$ git who show --json
{
  "profile": {
    "name": "work",
    "host": "github-work",
    "username": "Bryan Work",
    "email": "bryan@work.com",
    "signingMethod": "ssh",
    "signingKey": "/Users/bryan/.ssh/id_work.pub"
  },
  "derived": false,
  "signingKeyStatus": { "found": true },
  "mismatches": { "email": "bryan@personal.com" }
}
```

- **`derived`** is true when the profile was matched from the repo's `user.name` and `user.email`, not named by
  `gitwho.profile`.
- **`signingKeyStatus`** is only present for a profile that signs. `found` is false when the key isn't on this machine.
  For GPG, `uids` lists the identities on the key.
- **`mismatches`** is only present when the profile comes from the repo (`show` with no name). It lists the fields where
  the repo's git config differs from the profile, with the value git has. `null` means git has nothing set. An empty
  object means the repo matches the profile.

### `use --json`

`use --json` never prompts, so it needs a profile name and fails without one. The prompt for a mismatched `origin` is
replaced by a flag:

- Without `--update-origin`, `origin` is left alone. If it doesn't use the profile's SSH host, the output has
  `origin: { current, expected }` and `originUpdated` is false.
- With `--update-origin`, `origin` is rewritten to `expected` and `originUpdated` is true.

`--update-origin` also works without `--json`, where it answers yes to the prompt.

### Errors

With `--json`, a failure is printed as JSON on stdout and the exit code is still `1`:

```
{
  "error": "Failed to apply profile 'work'. Git config may be partly updated; re-run to retry.",
  "causes": ["addConfig failed"]
}
```

`causes` holds the messages of the wrapped errors, outermost first, and is empty when there are none.

### Agent skill

The package includes a skill that teaches an AI agent to use these commands: `skills/git-who/SKILL.md`, in the installed
package. Copy or link the `git-who` folder into your agent's skills directory (for Claude Code, `~/.claude/skills/`).

## Where profiles are stored

Profiles live in `~/.git-who.cfg.json`, as a JSON array. You can edit it by hand, but `git who` validates it on every
load and reports the position of any invalid entry.

```json
[
  {
    "name": "work",
    "host": "github-work",
    "username": "Bryan Work",
    "email": "bryan@work.com",
    "signingMethod": "ssh",
    "signingKey": "/Users/bryan/.ssh/id_work.pub"
  },
  {
    "name": "personal",
    "host": "github-personal",
    "username": "Bryan Personal",
    "email": "bryan@personal.com"
  }
]
```

`signingMethod` (`"ssh"` or `"gpg"`) and `signingKey` are either both present or both absent. For GPG, `signingKey` is
the key ID.

## Limitations

- **`Include` directives in `~/.ssh/config` are not followed.** Hosts defined in an included file won't appear in the
  host list.
- **Only SSH remotes.** `clone` rejects `http(s)` URLs, and `use` rewrites `origin` to an SSH URL.
- **Host aliases with wildcards or negation** (`*`, `?`, `!`) are skipped when listing hosts.
- **Signing keys are looked up on this machine.** SSH keys must be `*.pub` files in `~/.ssh`, and GPG keys must be in
  your local GPG keyring.

## Development

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests, with a 100% coverage threshold. |
| `npm run test:e2e` | End-to-end test of the profile lifecycle (add, list, show, edit, use, remove). |
| `npm run lint` | ESLint. |
| `npm run typecheck` | TypeScript, with no emit. |

Tests may not start a process. `test/hooks.ts` replaces every `child_process` spawner with one that throws, so a test
that forgets to mock a dependency such as git, ssh or gpg fails instead of running it.

The end-to-end test runs the real prompts and config file, with git, ssh, gpg and logging faked. It runs in its own
process because it uses Node's `mock.module`, which needs the `--experimental-test-module-mocks` flag (set by the
script) and can only replace modules that nothing else has loaded yet.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.

## Troubleshooting

Errors are printed to stderr and the exit code is `1`. When one error wraps another, each cause is printed underneath as
`Caused by: …`.

| Message | Meaning |
| --- | --- |
| `No profiles found. Use `git who add` to create one.` | `~/.git-who.cfg.json` doesn't exist or is empty. |
| `No SSH host aliases found in ~/.ssh/config.` | There are no usable `Host` entries, or the file doesn't exist. |
| `gpg is required but was not found on PATH.` | A GPG profile or GPG key lookup needs `gpg` installed. |
| `Config file has an invalid profile at position N` | Entry N of `~/.git-who.cfg.json` is malformed. The message, or the `Caused by:` line under it, says what's wrong. |
| `Active profile '…' not found — it may have been deleted.` | The repo's `gitwho.profile` names a profile that no longer exists (deleted or renamed). Run `git who use`. |

## License

Copyright 2026 Bryan Stopp. Licensed under the [Apache License, Version 2.0](LICENSE).