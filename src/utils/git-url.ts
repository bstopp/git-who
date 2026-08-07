const SCP_URL_PATTERN = /^git@([^:]+):(.+)$/;
const SSH_URL_PATTERN = /^ssh:\/\/git@([^:/]+)(?::\d+)?\/(.+)$/;

export function parseSshUrl(url: string): { host: string; path: string } | undefined {
  const match = url.match(SCP_URL_PATTERN) || url.match(SSH_URL_PATTERN);
  if (!match) {
    return undefined;
  }
  return { host: match[1], path: match[2] };
}
