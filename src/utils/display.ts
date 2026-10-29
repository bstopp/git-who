import chalk from 'chalk';
import log from './log.ts';
import { Profile } from '../profile.ts';

export const PROFILE_FIELDS = { USERNAME: 'username', EMAIL: 'email', SIGNING_KEY: 'signingKey', SIGNING_METHOD: 'signingMethod' } as const;
type ProfileField = (typeof PROFILE_FIELDS)[keyof typeof PROFILE_FIELDS];
export type ProfileMismatches = Partial<Record<ProfileField, string>>;
export type GpgUids = Array<{ name: string; email: string }>;
export type SigningKeyStatus = { found: boolean; uids?: GpgUids };

function formatSigningKey(keyId: string, uids: GpgUids) {
  if (uids.length === 1) {
    return `${keyId}, ${uids[0].name} (${uids[0].email})`;
  }
  return [keyId, ...uids.map((u) => `  ${u.name} (${u.email})`)].join('\n');
}

function buildSigningKey(signingKey: string, signingStatus?: SigningKeyStatus) {
  const keyText = signingStatus?.uids
    ? formatSigningKey(signingKey, signingStatus.uids)
    : signingKey;
  return signingStatus && !signingStatus.found
    ? chalk.yellow(`${keyText} (not found)`)
    : keyText;
}

const signingText = (method?: string) => method ? `Using ${method}` : 'No';
const specifiedOrNot = (key?: string) => key || 'Not Specified';

// Appends the original value of a field when it differs from the current one.
const wasSuffix = (
  oldVal: string | undefined,
  newVal: string | undefined,
  format: (value?: string) => string = (value) => `${value}`,
  separator = ' ',
) => oldVal === newVal ? '' : `${separator}(was: ${format(oldVal)})`;

export function printProfile(profile: Profile, opts?: { signingKeyStatus?: SigningKeyStatus; mismatches?: ProfileMismatches; original?: Profile }): void {
  const signingStatus = opts?.signingKeyStatus;
  const mismatches = opts?.mismatches;
  const prev = opts?.original ?? profile; // compared with itself, so nothing is annotated without an original

  const label = (s: string) => chalk.bold(s + ':');
  const field = (key: ProfileField, val: string) => {
    return key in (mismatches ?? {}) ? chalk.yellow(`${val} *`) : val;
  };
  const lines = [
    `${label('Profile')}      ${profile.name}${wasSuffix(prev.name, profile.name)}`,
    `${label('Host')}         ${profile.host}${wasSuffix(prev.host, profile.host)}`,
    `${label('Name')}         ${field(PROFILE_FIELDS.USERNAME, profile.username)}${wasSuffix(prev.username, profile.username)}`,
    `${label('Email')}        ${field(PROFILE_FIELDS.EMAIL, profile.email)}${wasSuffix(prev.email, profile.email)}`,
    `${label('Sign Commits')} ${signingText(profile.signingMethod)}${wasSuffix(prev.signingMethod, profile.signingMethod, signingText)}`,
  ];
  if (profile.signingKey) {
    const display = buildSigningKey(profile.signingKey, signingStatus);
    lines.push(`${label('Signing Key')}  ${display}${wasSuffix(prev.signingKey, profile.signingKey, specifiedOrNot, '\n')}`);
  }
  log.info(lines.join('\n'));
  if (mismatches && Object.keys(mismatches).length > 0) {
    const parts = Object.entries(mismatches).map(([k, v]) => `${k}=${v ?? ''}`).join(', ');
    log.warn(`Git config does not match profile '${profile.name}' (Git config values: ${parts})`);
  }
}
