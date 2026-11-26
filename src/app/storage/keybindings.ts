import type {
  KeybindingActionId,
  KeybindingEntry,
  KeybindingsMap,
} from '@irdashies/types';
import { DEFAULT_KEYBINDINGS } from '@irdashies/types';
import {
  isGamepadBinding,
  isWidgetToggleActionId,
  isValidWidgetToggleActionId,
  widgetToggleLabel,
} from '@irdashies/shared';
import { readData, writeData, writeDataAsync } from './storage';
import { getCurrentProfileId, getDashboard } from './dashboards';
import { migrateLegacyStreamChatKeybindings } from './streamChatMigration';

const STORAGE_KEY = 'keybindings';

export function getKeybindings(): KeybindingsMap {
  const stored = readData<Partial<KeybindingsMap>>(STORAGE_KEY);
  if (!stored) {
    writeData(STORAGE_KEY, DEFAULT_KEYBINDINGS);
    return { ...DEFAULT_KEYBINDINGS };
  }

  // Widgets renamed in a release must move their toggle binding first, or it
  // keeps targeting an id no widget has. Reading never writes: the migrated
  // map is persisted by persistKeybindingMigrations, or by the next save.
  const migrated = migrateLegacyStreamChatKeybindings(stored);

  // Merge with defaults so new actions added in future versions are included
  const merged: KeybindingsMap = { ...DEFAULT_KEYBINDINGS };
  for (const key of Object.keys(migrated) as KeybindingActionId[]) {
    const entry = migrated[key];
    if (!entry) continue;
    // Keep stored overrides of known static actions, plus any well-formed
    // dynamic per-widget toggles (which have no factory default to merge
    // against). Malformed `toggle-widget:` keys (empty id) are dropped.
    if (key in merged || isValidWidgetToggleActionId(key)) {
      merged[key] = entry;
    }
  }
  return merged;
}

/** Writes legacy-id migrations of the stored bindings back to disk, async. */
export async function persistKeybindingMigrations(): Promise<void> {
  const stored = readData<Partial<KeybindingsMap>>(STORAGE_KEY);
  if (!stored) return;
  const migrated = migrateLegacyStreamChatKeybindings(stored);
  if (migrated !== stored) await writeDataAsync(STORAGE_KEY, migrated);
}

export function saveKeybindings(bindings: KeybindingsMap): void {
  writeData(STORAGE_KEY, bindings);
}

/** Compare Electron aliases without treating normalization as syntax validation. */
function normalizeKeyboardAccelerator(
  accelerator: string,
  isMac: boolean
): string {
  const aliases: Record<string, string> = {
    commandorcontrol: isMac ? 'command' : 'control',
    cmdorctrl: isMac ? 'command' : 'control',
    cmd: 'command',
    ctrl: 'control',
    option: 'alt',
    // Electron parses these as VKEY_COMMAND on every platform.
    super: 'command',
    meta: 'command',
    esc: 'escape',
    return: 'enter',
  };
  return accelerator
    .toLowerCase()
    .split('+')
    .map((part) => aliases[part] ?? part)
    .sort()
    .join('+');
}

export class KeybindingConflictError extends Error {}

/**
 * What an action is called where a person sees it. A widget toggle goes by the
 * widget in the profile on screen -- a group by the number it has now -- and
 * only where that widget is not there does the name saved with the key stand,
 * which is what the settings page shows for a key of another profile's widget.
 */
export const keybindingActionLabel = (
  actionId: KeybindingActionId,
  entry: KeybindingEntry
): string => {
  if (isWidgetToggleActionId(actionId)) {
    const live = widgetToggleLabel(
      actionId,
      getDashboard(getCurrentProfileId())?.widgets ?? []
    );
    if (live) return live;
  }
  return entry.label;
};

/**
 * Find app-owned duplicates before attempting an OS registration.
 *
 * The name comes from `labelOf` where a caller has a better one than the label
 * saved with the key: a widget toggle is named by the widget, and a group is
 * numbered as the dashboard has it now.
 */
export function findKeybindingConflict(
  bindings: Partial<KeybindingsMap>,
  actionId: KeybindingActionId,
  accelerator: string,
  labelOf?: (actionId: KeybindingActionId, entry: KeybindingEntry) => string
): string | undefined {
  if (!accelerator) return;
  const normalize = (value: string) =>
    isGamepadBinding(value)
      ? value
      : normalizeKeyboardAccelerator(value, process.platform === 'darwin');
  const owner = Object.entries(bindings).find(
    ([id, entry]) =>
      entry &&
      id !== actionId &&
      normalize(entry.accelerator) === normalize(accelerator)
  );
  if (!owner || !owner[1]) return undefined;
  const [id, entry] = owner;
  return labelOf ? labelOf(id as KeybindingActionId, entry) : entry.label;
}

export function updateKeybinding(
  actionId: KeybindingActionId,
  accelerator: string,
  meta?: { label: string; description: string }
): KeybindingsMap {
  const bindings = getKeybindings();

  const conflict = findKeybindingConflict(bindings, actionId, accelerator);
  if (conflict !== undefined) {
    throw new KeybindingConflictError(
      `Shortcut already bound to "${conflict}" in Tearoff. Choose another combination.`
    );
  }

  const factory =
    DEFAULT_KEYBINDINGS[actionId as keyof typeof DEFAULT_KEYBINDINGS];

  // Dynamic (widget) bindings have no factory default: unbinding removes the
  // entry entirely so storage doesn't accumulate empty bindings.
  if (!factory && !accelerator) {
    return removeBinding(bindings, actionId);
  }

  const existing = bindings[actionId];
  bindings[actionId] = {
    accelerator,
    label: existing?.label ?? meta?.label ?? actionId,
    description: existing?.description ?? meta?.description ?? '',
    // For static actions, "default" means the factory accelerator. For dynamic
    // actions there is no factory binding, so unbound (empty) is the default.
    isDefault: factory
      ? accelerator === factory.accelerator
      : accelerator === '',
  };
  saveKeybindings(bindings);
  return bindings;
}

export function resetKeybinding(actionId: KeybindingActionId): KeybindingsMap {
  const bindings = getKeybindings();
  const factory =
    DEFAULT_KEYBINDINGS[actionId as keyof typeof DEFAULT_KEYBINDINGS];
  if (!factory) {
    // Dynamic action: resetting means unbinding (no factory binding exists).
    return removeBinding(bindings, actionId);
  }
  bindings[actionId] = { ...factory };
  saveKeybindings(bindings);
  return bindings;
}

/** Persist and return `bindings` with `actionId` removed. */
function removeBinding(
  bindings: KeybindingsMap,
  actionId: KeybindingActionId
): KeybindingsMap {
  const next = Object.fromEntries(
    Object.entries(bindings).filter(([id]) => id !== actionId)
  ) as KeybindingsMap;
  saveKeybindings(next);
  return next;
}

export function resetAllKeybindings(): KeybindingsMap {
  const bindings = { ...DEFAULT_KEYBINDINGS };
  saveKeybindings(bindings);
  return bindings;
}
