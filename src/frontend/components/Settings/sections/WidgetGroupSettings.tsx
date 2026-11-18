import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useDashboard } from '@irdashies/context';
import {
  WIDGET_GROUP_ID,
  findWidgetGroup,
  getWidgetDefaultConfig,
  normalizeWidgetScale,
  widgetGroupMembers,
  widgetGroups,
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
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DraggableSettingItem } from '../components/DraggableSettingItem';
import { SessionVisibility } from '../components/SessionVisibility';
import { SettingDivider } from '../components/SettingDivider';
import { SettingNumberRow } from '../components/SettingNumberRow';
import { SettingProps, settingPropFor } from '../components/SettingProp';
import { SettingSelectRow } from '../components/SettingSelectRow';
import { SettingsSection } from '../components/SettingSection';
import { WidgetGroupLayoutEditor } from '../components/WidgetGroupLayoutEditor';
import { widgetLabel } from '../menuItems';
import { generateId } from './FuelSettings/utils';
import {
  addWidgetGroup,
  addWidgetGroupMember,
  changeWidgetGroupMember,
  deleteWidgetGroup,
  removeWidgetGroupMember,
  resizeWidgetGroup,
  setWidgetGroupMembers,
  sizedWidgetGroupFrame,
  stackWidgetGroupMembers,
  widgetGroupCandidates,
  widgetGroupFrameFor,
  widgetGroupName,
  widgetGroupScale,
  type WidgetGroupFrameSize,
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

/** What is being arranged, until it is saved or dropped. */
interface LayoutDraft {
  members: WidgetGroupMember[];
  /**
   * What Reset layout laid out, which the frame has to show. It is kept rather
   * than the frame itself, so the frame follows the group's scale and size.
   */
  fitTo?: WidgetGroupMember[];
  /** A size typed for that frame, which waits to be saved along with it. */
  frameSize?: WidgetGroupFrameSize;
}

const WidgetGroupPage = ({
  dashboard,
  group,
  save,
  open,
}: {
  dashboard: DashboardLayout;
  group: DashboardWidget;
  save: (dashboard: DashboardLayout) => void;
  /** Goes to the settings page of a group. */
  open: (groupId: string) => void;
}) => {
  const config = {
    ...defaultConfig,
    ...group.config,
  } as WidgetGroupWidgetSettings['config'];
  const savedMembers = widgetGroupMembers(dashboard.widgets, group.id);
  const [draft, setDraft] = useState<LayoutDraft | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const members = draft?.members ?? savedMembers;
  const frame = draft?.fitTo
    ? sizedWidgetGroupFrame(
        widgetGroupFrameFor(group, draft.fitTo),
        draft.frameSize ?? {}
      )
    : group.layout;
  const edited = setWidgetGroupMembers(dashboard, group.id, members, frame);

  const changeMember = (widgetId: string, change: WidgetGroupMemberChange) =>
    setDraft((current) => ({
      ...current,
      members: changeWidgetGroupMember(
        current?.members ?? savedMembers,
        widgetId,
        change
      ),
    }));
  const placeMember = (
    widgetId: string,
    { x, y, width, height }: WidgetLayout
  ) => changeMember(widgetId, { x, y, width, height });
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
  const resizeFrame = (size: WidgetGroupFrameSize) => {
    if (draft?.fitTo) {
      setDraft({ ...draft, frameSize: { ...draft.frameSize, ...size } });
    } else {
      save(resizeWidgetGroup(dashboard, group.id, size));
    }
  };
  const resetLayout = () => {
    const stacked = stackWidgetGroupMembers(dashboard, members);
    setDraft({ members: stacked, fitTo: stacked });
  };
  const createGroup = () => {
    const id = `${WIDGET_GROUP_ID}-${generateId()}`;
    save(addWidgetGroup(dashboard, id));
    open(id);
  };
  const deleteGroup = () => {
    save(deleteWidgetGroup(dashboard, group.id));
    open(WIDGET_GROUP_ID);
  };
  const scale = widgetGroupScale(group);
  const name = widgetGroupName(dashboard.widgets, group.id);

  return (
    <BaseSettingsSection
      title={name}
      description="Place several widgets in one frame and show them on the overlay as one widget."
      settings={{ enabled: group.enabled, config }}
      // The page reads the saved dashboard, so it has no copy to keep.
      onSettingsChange={() => undefined}
      widgetId={group.id}
    >
      {(handleConfigChange) => (
        <SettingProps
          widget={WIDGET_GROUP_ID}
          config={config}
          onChange={handleConfigChange}
        >
          <div className="space-y-6">
            <SettingsSection title="Group" scaleWidgetId={group.id}>
              <SettingSelectRow
                title="Editing group"
                value={group.id}
                options={widgetGroups(dashboard.widgets).map(({ id }) => ({
                  label: widgetGroupName(dashboard.widgets, id),
                  value: id,
                }))}
                onChange={open}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={createGroup}
                  className="settings-button inline-flex items-center gap-1"
                >
                  <PlusIcon size={16} aria-hidden="true" />
                  New group
                </button>
                {group.id !== WIDGET_GROUP_ID && (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="settings-button-danger inline-flex items-center gap-1"
                  >
                    <TrashIcon size={16} aria-hidden="true" />
                    Delete group
                  </button>
                )}
              </div>
              <ConfirmDialog
                isOpen={confirmingDelete}
                title="Delete group"
                message={`Delete ${name}? Its widgets go back to their own places on the overlay.`}
                confirmText="Delete group"
                onConfirm={deleteGroup}
                onCancel={() => setConfirmingDelete(false)}
              />
              <SettingNumberRow
                title="Group width"
                units="px"
                min={1}
                value={frame.width}
                onChange={(width) => resizeFrame({ width })}
              />
              <SettingNumberRow
                title="Group height"
                units="px"
                min={1}
                value={frame.height}
                onChange={(height) => resizeFrame({ height })}
              />
            </SettingsSection>

            {members.length > 0 && (
              <SettingsSection title="Layout">
                <p className="text-sm text-slate-400">
                  Drag a widget to move it and its edges to size it. Hold Shift
                  to move freely. The preview shows the layout once it is saved.
                </p>
                <WidgetGroupLayoutEditor
                  width={frame.width / scale}
                  height={frame.height / scale}
                  tiles={members.map(({ widgetId, x, y, width, height }) => ({
                    id: widgetId,
                    name: nameOf(widgetId),
                    layout: { x, y, width, height },
                  }))}
                  onChange={placeMember}
                />
                <div className="flex flex-wrap items-center gap-2">
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
                    onClick={resetLayout}
                    className="settings-button"
                  >
                    Reset layout
                  </button>
                  {draft && (
                    <span role="status" className="text-sm text-slate-300">
                      Unsaved changes
                    </span>
                  )}
                </div>
              </SettingsSection>
            )}

            <SettingsSection title="Widgets">
              <p className="text-sm text-slate-400">
                A widget in the group leaves its own place on the overlay and
                returns to it when removed. Widgets lower in the list are drawn
                on top.
              </p>
              {draft && (
                <p className="text-sm text-slate-300">
                  Changes below are kept with Save layout, above. They are lost
                  on leaving this page without it.
                </p>
              )}
              <SettingSelectRow
                title="Add widget"
                value=""
                options={[
                  { label: 'Select a widget...', value: '' },
                  ...widgetGroupCandidates(dashboard, group.id).map(
                    (widget) => ({
                      label: memberName(widget),
                      value: widget.id,
                    })
                  ),
                ]}
                onChange={(widgetId) => {
                  if (widgetId) {
                    saveNow(addWidgetGroupMember(edited, group.id, widgetId));
                  }
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
                    setDraft({
                      ...draft,
                      members: items.map((item) => item.member),
                    })
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
                          saveNow(
                            removeWidgetGroupMember(edited, group.id, id)
                          )
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

export const WidgetGroupSettings = ({ widgetId }: { widgetId?: string }) => {
  const { currentDashboard, currentProfile, onDashboardUpdated } =
    useDashboard();
  const navigate = useNavigate();
  const widgets = currentDashboard?.widgets;
  const group = findWidgetGroup(widgets, widgetId) ?? findWidgetGroup(widgets);
  if (!currentDashboard || !group) return <>Loading...</>;
  return (
    <WidgetGroupPage
      // An arrangement being edited belongs to its group, in its profile.
      key={`${currentProfile?.id}:${group.id}`}
      dashboard={currentDashboard}
      group={group}
      save={(dashboard) => onDashboardUpdated?.(dashboard)}
      open={(id) => navigate(`/settings/${id}`)}
    />
  );
};
