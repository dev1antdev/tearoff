import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { StintHistorySettings } from './StintHistorySettings';

const meta = {
  title: 'components/Settings/StintHistorySettings',
  component: StintHistorySettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[860px] w-[880px] overflow-y-auto bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof StintHistorySettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Scrolls the page to the section under a heading, once it is there. */
const useScrollToSection = (title: string) => {
  useEffect(() => {
    // The page waits for its dashboard, so the section is not there at mount.
    const timer = window.setInterval(() => {
      const heading = [...document.querySelectorAll('h2, h3')].find(
        (element) => element.textContent === title
      );
      if (!heading) return;
      window.clearInterval(timer);
      heading.scrollIntoView({ block: 'start' });
    }, 50);
    return () => window.clearInterval(timer);
  }, [title]);
};

/** Which stints are listed. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('stintHistoryTab', 'options');
      return <Story />;
    },
  ],
};

/** The same tab at its last section: the columns of the table. */
export const Columns: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('stintHistoryTab', 'options');
      useScrollToSection('Columns');
      return <Story />;
    },
  ],
};

/** The sessions the widget shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('stintHistoryTab', 'visibility');
      return <Story />;
    },
  ],
};
