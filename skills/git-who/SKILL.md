---
name: git-who
description: Check or switch which git identity a repo uses (SSH host, user.name, user.email, commit signing) with the `git who` CLI. Use before committing or pushing in a repo that may belong to another account, when a commit went out under the wrong name or email, or when asked to use a named profile such as work or personal.
---

# git-who

`git who` keeps named **profiles**. A profile is an SSH host alias, a `user.name`, a `user.email` and optionally a
commit-signing key. Applying a profile to a repo writes those into the repo's local git config. Use it so that commits
and pushes in a repo go out under the right account.

Always pass `--json` and read stdout. Without it the commands print text meant for people, and some of them prompt.

## Commands you may run

| Command | Use it to |
| --- | --- |
| `git who list --json` | See which profiles exist and which one the current repo uses (`active`). |
| `git who show --json` | Check the current repo against its profile. |
| `git who show <name> --json` | Read one profile's details. |
| `git who use <name> --json` | Apply a profile to the current repo. |

Never run `git who add`, `edit` or `remove`. They are interactive and meant for the user. If a profile is missing or
wrong, tell the user and let them run those.

## Checking a repo

Run `git who show --json` in the repo.

```json
{
  "profile": { "name": "work", "host": "github-work", "username": "Bryan Work", "email": "bryan@work.com" },
  "derived": false,
  "signingKeyStatus": { "found": true },
  "mismatches": { "email": "bryan@personal.com" }
}
```

- `profile` is the profile the repo is set to use.
- `derived: true` means no profile is set on the repo, and this one was only matched by name and email. Apply it with
  `use` if it is the right one.
- `mismatches` lists the fields where the repo's git config differs from the profile, with the value git currently has.
  `null` means git has nothing set. `{}` means the repo is correct. If there are mismatches, the repo has drifted, and
  `use` fixes it.
- `signingKeyStatus.found: false` means the profile's signing key is not on this machine. Commits will not be signed as
  the profile expects. Tell the user, because you cannot fix that.
- `signingMethod` and `signingKey` are missing from `profile` when the profile does not sign.

## Switching a repo

1. Run `git who list --json` and pick the profile whose `name` matches what the user asked for. If you are unsure which
   one is meant, ask the user instead of guessing.
2. Run `git who use <name> --json`.

```json
{ "profile": { "name": "work", "...": "..." }, "originUpdated": false, "origin": { "current": "git@github-personal:org/repo.git", "expected": "git@github-work:org/repo.git" } }
```

`origin` is only present when the repo's `origin` remote does not use the profile's host. Pushes would go out under
the other account. `use` leaves `origin` alone by default (`originUpdated: false`).

- Do **not** add `--update-origin` on your own. It rewrites the remote. Say what `current` and `expected` are, and add
  the flag only if the user agrees or already asked for it.
- If the repo is correct afterwards, `git who show --json` shows `mismatches: {}`.

## Errors

A failure prints `{ "error": "...", "causes": ["..."] }` on stdout and exits with code 1. `causes` lists the wrapped
errors, outermost first.

| Error | What to do |
| --- | --- |
| `A profile name is required with --json.` | Pass a profile name to `use`. |
| `Profile <name> not found.` | Run `list` and use one of its names. If none fits, ask the user. |
| `The current directory must have a git repository to use a profile.` | Run it from inside the repo. |
| `No profiles found. ...` | Nothing is set up. The user has to run `git who add`. |
| `... key '...' not found for profile '...'` | The profile's signing key is missing. Tell the user. Do not work around it. |
| `Failed to apply profile ...` | The git config may be partly updated. Run `git who show --json` to see what is left, then retry `use`. |

## Rules

- Check with `show` before you commit or push in a repo where the identity matters, and fix it with `use` if it has
  drifted.
- Do not edit `user.name`, `user.email` or the signing settings with `git config` to get around a `git who` error.
  Report the error instead.
- Do not edit `~/.git-who.cfg.json` or the `gitwho.profile` setting by hand.
