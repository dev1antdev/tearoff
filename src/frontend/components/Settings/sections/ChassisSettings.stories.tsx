import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { ChassisSettings } from './ChassisSettings';

const meta = {
  title: 'components/Settings/ChassisSettings',
  component: ChassisSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ChassisSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The top of the page: the ride height row, its scale and bottoming heights. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('chassisTab', 'options');
      return <Story />;
    },
  ],
};

/**
 * The same page scrolled down: the three lengths the sim does not publish,
 * which turn rake and roll into angles, and the rows for the wheels.
 */
export const RakeRollAndWheels: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('chassisTab', 'options');
      useEffect(() => {
        // The page waits for its dashboard, so the section is not there at
        // mount.
        const timer = window.setInterval(() => {
          const heading = [...document.querySelectorAll('h3')].find(
            (element) => element.textContent === 'Rake and Roll'
          );
          if (!heading) return;
          heading.scrollIntoView();
          window.clearInterval(timer);
        }, 50);
        return () => window.clearInterval(timer);
      }, []);
      return <Story />;
    },
  ],
};

/** The sessions the widget shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('chassisTab', 'visibility');
      return <Story />;
    },
  ],
};
