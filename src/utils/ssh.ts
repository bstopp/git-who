import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import log from './log.ts';

const execFileAsync = promisify(execFile);

type HostEntry = { host: string; hostname: string };

function parseSshSearch(host: string, stdout: string): { host: string; hostname: string } {
  const hostname = stdout.split('\n')
    .find((line) => line.toLowerCase().startsWith('hostname'))!
    .split(' ')[1];
  return { host, hostname };
}

// TODO(README): `ssh` is a required prerequisite (unlike optional `gpg`) — document that once README.md is out of stash.
// TODO(README): `Include` directives in ~/.ssh/config are not followed — hosts defined in included files won't be found. Document this limitation once README.md is out of stash.
async function readConfig(): Promise<string> {
  const path = join(homedir(), '.ssh', 'config');
  return readFile(path, 'utf-8');
}

async function buildHostsResult(hosts: string[]): Promise<HostEntry[]> {
  const promises = hosts.map(async (host) => {
    return execFileAsync('ssh', ['-G', host])
      .then((result) => {
        return parseSshSearch(host, result.stdout);
      })
      .catch((err) => {
        log.warn(`Unable to look up host '${host}': ${err.message}`);
      });
  });
  return (await Promise.all(promises)).filter((v) => v !== undefined);
}

/**
 * List SSH host aliases configured in ~/.ssh/config, resolved via `ssh -G`.
 */
export async function listSshHosts(): Promise<HostEntry[]> {
  const configs = await readConfig();
  const hosts: string[] = [];
  for (const line of configs.split('\n')) {
    const match = line.trim().match(/^Host\s+([^#]+).*$/i);
    if (match) {
      match[1].split(/\s+/).filter((s) => s).forEach((host) => {
        if (host && !host.startsWith('!') && !host.match(/[?*]/) && !hosts.includes(host)) {
          hosts.push(host);
        }
      });
    }
  }
  const results = await buildHostsResult(hosts);
  if (results.length === 0) {
    throw new Error('No SSH host aliases found in ~/.ssh/config.');
  }
  return results;
}

/**
 * List SSH public key files (*.pub) found in ~/.ssh.
 */
export async function listSshKeys() {
  const path = join(homedir(), '.ssh');
  const files = await readdir(path);
  return files.filter((f) => f.endsWith('.pub')).map((f) => join(path, f)).sort();
}
