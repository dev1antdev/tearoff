import type { Decorator } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import {
  defaultDashboard,
  type BrowserAccess,
  type BrowserAccessBridge,
  type DashboardBridge,
  type GeneralSettingsType,
} from '@irdashies/types';
import { DashboardProvider } from '../src/frontend/context';
import { mockDashboardBridge } from './mockDashboardBridge';

/**
 * The built-in web server as the settings stories stage it. The keys are
 * made up for the stories: no server holds them.
 */
export const STORY_DEVICE_KEY = 'Xq3vN8rT2mKp7wYd5sHc9LbZ4gJf6aUe';
const NEXT_STORY_DEVICE_KEY = 'b7Rk2PzW9nLx4TqV6hYc1MdS8gFj3uAe';

/** Answering this PC only, as a new install does. */
export const storyAccessThisPcOnly: BrowserAccess = {
  listening: true,
  port: 3000,
  networkAccess: false,
  host: null,
  key: null,
  devices: 0,
};

/** Open to the network, with a tablet connected. */
export const storyAccessOpen: BrowserAccess = {
  listening: true,
  port: 3000,
  networkAccess: true,
  host: '192.168.1.50',
  key: STORY_DEVICE_KEY,
  devices: 1,
};

/** The main process as the settings window hears it, with one more key. */
export const storyAccessBridge = (
  access: BrowserAccess
): BrowserAccessBridge => ({
  getAccess: async () => access,
  replaceKey: async () => ({
    ...access,
    key: NEXT_STORY_DEVICE_KEY,
    devices: 0,
  }),
  onDevicesChanged: (callback) => {
    callback(access.devices);
    return () => undefined;
  },
});

/** A dashboard bridge whose General settings say what the switches say. */
export const storyDashboardWith = (
  general: GeneralSettingsType
): DashboardBridge => ({
  ...mockDashboardBridge,
  dashboardUpdated: (callback) => {
    callback(
      {
        ...defaultDashboard,
        generalSettings: { ...defaultDashboard.generalSettings, ...general },
      },
      undefined
    );
    return () => undefined;
  },
});

/**
 * Puts a settings story in the settings window's shell, with a router for
 * its links, a dashboard whose switches say `general`, and the preload
 * bridge answering as `access`.
 */
export const BrowserAccessDecorator =
  (
    access: BrowserAccess,
    general: GeneralSettingsType = {},
    frameClass = 'w-[880px]'
  ): Decorator =>
  (Story) => {
    window.browserAccessBridge = storyAccessBridge(access);
    return (
      <MemoryRouter>
        <DashboardProvider bridge={storyDashboardWith(general)}>
          <div
            className={`settings-shell bg-slate-900 p-6 text-white ${frameClass}`}
          >
            <Story />
          </div>
        </DashboardProvider>
      </MemoryRouter>
    );
  };
