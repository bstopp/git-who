import { simpleGit } from 'simple-git';
import { Profile, SIGNING_METHOD } from '../profile.ts';
import type { ProfileMismatches } from './display.ts';
import { getActiveProfileName } from './profiles.ts';

export type ResolvedInfo = {
  profile: Profile;
  derived: boolean;
  mismatches?: ProfileMismatches;
};

type GitData = {
  name?: string;
  username?: string;
  email?: string;
  signCommits?: string;
  signingKey?: string;
  signingMethod?: string;
};

/**
 * Compare a profile with the repo's local git config. A field is only present in the result when the two differ, and
 * its value is what git has (`undefined` when git has nothing set).
 *
 * Git's signing method is only defined when `commit.gpgsign` is `true`: `gpg.format` of `openpgp` (or unset) is gpg,
 * `ssh` is ssh. Any other format, such as x509, is not supported and reads as git not signing.
 */
function buildMismatches(actual: Profile, git: GitData): ProfileMismatches {
  const mismatches: ProfileMismatches = {};

  if (actual.username !== git.username) {
    mismatches.username = git.username;
  }
  if (actual.email !== git.email) {
    mismatches.email = git.email;
  }
  if (actual.signingKey !== git.signingKey) {
    mismatches.signingKey = git.signingKey;
  }

  let gitSigningMethod;
  if (git.signCommits === 'true') {
    if (!git.signingMethod || git.signingMethod === 'openpgp') {
      gitSigningMethod = SIGNING_METHOD.GPG;
    } else if (git.signingMethod === 'ssh') {
      gitSigningMethod = SIGNING_METHOD.SSH;
    }
  }
  if (actual.signingMethod !== gitSigningMethod) {
    mismatches.signingMethod = gitSigningMethod;
  }
  return mismatches;
}

async function readGitConfig(): Promise<GitData> {
  const git = simpleGit();
  const [
    name,
    { value: username },
    { value: email },
    { value: signCommits },
    { value: signingKey },
    { value: signingMethod },
  ] = await Promise.all([
    getActiveProfileName(git),
    git.getConfig('user.name', 'local'),
    git.getConfig('user.email', 'local'),
    git.getConfig('commit.gpgsign', 'local'),
    git.getConfig('user.signingKey', 'local'),
    git.getConfig('gpg.format', 'local'),
  ]);

  return {
    name,
    username: username ?? undefined,
    email: email ?? undefined,
    signCommits: signCommits ?? undefined,
    signingKey: signingKey ?? undefined,
    signingMethod: signingMethod ?? undefined,
  };
}

/**
 * Find the profile for the current repo: the one named by `gitwho.profile`, otherwise the single profile whose
 * username and email match the git config (flagged as derived).
 *
 * @throws {Error} If `gitwho.profile` names a missing profile and nothing else matches uniquely, if several profiles
 * match with no active profile set, or if no profile is set and none match. A missing active profile takes priority
 * over multiple matches, since it is the underlying cause.
 */
export async function resolveFromGit(profiles: Profile[]): Promise<ResolvedInfo> {
  const gitData = await readGitConfig();

  const profile = profiles.find((p) => p.name === gitData.name);
  if (profile) {
    const mismatches = buildMismatches(profile, gitData);
    return { profile, derived: false, mismatches };
  }
  const matches = profiles.filter((p) => p.username === gitData.username && p.email === gitData.email);
  if (matches.length === 1) {
    const mismatches = buildMismatches(matches[0], gitData);
    return { profile: matches[0], derived: true, mismatches };
  } else if (gitData.name) {
    throw new Error(`Active profile '${gitData.name}' not found — it may have been deleted.`);
  } else if (matches.length > 1) {
    throw new Error('Multiple profiles match the current git config — set one explicitly with `git who use <profile>`.');
  }

  throw new Error('No profile set and none found matching the current git config.');
}
