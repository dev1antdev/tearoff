import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS } from '@irdashies/types';
import type { KeybindingsMap } from '@irdashies/types';
import {
  getKeybindings,
  updateKeybinding,
  resetKeybinding,
  persistKeybindingMigrations,
  findKeybindingConflict,
} from './keybindings';
import { keybindingActionLabel } from '../keybindingActionLabels';

const mockReadData = vi.hoisted(() => vi.fn());
const mockWriteData = vi.hoisted(() => vi.fn());
const mockWriteDataAsync = vi.hoisted(() => vi.fn());

vi.mock('./storage', () => ({
  readData: mockReadData,
  writeData: mockWriteData,
  writeDataAsync: mockWriteDataAsync,
}));

describe('the name a conflict message gives an action', () => {
  const group = (id: string) =>
    ({
      id,
      type: 'widgetgroup',
      enabled: true,
      layout: { x: 0, y: 0, width: 1, height: 1 },
    }) as never;

  const dashboards = {
    race: { widgets: [group('group-a'), group('group-b')] },
  };

  const stored = {
    'toggle-widget:group-b': {
      accelerator: 'Alt+7',
      // The number the group had when the key was set: another group has
      // been deleted since, and this one is the second now.
      label: 'Widget Group 3',
      description: '',
      isDefault: false,
    },
  };

  beforeEach(() => {
    mockReadData.mockImplementation((key: string) =>
      key === 'currentProfile'
        ? 'race'
        : key === 'dashboards'
          ? dashboards
          : undefined
    );
  });

  it('numbers a widget group as the dashboard has it now', () => {
    const label = findKeybindingConflict(
      stored,
      'toggle-hide-ui',
      'Alt+7',
      keybindingActionLabel
    );

    expect(label).toBe('Widget Group 2');
  });

  it('keeps the saved name for a widget the profile does not hold', () => {
    const label = findKeybindingConflict(
      {
        'toggle-widget:fuel': {
          accelerator: 'Alt+8',
          label: 'Fuel Calculator',
          description: '',
          isDefault: false,
        },
      },
      'toggle-hide-ui',
      'Alt+8',
      keybindingActionLabel
    );

    expect(label).toBe('Fuel Calculator');
  });
});

describe('keybindings storage', () => {
  beforeEach(() => {
    mockReadData.mockReset();
    mockWriteData.mockReset();
    mockWriteDataAsync.mockReset();
  });

  describe('persistKeybindingMigrations', () => {
    it('writes a migrated legacy binding back asynchronously', async () => {
      mockReadData.mockReturnValue({
        'toggle-widget:twitchchat': {
          accelerator: 'Alt+7',
          label: 'Twitch Chat',
          description: '',
        },
      });

      await persistKeybindingMigrations();

      expect(mockWriteData).not.toHaveBeenCalled();
      const [key, written] = mockWriteDataAsync.mock.calls[0];
      expect(key).toBe('keybindings');
      expect(written).not.toHaveProperty('toggle-widget:twitchchat');
      expect(written['toggle-widget:streamchat'].accelerator).toBe('Alt+7');
    });

    it('writes nothing when no legacy binding is stored', async () => {
      mockReadData.mockReturnValue({});

      await persistKeybindingMigrations();

      expect(mockWriteDataAsync).not.toHaveBeenCalled();
    });
  });

  describe('getKeybindings', () => {
    it('seeds defaults when nothing is stored', () => {
      mockReadData.mockReturnValue(undefined);
      const result = getKeybindings();
      expect(result).toEqual(DEFAULT_KEYBINDINGS);
      expect(mockWriteData).toHaveBeenCalledWith(
        'keybindings',
        DEFAULT_KEYBINDINGS
      );
    });

    it.each([['Alt+7'], ['gamepad:btn0+gamepad:btn5']])(
      'moves a legacy toggle-widget:twitchchat binding (%s) to streamchat',
      (accelerator) => {
        mockReadData.mockReturnValue({
          'toggle-widget:twitchchat': {
            accelerator,
            label: 'Twitch Chat',
            description: 'Show / hide the Twitch Chat widget',
            isDefault: false,
          },
        });

        const result = getKeybindings();

        expect(result).not.toHaveProperty('toggle-widget:twitchchat');
        expect(result['toggle-widget:streamchat']).toMatchObject({
          accelerator,
          label: 'Stream Chat',
        });
        expect(mockWriteData).not.toHaveBeenCalled();
      }
    );

    it('keeps an existing streamchat binding over the legacy one', () => {
      mockReadData.mockReturnValue({
        'toggle-widget:twitchchat': {
          accelerator: 'Alt+7',
          label: 'Twitch Chat',
          description: '',
        },
        'toggle-widget:streamchat': {
          accelerator: 'Alt+8',
          label: 'Stream Chat',
          description: '',
        },
      });

      const result = getKeybindings();

      expect(result).not.toHaveProperty('toggle-widget:twitchchat');
      expect(result['toggle-widget:streamchat'].accelerator).toBe('Alt+8');
    });

    it('preserves stored dynamic widget-toggle entries through the merge', () => {
      const stored: Partial<KeybindingsMap> = {
        'toggle-widget:standings': {
          accelerator: 'Alt+1',
          label: 'Standings',
          description: 'Show / hide the Standings widget',
          isDefault: false,
        },
      };
      mockReadData.mockReturnValue(stored);

      const result = getKeybindings();
      expect(result['toggle-widget:standings']).toEqual(
        stored['toggle-widget:standings']
      );
      // Static defaults still present
      expect(result['toggle-hide-ui']).toEqual(
        DEFAULT_KEYBINDINGS['toggle-hide-ui']
      );
    });

    it('drops malformed widget-toggle keys with an empty widget id', () => {
      mockReadData.mockReturnValue({
        'toggle-widget:': {
          accelerator: 'Alt+0',
          label: '',
          description: '',
          isDefault: false,
        },
      });
      const result = getKeybindings();
      expect('toggle-widget:' in result).toBe(false);
    });

    it('keeps stored overrides of static actions', () => {
      mockReadData.mockReturnValue({
        'toggle-hide-ui': {
          accelerator: 'Alt+G',
          label: 'Hide / Show UI',
          description: 'Toggle visibility of all overlay windows',
          isDefault: false,
        },
      });
      const result = getKeybindings();
      expect(result['toggle-hide-ui'].accelerator).toBe('Alt+G');
    });
  });

  describe('updateKeybinding', () => {
    it('creates a dynamic widget entry with provided label/description', () => {
      mockReadData.mockReturnValue({ ...DEFAULT_KEYBINDINGS });
      const result = updateKeybinding('toggle-widget:fuel', 'Alt+2', {
        label: 'Fuel Calculator',
        description: 'Show / hide the Fuel Calculator widget',
      });
      expect(result['toggle-widget:fuel']).toEqual({
        accelerator: 'Alt+2',
        label: 'Fuel Calculator',
        description: 'Show / hide the Fuel Calculator widget',
        isDefault: false,
      });
      expect(mockWriteData).toHaveBeenCalled();
    });

    it('removes a dynamic entry when unbound (empty accelerator)', () => {
      mockReadData.mockReturnValue({
        ...DEFAULT_KEYBINDINGS,
        'toggle-widget:fuel': {
          accelerator: 'Alt+2',
          label: 'Fuel Calculator',
          description: 'Show / hide the Fuel Calculator widget',
          isDefault: false,
        },
      });
      const result = updateKeybinding('toggle-widget:fuel', '');
      expect(result['toggle-widget:fuel']).toBeUndefined();
    });

    it('does not treat empty accelerators as conflicts', () => {
      mockReadData.mockReturnValue({
        ...DEFAULT_KEYBINDINGS,
        'toggle-widget:fuel': {
          accelerator: '',
          label: 'Fuel Calculator',
          description: '',
          isDefault: true,
        },
      });
      expect(() =>
        updateKeybinding('toggle-widget:standings', '', {
          label: 'Standings',
          description: '',
        })
      ).not.toThrow();
    });

    it('rejects equivalent keyboard aliases before saving', () => {
      mockReadData.mockReturnValue({
        ...DEFAULT_KEYBINDINGS,
        'toggle-hide-ui': {
          ...DEFAULT_KEYBINDINGS['toggle-hide-ui'],
          accelerator: 'Control+Shift+H',
        },
      });
      expect(() =>
        updateKeybinding('toggle-edit-mode', 'Shift+Ctrl+H')
      ).toThrow('already bound');
      expect(mockWriteData).not.toHaveBeenCalled();
    });

    it.each(['Super', 'Meta'])(
      'rejects %s as an alias of an existing Command binding without saving',
      (alias) => {
        mockReadData.mockReturnValue({
          ...DEFAULT_KEYBINDINGS,
          'toggle-hide-ui': {
            ...DEFAULT_KEYBINDINGS['toggle-hide-ui'],
            accelerator: 'Command+H',
          },
        });
        expect(() =>
          updateKeybinding('toggle-edit-mode', `${alias}+H`)
        ).toThrow('already bound to "Hide / Show UI"');
        expect(mockWriteData).not.toHaveBeenCalled();
      }
    );

    it('throws when binding a key already in use', () => {
      mockReadData.mockReturnValue({ ...DEFAULT_KEYBINDINGS });
      expect(() =>
        updateKeybinding('toggle-widget:fuel', 'Alt+H', {
          label: 'Fuel Calculator',
          description: '',
        })
      ).toThrow(/already bound/);
    });
  });

  describe('resetKeybinding', () => {
    it('unbinds (removes) a dynamic widget entry', () => {
      mockReadData.mockReturnValue({
        ...DEFAULT_KEYBINDINGS,
        'toggle-widget:fuel': {
          accelerator: 'Alt+2',
          label: 'Fuel Calculator',
          description: '',
          isDefault: false,
        },
      });
      const result = resetKeybinding('toggle-widget:fuel');
      expect(result['toggle-widget:fuel']).toBeUndefined();
    });

    it('restores a static action to its factory binding', () => {
      mockReadData.mockReturnValue({
        ...DEFAULT_KEYBINDINGS,
        'toggle-hide-ui': {
          accelerator: 'Alt+G',
          label: 'Hide / Show UI',
          description: 'Toggle visibility of all overlay windows',
          isDefault: false,
        },
      });
      const result = resetKeybinding('toggle-hide-ui');
      expect(result['toggle-hide-ui']).toEqual(
        DEFAULT_KEYBINDINGS['toggle-hide-ui']
      );
    });
  });
});
