import { useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChannelSnapshotDecorator,
  mockDashboardBridge,
  timingTowerRace,
} from '@irdashies/storybook';
import {
  DashboardProvider,
  useDashboard,
  useSessionStore,
} from '@irdashies/context';
import { pitWallHostedDashboard, type PitWallSlot } from '@irdashies/types';
import { PitWallPanel } from '../PitWall/components/PitWallPanel/PitWallPanel';
import { ThemeManager } from '../ThemeManager/ThemeManager';
import { PanelContent } from './PitWallHost';

/**
 * The Timing Tower as a panel of the Pit Wall would hold it, before any
 * layout of the page names it: the page's own frame around the widget,
 * hosted exactly as the page hosts its panels, at the size of a panel.
 *
 * On the staged eight-hour race of `.storybook/timingTowerStage.ts`.
 */

const TOWER = 'timingtower';

/**
 * The slot a layout would give the tower. It leaves columns out on a narrow
 * panel by itself, so the width below which the page scales a widget down
 * is set low: the tower is shrunk only where even its three fixed columns
 * would not fit.
 */
const SLOT: PitWallSlot = { widget: TOWER, rows: 12, minWidth: 420 };

const HOSTED = new Set([TOWER]);

interface TowerPanelProps {
  width: number;
  height: number;
}

const TowerPanel = ({ width, height }: TowerPanelProps) => {
  const { currentDashboard } = useDashboard();
  const widget = currentDashboard?.widgets.find((entry) => entry.id === TOWER);
  const hosted = useMemo(
    () => pitWallHostedDashboard(currentDashboard, HOSTED),
    [currentDashboard]
  );
  if (!widget) return null;
  return (
    // The page behind a panel, and a grid cell of the size asked for.
    <div className="grid bg-settings-page p-3" style={{ width, height }}>
      <PitWallPanel title="Timing Tower" onOpenSettings={() => undefined}>
        <PanelContent
          widget={widget}
          slot={SLOT}
          running
          hostedDashboard={hosted}
        />
      </PitWallPanel>
    </div>
  );
};

const meta: Meta<typeof TowerPanel> = {
  component: TowerPanel,
  title: 'widgets/TimingTower/Pit Wall panel',
  parameters: { layout: 'fullscreen' },
  loaders: [
    async () => {
      useSessionStore.setState({ session: timingTowerRace.session });
    },
  ],
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <ThemeManager>
          <Story />
        </ThemeManager>
      </DashboardProvider>
    ),
    ChannelSnapshotDecorator(timingTowerRace.snapshots),
  ],
};
export default meta;
type Story = StoryObj<typeof TowerPanel>;

/**
 * A panel about 900 by 980, as on the Race page of a 1920 by 1080 window:
 * every column, and the whole of a class without scrolling.
 */
export const RacePanel: Story = { args: { width: 900, height: 980 } };

/**
 * A panel about 560 wide, as on the Compact page: the tower leaves out the
 * columns that do not fit and keeps the place, the driver, the gap, the
 * last lap and the three pace columns.
 */
export const CompactPanel: Story = { args: { width: 560, height: 720 } };

/**
 * A short panel: the list scrolls inside the panel under the header row.
 * Our car is fourth in its class, so the list is at its top.
 */
export const ShortPanel: Story = { args: { width: 900, height: 360 } };
