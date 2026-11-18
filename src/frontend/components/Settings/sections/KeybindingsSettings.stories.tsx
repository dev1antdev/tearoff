import { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge, TelemetryDecorator } from '@irdashies/storybook';
import { DEFAULT_KEYBINDINGS, KEYBINDING_MESSAGES } from '@irdashies/types';
import type {
  KeybindingEntry,
  KeybindingsBridge,
  KeybindingsMap,
  WidgetToggleActionId,
} from '@irdashies/types';
import { KeybindingsSettings } from './KeybindingsSettings';

const mockKeybindings =
  (
    unavailable = false,
    more: Record<WidgetToggleActionId, KeybindingEntry> = {}
  ) =>
  () => {
    const original = window.keybindingsBridge;
    let bindings: KeybindingsMap = {
      ...structuredClone(DEFAULT_KEYBINDINGS),
      ...more,
    };
    window.keybindingsBridge = {
      getKeybindings: async () => bindings,
      getRegistrationErrors: async () =>
        unavailable
          ? {
              'toggle-hide-ui': KEYBINDING_MESSAGES.unavailable,
            }
          : {},
      updateKeybinding: async (id, accelerator) => {
        if (accelerator === 'F8')
          return { error: KEYBINDING_MESSAGES.unavailable };
        bindings = {
          ...bindings,
          [id]: { ...bindings[id], accelerator, isDefault: false },
        };
        unavailable = false;
        return bindings;
      },
      resetKeybinding: async () =>
        (bindings = structuredClone(DEFAULT_KEYBINDINGS)),
      resetAllKeybindings: async () =>
        (bindings = structuredClone(DEFAULT_KEYBINDINGS)),
      startRecording: async () => undefined,
      stopRecording: async () => undefined,
      onGamepadCaptured: () => () => undefined,
    } satisfies KeybindingsBridge;
    return () => {
      window.keybindingsBridge = original;
    };
  };

const meta: Meta<typeof KeybindingsSettings> = {
  component: KeybindingsSettings,
  title: 'components/Settings/KeybindingsSettings',
  decorators: [
    TelemetryDecorator(),
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="h-screen w-[600px]">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof KeybindingsSettings>;
export const Default: Story = { beforeEach: mockKeybindings() };
export const PersistedUnavailable: Story = {
  beforeEach: mockKeybindings(true),
};

/** A key still held by a widget group that has been deleted. */
export const WidgetNotInThisProfile: Story = {
  beforeEach: mockKeybindings(false, {
    'toggle-widget:widgetgroup-2': {
      accelerator: 'Alt+G',
      label: 'Widget Group 2',
      description: 'Show / hide the Widget Group 2 widget',
      isDefault: false,
    },
  }),
};
