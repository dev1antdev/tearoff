import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
);

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (event: unknown, ...args: unknown[]) => unknown
      ) => {
        handlers.set(channel, handler);
      }
    ),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  },
}));

const { PIT_WALL_SHOW_WINDOW, setupPitWallBridge } =
  await import('./pitWallBridge');

const invoke = (...args: unknown[]) => {
  const handler = handlers.get(PIT_WALL_SHOW_WINDOW);
  if (!handler) throw new Error('no handler registered');
  return handler({}, ...args);
};

describe('setupPitWallBridge', () => {
  beforeEach(() => handlers.clear());

  it('registers the one channel, by the name the preload calls', () => {
    setupPitWallBridge(() => true);
    expect(PIT_WALL_SHOW_WINDOW).toBe('pitWall:showWindow');
    expect([...handlers.keys()]).toEqual(['pitWall:showWindow']);
  });

  it('answers whether a window was shown', () => {
    const showWindow = vi.fn(() => true);
    setupPitWallBridge(showWindow);
    expect(invoke()).toBe(true);
    showWindow.mockReturnValue(false);
    expect(invoke()).toBe(false);
    expect(showWindow).toHaveBeenCalledTimes(2);
  });

  it('answers a boolean whatever the opener returns', () => {
    setupPitWallBridge((() => 'yes') as unknown as () => boolean);
    expect(invoke()).toBe(false);
  });

  it.each([[undefined], [null], ['gantry'], [{ widget: 'pitwall' }], [1, 2]])(
    'refuses a call that brings arguments: %j',
    (...args) => {
      const showWindow = vi.fn(() => true);
      setupPitWallBridge(showWindow);
      expect(() => invoke(...args)).toThrow(TypeError);
      expect(showWindow).not.toHaveBeenCalled();
    }
  );

  it('stops answering once disposed', () => {
    const dispose = setupPitWallBridge(() => true);
    dispose();
    expect(handlers.has(PIT_WALL_SHOW_WINDOW)).toBe(false);
  });
});
