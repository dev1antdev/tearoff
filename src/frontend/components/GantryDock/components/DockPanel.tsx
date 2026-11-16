import { memo } from 'react';
import { CaretDownIcon, CaretRightIcon, GearIcon } from '@phosphor-icons/react';
import {
  GANTRY_DOCK_PANEL_LABELS,
  type ResolvedDockPanel,
} from '@irdashies/types';
import {
  HostedPanelMessage,
  HostedWidget,
} from '../../WidgetPanelHost/HostedWidget';

/** The settings page the gear button opens. */
export const dockPanelSettingsTarget = (resolved: ResolvedDockPanel) =>
  resolved.status === 'ready' ? resolved.widget.id : 'gantry';

export const dockPanelLabel = (resolved: ResolvedDockPanel) =>
  GANTRY_DOCK_PANEL_LABELS[resolved.panel.type];

const iconButtonClass =
  'p-0.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-700/60 transition-colors';

interface DockPanelHeaderProps {
  panelId: string;
  label: string;
  settingsTarget: string;
  collapsed: boolean;
  onToggleCollapsed: (panelId: string) => void;
  onOpenSettings: (target: string) => void;
}

export const DockPanelHeader = memo(
  ({
    panelId,
    label,
    settingsTarget,
    collapsed,
    onToggleCollapsed,
    onOpenSettings,
  }: DockPanelHeaderProps) => (
    <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-800/60 border-b border-slate-700/50 flex-shrink-0">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 truncate">
        {label}
      </span>
      <div className="flex-1" />
      <button
        type="button"
        className={iconButtonClass}
        title={`Open ${label} settings`}
        aria-label={`Open ${label} settings`}
        onClick={() => onOpenSettings(settingsTarget)}
      >
        <GearIcon size={14} />
      </button>
      <button
        type="button"
        className={iconButtonClass}
        title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
        aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
        aria-expanded={!collapsed}
        onClick={() => onToggleCollapsed(panelId)}
      >
        {collapsed ? <CaretRightIcon size={14} /> : <CaretDownIcon size={14} />}
      </button>
    </div>
  )
);
DockPanelHeader.displayName = 'DockPanelHeader';

interface DockPanelContentProps {
  resolved: ResolvedDockPanel;
  running: boolean;
  onOpenSettings: (target: string) => void;
}

/**
 * What a docked panel shows: its widget, drawn by the host the Pit Wall
 * shares, or why there is none.
 */
export const DockPanelContent = memo(
  ({ resolved, running, onOpenSettings }: DockPanelContentProps) => {
    if (resolved.status !== 'ready') {
      const message =
        resolved.status === 'unlinked'
          ? 'Choose which fuel layout this panel shows.'
          : resolved.panel.type === 'fuel'
            ? 'The fuel layout this panel used was removed.'
            : `The ${dockPanelLabel(resolved)} widget is missing from this profile.`;
      return (
        <HostedPanelMessage
          message={message}
          action={{
            label:
              resolved.status === 'unlinked'
                ? 'Choose a layout'
                : 'Choose another',
            onClick: () => onOpenSettings('gantry'),
          }}
        />
      );
    }

    return (
      <HostedWidget
        widget={resolved.widget}
        running={running}
        host="gantry-dock"
        waitingMessage="Waiting for iRacing."
      />
    );
  }
);
DockPanelContent.displayName = 'DockPanelContent';
