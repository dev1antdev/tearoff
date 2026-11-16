import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { PIT_WALL_WIDGET_ID, type DashboardLayout } from '@irdashies/types';
import logger from './logger';
import {
  readPitWallWindowPlacement,
  savePitWallWindowPlacement,
} from './storage/pitWallWindowBounds';
import { trackWindowMovement, wasMovedByApp } from './trackWindowMovement';
import {
  PIT_WALL_WINDOW_MIN_SIZE,
  defaultPitWallWindowBounds,
} from './windowBounds';
import { ensureWindowOnScreen, restoreWindowBounds } from './windowPlacement';

// used for Hot Module Replacement
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

export const PIT_WALL_WINDOW_TITLE = 'Tearoff - Pit Wall';

/** The id the window is known by to `onOverlayReady` listeners. */
export const PIT_WALL_WINDOW_ID = PIT_WALL_WIDGET_ID;

/** How the window is called in the log. */
const LOG_NAME = 'Pit Wall window';

/** What the window needs from the manager that owns it. */
export interface PitWallWindowHost {
  /** The app is closing: nothing is opened or reopened. */
  isQuitting(): boolean;
  /** Switched on by the user and supported by the running sim. */
  isWidgetVisible(widget: {
    id: string;
    type?: string;
    enabled: boolean;
  }): boolean;
  iconPath(): string;
  /** The baseline every window with the app preload gets. */
  harden(window: BrowserWindow): void;
  /** The page has loaded: the sim bridges send it what they hold. */
  onReady(): void;
  /** The window is on screen again: hand it the session it missed. */
  onShown(window: BrowserWindow): void;
  /** The dashboard to reopen from after the renderer has crashed. */
  currentDashboard(): DashboardLayout | undefined;
  /** The widget was switched on or off, or the sim stopped supporting it. */
  onEnabledChange(enabled: boolean): void;
}

/** Remember where the user left the window, not where the app put it. */
const persistPlacement = (browserWindow: BrowserWindow): void => {
  // Full screen is the page's doing and passes: the place to come back to is
  // the one the window had before it, which is already saved.
  if (browserWindow.isFullScreen()) return;
  // The rectangle the window has when it is neither maximised nor full
  // screen, so a maximised or full-screen window is not remembered as a
  // window the size of its monitor.
  const bounds = browserWindow.getNormalBounds();
  const maximized = browserWindow.isMaximized();
  if (!maximized && wasMovedByApp(browserWindow, bounds)) return;
  savePitWallWindowPlacement({ bounds, maximized });
};

/**
 * The Pit Wall is an ordinary framed window with a page of its own, on the
 * `#/pitwall` route, rather than a widget the overlay draws.
 *
 * Unlike the Gantry it holds nothing worth keeping: everything it shows comes
 * from the main process, so closing the window destroys it, and it is fed
 * like an overlay window, only while it is visible (rule R4.6). Owned by
 * OverlayManager, which knows the dashboard, the sim and when the app quits.
 */
export class PitWallWindow {
  private window: BrowserWindow | undefined;
  /** Last-applied enabled state, so `sync` only acts on changes. */
  private enabled = false;

  constructor(private readonly host: PitWallWindowHost) {}

  /** The open window, or undefined when there is none. */
  public get current(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  /** Whether the widget is on and the running sim can show it. */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Open the window, or bring it to the front.
   *
   * @returns `false` when the widget is switched off or unsupported by the
   * running sim and nothing was opened, so the caller can say why.
   */
  public show(dashboardLayout?: DashboardLayout): boolean {
    const widget = dashboardLayout?.widgets.find(
      (w) => w.id === PIT_WALL_WIDGET_ID
    );
    if (!widget || !this.host.isWidgetVisible(widget)) {
      logger.info(
        '[PitWallWindow] Window requested but the widget is disabled' +
          ' or unsupported by the running simulator'
      );
      return false;
    }

    const existing = this.current;
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return true;
    }

    this.create();
    return true;
  }

  /**
   * Bring the window in line with the dashboard: open it when the widget is
   * switched on, close it when it is not. Called on every dashboard update,
   * so toggling the widget or switching profile takes effect at once.
   */
  public sync(dashboardLayout?: DashboardLayout): void {
    const widget = dashboardLayout?.widgets.find(
      (w) => w.id === PIT_WALL_WIDGET_ID
    );
    const enabled = !!widget && this.host.isWidgetVisible(widget);
    const wasEnabled = this.enabled;
    this.enabled = enabled;
    if (enabled !== wasEnabled) this.host.onEnabledChange(enabled);

    if (enabled) {
      // Open on the off -> on edge only. A window the user closed stays
      // closed while they edit unrelated settings, until they ask for it.
      if (!wasEnabled) this.show(dashboardLayout);
      return;
    }

    if (this.current) {
      logger.info(
        '[PitWallWindow] Closing — widget disabled in the active dashboard'
      );
    }
    this.destroy();
  }

  /** Close the window without asking, as quitting does. */
  public destroy(): void {
    const browserWindow = this.current;
    this.window = undefined;
    browserWindow?.destroy();
  }

  private create(): void {
    const saved = readPitWallWindowPlacement();
    const bounds =
      restoreWindowBounds(saved?.bounds, LOG_NAME) ??
      defaultPitWallWindowBounds(screen.getPrimaryDisplay().workArea);

    const browserWindow = new BrowserWindow({
      title: PIT_WALL_WINDOW_TITLE,
      frame: true,
      ...bounds,
      minWidth: PIT_WALL_WINDOW_MIN_SIZE.width,
      minHeight: PIT_WALL_WINDOW_MIN_SIZE.height,
      // The page's own background, so the window does not flash white.
      backgroundColor: '#141a21',
      autoHideMenuBar: true,
      icon: this.host.iconPath(),
      show: false,
      // No backgroundThrottling override, unlike the Gantry: nothing here has
      // to keep running while the window is minimised or covered.
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
      },
    });

    this.window = browserWindow;
    this.host.harden(browserWindow);

    browserWindow.once('ready-to-show', () => {
      if (browserWindow.isDestroyed()) return;
      ensureWindowOnScreen(browserWindow, LOG_NAME);
      // After the rescue above, so it fills the monitor it can be reached on.
      if (saved?.maximized) browserWindow.maximize();
      browserWindow.show();
    });

    trackWindowMovement(browserWindow, persistPlacement, [
      'moved',
      'resized',
      'maximize',
      'unmaximize',
    ]);

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      browserWindow.loadURL(
        `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/${PIT_WALL_WIDGET_ID}`
      );
    } else {
      browserWindow.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
        { hash: `/${PIT_WALL_WIDGET_ID}` }
      );
    }

    // No close handler: closing destroys the window, and it stays closed
    // until the user asks for it again.
    browserWindow.on('closed', () => {
      if (this.window === browserWindow) this.window = undefined;
    });

    // Session data is not sent to a window that is not visible, so one that
    // comes back has to be handed the session as it is now. Electron emits
    // restore, not show, when a minimised window comes back.
    const resendSessionData = () => this.host.onShown(browserWindow);
    browserWindow.on('show', resendSessionData);
    browserWindow.on('restore', resendSessionData);

    browserWindow.webContents.on('did-finish-load', () => {
      if (browserWindow.isDestroyed()) return;
      this.host.onReady();
    });

    // Without this a renderer crash leaves a live-but-blank BrowserWindow that
    // still receives every message, and the stale reference makes the next
    // show call focus it instead of opening a working one.
    browserWindow.webContents.on('render-process-gone', (_event, details) => {
      logger.error(
        `[PitWallWindow] Renderer process gone: reason=${details.reason}, exitCode=${details.exitCode}`
      );
      if (this.window === browserWindow) this.window = undefined;
      if (!browserWindow.isDestroyed()) browserWindow.destroy();
      if (this.host.isQuitting()) return;

      setTimeout(() => {
        if (this.host.isQuitting() || this.current) return;
        logger.info('[PitWallWindow] Recreating renderer');
        this.show(this.host.currentDashboard());
      }, 1000);
    });
  }
}
