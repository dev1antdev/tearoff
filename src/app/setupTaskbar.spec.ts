import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverlayManager } from './overlayManager';
import type { KeybindingManager } from './keybindingManager';
import type { OverlayVisibility } from './overlayVisibility';

vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
if (!process.resourcesPath) {
  Object.defineProperty(process, 'resourcesPath', { value: '/resources' });
}

interface MenuItem {
  label: string;
  click?: (item: { checked: boolean }) => void;
}

const menus = vi.hoisted(() => [] as { label: string }[][]);

vi.mock('electron', () => ({
  nativeImage: { createFromPath: vi.fn(() => ({})) },
  Tray: class {
    setToolTip = vi.fn();
    on = vi.fn();
    setContextMenu = vi.fn((menu: { label: string }[]) => {
      menus.push(menu);
    });
  },
  Menu: { buildFromTemplate: vi.fn((template: unknown) => template) },
}));
// Only their types are used here; the real modules pull in the whole app.
vi.mock('./overlayManager', () => ({}));
vi.mock('./keybindingManager', () => ({}));

const { setupTaskbar, rebuildTaskbarMenu } = await import('./setupTaskbar');

const createApp = () => {
  let pitWallEnabled = false;
  const pitWallListeners = new Set<(enabled: boolean) => void>();
  const overlayManager = {
    focusSettingsWindow: vi.fn(),
    toggleLockOverlays: vi.fn(),
    quitApp: vi.fn(),
    isPitWallEnabled: vi.fn(() => pitWallEnabled),
    showPitWallWindow: vi.fn(() => true),
    onPitWallEnabledChange: vi.fn((listener: (enabled: boolean) => void) => {
      pitWallListeners.add(listener);
      return () => pitWallListeners.delete(listener);
    }),
  };
  const keybindingManager = {
    getBindings: vi.fn(() => ({
      'toggle-edit-mode': { accelerator: 'F6' },
      'save-telemetry': { accelerator: 'F7' },
    })),
    triggerAction: vi.fn(),
  };
  const overlayVisibility = {
    getState: vi.fn(() => ({ userHidden: false })),
    setUserHidden: vi.fn(),
    onChange: vi.fn(),
  };
  setupTaskbar(
    overlayManager as unknown as OverlayManager,
    keybindingManager as unknown as KeybindingManager,
    overlayVisibility as unknown as OverlayVisibility
  );
  return {
    overlayManager,
    setPitWallEnabled: (enabled: boolean) => {
      pitWallEnabled = enabled;
      pitWallListeners.forEach((listener) => listener(enabled));
    },
  };
};

const lastMenu = () => menus[menus.length - 1] as MenuItem[];
const labels = () => lastMenu().map((item) => item.label);

describe('tray menu', () => {
  beforeEach(() => {
    menus.length = 0;
  });

  it('does not list the Pit Wall while its widget is switched off', () => {
    createApp();
    expect(labels()).toEqual([
      'Settings',
      'Show Overlay',
      'Lock / Unlock (F6)',
      'Save Current Telemetry (F7)',
      'Quit',
    ]);
  });

  it('lists the Pit Wall under Settings once the widget is switched on', () => {
    const app = createApp();
    app.setPitWallEnabled(true);
    expect(labels().slice(0, 3)).toEqual([
      'Settings',
      'Pit Wall',
      'Show Overlay',
    ]);

    app.setPitWallEnabled(false);
    expect(labels()).not.toContain('Pit Wall');
  });

  it('opens the Pit Wall window from its item', () => {
    const app = createApp();
    app.setPitWallEnabled(true);
    lastMenu()
      .find((item) => item.label === 'Pit Wall')
      ?.click?.({ checked: false });
    expect(
      app.overlayManager.showPitWallWindow
    ).toHaveBeenCalledExactlyOnceWith();
  });

  it('keeps the item through a rebuild for another reason', () => {
    const app = createApp();
    app.setPitWallEnabled(true);
    rebuildTaskbarMenu();
    expect(labels()).toContain('Pit Wall');
  });
});
