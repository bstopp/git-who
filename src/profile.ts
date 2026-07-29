import {
  validateProfileName,
  validateHost,
  validateUsername,
  validateEmail,
  validateSshSigningKey,
  validateGpgSigningKey,
} from './utils/validators.ts';

export const SIGNING_METHOD = { GPG: 'gpg', SSH: 'ssh' } as const;
export type SigningMethod = (typeof SIGNING_METHOD)[keyof typeof SIGNING_METHOD]; // 'gpg' | 'ssh'

const SIGNING_KEY_VALIDATORS: Record<SigningMethod, (key: string) => void> = {
  [SIGNING_METHOD.SSH]: validateSshSigningKey,
  [SIGNING_METHOD.GPG]: validateGpgSigningKey,
};

type GitData = {
  host: string;
  username: string;
  email: string;
};

type SigningData = {
  method: SigningMethod;
  key: string;
};

export class Profile {
  name: string;
  host: string;
  username: string;
  email: string;
  signingMethod?: SigningMethod;
  signingKey?: string;

  constructor(name: string, git: GitData, signing?: SigningData) {
    validateProfileName(name);
    this.name = name;
    validateHost(git.host);
    this.host = git.host;
    validateUsername(git.username);
    this.username = git.username;
    validateEmail(git.email);
    this.email = git.email;
    if (signing) {
      const validate = SIGNING_KEY_VALIDATORS[signing.method];
      if (!validate) {
        throw new Error(`Invalid signing method: '${signing.method}'. Value must be one of: '${Object.values(SIGNING_METHOD).join("', '")}'.`);
      }
      validate(signing.key);
      this.signingMethod = signing.method;
      this.signingKey = signing.key;
    }
  }
}
