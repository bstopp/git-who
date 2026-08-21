import os from 'node:os';
import path from 'node:path';
import { access, constants, readFile, writeFile } from 'node:fs/promises';
import type { SimpleGit } from 'simple-git';
import { Profile, SIGNING_METHOD, type SigningData } from '../profile.ts';
import { listGpgKeys } from './gpg.ts';
import { listSshKeys } from './ssh.ts';

const cache: Profile[] = [];
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

function configParseError() {
  return new Error(`Config file could not be parsed: ${CONFIG_PATH}`);
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
  } catch {
    throw new Error(`Config file could not be read: ${CONFIG_PATH}`);
  }
  let profiles;
  try {
    profiles = JSON.parse(
      await readFile(CONFIG_PATH, 'utf8'),
    );
  } catch {
    throw configParseError();
  }
  if (profiles && !Array.isArray(profiles)) {
    throw configParseError();
  }
  return profiles;
}

async function saveProfiles(profiles: Profile[]) {
  try {
    cache.length = 0;
    cache.push(...profiles);
    await writeFile(CONFIG_PATH, JSON.stringify(profiles, null, 2), 'utf8');
  } catch {
    throw new Error(`Config file could not be written: ${CONFIG_PATH}`);
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
  if (cache.length > 0) {
    return [...cache];
  }
  const parsed = await readAndParseConfig() || [];
  const profiles = parsed.map((raw) => {
    const obj = raw as Profile;
    const signing: SigningData | undefined = obj.signingMethod !== undefined
      ? { method: obj.signingMethod, key: obj.signingKey! }
      : undefined;
    return new Profile(obj.name, obj, signing);
  });
  if (profiles.length === 0) {
    throw new NoProfilesError();
  }
  cache.push(...profiles);
  return profiles;
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
      if (listGpgKeys(profile.signingKey).length === 0) {
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
