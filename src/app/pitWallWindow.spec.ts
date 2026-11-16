import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardLayout } from '@irdashies/types';
import type { Rect } from './windowBounds';
import type { PitWallWindowPlacement } from './storage/pitWallWindowBounds';

// `declare const` globals injected by the Forge/Vite plugin.
vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');

const PRIMARY = { x: 0, y: 40, width: 2560, height: 1400 };
const LEFT = { x: -1920, y: 0, width: 1920, height: 1040 };

const state = vi.hoisted(() => ({
  workAreas: [] as Rect[],
  saved: undefined as PitWallWindowPlacement | undefined,
}));
const savePlacement = vi.hoisted(() =>
  vi.fn<(placement: PitWallWindowPlacement) => void>()
);

type Handler = (...args: unknown[]) => void;
const createdWindows: FakeBrowserWindow[] = [];

class FakeBrowserWindow {
  webContents = {
    id: 77,
    send: vi.fn(),
    handlers: new Map<string, Handler>(),
    on: vi.fn((event: string, handler: Handler) => {
      this.webContents.handlers.set(event, handler);
    }),
  };
  handlers = new Map<string, Handler[]>();
  onceHandlers = new Map<string, Handler>();
  destroyed = false;
  shown = false;
  minimized = false;
  maximized = false;
  rectangle: Rect;
  normal: Rect;
  on = vi.fn((event: string, handler: Handler) => {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  });
  once = vi.fn((event: string, handler: Handler) => {
    this.onceHandlers.set(event, handler);
    return this;
  });
  show = vi.fn(() => {
    this.shown = true;
  });
  focus = vi.fn();
  restore = vi.fn(() => {
    this.minimized = false;
  });
  maximize = vi.fn(() => {
    this.maximized = true;
  });
  destroy = vi.fn(() => {
    this.destroyed = true;
    this.emit('closed');
  });
  isDestroyed = vi.fn(() => this.destroyed);
  isMinimized = vi.fn(() => this.minimized);
  isMaximized = vi.fn(() => this.maximized);
  fullScreen = false;
  isFullScreen = vi.fn(() => this.fullScreen);
  getBounds = vi.fn(() => ({ ...this.rectangle }));
  getNormalBounds = vi.fn(() => ({ ...this.normal }));
  setBounds = vi.fn((rect: Rect) => {
    this.rectangle = { ...rect };
    this.normal = { ...rect };
  });
  loadURL = vi.fn();
  loadFile = vi.fn();

  constructor(public options: Record<string, unknown>) {
    this.rectangle = {
      x: options.x as number,
      y: options.y as number,
      width: options.width as number,
      height: options.height as number,
    };
    this.normal = { ...this.rectangle };
    createdWindows.push(this);
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  ready() {
    this.onceHandlers.get('ready-to-show')?.();
  }
}

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: FakeBrowserWindow,
  screen: {
    getAllDisplays: () => state.workAreas.map((workArea) => ({ workArea })),
    getPrimaryDisplay: () => ({ workArea: state.workAreas[0] }),
  },
}));
vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./storage/pitWallWindowBounds', () => ({
  readPitWallWindowPlacement: () => state.saved,
  savePitWallWindowPlacement: savePlacement,
}));
vi.mock('./storage/settingsWindowBounds', () => ({
  saveSettingsWindowBounds: vi.fn(),
}));

const { PitWallWindow, PIT_WALL_WINDOW_ID, PIT_WALL_WINDOW_TITLE } =
  await import('./pitWallWindow');
const { flushWindowMovementOnShutdown } = await import('./trackWindowMovement');

const dashboard = (enabled: boolean) =>
  ({ widgets: [{ id: 'pitwall', enabled, config: {} }] }) as DashboardLayout;

const createHost = () => {
  const host = {
    quitting: false,
    supported: true,
    dashboard: dashboard(true) as DashboardLayout | undefined,
    isQuitting: vi.fn(() => host.quitting),
    isWidgetVisible: vi.fn(
      (widget: { enabled: boolean }) => widget.enabled && host.supported
    ),
    iconPath: vi.fn(() => '/icons/logo.png'),
    harden: vi.fn(),
    onReady: vi.fn(),
    onShown: vi.fn(),
    currentDashboard: vi.fn(() => host.dashboard),
    onEnabledChange: vi.fn(),
  };
  return host;
};

describe('PitWallWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    createdWindows.length = 0;
    state.workAreas = [PRIMARY, LEFT];
    state.saved = undefined;
  });

  afterEach(() => {
    flushWindowMovementOnShutdown();
    vi.useRealTimers();
  });

  it('is known to the ready listeners by the widget id', () => {
    expect(PIT_WALL_WINDOW_ID).toBe('pitwall');
    expect(PIT_WALL_WINDOW_TITLE).toBe('Tearoff - Pit Wall');
  });

  describe('opening', () => {
    it('opens an ordinary framed window on the pitwall route', () => {
      const host = createHost();
      const pitWall = new PitWallWindow(host);

      expect(pitWall.show(dashboard(true))).toBe(true);
      const [window] = createdWindows;
      expect(window.options).toMatchObject({
        title: 'Tearoff - Pit Wall',
        frame: true,
        autoHideMenuBar: true,
        minWidth: 900,
        minHeight: 560,
        show: false,
        icon: '/icons/logo.png',
      });
      expect(window.options).not.toHaveProperty('alwaysOnTop');
      expect(window.options).not.toHaveProperty('transparent');
      expect(window.loadFile).toHaveBeenCalledWith(
        expect.stringContaining('index.html'),
        { hash: '/pitwall' }
      );
      expect(pitWall.current).toBe(window);
    });

    it('keeps the secure web preferences and applies the baseline hardening', () => {
      const host = createHost();
      new PitWallWindow(host).show(dashboard(true));
      const [window] = createdWindows;
      const preferences = window.options.webPreferences as Record<
        string,
        unknown
      >;
      expect(Object.keys(preferences)).toEqual(['preload']);
      expect(host.harden).toHaveBeenCalledExactlyOnceWith(window);
    });

    it('opens 1600 by 900 in the middle of the primary display by default', () => {
      new PitWallWindow(createHost()).show(dashboard(true));
      expect(createdWindows[0].options).toMatchObject({
        width: 1600,
        height: 900,
        x: 480,
        y: 290,
      });
    });

    it('is shown once the page is ready, not before', () => {
      new PitWallWindow(createHost()).show(dashboard(true));
      const [window] = createdWindows;
      expect(window.show).not.toHaveBeenCalled();
      window.ready();
      expect(window.show).toHaveBeenCalledOnce();
      expect(window.maximize).not.toHaveBeenCalled();
    });

    it('does nothing and says so when the widget is switched off', () => {
      const pitWall = new PitWallWindow(createHost());
      expect(pitWall.show(dashboard(false))).toBe(false);
      expect(pitWall.show(undefined)).toBe(false);
      expect(pitWall.show({ widgets: [] } as unknown as DashboardLayout)).toBe(
        false
      );
      expect(createdWindows).toHaveLength(0);
    });

    it('stays shut when the running simulator cannot support the widget', () => {
      const host = createHost();
      host.supported = false;
      expect(new PitWallWindow(host).show(dashboard(true))).toBe(false);
      expect(createdWindows).toHaveLength(0);
    });

    it('brings an open window to the front instead of opening a second', () => {
      const pitWall = new PitWallWindow(createHost());
      pitWall.show(dashboard(true));
      const [window] = createdWindows;
      window.minimized = true;

      expect(pitWall.show(dashboard(true))).toBe(true);
      expect(createdWindows).toHaveLength(1);
      expect(window.restore).toHaveBeenCalledOnce();
      expect(window.show).toHaveBeenCalledOnce();
      expect(window.focus).toHaveBeenCalledOnce();
    });
  });

  describe('following the dashboard', () => {
    it('opens once when the widget is switched on', () => {
      const host = createHost();
      const pitWall = new PitWallWindow(host);
      pitWall.sync(dashboard(true));
      pitWall.sync(dashboard(true));
      expect(createdWindows).toHaveLength(1);
      expect(pitWall.isEnabled()).toBe(true);
      expect(host.onEnabledChange).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('leaves a window the user closed shut until they ask for it', () => {
      const pitWall = new PitWallWindow(createHost());
      pitWall.sync(dashboard(true));
      const [window] = createdWindows;
      // The user closes it: nothing prevents the close.
      const closing = { preventDefault: vi.fn() };
      window.emit('close', closing);
      expect(closing.preventDefault).not.toHaveBeenCalled();
      window.destroy();
      expect(pitWall.current).toBeUndefined();

      pitWall.sync(dashboard(true));
      expect(createdWindows).toHaveLength(1);

      expect(pitWall.show(dashboard(true))).toBe(true);
      expect(createdWindows).toHaveLength(2);
    });

    it('closes when the widget is switched off, and opens again when it is back on', () => {
      const host = createHost();
      const pitWall = new PitWallWindow(host);
      pitWall.sync(dashboard(true));
      const [window] = createdWindows;

      pitWall.sync(dashboard(false));
      expect(window.destroy).toHaveBeenCalledOnce();
      expect(pitWall.current).toBeUndefined();
      expect(pitWall.isEnabled()).toBe(false);
      expect(host.onEnabledChange).toHaveBeenLastCalledWith(false);

      pitWall.sync(dashboard(true));
      expect(createdWindows).toHaveLength(2);
    });

    it('closes when the profile has no Pit Wall widget at all', () => {
      const pitWall = new PitWallWindow(createHost());
      pitWall.sync(dashboard(true));
      pitWall.sync({ widgets: [] } as unknown as DashboardLayout);
      expect(createdWindows[0].destroy).toHaveBeenCalledOnce();
    });

    it('closes when the simulator that starts cannot support it', () => {
      const host = createHost();
      const pitWall = new PitWallWindow(host);
      pitWall.sync(dashboard(true));
      host.supported = false;
      pitWall.sync(dashboard(true));
      expect(createdWindows[0].destroy).toHaveBeenCalledOnce();
      expect(pitWall.isEnabled()).toBe(false);
    });

    it('does not report a change while nothing changes', () => {
      const host = createHost();
      const pitWall = new PitWallWindow(host);
      pitWall.sync(dashboard(false));
      pitWall.sync(dashboard(false));
      expect(host.onEnabledChange).not.toHaveBeenCalled();
    });
  });

  describe('upkeep', () => {
    it('tells the host when the page has loaded, unless the window is gone', () => {
      const host = createHost();
      new PitWallWindow(host).show(dashboard(true));
      const [window] = createdWindows;
      const loaded = window.webContents.handlers.get('did-finish-load');

      loaded?.();
      expect(host.onReady).toHaveBeenCalledOnce();

      window.destroyed = true;
      loaded?.();
      expect(host.onReady).toHaveBeenCalledOnce();
    });

    it.each(['show', 'restore'])(
      'asks for the session again on %s',
      (event) => {
        const host = createHost();
        new PitWallWindow(host).show(dashboard(true));
        const [window] = createdWindows;
        window.emit(event);
        expect(host.onShown).toHaveBeenCalledExactlyOnceWith(window);
      }
    );

    it('is destroyed on request, as quitting does', () => {
      const pitWall = new PitWallWindow(createHost());
      pitWall.show(dashboard(true));
      pitWall.destroy();
      expect(createdWindows[0].destroy).toHaveBeenCalledOnce();
      expect(pitWall.current).toBeUndefined();
      // Nothing to destroy the second time.
      pitWall.destroy();
      expect(createdWindows[0].destroy).toHaveBeenCalledOnce();
    });

    it('reopens after its renderer crashes', () => {
      const host = createHost();
      const pitWall = new PitWallWindow(host);
      pitWall.show(dashboard(true));
      const [window] = createdWindows;
      const crashed = window.webContents.handlers.get('render-process-gone');

      crashed?.({}, { reason: 'crashed', exitCode: 1 });
      expect(window.destroy).toHaveBeenCalledOnce();
      expect(pitWall.current).toBeUndefined();
      expect(createdWindows).toHaveLength(1);

      vi.advanceTimersByTime(1000);
      expect(createdWindows).toHaveLength(2);
      expect(pitWall.current).toBe(createdWindows[1]);
    });

    it('does not reopen after a crash while the app is quitting', () => {
      const host = createHost();
      const pitWall = new PitWallWindow(host);
      pitWall.show(dashboard(true));
      host.quitting = true;
      createdWindows[0].webContents.handlers.get('render-process-gone')?.(
        {},
        { reason: 'killed', exitCode: 1 }
      );
      vi.advanceTimersByTime(1000);
      expect(createdWindows).toHaveLength(1);
    });

    it('does not reopen after a crash once the widget has been switched off', () => {
      const host = createHost();
      const pitWall = new PitWallWindow(host);
      pitWall.show(dashboard(true));
      createdWindows[0].webContents.handlers.get('render-process-gone')?.(
        {},
        { reason: 'crashed', exitCode: 1 }
      );
      host.dashboard = dashboard(false);
      vi.advanceTimersByTime(1000);
      expect(createdWindows).toHaveLength(1);
    });
  });

  describe('remembering its place', () => {
    const chosen = { x: -1800, y: 60, width: 1500, height: 800 };

    it('opens where it was left, on the monitor it was left on', () => {
      state.saved = { bounds: chosen, maximized: false };
      new PitWallWindow(createHost()).show(dashboard(true));
      const [window] = createdWindows;
      expect(window.options).toMatchObject(chosen);
      window.ready();
      expect(window.maximize).not.toHaveBeenCalled();
      expect(window.setBounds).not.toHaveBeenCalled();
    });

    it('opens maximised again on that monitor', () => {
      state.saved = { bounds: chosen, maximized: true };
      new PitWallWindow(createHost()).show(dashboard(true));
      const [window] = createdWindows;
      expect(window.options).toMatchObject(chosen);
      window.ready();
      expect(window.maximize).toHaveBeenCalledOnce();
      expect(window.show).toHaveBeenCalledOnce();
    });

    it('moves a place that is off every screen onto the primary display', () => {
      // The monitor on the left has been unplugged.
      state.workAreas = [PRIMARY];
      state.saved = { bounds: chosen, maximized: false };
      new PitWallWindow(createHost()).show(dashboard(true));
      expect(createdWindows[0].options).toMatchObject({
        width: 1500,
        height: 800,
        x: 530,
        y: 340,
      });
    });

    it('rescues a window that still landed off screen, without saving the rescue', () => {
      new PitWallWindow(createHost()).show(dashboard(true));
      const [window] = createdWindows;
      const offScreen = { x: -30000, y: 100, width: 1600, height: 900 };
      window.rectangle = offScreen;
      window.normal = offScreen;

      window.ready();
      expect(window.setBounds).toHaveBeenCalledExactlyOnceWith({
        x: 480,
        y: 290,
        width: 1600,
        height: 900,
      });

      window.emit('moved');
      vi.advanceTimersByTime(250);
      expect(savePlacement).not.toHaveBeenCalled();
    });

    it.each(['moved', 'resized'])('saves the place after it is %s', (event) => {
      new PitWallWindow(createHost()).show(dashboard(true));
      const [window] = createdWindows;
      window.normal = chosen;
      window.emit(event);
      expect(savePlacement).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);
      expect(savePlacement).toHaveBeenCalledExactlyOnceWith({
        bounds: chosen,
        maximized: false,
      });
    });

    it('saves a maximised window as its normal rectangle and the fact', () => {
      new PitWallWindow(createHost()).show(dashboard(true));
      const [window] = createdWindows;
      window.normal = chosen;
      // What a maximised window reports: its monitor and a little more.
      window.rectangle = { x: -1928, y: -8, width: 1936, height: 1056 };
      window.maximized = true;
      window.emit('maximize');
      vi.advanceTimersByTime(250);
      expect(savePlacement).toHaveBeenCalledExactlyOnceWith({
        bounds: chosen,
        maximized: true,
      });

      window.maximized = false;
      window.emit('unmaximize');
      vi.advanceTimersByTime(250);
      expect(savePlacement).toHaveBeenLastCalledWith({
        bounds: chosen,
        maximized: false,
      });
    });

    it('does not take full screen for a place to remember', () => {
      new PitWallWindow(createHost()).show(dashboard(true));
      const [window] = createdWindows;
      window.fullScreen = true;
      window.emit('resized');
      vi.advanceTimersByTime(250);
      expect(savePlacement).not.toHaveBeenCalled();
    });

    it('saves a move still pending when the window closes', () => {
      new PitWallWindow(createHost()).show(dashboard(true));
      const [window] = createdWindows;
      window.normal = chosen;
      window.emit('moved');
      window.emit('close');
      expect(savePlacement).toHaveBeenCalledExactlyOnceWith({
        bounds: chosen,
        maximized: false,
      });
    });
  });
});
