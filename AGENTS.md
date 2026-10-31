# Agent instructions

`git-who` is a TypeScript CLI that manages named git profiles. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full
conventions and [README.md](README.md) for what the tool does.

- **Write the test first**, and see it fail for the right reason before changing the code. New behavior and bug fixes
  come with a test. Coverage of `src/` must stay at 100%.
- **Run all four checks** before calling work done: `npm run lint`, `npm run typecheck`, `npm test` and
  `npm run test:e2e`.
- **Tests may not start a process.** `test/hooks.ts` makes every `child_process` spawner throw. Mock the dependency that
  spawns (git, ssh, gpg) instead of working around it.
- **The e2e test runs in its own process** because it uses `mock.module`. Don't import anything from `src/` statically
  in it.
- **Pull requests are squash merged and the PR title is the release.** It must be a conventional commit, such as
  `feat: …` or `fix: …`, with `!` after the type for a breaking change. `docs`, `chore`, `ci`, `test` and `refactor`
  don't release.
- **Match the surrounding code**: naming, comment density and idiom. ESLint is the style reference, including the
  complexity cap of 10 and the function length limit.
- **Don't add a custom `Error` subclass** unless a caller needs `instanceof`. When one error wraps another, pass the
  original as `cause`.
- **`list`, `show` and `use` take `--json`** for agents. `add`, `edit` and `remove` are interactive and must not. Don't
  make a command that prompts available through `--json` without removing the prompt.
- **Don't push or publish.** Releases are made by CI from `main`.
