// The generator ships no types. This is only the part that test/release-config.test.ts calls.
declare module '@semantic-release/release-notes-generator' {
  export function generateNotes(
    pluginConfig: object,
    context: {
      commits: { hash: string; message: string; committerDate: string; author: { name: string }; committer: { name: string } }[];
      cwd: string;
      logger: { log: (...args: unknown[]) => void };
      lastRelease: { gitTag: string; version: string };
      nextRelease: { gitTag: string; version: string; gitHead: string };
      options: { repositoryUrl: string };
    },
  ): Promise<string>;
}
