import { useEffect } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { CruiseSettings } from './CruiseSettings';

const tab =
  (name: string): Decorator =>
  (Story) => {
    localStorage.setItem('cruiseTab', name);
    return <Story />;
  };

/**
 * Brings the section with this heading into view, as scrolling to it would.
 * The page waits for its dashboard, so the heading is looked for until it
 * turns up.
 */
const showSection =
  (title: string): Decorator =>
  (Story) => {
    useEffect(() => {
      const timer = window.setInterval(() => {
        const heading = [...document.querySelectorAll('h3')].find(
          (element) => element.textContent === title
        );
        if (!heading) return;
        window.clearInterval(timer);
        heading.scrollIntoView({ block: 'start' });
      }, 50);
      return () => window.clearInterval(timer);
    }, []);
    return <Story />;
  };

const meta = {
  title: 'components/Settings/CruiseSettings',
  component: CruiseSettings,
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
} satisfies Meta<typeof CruiseSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Which cells are drawn, and in what order. */
export const Display: Story = {
  decorators: [tab('display')],
};

/**
 * The layout, the units, the dial and the scope of the two totals, with
 * what the compass and the elevation are measured against.
 */
export const Options: Story = {
  decorators: [tab('options')],
};

/**
 * The end of the same tab: what the compass takes for north and what the
 * elevation is measured from.
 */
export const AboutTheReadings: Story = {
  decorators: [showSection('Totals'), tab('options')],
};

/** The sessions the widget shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [tab('visibility')],
};
