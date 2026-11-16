import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { FuelSaverSettings } from './FuelSaverSettings';

const meta = {
  title: 'components/Settings/FuelSaverSettings',
  component: FuelSaverSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[900px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof FuelSaverSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** What the targets are compared with, and how many of them there are. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('fuelSaverTab', 'options');
      return <Story />;
    },
  ],
};

/** The same tab further down: the columns and the stop line. */
export const Targets: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('fuelSaverTab', 'options');
      useEffect(() => {
        // The page waits for its dashboard, so the section is not there at
        // mount.
        const timer = window.setInterval(() => {
          const heading = [...document.querySelectorAll('h2, h3')].find(
            (element) => element.textContent === 'Consumption'
          );
          if (!heading) return;
          window.clearInterval(timer);
          heading.scrollIntoView({ block: 'start' });
        }, 50);
        return () => window.clearInterval(timer);
      }, []);
      return <Story />;
    },
  ],
};

/** The sessions it shows in, and off track or not. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('fuelSaverTab', 'visibility');
      return <Story />;
    },
  ],
};
