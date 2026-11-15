import { useEffect } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import {
  createMockBridgeWithConfig,
  mockDashboardBridge,
} from '@irdashies/storybook';
import type { DashboardBridge } from '@irdashies/types';
import { HybridSettings } from './HybridSettings';

const meta = {
  title: 'components/Settings/HybridSettings',
  component: HybridSettings,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof HybridSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Opens a tab on a dashboard, and brings the section with this heading into
 * view.
 */
const open =
  (
    tab: string,
    section?: string,
    bridge: DashboardBridge = mockDashboardBridge
  ): Decorator =>
  (Story) => {
    localStorage.setItem('hybridTab', tab);
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
    return (
      <DashboardProvider bridge={bridge}>
        <div className="h-[760px] w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    );
  };

/** How it is drawn, and where the charge turns red and amber. */
export const Options: Story = { decorators: [open('options')] };

/** The same tab further down: the figures for the lap. */
export const ThisLap: Story = { decorators: [open('options', 'This Lap')] };

/** The motor row switched on, which opens its own settings. */
export const MotorRow: Story = {
  decorators: [
    open(
      'options',
      'Motor',
      createMockBridgeWithConfig({ hybrid: { showMotor: true } })
    ),
  ],
};

/** The sessions the widget shows in, and whether it hides off track. */
export const Visibility: Story = { decorators: [open('visibility')] };
