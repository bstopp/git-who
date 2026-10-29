import input from '@inquirer/input';
import select from '@inquirer/select';

import log from './log.ts';
import { Profile, SIGNING_METHOD, type SigningData } from '../profile.ts';
import { listSshHosts, listSshKeys } from './ssh.ts';
import { type GpgKey, type Uid, listGpgKeys } from './gpg.ts';
import {
  validateProfileName,
  validateUnique,
  validateUsername,
  validateEmail,
} from './validators.ts';
import { loadProfiles, NoProfilesError } from './profiles.ts';

type Validator = (value: string) => void;

async function loadExistingProfiles(): Promise<Profile[]> {
  try {
    return await loadProfiles();
  } catch (err) {
    if (err instanceof NoProfilesError) {
      return [];
    }
    throw err;
  }
}

function inquirerValidate(fn: Validator) {
  function validate(value: string): boolean | string {
    try {
      fn(value);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).message;
    }
  }

  return validate;
}

async function nameInput(existing?: Profile[], current?: string): Promise<string> {
  return input({
    message: 'Profile name:',
    default: current,
    validate: inquirerValidate((value: string) => {
      validateProfileName(value);
      if (existing && existing.length > 0 && value !== current) {
        validateUnique(existing, value);
      }
    }),
  });
}

async function hostInput(current?: string) {
  const hosts = await listSshHosts();
  const choices: { name: string; value: string }[] = [];
  hosts.forEach((entry) => {
    choices.push({
      value: entry.host,
      name: `${entry.host} (${entry.hostname})`,
    });
  });
  return select({
    message: 'SSH Host:',
    default: current,
    choices,
  });
}

async function signInput(current: string = 'ssh') {
  const choices = [
    { name: 'Use SSH', value: SIGNING_METHOD.SSH },
    { name: 'Use GPG', value: SIGNING_METHOD.GPG },
    { name: 'No', value: 'no' },
  ];
  return select({
    message: 'Sign Commits?',
    default: current,
    choices,
  });
}

async function selectUid(key: GpgKey) {
  if (key.uids.length === 1) {
    log.info(`Using identity: ${key.uids[0].name} (${key.uids[0].email})`);
    return key.uids[0];
  }
  return select({
    message: 'Select an identity:',
    choices: key.uids.map((uid) => ({
      name: `${uid.name} (${uid.email})`,
      value: uid,
    })),
  });
}

async function selectGpgKey(current: string | undefined): Promise<{ key: GpgKey; uid: Uid }> {
  const keys = await listGpgKeys();
  if (keys.length === 0) {
    throw new Error('No GPG keys found on this system.');
  }
  let key: GpgKey;
  if (keys.length === 1) {
    log.info(`Using GPG key: ${keys[0].keyId}`);
    key = keys[0];
  } else {
    const keyId = await select({
      message: 'Select a GPG key:',
      choices: keys.map((k) => ({
        name: `${k.keyId} — ${k.uids.map((u) => `${u.name} (${u.email})`).join(', ')}`,
        value: k.keyId,
      })),
      default: current,
    });
    key = keys.find((entry) => entry.keyId === keyId)!;
  }
  const uid = await selectUid(key);
  return { key, uid };
}

async function selectSshKey(current: string | undefined) {
  const keys = await listSshKeys();
  if (keys.length === 0) {
    throw new Error('No SSH keys found on this system.');
  }
  return select({
    message: 'Select an SSH key:',
    default: current,
    choices: keys,
  });
}

async function usernameInput(current?: string) {
  return input({
    message: 'Git user.name:',
    default: current,
    validate: inquirerValidate(validateUsername),
  });
}

async function emailInput(current?: string) {
  return input({
    message: 'Git user.email:',
    default: current,
    validate: inquirerValidate(validateEmail),
  });
}

async function promptSignCommits(editing: Profile | undefined) {
  const method = await signInput(editing?.signingMethod);
  let signingData: SigningData | undefined;
  let uid: Uid | undefined;
  if (method === SIGNING_METHOD.GPG) {
    let key: GpgKey;
    ({ key, uid } = await selectGpgKey(editing?.signingKey));
    signingData = { method, key: key.keyId };
  } else if (method === SIGNING_METHOD.SSH) {
    const key = await selectSshKey(editing?.signingKey);
    signingData = { method, key };
  }
  return { signingData, uid };
}

export async function promptForProfile(editing?: Profile): Promise<Profile> {
  const existing = await loadExistingProfiles();
  const name = await nameInput(existing, editing?.name);
  const host = await hostInput(editing?.host);
  const { signingData, uid } = await promptSignCommits(editing);
  const username = await usernameInput(uid?.name || editing?.username);
  const email = await emailInput(uid?.email || editing?.email);
  return new Profile(name, { host, username, email }, signingData);
}
