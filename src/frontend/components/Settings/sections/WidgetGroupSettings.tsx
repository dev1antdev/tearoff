import { useCallback, useMemo, useState } from 'react';
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
  type WidgetLayout,
} from '@irdashies/types';
import { getWidgetName } from '../../../constants/widgetNames';
import { SortableList } from '../../SortableList';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import { DraggableSettingItem } from '../components/DraggableSettingItem';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingDivider } from '../components/SettingDivider';
import { SettingNumberRow } from '../components/SettingNumberRow';
import { SettingProps, settingPropFor } from '../components/SettingProp';
import { SettingSelectRow } from '../components/SettingSelectRow';
import { SettingsSection } from '../components/SettingSection';
import { WidgetGroupLayoutEditor } from '../components/WidgetGroupLayoutEditor';
import { widgetLabel } from '../menuItems';
import {
  addWidgetGroupMember,
  changeWidgetGroupMember,
  removeWidgetGroupMember,
  resizeWidgetGroup,
  setWidgetGroupMembers,
  stackWidgetGroupMembers,
  widgetGroupCandidates,
  type WidgetGroupMemberChange,
} from './widgetGroupEdits';

const SettingProp = settingPropFor(WIDGET_GROUP_ID);
const defaultConfig = getWidgetDefaultConfig(WIDGET_GROUP_ID);

const POSITION_FIELDS = [
  { key: 'x', title: 'X' },
  { key: 'y', title: 'Y' },
  { key: 'width', title: 'Width', min: 1 },
  { key: 'height', title: 'Height', min: 1 },
] as const;

/** The name the settings menu uses, and the instance where there are more. */
const memberName = (widget: DashboardWidget) => {
  const type = widget.type || widget.id;
  const label = widgetLabel(type);
  // A widget that is not in the menu comes back as its type.
  const name = label === type ? getWidgetName(type) : label;
  return widget.id === type ? name : `${name} (${widget.id})`;
};

const MemberFields = ({
  name,
  member,
  widget,
  onChange,
  onRemove,
}: {
  name: string;
  member: WidgetGroupMember;
  widget: DashboardWidget | undefined;
  onChange: (change: WidgetGroupMemberChange) => void;
  onRemove: () => void;
}) => (
  <div role="group" aria-label={name} className="mt-2 space-y-2">
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {POSITION_FIELDS.map((field) => (
        <SettingNumberRow
          key={field.key}
          title={field.title}
          units="px"
          min={'min' in field ? field.min : undefined}
          value={member[field.key]}
          onChange={(value) => onChange({ [field.key]: value })}
        />
      ))}
      <SettingNumberRow
        title="Scale"
        units="%"
        min={WIDGET_SCALE.min}
        max={WIDGET_SCALE.max}
        step={WIDGET_SCALE.step}
        value={member.scale ?? normalizeWidgetScale(widget?.scale)}
        onChange={(scale) => onChange({ scale })}
      />
    </div>
    <button
      type="button"
      aria-label={`Remove ${name} from the group`}
      onClick={onRemove}
      className="settings-button-danger inline-flex items-center gap-1"
    >
      <TrashIcon size={16} aria-hidden="true" />
      Remove
    </button>
  </div>
);

const WidgetGroupPage = ({
  dashboard,
  group,
  save,
}: {
  dashboard: DashboardLayout;
  group: DashboardWidget;
  save: (dashboard: DashboardLayout) => void;
}) => {
  const config = {
    ...defaultConfig,
    ...group.config,
  } as WidgetGroupWidgetSettings['config'];
  const savedMembers = useMemo(
    () => sanitizeWidgetGroupMembers(group.config?.members),
    [group.config?.members]
  );
  // The arrangement being edited, until it is saved or dropped.
  const [draft, setDraft] = useState<WidgetGroupMember[] | null>(null);
  const members = draft ?? savedMembers;
  const edited = setWidgetGroupMembers(dashboard, members);

  const changeMember = useCallback(
    (widgetId: string, change: WidgetGroupMemberChange) =>
      setDraft((current) =>
        changeWidgetGroupMember(current ?? savedMembers, widgetId, change)
      ),
    [savedMembers]
  );
  const placeMember = useCallback(
    (widgetId: string, { x, y, width, height }: WidgetLayout) =>
      changeMember(widgetId, { x, y, width, height }),
    [changeMember]
  );
  // Adding and removing change more than the arrangement, so they save, and
  // what was being edited is saved with them rather than lost.
  const saveNow = (next: DashboardLayout) => {
    save(next);
    setDraft(null);
  };

  const widgetOf = (id: string) =>
    dashboard.widgets.find((widget) => widget.id === id);
  const nameOf = (id: string) => {
    const widget = widgetOf(id);
    return widget ? memberName(widget) : id;
  };
  const scale = normalizeWidgetScale(group.scale) / 100;

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
                  save(resizeWidgetGroup(dashboard, { width }))
                }
              />
              <SettingNumberRow
                title="Group height"
                units="px"
                min={1}
                value={group.layout.height}
                onChange={(height) =>
                  save(resizeWidgetGroup(dashboard, { height }))
                }
              />
            </SettingsSection>

            <SettingsSection title="Layout">
              <p className="text-sm text-slate-400">
                Drag a widget to move it and its edges to size it. Hold Shift to
                move freely. The preview shows the layout once it is saved.
              </p>
              <WidgetGroupLayoutEditor
                width={group.layout.width / scale}
                height={group.layout.height / scale}
                tiles={members.map(({ widgetId, x, y, width, height }) => ({
                  id: widgetId,
                  name: nameOf(widgetId),
                  layout: { x, y, width, height },
                }))}
                onChange={placeMember}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!draft}
                  onClick={() => saveNow(edited)}
                  className="settings-button-primary"
                >
                  Save layout
                </button>
                <button
                  type="button"
                  disabled={!draft}
                  onClick={() => setDraft(null)}
                  className="settings-button"
                >
                  Revert
                </button>
                <button
                  type="button"
                  disabled={members.length === 0}
                  onClick={() =>
                    setDraft(stackWidgetGroupMembers(dashboard, members))
                  }
                  className="settings-button"
                >
                  Reset layout
                </button>
              </div>
            </SettingsSection>

            <SettingsSection title="Widgets">
              <p className="text-sm text-slate-400">
                A widget in the group leaves its own place on the overlay and
                returns to it when removed. Widgets lower in the list are drawn
                on top.
              </p>
              <SettingSelectRow
                title="Add widget"
                value=""
                options={[
                  { label: 'Select a widget...', value: '' },
                  ...widgetGroupCandidates(dashboard).map((widget) => ({
                    label: memberName(widget),
                    value: widget.id,
                  })),
                ]}
                onChange={(widgetId) => {
                  if (widgetId) saveNow(addWidgetGroupMember(edited, widgetId));
                }}
              />
              {members.length === 0 ? (
                <p className="text-sm text-slate-400">No widgets added yet.</p>
              ) : (
                <SortableList
                  items={members.map((member) => ({
                    id: member.widgetId,
                    member,
                  }))}
                  onReorder={(items) =>
                    setDraft(items.map((item) => item.member))
                  }
                  renderItem={({ id, member }, sortableProps) => (
                    <DraggableSettingItem
                      key={id}
                      label={nameOf(id)}
                      enabled
                      onToggle={() => undefined}
                      showToggle={false}
                      sortableProps={sortableProps}
                    >
                      <MemberFields
                        name={nameOf(id)}
                        member={member}
                        widget={widgetOf(id)}
                        onChange={(change) => changeMember(id, change)}
                        onRemove={() =>
                          saveNow(removeWidgetGroupMember(edited, id))
                        }
                      />
                    </DraggableSettingItem>
                  )}
                />
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

export const WidgetGroupSettings = () => {
  const { currentDashboard, onDashboardUpdated } = useDashboard();
  const group = findWidgetGroup(currentDashboard?.widgets);
  if (!currentDashboard || !group) return <>Loading...</>;
  return (
    <WidgetGroupPage
      dashboard={currentDashboard}
      group={group}
      save={(dashboard) => onDashboardUpdated?.(dashboard)}
    />
  );
};
