import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { ClassFieldsSettings } from './ClassFieldsSettings';

const meta = {
  title: 'components/Settings/ClassFieldsSettings',
  component: ClassFieldsSettings,
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
} satisfies Meta<typeof ClassFieldsSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The chips, the order of the classes and the counts each chip shows. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('classFieldsTab', 'options');
      return <Story />;
    },
  ],
};

/** The sessions the summary shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('classFieldsTab', 'visibility');
      return <Story />;
    },
  ],
};
