import { useEffect } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { LiftCoastSettings } from './LiftCoastSettings';

const meta = {
  title: 'components/Settings/LiftCoastSettings',
  component: LiftCoastSettings,
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
} satisfies Meta<typeof LiftCoastSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Opens a tab, and brings the section with this heading into view. */
const open =
  (tab: string, section?: string): Decorator =>
  (Story) => {
    localStorage.setItem('liftCoastTab', tab);
    useEffect(() => {
      if (!section) return;
      // The page waits for its dashboard, so the section is not there at
      // mount.
      const timer = window.setInterval(() => {
        const heading = [...document.querySelectorAll('h2, h3')].find(
          (element) => element.textContent === section
        );
        if (!heading) return;
        window.clearInterval(timer);
        heading.scrollIntoView({ block: 'start' });
      }, 50);
      return () => window.clearInterval(timer);
    }, []);
    return <Story />;
  };

/** The strip itself: how many lights, and which way they fill. */
export const Options: Story = { decorators: [open('options')] };

/**
 * The same tab further down: the lift-and-coast stage and the assists. The
 * lock and wheelspin stages are greyed until something measures the slip
 * ratio.
 */
export const Stages: Story = {
  decorators: [open('options', 'Lift And Coast')],
};

/** The sessions the strip shows in, and when it hides. */
export const Visibility: Story = { decorators: [open('visibility')] };
