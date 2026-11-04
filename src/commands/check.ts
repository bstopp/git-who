import { simpleGit } from 'simple-git';
import type { Profile } from '../profile.ts';
import log from '../utils/log.ts';
import type { ProfileMismatches } from '../utils/display.ts';
import { loadProfiles } from '../utils/profiles.ts';
import { resolveFromGit } from '../utils/repo-profile.ts';

const NOT_SET = '(not set)';

const quote = (value?: string) => value === undefined ? NOT_SET : `'${value}'`;

/**
 * One line per setting that differs: what the profile expects and what git has. A profile without a signing key
 * expects the signing settings to be unset.
 */
function describeMismatches(profile: Profile, mismatches: ProfileMismatches): string[] {
  const settings: [keyof ProfileMismatches, string, string | undefined][] = [
    ['username', 'user.name', profile.username],
    ['email', 'user.email', profile.email],
    ['signingKey', 'user.signingKey', profile.signingKey],
    ['signingMethod', 'commit signing', profile.signingMethod],
  ];
  return settings
    .filter(([field]) => field in mismatches)
    .map(([field, label, expected]) => `  ${label}: expected ${quote(expected)}, found ${quote(mismatches[field])}`);
}

/**
 * Check that the current repo's git config matches its profile, for use in a pre-commit hook. A passing check prints
 * nothing, so a hook adds no noise to a commit, unless `json` is set, which prints the profile that matched.
 *
 * @throws {Error} If the current directory is not a git repo, no profile can be resolved for it, or the git config
 * differs from the profile. The message of the last names each setting that differs.
 */
export default async function check(options: { json?: boolean } = {}): Promise<void> {
  if (!await simpleGit().checkIsRepo()) {
    throw new Error('The current directory must have a git repository to check a profile.');
  }
  const { profile, derived, mismatches } = await resolveFromGit(await loadProfiles());
  if (mismatches && Object.keys(mismatches).length > 0) {
    const lines = describeMismatches(profile, mismatches);
    throw new Error([`Git config does not match profile '${profile.name}':`, ...lines].join('\n'));
  }
  if (options.json) {
    log.json({ profile, derived });
  }
}
