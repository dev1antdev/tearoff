import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import {
  createMockBridgeWithConfig,
  mockDashboardBridge,
} from '@irdashies/storybook';
import { TyresSettings } from './TyresSettings';

const meta = {
  title: 'components/Settings/TyresSettings',
  component: TyresSettings,
  decorators: [
    (Story) => {
      localStorage.setItem('tyresTab', 'options');
      return (
        <div className="w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      );
    },
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof TyresSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The top of the page, as a new dashboard has it. */
export const Options: Story = {
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <Story />
      </DashboardProvider>
    ),
  ],
};

const everyRowBridge = createMockBridgeWithConfig({
  tyres: {
    showLoad: true,
    showDeflection: true,
    showPressureDeviation: true,
    pressureTarget: { enabled: true, front: 186, rear: 186, tolerance: 3.5 },
  },
});

/**
 * The same page scrolled to its last two sections, with every row switched
 * on: the cold-tyre threshold and the pressure offsets under the targets,
 * then load and deflection, each with the threshold it turns red at.
 */
export const PressureLoadAndDeflection: Story = {
  decorators: [
    (Story) => {
      useEffect(() => {
        // The page waits for its dashboard, so the section is not there at
        // mount.
        const timer = window.setInterval(() => {
          const heading = [...document.querySelectorAll('h3')].find(
            (element) => element.textContent === 'Pressure'
          );
          if (!heading) return;
          heading.scrollIntoView();
          window.clearInterval(timer);
        }, 50);
        return () => window.clearInterval(timer);
      }, []);
      return (
        <DashboardProvider bridge={everyRowBridge}>
          <Story />
        </DashboardProvider>
      );
    },
  ],
};
