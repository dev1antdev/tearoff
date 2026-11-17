/**
 * What a socket may put in the log.
 *
 * A message's text is the visitor's own, up to the socket's 4 MB a message,
 * and a visitor may send as many as it likes. So a line about a message
 * carries a short, cleaned piece of it and never the whole, and one socket
 * writes only so many such lines a minute.
 */

/** As many characters of a visitor's text as a log line carries. */
export const LOGGED_TYPE_LENGTH = 40;

/** Lines of one kind a socket may write in `SOCKET_LOG_WINDOW_MS`. */
export const SOCKET_LOG_LINES = 3;
export const SOCKET_LOG_WINDOW_MS = 60_000;

/**
 * A message's `type` as it may be written down: its first characters, with
 * anything that is not a printable ASCII character replaced, and its whole
 * length where it was cut. A type that is not text is named by its kind and
 * nothing of it is written.
 */
export function briefMessageType(type: unknown): string {
  if (typeof type !== 'string') {
    const kind =
      type === null ? 'null' : Array.isArray(type) ? 'list' : typeof type;
    return `(not text: ${kind})`;
  }
  // Cut first, so that megabytes are never walked.
  const head = type.slice(0, LOGGED_TYPE_LENGTH).replace(/[^\x20-\x7e]/g, '?');
  return type.length > LOGGED_TYPE_LENGTH
    ? `"${head}" (cut from ${type.length} characters)`
    : `"${head}"`;
}

/**
 * Lets one socket write `lines` lines in each window and counts the rest.
 * The count goes out with the next line that is let through, so the log says
 * that there were more without holding them.
 *
 * `write` is handed what to add to the line: empty, or how many were left
 * out since the last one.
 */
export function createSocketLogLimit(
  now: () => number = () => Date.now(),
  lines: number = SOCKET_LOG_LINES,
  windowMs: number = SOCKET_LOG_WINDOW_MS
) {
  let windowStart = Number.NEGATIVE_INFINITY;
  let written = 0;
  let leftOut = 0;
  return (write: (leftOutNote: string) => void): void => {
    const time = now();
    if (time - windowStart >= windowMs) {
      windowStart = time;
      written = 0;
    }
    if (written >= lines) {
      leftOut += 1;
      return;
    }
    written += 1;
    const note = leftOut > 0 ? ` (${leftOut} more not logged)` : '';
    leftOut = 0;
    write(note);
  };
}
