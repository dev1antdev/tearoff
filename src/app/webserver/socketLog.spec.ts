import { describe, expect, it, vi } from 'vitest';
import {
  LOGGED_TYPE_LENGTH,
  SOCKET_LOG_LINES,
  SOCKET_LOG_WINDOW_MS,
  briefMessageType,
  createSocketLogLimit,
} from './socketLog';

describe("a message's type as it is written to the log", () => {
  it('is written whole when it is short', () => {
    expect(briefMessageType('getDashbord')).toBe('"getDashbord"');
  });

  it('is cut to a fixed length, with its whole length beside it', () => {
    const type = 'x'.repeat(4 * 1024 * 1024);
    const line = briefMessageType(type);

    expect(line).toBe(
      `"${'x'.repeat(LOGGED_TYPE_LENGTH)}" (cut from ${type.length} characters)`
    );
    expect(line.length).toBeLessThan(100);
  });

  it('carries no line break, control character or other script', () => {
    expect(
      briefMessageType('a\r\n[error] forged line\u001b[31m\u0000\u2028\u00e9')
    ).toBe('"a??[error] forged line?[31m???"');
  });

  it.each([
    [{ toString: () => 'x'.repeat(1000) }, '(not text: object)'],
    [['x'.repeat(1000)], '(not text: list)'],
    [12, '(not text: number)'],
    [null, '(not text: null)'],
    [undefined, '(not text: undefined)'],
    [true, '(not text: boolean)'],
  ])('names a type that is not text by its kind only', (type, line) => {
    expect(briefMessageType(type)).toBe(line);
  });
});

describe('how many lines a socket writes', () => {
  it('is a few a minute, the rest counted and named with the next one', () => {
    let time = 0;
    const limit = createSocketLogLimit(() => time);
    const write = vi.fn<(note: string) => void>();

    for (let i = 0; i < 1000; i += 1) limit(write);
    expect(write).toHaveBeenCalledTimes(SOCKET_LOG_LINES);
    expect(write.mock.calls.map(([note]) => note)).toEqual(['', '', '']);

    // Still inside the minute: nothing more.
    time = SOCKET_LOG_WINDOW_MS - 1;
    limit(write);
    expect(write).toHaveBeenCalledTimes(SOCKET_LOG_LINES);

    // The next minute's first line says how many there were.
    time = SOCKET_LOG_WINDOW_MS;
    limit(write);
    expect(write).toHaveBeenLastCalledWith(
      ` (${1000 - SOCKET_LOG_LINES + 1} more not logged)`
    );
    limit(write);
    expect(write).toHaveBeenLastCalledWith('');
  });
});
