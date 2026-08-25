import { Profile, SIGNING_METHOD } from '../src/profile.ts';

export const validProfile = new Profile('work', { host: 'github-work', username: 'Bryan Work', email: 'bryan@work.com' });
export const validProfileWithGpgKey = new Profile('work-gpg-signed', validProfile, { method: SIGNING_METHOD.GPG, key: 'FEDCBA0987654321' });
export const validProfileWithSshKey = new Profile('work-ssh-signed', validProfile, { method: SIGNING_METHOD.SSH, key: '/home/user/.ssh/id_work.pub' });
export const validProfiles = [validProfile, validProfileWithGpgKey, validProfileWithSshKey];
export const personalProfile = new Profile('personal', { host: 'github-personal', username: 'BStopp', email: 'bryan@personal.com' });
export const ambiguousProfiles = [validProfile, validProfileWithGpgKey, validProfileWithSshKey];
export const multiProfiles = [validProfile, personalProfile];

export const sshKeys = ['/home/user/.ssh/id_personal.pub', '/home/user/.ssh/id_work.pub'];

export const gpgKeys = [
  { keyId: 'FEDCBA0987654321', uids: [{ name: 'Bryan Work', email: 'bryan@work.com' }] },
  {
    keyId: '1234567890ABCDEF',
    uids: [
      { name: 'Bryan Personal', email: 'bryan@personal.com' },
      { name: 'Bryan Work', email: 'bryan@work.com' },
    ],
  },
];
export const sshHosts = [
  { host: 'github-personal', hostname: 'github.com' },
  { host: 'github-work', hostname: 'github.com' },
];
