// The analyzer ships no types. This is only the part that scripts/release-preview.ts calls.
declare module '@semantic-release/commit-analyzer' {
  export function analyzeCommits(
    pluginConfig: object,
    context: { commits: { message: string }[]; logger: { log: (...args: unknown[]) => void }; cwd: string },
  ): Promise<'major' | 'minor' | 'patch' | null>;
}
