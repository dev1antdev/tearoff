import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { DamageSettings } from './DamageSettings';

const meta = {
  title: 'components/Settings/DamageSettings',
  component: DamageSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-[820px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof DamageSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** What the diagram draws: the figure in the car and the three marks. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('damageTab', 'options');
      return <Story />;
    },
  ],
};

/** The same tab further down: the four warnings and the repair line. */
export const Figures: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('damageTab', 'options');
      useEffect(() => {
        // The page waits for its dashboard, so the section is not there at
        // mount.
        const timer = window.setInterval(() => {
          const heading = [...document.querySelectorAll('h2, h3')].find(
            (element) => element.textContent === 'Figures'
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

/** The sessions it shows in, off track or not, and only when damaged. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('damageTab', 'visibility');
      return <Story />;
    },
  ],
};
