# Contributing

Thanks for your interest in `git-who`. Bug reports, ideas and pull requests are welcome.

## Getting set up

You need Node.js 24 or later, git and ssh (see [Requirements](README.md#requirements)).

```
npm install
```

You don't need to build to develop or run the tests. Node runs the TypeScript sources directly, using its built-in type
stripping. `npm run build` compiles to `dist/`, which is what gets published, so it is only needed to check the package.

## Checks

Run these before opening a pull request. All of them must pass.

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests. A 100% coverage threshold applies to `src/`. |
| `npm run test:e2e` | End-to-end test of the profile lifecycle. |
| `npm run lint` | ESLint, including the style rules and a complexity cap of 10. |
| `npm run typecheck` | TypeScript, with no emit. |
| `npm run build` | Compiles to `dist/`. CI also runs `node dist/bin/git-who.js --version` to check the build starts. |

## Writing tests

- **Add or change the test first.** New behavior and bug fixes come with a test.
- **Tests may not start a process.** `test/hooks.ts` replaces every `child_process` spawner with one that throws. If a
  test trips it, mock the dependency that spawns (git, ssh, gpg) rather than working around the guard.
- **Mock with `esmock`** in the unit tests. Mocking is strict, so mocking an export that does not exist fails.
- **Derive expected values from the fixtures** in `test/fixtures.ts` or from the mock's own variable. Don't retype them
  as literals in the assertion.
- **The end-to-end test runs in its own process** (`npm run test:e2e`), because it uses Node's `mock.module`, which can
  only replace modules that nothing else has loaded. Don't import anything from `src/` statically in it.

## Code style

- Match the surrounding code: naming, comment density and idiom.
- ESLint is the style reference. `npm run lint` tells you what it wants.
- Don't add a custom `Error` subclass unless a caller needs `instanceof` to decide what to do. A plain `Error` with a
  clear message is the default.
- When one error wraps another, pass the original as `cause`. The CLI prints the whole `Caused by:` chain.
- Comments explain why, and JSDoc documents what a function throws.

## Commits and pull requests

Pull requests are squash merged, so the pull request title becomes the commit on `main`. Releases are made automatically
from those titles, so the title must follow the [Conventional Commits](https://www.conventionalcommits.org) format:

```
type(optional scope): description
```

| Type | Effect on release |
| --- | --- |
| `feat` | New minor version |
| `fix`, `perf` | New patch version |
| `docs`, `chore`, `ci`, `test`, `refactor`, `build`, `style`, `revert` | No release |

Add `!` after the type, for example `feat!: rename the config file`, for a change that breaks existing users. That makes
a new major version. A check on every pull request fails if the title does not match.

- Keep pull requests small and focused, with a short imperative description: `fix: warn when a renamed profile leaves
  repos using the old name`.
- Describe what changed and why in the pull request, and note anything you could not test.
- The messages of the individual commits inside a pull request don't affect releases, only the title does.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE), the same as the
project.
