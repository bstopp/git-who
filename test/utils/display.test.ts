import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';
import {
  gpgKeys, personalProfile,
  validProfile,
  validProfileWithGpgKey,
  validProfileWithSshKey,
} from '../fixtures.ts';
import { PROFILE_FIELDS, type ProfileMismatches, type SigningKeyStatus } from '../../src/utils/display.ts';

describe('utils/display.ts', async () => {
  const logInfoCalls: string[] = [];
  const logWarnCalls: string[] = [];
  const logMock = {
    '../../src/utils/log.ts': {
      default: {
        info: (msg: string) => logInfoCalls.push(msg),
        warn: (msg: string) => logWarnCalls.push(msg),
      },
    },
  };

  const chalkMock = {
    chalk: {
      default: {
        bold: (text: string) => `[Bold]${text}[/Bold]`,
        yellow: (text: string) => `[Yellow]${text}[/Yellow]`,
      },
    },
  };
  const { printProfile } = await esmock<typeof import('../../src/utils/display.ts')>('../../src/utils/display.ts', {
    ...logMock,
    ...chalkMock,
  });

  beforeEach(() => {
    logInfoCalls.length = 0;
    logWarnCalls.length = 0;
  });

  it('displays default fields', async () => {
    printProfile(validProfile);
    const output = logInfoCalls.join('\n');
    assert.ok(output.match(/\[Bold]Profile:\[\/Bold]\s+work/));
    assert.ok(output.match(/\[Bold]Host:\[\/Bold]\s+github-work/));
    assert.ok(output.match(/\[Bold]Name:\[\/Bold]\s+Bryan Stopp/));
    assert.ok(output.match(/\[Bold]Email:\[\/Bold]\s+bryan@work.com/));
    assert.ok(output.match(/\[Bold]Sign Commits:\[\/Bold]\sNo/));
    assert.ok(!output.match(/Signing Key/));
  });

  it('displays ssh signing key', async () => {
    const signingKeyStatus: SigningKeyStatus = { found: true };
    printProfile(validProfileWithSshKey, { signingKeyStatus });
    const output = logInfoCalls.join('\n');
    assert.ok(output.match(/\[Bold]Sign Commits:\[\/Bold]\s+Using ssh/));
    assert.ok(output.match(new RegExp(`\\[Bold]Signing Key:\\[/Bold]\\s+${validProfileWithSshKey.signingKey}`)));
  });

  it('displays missing ssh signing key', async () => {
    const signingKeyStatus: SigningKeyStatus = { found: false };
    printProfile(validProfileWithSshKey, { signingKeyStatus });
    const output = logInfoCalls.join('\n');
    assert.ok(output.match(/\[Bold]Sign Commits:\[\/Bold]\s+Using ssh/));
    assert.ok(output.match(new RegExp(`\\[Bold]Signing Key:\\[/Bold]\\s+\\[Yellow]${validProfileWithSshKey.signingKey} \\(not found\\)\\[/Yellow]`)));
  });

  it('displays gpg signing key with single uid on one line', async () => {
    const signingKeyStatus: SigningKeyStatus = { found: true, uids: gpgKeys[0].uids };
    printProfile(validProfileWithGpgKey, { signingKeyStatus });
    const output = logInfoCalls.join('\n');
    assert.ok(output.match(/\[Bold]Sign Commits:\[\/Bold]\s+Using gpg/));
    assert.ok(output.match(/\[Bold]Signing Key:\[\/Bold]\s+FEDCBA0987654321, Bryan Stopp \(bryan@work.com\)/));
  });

  it('displays not found gpg signing key with single uid on one line', async () => {
    const signingKeyStatus: SigningKeyStatus = { found: false, uids: gpgKeys[0].uids };
    printProfile(validProfileWithGpgKey, { signingKeyStatus });
    const output = logInfoCalls.join('\n');
    assert.ok(output.match(/\[Bold]Sign Commits:\[\/Bold]\s+Using gpg/));
    assert.ok(output.match(/\[Bold]Signing Key:\[\/Bold]\s+\[Yellow]FEDCBA0987654321, Bryan Stopp \(bryan@work.com\) \(not found\)\[\/Yellow]/));
  });

  it('displays gpg signing key with multiple uids on separate indented lines', async () => {
    const signingKeyStatus: SigningKeyStatus = { found: true, uids: gpgKeys[1].uids };
    printProfile(validProfileWithGpgKey, { signingKeyStatus });
    const output = logInfoCalls.join('\n');
    assert.ok(output.match(/\[Bold]Sign Commits:\[\/Bold]\sUsing gpg/));
    assert.ok(output.match(/\[Bold]Signing Key:\[\/Bold]\s+FEDCBA0987654321\n/));
    assert.ok(output.match(/\s+Bryan Stopp \(bryan@work.com\)\n?/));
    assert.ok(output.match(/\s+Bryan Stopp \(bryan@personal.com\)\n?/));
  });

  it('displays not found gpg signing key with multiple uids on separate indented lines', async () => {
    const signingKeyStatus: SigningKeyStatus = { found: false, uids: gpgKeys[1].uids };
    printProfile(validProfileWithGpgKey, { signingKeyStatus });
    const output = logInfoCalls.join('\n');
    assert.ok(output.match(/\[Bold]Sign Commits:\[\/Bold]\sUsing gpg/));
    assert.ok(output.match(/\[Bold]Signing Key:\[\/Bold]\s+\[Yellow]FEDCBA0987654321\n/));
    assert.ok(output.match(/\s+Bryan Stopp \(bryan@work.com\)/));
    assert.ok(output.match(/\s+Bryan Stopp \(bryan@personal.com\)/));
    assert.ok(output.match(/\(not found\)\[\/Yellow]$/));
  });

  it('does not log a warning when mismatches is empty', async () => {
    const mismatches: ProfileMismatches = {};
    printProfile(validProfile, { mismatches });
    assert.equal(logWarnCalls.length, 0);
    const output = logInfoCalls.join('\n');
    assert.ok(!output.match(/\*/));
  });

  it('flags mismatched fields with * and logs a warning', async () => {
    const signingKeyStatus: SigningKeyStatus = { found: true, uids: gpgKeys[1].uids };
    const mismatches: ProfileMismatches = {
      [PROFILE_FIELDS.USERNAME]: personalProfile.username,
      [PROFILE_FIELDS.EMAIL]: personalProfile.email,
    };
    const opts = { signingKeyStatus, mismatches };
    printProfile(validProfile, opts);
    const output = logInfoCalls.join('\n');
    assert.ok(output.match(/\[Bold]Name:\[\/Bold]\s+\[Yellow]Bryan Stopp \*\[\/Yellow]/));
    assert.ok(output.match(/\[Bold]Email:\[\/Bold]\s+\[Yellow]bryan@work.com \*\[\/Yellow]/));
    const warnings = logWarnCalls.join('\n');
    assert.ok(warnings.match(/Git config does not match profile.*username=BStopp.*email=bryan@personal.com/));
  });

  it('flags missing fields with * and logs a warning', async () => {
    const signingKeyStatus: SigningKeyStatus = { found: true, uids: gpgKeys[1].uids };
    const mismatches: ProfileMismatches = {
      [PROFILE_FIELDS.USERNAME]: undefined,
      [PROFILE_FIELDS.EMAIL]: undefined,
    };
    const opts = { signingKeyStatus, mismatches };
    printProfile(validProfile, opts);
    const output = logInfoCalls.join('\n');
    assert.ok(output.match(/\[Bold]Name:\[\/Bold]\s+\[Yellow]Bryan Stopp \*\[\/Yellow]/));
    assert.ok(output.match(/\[Bold]Email:\[\/Bold]\s+\[Yellow]bryan@work.com \*\[\/Yellow]/));
    const warnings = logWarnCalls.join('\n');
    assert.ok(warnings.match(/Git config does not match profile.*username=.*email=/));
  });

  it('displays signing key with no status check performed', async () => {
    printProfile(validProfileWithSshKey);
    const output = logInfoCalls.join('\n');
    assert.ok(output.match(new RegExp(`Signing Key.*${validProfileWithSshKey.signingKey}$`)));
  });
});
