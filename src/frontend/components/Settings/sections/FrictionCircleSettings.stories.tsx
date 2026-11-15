import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { FrictionCircleSettings } from './FrictionCircleSettings';

const meta = {
  title: 'components/Settings/FrictionCircleSettings',
  component: FrictionCircleSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[860px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof FrictionCircleSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The scale and direction of the circle, and what is drawn on it. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('frictionCircleTab', 'options');
      return <Story />;
    },
  ],
};

/** The last section of the same tab: the trail and how long it is. */
export const Trail: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('frictionCircleTab', 'options');
      useEffect(() => {
        // The page waits for its dashboard, so the section is not there at
        // mount.
        const timer = window.setInterval(() => {
          const heading = [...document.querySelectorAll('h2, h3')].find(
            (element) => element.textContent === 'Trail'
          );
          if (!heading) return;
          window.clearInterval(timer);
          heading.scrollIntoView({ block: 'center' });
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
      localStorage.setItem('frictionCircleTab', 'visibility');
      return <Story />;
    },
  ],
};
