import { nativeImage, Tray, Menu } from 'electron';
import { OverlayManager } from './overlayManager';
import { KeybindingManager } from './keybindingManager';
import type { OverlayVisibility } from './overlayVisibility';
import path from 'node:path';

/** A menu label with its shortcut after it, when it has one. */
const withShortcut = (
  label: string,
  accelerator: string | undefined
): string => (accelerator ? `${label} (${accelerator})` : label);

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;

const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;

function getIconPath(): string {
  const basePath = isDev
    ? path.join(__dirname, '../../docs/assets/icons')
    : path.join(process.resourcesPath, 'icons');

  return path.join(basePath, 'logo-tray.png');
}

class Taskbar {
  private tray: Tray;

  constructor(
    private overlayManager: OverlayManager,
    private keybindingManager: KeybindingManager,
    private overlayVisibility: OverlayVisibility
  ) {
    this.tray = this.createTray();
    this.buildContextMenu();
    // The tick has to follow the shortcut and the settings window too.
    this.overlayVisibility.onChange(() => this.buildContextMenu());
  }

  private createTray(): Tray {
    const iconPath = getIconPath();
    const icon = nativeImage.createFromPath(iconPath);

    const tray = new Tray(icon);
    tray.setToolTip('Tearoff');

    tray.on('click', () => {
      this.overlayManager.focusSettingsWindow();
    });

    return tray;
  }

  public buildContextMenu(): void {
    const bindings = this.keybindingManager.getBindings();

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Settings',
        click: () => {
          this.overlayManager.focusSettingsWindow();
        },
      },
      {
        // Ticked while the overlay is on. A paused game can still have it
        // off the screen; this is the driver's own switch.
        label: withShortcut(
          'Show Overlay',
          bindings['toggle-hide-ui']?.accelerator
        ),
        type: 'checkbox',
        checked: !this.overlayVisibility.getState().userHidden,
        click: (item) => {
          this.overlayVisibility.setUserHidden(!item.checked);
        },
      },
      {
        label: `Lock / Unlock (${bindings['toggle-edit-mode'].accelerator})`,
        click: () => {
          this.overlayManager.toggleLockOverlays();
        },
      },
      {
        label: `Save Current Telemetry (${bindings['save-telemetry'].accelerator})`,
        click: () => {
          this.keybindingManager.triggerAction('save-telemetry');
        },
      },
      {
        label: 'Quit',
        click: () => {
          this.overlayManager.quitApp();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }
}

let taskbarInstance: Taskbar | undefined;

export const setupTaskbar = (
  overlayManager: OverlayManager,
  keybindingManager: KeybindingManager,
  overlayVisibility: OverlayVisibility
) => {
  taskbarInstance = new Taskbar(
    overlayManager,
    keybindingManager,
    overlayVisibility
  );
};

export const rebuildTaskbarMenu = () => {
  taskbarInstance?.buildContextMenu();
};
