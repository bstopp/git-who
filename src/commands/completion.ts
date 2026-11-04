import log from '../utils/log.ts';
import { script, type Shell } from '../utils/completion.ts';

/**
 * Print the completion script for a shell, for `eval "$(git who completion <shell>)"` in its startup file.
 */
export default function completion(shell: Shell): void {
  log.raw(script(shell));
}
