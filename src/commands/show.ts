import { simpleGit } from 'simple-git';
import { Profile, SIGNING_METHOD } from '../profile.ts';
import log from '../utils/log.ts';
import { printProfile, type ProfileMismatches, type SigningKeyStatus } from '../utils/display.ts';
import { loadProfiles, getActiveProfileName } from '../utils/profiles.ts';
import { listSshKeys } from '../utils/ssh.ts';
import { listGpgKeys } from '../utils/gpg.ts';

type ResolvedInfo = {
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
async function resolveFromGit(profiles: Profile[]): Promise<ResolvedInfo> {
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

async function buildStatus(resolved: ResolvedInfo): Promise<SigningKeyStatus | undefined> {
  let signingKeyStatus;

  if (resolved.profile.signingMethod === SIGNING_METHOD.SSH) {
    const keys = await listSshKeys();
    if (resolved.profile.signingKey && !keys.includes(resolved.profile.signingKey)) {
      signingKeyStatus = {
        found: false,
      };
    } else {
      signingKeyStatus = {
        found: true,
      };
    }
  } else if (resolved.profile.signingMethod === SIGNING_METHOD.GPG) {
    const gpgKeys = await listGpgKeys(resolved.profile.signingKey);
    if (gpgKeys.length > 0) {
      signingKeyStatus = {
        found: true,
        uids: gpgKeys[0].uids,
      };
    } else {
      signingKeyStatus = { found: false };
    }
  }
  return signingKeyStatus;
}

async function resolveProfile(name: string | undefined, profiles: Profile[]): Promise<ResolvedInfo> {
  if (name) {
    const profile = profiles.find((p) => p.name === name);
    if (!profile) {
      throw new Error(`Profile ${name} not found.`);
    }
    return {
      profile,
      derived: false,
    };
  } else {
    return await resolveFromGit(profiles);
  }
}

/**
 * Print a profile, either the one given by name or the one resolved from the current repo. A profile resolved from the
 * repo is also checked against its git config, and any signing key is looked up to confirm it exists.
 *
 * @throws {Error} If no name is given outside a git repo, the named profile does not exist, or no profile can be
 * resolved from the repo. Errors from the ssh and gpg key lookups are not caught.
 */
export default async function show(name?: string): Promise<void> {
  const git = simpleGit();
  if (!name && !(await git.checkIsRepo())) {
    throw new Error('You must provide a profile name, or invoke the show command from a git repo.');
  }

  const profiles = await loadProfiles();
  const resolved = await resolveProfile(name, profiles);

  const signingKeyStatus = await buildStatus(resolved);

  let opts: {
    signingKeyStatus?: SigningKeyStatus;
    mismatches?: ProfileMismatches;
  } | undefined = undefined;
  if (resolved.mismatches && Object.keys(resolved.mismatches).length > 0) {
    opts ||= {};
    opts.mismatches = resolved.mismatches;
  }
  if (signingKeyStatus) {
    opts ||= {};
    opts.signingKeyStatus = signingKeyStatus;
  }
  printProfile(resolved.profile, opts);
  if (resolved.derived) {
    log.warn(`Profile derived from git config — not explicitly set via gitwho.profile`);
  }
}
