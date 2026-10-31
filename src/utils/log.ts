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

  /**
   * Writes a value to stdout as indented JSON, with no blank lines or colors so the output can be parsed as is.
   */
  json(value: unknown) {
    console.log(JSON.stringify(value, null, 2));
  },
};

export default log;
