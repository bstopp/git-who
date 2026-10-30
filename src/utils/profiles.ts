import os from 'node:os';
import path from 'node:path';
import { access, constants, readFile, writeFile } from 'node:fs/promises';
import type { SimpleGit } from 'simple-git';
import { Profile, SIGNING_METHOD, type SigningData } from '../profile.ts';
import { type GpgKey, listGpgKeys } from './gpg.ts';
import { listSshKeys } from './ssh.ts';

let cache: Promise<Profile[]> | undefined;
const CONFIG_PATH = path.join(os.homedir(), '.git-who.cfg.json');

export class NoProfilesError extends Error {
  constructor() {
    super('No profiles found. Use `git who add` to create one.');
    this.name = 'NoProfilesError';
  }
}

export class SigningKeyNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SigningKeyNotFoundError';
  }
}

function configParseError(cause?: unknown) {
  return new Error(`Config file could not be parsed: ${CONFIG_PATH}`, { cause });
}

// Two access() checks rather than a single readFile+errno inspection — keeps error
// classification explicit and typed without inspecting platform error codes.
// The TOCTOU window between checks is acceptable for a single-user CLI config file.
async function readAndParseConfig(): Promise<unknown[]> {
  try {
    await access(CONFIG_PATH, constants.F_OK);
  } catch {
    throw new NoProfilesError();
  }
  try {
    await access(CONFIG_PATH, constants.R_OK);
  } catch (err) {
    throw new Error(`Config file could not be read: ${CONFIG_PATH}`, { cause: err });
  }
  let profiles;
  try {
    profiles = JSON.parse(
      await readFile(CONFIG_PATH, 'utf8'),
    );
  } catch (err) {
    throw configParseError(err);
  }
  if (profiles && !Array.isArray(profiles)) {
    throw configParseError();
  }
  return profiles;
}

function invalidProfileError(index: number, reason?: string, cause?: unknown) {
  const detail = reason ? `: ${reason}` : '';
  return new Error(`Config file has an invalid profile at position ${index + 1}${detail} (${CONFIG_PATH})`, { cause });
}

type ProfileEntry = { name: string; host: string; username: string; email: string; signingMethod?: string; signingKey?: string };

/**
 * Check the shape of an entry of the config file, which is unvalidated input.
 *
 * @throws {Error} If the entry is not an object or a field is missing or not a string.
 */
function checkEntryShape(raw: unknown, index: number): ProfileEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalidProfileError(index, 'expected an object.');
  }
  const obj = raw as Record<string, unknown>;
  for (const field of ['name', 'host', 'username', 'email']) {
    if (typeof obj[field] !== 'string') {
      throw invalidProfileError(index, `'${field}' must be a string.`);
    }
  }
  if (obj.signingMethod !== undefined && typeof obj.signingMethod !== 'string') {
    throw invalidProfileError(index, "'signingMethod' must be a string.");
  }
  if (obj.signingMethod !== undefined && typeof obj.signingKey !== 'string') {
    throw invalidProfileError(index, "'signingKey' must be a string when 'signingMethod' is set.");
  }
  return obj as ProfileEntry;
}

/**
 * Build a profile from an entry of the config file.
 *
 * @throws {Error} If the entry has the wrong shape, or its values fail the profile's validation. The latter is thrown
 * with the validation error as its `cause`.
 */
function parseProfile(raw: unknown, index: number): Profile {
  const entry = checkEntryShape(raw, index);
  const signing = entry.signingMethod !== undefined
    ? { method: entry.signingMethod as SigningData['method'], key: entry.signingKey! }
    : undefined;
  try {
    return new Profile(entry.name, entry, signing);
  } catch (err) {
    throw invalidProfileError(index, undefined, err);
  }
}

async function saveProfiles(profiles: Profile[]) {
  try {
    await writeFile(CONFIG_PATH, JSON.stringify(profiles, null, 2), 'utf8');
    cache = Promise.resolve(profiles);
  } catch (err) {
    throw new Error(`Config file could not be written: ${CONFIG_PATH}`, { cause: err });
  }
}

async function applySigningConfig(git: SimpleGit, profile: Profile) {
  if (profile.signingKey !== undefined) {
    if (profile.signingMethod === SIGNING_METHOD.SSH) {
      await git.addConfig('user.signingKey', profile.signingKey, false, 'local');
      await git.addConfig('commit.gpgsign', 'true', false, 'local');
      await git.addConfig('gpg.format', 'ssh', false, 'local');
    } else if (profile.signingMethod === SIGNING_METHOD.GPG) {
      await git.addConfig('user.signingKey', profile.signingKey, false, 'local');
      await git.addConfig('commit.gpgsign', 'true', false, 'local');
      await git.raw(['config', '--local', '--unset', 'gpg.format']);
    }
  } else {
    await git.raw(['config', '--local', '--unset', 'user.signingKey']);
    await git.raw(['config', '--local', '--unset', 'commit.gpgsign']);
    await git.raw(['config', '--local', '--unset', 'gpg.format']);
  }
}

export async function loadProfiles(): Promise<Profile[]> {
  if (!cache) {
    cache = (async () => {
      const parsed = await readAndParseConfig() || [];
      const profiles = parsed.map(parseProfile);
      if (profiles.length === 0) {
        throw new NoProfilesError();
      }
      return profiles;
    })();
  }
  try {
    const profiles = await cache;
    return [...profiles];
  } catch (err) {
    cache = undefined;
    throw err;
  }
}

export async function addProfile(profile: Profile) {
  let profiles: Profile[] = [];
  try {
    profiles = await loadProfiles();
  } catch (err) {
    if (!(err instanceof NoProfilesError)) {
      throw err;
    }
  }
  if (profiles.some((p) => p.name === profile.name)) {
    throw new Error(`Profile '${profile.name}' already exists`);
  }
  profiles.push(profile);
  await saveProfiles(profiles);
}

export async function updateProfile(original: Profile, update: Profile) {
  const profiles = await loadProfiles();
  const idx = profiles.findIndex((p) => p.name === original.name);
  if (idx < 0) {
    throw new Error(`Profile '${original.name}' not found`);
  }
  profiles.splice(idx, 1, update);
  await saveProfiles(profiles);
}

export async function removeProfile(name: string) {
  if (!name) {
    return;
  }
  let profiles;
  try {
    profiles = await loadProfiles();
  } catch (err) {
    if (err instanceof NoProfilesError) {
      return;
    }
    throw err;
  }
  const idx = profiles.findIndex((p) => p.name === name);
  if (idx >= 0) {
    profiles.splice(idx, 1);
    await saveProfiles(profiles);
  }
}

export async function getActiveProfileName(git: SimpleGit) {
  if (!await git.checkIsRepo()) {
    return undefined;
  }
  const { value } = await git.getConfig('gitwho.profile', 'local');
  return value ?? undefined;
}

export async function applyProfile(git: SimpleGit, profile: Profile, originUrl?: string) {
  if (profile.signingKey !== undefined) {
    if (profile.signingMethod === SIGNING_METHOD.GPG) {
      const keys: GpgKey[] = await listGpgKeys(profile.signingKey);
      if (keys.length === 0) {
        throw new SigningKeyNotFoundError(`GPG key '${profile.signingKey}' not found for profile '${profile.name}'.`);
      }
    } else if (profile.signingMethod === SIGNING_METHOD.SSH) {
      const sshKeys = await listSshKeys();
      if (!sshKeys.includes(profile.signingKey)) {
        throw new SigningKeyNotFoundError(`SSH key '${profile.signingKey}' not found for profile '${profile.name}'.`);
      }
    }
  }
  await git.addConfig('gitwho.profile', profile.name, false, 'local');
  await git.addConfig('user.name', profile.username, false, 'local');
  await git.addConfig('user.email', profile.email, false, 'local');
  await applySigningConfig(git, profile);
  if (originUrl) {
    await git.remote(['set-url', 'origin', originUrl]);
  }
}
