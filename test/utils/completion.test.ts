import assert from 'node:assert/strict';
import { Command } from 'commander';
import { complete, script, SHELLS } from '../../src/utils/completion.ts';

describe('utils/completion.ts', () => {
  const profiles = ['personal', 'work', 'work-gpg'];

  const root = new Command().name('git who').version('1.0.0');
  root.command('show [name]').option('--json', 'Print the result as JSON');
  root.command('use [name]').option('--json', 'Print the result as JSON').option('--update-origin', 'Update origin');
  root.command('list').option('--json', 'Print the result as JSON').option('-q', 'Short flag with no long form');
  root.command('clone <repo> [name]');
  const hook = root.command('hook');
  hook.command('install');
  hook.command('uninstall');
  root.command('__complete', { hidden: true });

  const run = (...words: string[]) => complete(root, words, profiles);

  describe('subcommands', () => {
    it('offers every visible command when nothing is typed', () => {
      const candidates = run('');
      for (const name of ['show', 'use', 'list', 'clone', 'hook']) {
        assert.ok(candidates.includes(name), `${name} should be offered`);
      }
    });

    it('treats no words as nothing typed', () => {
      assert.deepEqual(complete(root, [], profiles), run(''));
    });

    it('never offers a hidden command', () => {
      assert.ok(!run('').includes('__complete'));
      assert.deepEqual(run('__'), []);
    });

    it('offers only the commands that start with what is typed', () => {
      assert.deepEqual(run('sh'), ['show']);
    });

    it('offers the subcommands of a command that has them', () => {
      const candidates = run('hook', '');
      assert.ok(candidates.includes('install'));
      assert.ok(candidates.includes('uninstall'));
      assert.deepEqual(run('hook', 'un'), ['uninstall']);
    });

    it('offers nothing after a complete subcommand', () => {
      assert.deepEqual(run('hook', 'install', ''), []);
    });

    it('offers nothing for an unknown command, or after one', () => {
      assert.deepEqual(run('nonsense', ''), []);
      assert.deepEqual(run('nonsense', 'use', ''), []);
    });
  });

  describe('profile names', () => {
    it('offers the profiles for an argument called name', () => {
      assert.deepEqual(run('use', ''), profiles);
      assert.deepEqual(run('show', ''), profiles);
    });

    it('offers only the profiles that start with what is typed', () => {
      assert.deepEqual(run('use', 'work'), ['work', 'work-gpg']);
    });

    it('offers nothing once the name is given', () => {
      assert.deepEqual(run('use', 'work', ''), []);
    });

    it('does not count a flag as the name', () => {
      assert.deepEqual(run('use', '--json', ''), profiles);
    });

    it('offers profiles for the second argument of clone, not the first', () => {
      assert.deepEqual(run('clone', ''), []);
      assert.deepEqual(run('clone', 'org/repo', ''), profiles);
    });

    it('offers nothing for a command that takes no name', () => {
      assert.deepEqual(run('list', ''), []);
    });

    it('offers nothing when there are no profiles', () => {
      assert.deepEqual(complete(root, ['use', ''], []), []);
    });
  });

  // Whether a shell really completes with these is not something a test can show, since it needs the shell running.
  describe('script', () => {
    it('supports zsh and bash', () => {
      assert.deepEqual([...SHELLS], ['zsh', 'bash']);
    });

    it('defines the function that git calls for `git who` in bash, and hands the candidates to git', () => {
      assert.match(script('bash'), /^_git_who\(\) \{$/m);
      assert.ok(script('bash').includes('__gitcomp_nl "$(git who __complete'));
      assert.doesNotMatch(script('bash'), /_git-who/);
    });

    // git's own zsh wrapper, which Homebrew installs as _git, calls the bash-style function, and zsh's built-in _git
    // calls the dashed one. Only one of them is loaded, so defining both is harmless.
    it('defines the function that git calls in zsh for both of its completions', () => {
      assert.match(script('zsh'), /^_git_who\(\) \{$/m);
      assert.match(script('zsh'), /^_git-who\(\) \{$/m);
      assert.ok(script('zsh').includes('__gitcomp_nl "$(git who __complete'));
    });

    for (const shell of SHELLS) {
      it(`asks \`git who __complete\` for the words typed after who, in ${shell}`, () => {
        assert.ok(script(shell).includes('git who __complete -- '));
      });

      it(`has no trailing newline in ${shell}, since printing it adds one`, () => {
        assert.match(script(shell), /[^\n]$/);
      });
    }
  });

  describe('flags', () => {
    it('offers the flags of the command, with help', () => {
      assert.deepEqual(run('use', '-').sort(), ['--help', '--json', '--update-origin']);
    });

    it('offers only the flags that start with what is typed', () => {
      assert.deepEqual(run('use', '--u'), ['--update-origin']);
    });

    it('leaves out a flag that has no long form', () => {
      assert.deepEqual(run('list', '-').sort(), ['--help', '--json']);
    });

    it('offers the flags of the root command, including the version', () => {
      assert.deepEqual(run('--v'), ['--version']);
    });

    it('offers flags after the name too', () => {
      assert.deepEqual(run('use', 'work', '--j'), ['--json']);
    });
  });
});
