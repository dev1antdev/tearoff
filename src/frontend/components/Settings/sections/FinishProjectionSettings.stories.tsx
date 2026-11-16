import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { FinishProjectionSettings } from './FinishProjectionSettings';

const meta = {
  title: 'components/Settings/FinishProjectionSettings',
  component: FinishProjectionSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[1000px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof FinishProjectionSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The page from the top: what it is, and the stop columns. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('finishProjectionTab', 'options');
      return <Story />;
    },
  ],
};

/** Brings a section of the options tab to the top of the page. */
const scrolledTo = (title: string): Story => ({
  decorators: [
    (Story) => {
      localStorage.setItem('finishProjectionTab', 'options');
      useEffect(() => {
        // The page waits for its dashboard, so the section is not there at
        // mount.
        const timer = window.setInterval(() => {
          const heading = [...document.querySelectorAll('h2, h3')].find(
            (element) => element.textContent === title
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
});

/** The same tab further down: the stop lengths and the three stop columns. */
export const StopColumns: Story = scrolledTo('Stop Columns');

/** Further down still: the finish, the refuel rows and the rivals. */
export const RefuelAndRivals: Story = scrolledTo('Finish');

/** The sessions it shows in, and off track or not. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('finishProjectionTab', 'visibility');
      return <Story />;
    },
  ],
};
