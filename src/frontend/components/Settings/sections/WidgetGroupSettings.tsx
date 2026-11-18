import { useId, useState } from 'react';
import { TrashIcon } from '@phosphor-icons/react';
import { useDashboard } from '@irdashies/context';
import {
  WIDGET_GROUP_ID,
  findWidgetGroup,
  getWidgetDefaultConfig,
  normalizeWidgetScale,
  sanitizeWidgetGroupMembers,
  WIDGET_SCALE,
  type DashboardLayout,
  type DashboardWidget,
  type WidgetGroupMember,
  type WidgetGroupWidgetSettings,
} from '@irdashies/types';
import { getWidgetName } from '../../../constants/widgetNames';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import { ReorderControls } from '../components/ReorderControls';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingDivider } from '../components/SettingDivider';
import { SettingNumberRow } from '../components/SettingNumberRow';
import { SettingProps, settingPropFor } from '../components/SettingProp';
import { SettingsSection } from '../components/SettingSection';
import {
  addWidgetGroupMember,
  moveWidgetGroupMember,
  removeWidgetGroupMember,
  resizeWidgetGroup,
  updateWidgetGroupMember,
  widgetGroupCandidates,
} from './widgetGroupEdits';

const SettingProp = settingPropFor(WIDGET_GROUP_ID);
const defaultConfig = getWidgetDefaultConfig(WIDGET_GROUP_ID);

const POSITION_FIELDS = [
  { key: 'x', title: 'X', min: undefined },
  { key: 'y', title: 'Y', min: undefined },
  { key: 'width', title: 'Width', min: 1 },
  { key: 'height', title: 'Height', min: 1 },
] as const;

const widgetLabel = (widget: DashboardWidget) => {
  const type = widget.type || widget.id;
  const name = getWidgetName(type);
  return widget.id === type ? name : `${name} (${widget.id})`;
};

interface SaveProps {
  dashboard: DashboardLayout;
  save: (dashboard: DashboardLayout) => void;
}

const AddWidget = ({ dashboard, save }: SaveProps) => {
  const id = useId();
  const [selected, setSelected] = useState('');
  const candidates = widgetGroupCandidates(dashboard);
  // What was chosen may have been added since.
  const choice = candidates.some((widget) => widget.id === selected)
    ? selected
    : '';

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm text-slate-300">
        Add widget
      </label>
      <div className="flex gap-2">
        <select
          id={id}
          value={choice}
          onChange={(event) => setSelected(event.target.value)}
          className="settings-field min-w-0 flex-1"
        >
          <option value="">Select a widget...</option>
          {candidates.map((widget) => (
            <option key={widget.id} value={widget.id}>
              {widgetLabel(widget)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!choice}
          onClick={() => {
            save(addWidgetGroupMember(dashboard, choice));
            setSelected('');
          }}
          className="settings-button-primary"
        >
          Add
        </button>
      </div>
    </div>
  );
};

const MemberCard = ({
  dashboard,
  save,
  member,
  position,
  total,
}: SaveProps & {
  member: WidgetGroupMember;
  position: number;
  total: number;
}) => {
  const { widgetId } = member;
  const widget = dashboard.widgets.find(({ id }) => id === widgetId);
  const name = widget ? widgetLabel(widget) : widgetId;
  const change = (values: Parameters<typeof updateWidgetGroupMember>[2]) =>
    save(updateWidgetGroupMember(dashboard, widgetId, values));

  return (
    <div
      role="group"
      aria-label={name}
      className="space-y-3 rounded-md border border-slate-700 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-white">{name}</span>
        <div className="flex items-center gap-2">
          <ReorderControls
            label={name}
            position={position}
            total={total}
            onMoveUp={
              position > 1
                ? () => save(moveWidgetGroupMember(dashboard, widgetId, -1))
                : undefined
            }
            onMoveDown={
              position < total
                ? () => save(moveWidgetGroupMember(dashboard, widgetId, 1))
                : undefined
            }
          />
          <button
            type="button"
            aria-label={`Remove ${name} from the group`}
            onClick={() => save(removeWidgetGroupMember(dashboard, widgetId))}
            className="settings-button-danger inline-flex items-center gap-1"
          >
            <TrashIcon size={16} aria-hidden="true" />
            Remove
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {POSITION_FIELDS.map(({ key, title, min }) => (
          <SettingNumberRow
            key={key}
            title={title}
            units="px"
            min={min}
            value={member[key]}
            onChange={(value) => change({ [key]: value })}
          />
        ))}
        <SettingNumberRow
          title="Scale"
          units="%"
          min={WIDGET_SCALE.min}
          max={WIDGET_SCALE.max}
          step={WIDGET_SCALE.step}
          value={member.scale ?? normalizeWidgetScale(widget?.scale)}
          onChange={(scale) => change({ scale })}
        />
      </div>
    </div>
  );
};

export const WidgetGroupSettings = () => {
  const { currentDashboard, onDashboardUpdated } = useDashboard();
  const group = findWidgetGroup(currentDashboard?.widgets);
  if (!currentDashboard || !group) return <>Loading...</>;

  const config = {
    ...defaultConfig,
    ...group.config,
  } as WidgetGroupWidgetSettings['config'];
  const members = sanitizeWidgetGroupMembers(config.members);
  const save = (dashboard: DashboardLayout) => onDashboardUpdated?.(dashboard);
  const saveProps = { dashboard: currentDashboard, save };

  return (
    <BaseSettingsSection
      title="Widget Group"
      description="Place several widgets in one frame and show them on the overlay as one widget."
      settings={{ enabled: group.enabled, config }}
      // The page reads the saved dashboard, so it has no copy to keep.
      onSettingsChange={() => undefined}
      widgetId={WIDGET_GROUP_ID}
    >
      {(handleConfigChange) => (
        <SettingProps
          widget={WIDGET_GROUP_ID}
          config={config}
          onChange={handleConfigChange}
        >
          <div className="space-y-6">
            <SettingsSection title="Group" scaleWidgetId={WIDGET_GROUP_ID}>
              <SettingNumberRow
                title="Group width"
                units="px"
                min={1}
                value={group.layout.width}
                onChange={(width) =>
                  save(resizeWidgetGroup(currentDashboard, { width }))
                }
              />
              <SettingNumberRow
                title="Group height"
                units="px"
                min={1}
                value={group.layout.height}
                onChange={(height) =>
                  save(resizeWidgetGroup(currentDashboard, { height }))
                }
              />
            </SettingsSection>

            <SettingsSection title="Widgets">
              <p className="text-sm text-slate-400">
                A widget in the group leaves its own place on the overlay and
                returns to it when removed. Later widgets are drawn on top.
              </p>
              <AddWidget {...saveProps} />
              {members.length === 0 ? (
                <p className="text-sm text-slate-400">No widgets added yet.</p>
              ) : (
                <div className="space-y-3">
                  {members.map((member, index) => (
                    <MemberCard
                      key={member.widgetId}
                      {...saveProps}
                      member={member}
                      position={index + 1}
                      total={members.length}
                    />
                  ))}
                </div>
              )}
            </SettingsSection>

            <SettingsSection title="Session visibility">
              <SessionVisibility
                sessionVisibility={config.sessionVisibility}
                handleConfigChange={handleConfigChange}
              />
              <SettingDivider />
              <SettingProp path="showOnlyWhenOnTrack" />
            </SettingsSection>
          </div>
        </SettingProps>
      )}
    </BaseSettingsSection>
  );
};
