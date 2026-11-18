import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import { DashboardProvider } from '@irdashies/context';
import { WidgetGroupSettings } from './WidgetGroupSettings';
import { dashboardBridgeWith } from './settingsStory';

const meta = {
  title: 'components/Settings/WidgetGroupSettings',
  component: WidgetGroupSettings,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof WidgetGroupSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Two widgets in the group, the second at a scale of its own. */
export const WithWidgets: Story = {
  render: () => (
    <DashboardProvider
      bridge={dashboardBridgeWith('widgetgroup', {
        members: [
          { widgetId: 'input', x: 0, y: 0, width: 400, height: 120 },
          {
            widgetId: 'weather',
            x: 410,
            y: 0,
            width: 190,
            height: 300,
            scale: 80,
          },
        ],
      })}
    >
      <div className="h-[1100px] w-[880px] bg-slate-900 p-6 text-white">
        <WidgetGroupSettings />
      </div>
    </DashboardProvider>
  ),
};

/** A second group, with a widget the first one does not hold. */
export const SecondGroup: Story = {
  render: () => (
    <DashboardProvider
      bridge={dashboardBridgeWith(
        'widgetgroup',
        {
          members: [{ widgetId: 'input', x: 0, y: 0, width: 400, height: 120 }],
        },
        [
          {
            id: 'widgetgroup-2',
            type: 'widgetgroup',
            enabled: true,
            layout: { x: 100, y: 500, width: 300, height: 300 },
            config: {
              members: [
                { widgetId: 'weather', x: 0, y: 0, width: 190, height: 300 },
              ],
            },
          },
        ]
      )}
    >
      <div className="h-[1100px] w-[880px] bg-slate-900 p-6 text-white">
        <WidgetGroupSettings widgetId="widgetgroup-2" />
      </div>
    </DashboardProvider>
  ),
};
