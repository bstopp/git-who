import { execFileSync } from 'node:child_process';

const VALID_UID = new Set(['u', 'f', 'm', 'q', '-']);

type Uid = { name: string; email: string };
export type GpgKey = { keyId: string; uids: Array<Uid> };

function parseUid(line: string) {
  const validity = line.split(':')[1];
  if (!VALID_UID.has(validity)) {
    return null;
  }
  const field = line.split(':')[9];
  const match = field.match(/<([^<>]+)>\s*$/);
  if (!match) {
    return null;
  }
  return { name: field.slice(0, match.index).trim(), email: match[1].trim() };
}

function processResult(stdout: string): Array<GpgKey> {
  const keys = [];
  let current: GpgKey | undefined = undefined;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('sec:')) {
      if (current && current.uids.length > 0) {
        keys.push(current);
      }
      current = { keyId: line.split(':')[4], uids: [] };
    } else if (line.startsWith('uid:') && current) {
      const uid = parseUid(line);
      if (uid) {
        current.uids.push(uid);
      }
    }
  }
  if (current && current.uids.length > 0) {
    keys.push(current);
  }
  return keys;
}

function matchesQuery(key: GpgKey, query: string) {
  const q = query.toLowerCase();
  if (key.keyId.toLowerCase() === q) {
    return true;
  }
  return key.uids.some((uid) => uid.email.toLowerCase() === q);
}

/**
 * List the current GPG Keys on the system that match the query.
 */
export function listGpgKeys(query?: string): Array<GpgKey> {
  const args = ['--list-secret-keys', '--with-colons', '--keyid-format=long'];

  let stdout;
  try {
    stdout = execFileSync('gpg', args, { encoding: 'utf8' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('gpg is required but was not found on PATH. Please install GnuPG.', { cause: error });
    }
    throw error;
  }
  const keys = processResult(stdout);
  return query ? keys.filter((key) => matchesQuery(key, query)) : keys;
}
