import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { PitStopSettings } from './PitStopSettings';

const meta = {
  title: 'components/Settings/PitStopSettings',
  component: PitStopSettings,
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
} satisfies Meta<typeof PitStopSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The stop, the refuel and the rejoin. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('pitStopTab', 'options');
      return <Story />;
    },
  ],
};

/** The same tab further down: the refuel, the rejoin and the pit lane. */
export const RefuelAndRejoin: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('pitStopTab', 'options');
      useEffect(() => {
        // The page waits for its dashboard, so the section is not there at
        // mount.
        const timer = window.setInterval(() => {
          const heading = [...document.querySelectorAll('h2, h3')].find(
            (element) => element.textContent === 'Refuel'
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

/** The sessions it shows in, when it shows, and off track or not. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('pitStopTab', 'visibility');
      return <Story />;
    },
  ],
};
