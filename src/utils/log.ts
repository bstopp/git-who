import chalk from 'chalk';

const log = {
  /**
   * Writes a red-colored message to stderr, surrounded by blank lines.
   */
  error(msg: string) {
    console.error(`\n${chalk.red(msg)}\n`);
  },

  /**
   * Writes a yellow-colored message to stderr, surrounded by blank lines.
   */
  warn(msg: string) {
    console.error(`\n${chalk.yellow(msg)}\n`);
  },

  /**
   * Writes a message to stdout, surrounded by blank lines.
   */
  info(msg: string) {
    console.log(`\n${msg}\n`);
  },
};

export default log;
