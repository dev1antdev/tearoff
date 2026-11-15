import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import {
  createMockBridgeWithConfig,
  mockDashboardBridge,
} from '@irdashies/storybook';
import { CarSystemsSettings } from './CarSystemsSettings';

const meta = {
  title: 'components/Settings/CarSystemsSettings',
  component: CarSystemsSettings,
  decorators: [
    (Story) => {
      localStorage.setItem('carSystemsTab', 'options');
      return (
        <div className="w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      );
    },
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof CarSystemsSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The display options, what happens when a dial moves, and a list of rows
 * for each simulator: iRacing's and Le Mans Ultimate's are saved apart.
 */
export const Options: Story = {
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <Story />
      </DashboardProvider>
    ),
  ],
};

/**
 * The same page scrolled to the Le Mans Ultimate list, which sits below the
 * iRacing one: the anti-roll bars, the wipers and the setup's regeneration
 * level are offered there and off.
 */
export const LmuRows: Story = {
  decorators: [
    (Story) => {
      useEffect(() => {
        // The page waits for its dashboard, so the list is not there at mount.
        const timer = window.setInterval(() => {
          const heading = [...document.querySelectorAll('h3')].find(
            (element) => element.textContent === 'Le Mans Ultimate Rows'
          );
          if (!heading) return;
          heading.scrollIntoView();
          window.clearInterval(timer);
        }, 50);
        return () => window.clearInterval(timer);
      }, []);
      return (
        <DashboardProvider bridge={mockDashboardBridge}>
          <Story />
        </DashboardProvider>
      );
    },
  ],
};

const onChangeBridge = createMockBridgeWithConfig({
  carsystems: { displayMode: 'onChange', changeHoldSeconds: 6 },
});

/** Shown only when a dial changes, which brings up the time it stays for. */
export const ShownOnChange: Story = {
  decorators: [
    (Story) => (
      <DashboardProvider bridge={onChangeBridge}>
        <Story />
      </DashboardProvider>
    ),
  ],
};
