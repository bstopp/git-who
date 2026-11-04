import { simpleGit } from 'simple-git';
import { type Profile, SIGNING_METHOD } from '../profile.ts';
import log from '../utils/log.ts';
import { printProfile, type ProfileMismatches, type SigningKeyStatus } from '../utils/display.ts';
import { loadProfiles } from '../utils/profiles.ts';
import { resolveFromGit, type ResolvedInfo } from '../utils/repo-profile.ts';
import { listSshKeys } from '../utils/ssh.ts';
import { listGpgKeys } from '../utils/gpg.ts';

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
 * The result as a plain object for `--json`. The warnings that are printed as text become fields, so nothing is lost
 * from stdout. A mismatched field git has no value for is `null`, which JSON would otherwise drop from the object.
 */
function toJson(resolved: ResolvedInfo, signingKeyStatus?: SigningKeyStatus) {
  const { profile, derived, mismatches } = resolved;
  return {
    profile,
    derived,
    signingKeyStatus,
    mismatches: mismatches && Object.fromEntries(Object.entries(mismatches).map(([field, value]) => [field, value ?? null])),
  };
}

/**
 * The extras for `printProfile`, or `undefined` when there are none, so a plain profile is printed without them.
 */
function displayOptions(resolved: ResolvedInfo, signingKeyStatus?: SigningKeyStatus) {
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
  return opts;
}

/**
 * Print a profile, either the one given by name or the one resolved from the current repo. A profile resolved from the
 * repo is also checked against its git config, and any signing key is looked up to confirm it exists. With `json` the
 * result is printed as JSON instead.
 *
 * @throws {Error} If no name is given outside a git repo, the named profile does not exist, or no profile can be
 * resolved from the repo. Errors from the ssh and gpg key lookups are not caught.
 */
export default async function show(name?: string, options: { json?: boolean } = {}): Promise<void> {
  const git = simpleGit();
  if (!name && !(await git.checkIsRepo())) {
    throw new Error('You must provide a profile name, or invoke the show command from a git repo.');
  }

  const profiles = await loadProfiles();
  const resolved = await resolveProfile(name, profiles);

  const signingKeyStatus = await buildStatus(resolved);

  if (options.json) {
    log.json(toJson(resolved, signingKeyStatus));
    return;
  }

  printProfile(resolved.profile, displayOptions(resolved, signingKeyStatus));
  if (resolved.derived) {
    log.warn(`Profile derived from git config — not explicitly set via gitwho.profile`);
  }
}
