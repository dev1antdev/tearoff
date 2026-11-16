import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardLayout, DashboardWidget } from '@irdashies/types';

// `declare const` globals injected by the Forge/Vite plugin.
vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');
vi.stubGlobal('APP_GIT_HASH', 'test');
// Only set inside a packaged Electron process; getIconPath() reads it.
if (!process.resourcesPath) {
  Object.defineProperty(process, 'resourcesPath', { value: '/resources' });
}

const DISPLAY = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};

const createdWindows: FakeBrowserWindow[] = [];

class FakeWebContents {
  id = 100 + createdWindows.length;
  send = vi.fn();
  on = vi.fn();
  isDestroyed = vi.fn(() => false);
  setWindowOpenHandler = vi.fn();
}

class FakeBrowserWindow {
  static getAllWindows = vi.fn(() => []);
  static fromWebContents = vi.fn(
    (webContents: FakeWebContents) =>
      createdWindows.find((w) => w.webContents === webContents) ?? null
  );
  webContents = new FakeWebContents();
  destroyed = false;
  shown = false;
  show = vi.fn(() => {
    this.shown = true;
  });
  showInactive = vi.fn(() => {
    this.shown = true;
  });
  focus = vi.fn();
  hide = vi.fn();
  close = vi.fn();
  destroy = vi.fn(() => {
    this.destroyed = true;
  });
  isDestroyed = vi.fn(() => this.destroyed);
  isVisible = vi.fn(() => this.shown);
  isMinimized = vi.fn(() => false);
  isMaximized = vi.fn(() => false);
  isFullScreen = vi.fn(() => false);
  maximize = vi.fn();
  restore = vi.fn();
  loadURL = vi.fn();
  loadFile = vi.fn();
  getBounds = vi.fn(() => ({ x: 0, y: 0, width: 1600, height: 900 }));
  getNormalBounds = vi.fn(() => ({ x: 0, y: 0, width: 1600, height: 900 }));
  setBounds = vi.fn();
  setPosition = vi.fn();
  setSize = vi.fn();
  setAlwaysOnTop = vi.fn();
  setIgnoreMouseEvents = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  moveTop = vi.fn();
  once = vi.fn();
  on = vi.fn();

  constructor(public options: Record<string, unknown>) {
    createdWindows.push(this);
  }
}

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.0.0',
    getPath: () => '/tmp/irdashies-test',
    quit: vi.fn(),
    disableHardwareAcceleration: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
  },
  BrowserWindow: FakeBrowserWindow,
  Notification: vi.fn(),
  screen: {
    getAllDisplays: vi.fn(() => [DISPLAY]),
    getPrimaryDisplay: vi.fn(() => DISPLAY),
    on: vi.fn(),
  },
}));

vi.mock('./storage/storage', () => ({ readData: vi.fn(), writeData: vi.fn() }));
vi.mock('./storage/dashboards', () => ({
  getDashboard: vi.fn(),
  getCurrentProfileId: () => 'default',
}));
vi.mock('./storage/chromiumFlags', () => ({
  getChromiumFlags: vi.fn(() => ({})),
  parseCustomSwitches: vi.fn(() => []),
}));
vi.mock('./trackWindowMovement', () => ({
  trackSettingsWindowMovement: vi.fn(),
  trackWindowMovement: vi.fn(),
  wasMovedByApp: vi.fn(() => false),
  markCorrectedBounds: vi.fn(),
}));
vi.mock('./perfRendererArguments', () => ({
  createRendererPerfArguments: vi.fn(() => []),
}));
vi.mock('./hardenWindow', () => ({ hardenWindow: vi.fn() }));
const simWidgetSupport = vi.hoisted(() => ({
  message: 'This widget is not compatible with the running sim',
  disabledWidgets: { iracing: [] as string[], lmu: [] as string[] },
}));
vi.mock('./storage/simWidgetSupport', () => ({
  getSimWidgetSupport: () => simWidgetSupport,
}));
vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { OverlayManager } = await import('./overlayManager');
const { hardenWindow } = await import('./hardenWindow');
const { app } = await import('electron');

const pitWallWidget = (enabled: boolean): DashboardWidget => ({
  id: 'pitwall',
  enabled,
  // The size of its settings preview, which would cover the whole display.
  layout: { x: 0, y: 0, width: 1600, height: 900 },
  config: { layout: 'race' },
});

const dashboard = (
  enabled: boolean,
  generalSettings: DashboardLayout['generalSettings'] = undefined
) =>
  ({ widgets: [pitWallWidget(enabled)], generalSettings }) as DashboardLayout;

const pitWallWindows = () =>
  createdWindows.filter((w) => w.options.title === 'Tearoff - Pit Wall');

const allSubscribed = () => ({
  has: vi.fn(() => true),
  hasAny: vi.fn(() => false),
});

describe('OverlayManager Pit Wall window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createdWindows.length = 0;
    simWidgetSupport.disabledWidgets.iracing = [];
    simWidgetSupport.disabledWidgets.lmu = [];
  });

  it('opens with the overlays when the widget is on, and is hardened', () => {
    const manager = new OverlayManager();
    manager.createOverlays(dashboard(true), { createSettingsWindow: false });

    const [window] = pitWallWindows();
    expect(window).toBeDefined();
    expect(manager.isPitWallEnabled()).toBe(true);
    expect(hardenWindow).toHaveBeenCalledWith(
      window,
      expect.objectContaining({ label: 'Pit Wall' })
    );
  });

  it('stays shut while the widget is off', () => {
    const manager = new OverlayManager();
    manager.createOverlays(dashboard(false), { createSettingsWindow: false });
    expect(pitWallWindows()).toHaveLength(0);
    expect(manager.isPitWallEnabled()).toBe(false);
    expect(manager.showPitWallWindow(dashboard(false))).toBe(false);
  });

  it('follows the switch on a dashboard update, and tells the tray', () => {
    const manager = new OverlayManager();
    const onChange = vi.fn();
    manager.onPitWallEnabledChange(onChange);
    manager.createOverlays(dashboard(false), { createSettingsWindow: false });

    manager.closeOrCreateWindows(dashboard(true));
    expect(pitWallWindows()).toHaveLength(1);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);

    // Unrelated saves leave it alone.
    manager.closeOrCreateWindows(dashboard(true));
    expect(pitWallWindows()).toHaveLength(1);
    expect(onChange).toHaveBeenCalledOnce();

    manager.closeOrCreateWindows(dashboard(false));
    expect(pitWallWindows()[0].destroy).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('shows the window for the dashboard in use when none is named', () => {
    const manager = new OverlayManager();
    expect(manager.showPitWallWindow()).toBe(false);

    manager.createOverlays(dashboard(true), { createSettingsWindow: false });
    const [window] = pitWallWindows();
    expect(manager.showPitWallWindow()).toBe(true);
    expect(window.focus).toHaveBeenCalledOnce();
    expect(pitWallWindows()).toHaveLength(1);
  });

  it('closes under a simulator that cannot support the widget', () => {
    const manager = new OverlayManager();
    manager.createOverlays(dashboard(true), { createSettingsWindow: false });
    const [window] = pitWallWindows();

    simWidgetSupport.disabledWidgets.lmu = ['pitwall'];
    manager.setActiveSimulator('lmu');
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(manager.isPitWallEnabled()).toBe(false);
  });

  it('never gives the widget an overlay window of its own', () => {
    const manager = new OverlayManager();
    manager.createOverlays(dashboard(true, { overlayWindowMode: 'widget' }), {
      createSettingsWindow: false,
    });
    expect(manager.getOverlays()).toHaveLength(0);
    expect(pitWallWindows()).toHaveLength(1);
    expect(
      createdWindows.filter((w) => w.options.title !== 'Tearoff - Pit Wall')
    ).toHaveLength(0);
  });

  it('does not stretch the overlay window over the widget’s preview size', () => {
    const manager = new OverlayManager();
    const layout = dashboard(true);
    layout.widgets.push({
      id: 'fuel',
      enabled: true,
      layout: { x: 100, y: 100, width: 300, height: 200 },
    });
    manager.createOverlays(layout, { createSettingsWindow: false });
    const [overlay] = manager.getOverlays();

    manager.updateOverlayBounds(layout);
    // The fuel widget and its padding, not the 1600 by 900 of the Pit Wall.
    expect(overlay.window.setBounds).toHaveBeenLastCalledWith({
      x: 80,
      y: 80,
      width: 340,
      height: 240,
    });
  });

  describe('feeding', () => {
    const open = () => {
      const manager = new OverlayManager();
      const subscriptions = allSubscribed();
      manager.setRendererDataSubscriptions(subscriptions);
      manager.createOverlays(dashboard(true), { createSettingsWindow: false });
      const [window] = pitWallWindows();
      window.webContents.send.mockClear();
      return { manager, subscriptions, window };
    };

    it('sends session data only while the window is visible', () => {
      const { manager, window } = open();

      manager.publishMessage('sessionData', { revision: 1 });
      expect(window.webContents.send).not.toHaveBeenCalled();

      window.shown = true;
      manager.publishMessage('sessionData', { revision: 2 });
      expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(
        'sessionData',
        { revision: 2 }
      );
    });

    it('sends session data only to a subscribed window', () => {
      const { manager, subscriptions, window } = open();
      window.shown = true;
      subscriptions.has.mockReturnValue(false);
      manager.publishMessage('sessionData', { revision: 1 });
      expect(window.webContents.send).not.toHaveBeenCalled();
    });

    it('forwards what every window is told, such as a dashboard update', () => {
      const { manager, window } = open();
      manager.publishMessage('dashboardUpdated', { widgets: [] });
      manager.publishMessage('runningState', true);
      expect(window.webContents.send).toHaveBeenCalledWith('dashboardUpdated', {
        widgets: [],
      });
      expect(window.webContents.send).toHaveBeenCalledWith(
        'runningState',
        true
      );
    });

    it('is not one of the renderers fed while hidden', () => {
      const { manager, window } = open();
      const sender = window.webContents as unknown as Electron.WebContents;
      manager.publishMessage('sessionData', { revision: 1 });

      expect(manager.isGantryWebContents(sender)).toBe(false);
      // Hidden: no seed, unlike the Gantry and the settings window.
      expect(manager.seedSessionData(sender)).toBe(false);
      expect(window.webContents.send).not.toHaveBeenCalled();

      window.shown = true;
      expect(manager.seedSessionData(sender)).toBe(true);
      expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(
        'sessionData',
        { revision: 1 }
      );
    });

    it('is handed the session it missed when it comes back on screen', () => {
      const { manager, window } = open();
      manager.publishMessage('sessionData', { revision: 3 });
      const shown = window.on.mock.calls.find(
        ([event]) => event === 'show'
      )?.[1] as () => void;
      const restored = window.on.mock.calls.find(
        ([event]) => event === 'restore'
      )?.[1] as () => void;

      window.shown = true;
      shown();
      restored();
      expect(window.webContents.send).toHaveBeenCalledTimes(2);
      expect(window.webContents.send).toHaveBeenLastCalledWith('sessionData', {
        revision: 3,
      });
    });

    it('is seeded by the sim bridges as "pitwall" when its page loads', () => {
      const { manager, window } = open();
      const onReady = vi.fn();
      manager.onOverlayReady(onReady);
      const loaded = window.webContents.on.mock.calls.find(
        ([event]) => event === 'did-finish-load'
      )?.[1] as () => void;

      loaded();
      expect(onReady).toHaveBeenCalledExactlyOnceWith('pitwall');

      manager.publishMessageToOverlay('pitwall', 'runningState', true);
      expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(
        'runningState',
        true
      );

      // Session data still goes only to a visible window.
      window.webContents.send.mockClear();
      manager.publishMessageToOverlay('pitwall', 'sessionData', { r: 1 });
      expect(window.webContents.send).not.toHaveBeenCalled();
      window.shown = true;
      manager.publishMessageToOverlay('pitwall', 'sessionData', { r: 2 });
      expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(
        'sessionData',
        { r: 2 }
      );
    });

    it('stops being sent anything once it is closed', () => {
      const { manager, window } = open();
      window.shown = true;
      const closed = window.on.mock.calls.find(
        ([event]) => event === 'closed'
      )?.[1] as () => void;
      window.destroyed = true;
      closed();

      manager.publishMessage('runningState', true);
      manager.publishMessageToOverlay('pitwall', 'runningState', true);
      expect(window.webContents.send).not.toHaveBeenCalled();
    });
  });

  it('is destroyed when the app quits', () => {
    const manager = new OverlayManager();
    manager.createOverlays(dashboard(true), { createSettingsWindow: false });
    const [window] = pitWallWindows();

    manager.quitApp();
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
  });
});
