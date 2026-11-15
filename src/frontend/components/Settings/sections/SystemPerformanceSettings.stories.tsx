import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { SystemPerformanceSettings } from './SystemPerformanceSettings';

const meta = {
  title: 'components/Settings/SystemPerformanceSettings',
  component: SystemPerformanceSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[760px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof SystemPerformanceSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Which rows are drawn and how they are laid out. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('systemPerformanceTab', 'options');
      return <Story />;
    },
  ],
};

/** The same tab at its last section: where a figure turns amber and red. */
export const Warnings: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('systemPerformanceTab', 'options');
      useEffect(() => {
        // The page waits for its dashboard, so the section is not there at
        // mount.
        const timer = window.setInterval(() => {
          const heading = [...document.querySelectorAll('h2, h3')].find(
            (element) => element.textContent === 'Warnings'
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
      localStorage.setItem('systemPerformanceTab', 'visibility');
      return <Story />;
    },
  ],
};
