import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { ClassRivalsSettings } from './ClassRivalsSettings';

const meta = {
  title: 'components/Settings/ClassRivalsSettings',
  component: ClassRivalsSettings,
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
} satisfies Meta<typeof ClassRivalsSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The page from the top: what it is, how many cars and which columns. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('classRivalsTab', 'options');
      return <Story />;
    },
  ],
};

/** The sessions it shows in, and off track or not. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('classRivalsTab', 'visibility');
      return <Story />;
    },
  ],
};
