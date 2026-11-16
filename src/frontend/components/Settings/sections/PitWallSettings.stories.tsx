import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { PitWallSettings } from './PitWallSettings';

const meta = {
  title: 'components/Settings/PitWallSettings',
  component: PitWallSettings,
  decorators: [
    (Story) => {
      // No window can be opened from a story: the button answers as it does
      // while the widget is switched off, which shows its hint.
      window.pitWallBridge = { showWindow: async () => false };
      return (
        <DashboardProvider bridge={mockDashboardBridge}>
          <div className="settings-shell h-[900px] w-[880px] bg-slate-900 p-6 text-white">
            <Story />
          </div>
        </DashboardProvider>
      );
    },
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof PitWallSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The window, the layout, the page's scale, and what this stage is. */
export const Options: Story = {};
