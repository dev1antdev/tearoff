import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  applyDefaultsToAllProfiles,
  getOrCreateDefaultDashboard,
  setCurrentProfile,
  listDashboards,
  getDashboard,
  saveDashboard,
  updateDashboardWidget,
  withDashboardDefaults,
  resetDashboard,
} from './dashboards';
import {
  PIT_WALL_CUSTOM_START,
  defaultDashboard,
  getWidgetDefaultConfig,
  resolvePitWall,
  sanitizePitWallConfig,
} from '@irdashies/types';
import { DashboardLayout } from '@irdashies/types';

const mockReadData = vi.hoisted(() => vi.fn());
const mockWriteData = vi.hoisted(() => vi.fn());

vi.mock('./storage', () => ({
  readData: mockReadData,
  writeData: mockWriteData,
}));

const mockLoggerWarn = vi.hoisted(() => vi.fn());

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockEmitDashboardUpdated = vi.hoisted(() => vi.fn());

vi.mock('./dashboardEvents', () => ({
  emitDashboardUpdated: mockEmitDashboardUpdated,
  emitDashboardsSaved: vi.fn(),
}));

describe('dashboards', () => {
  beforeEach(() => {
    mockReadData.mockReset();
    mockWriteData.mockReset();
    mockEmitDashboardUpdated.mockReset();
    mockLoggerWarn.mockReset();
    // Setup intelligent mock for readData that handles different keys
    mockReadData.mockImplementation((key: string) => {
      if (key === 'currentProfile') {
        return 'default'; // Always return 'default' as current profile for tests
      }
      if (key === 'profiles') {
        return { default: { id: 'default', name: 'Default' } }; // Default profile exists
      }
      // For 'dashboards' key and others, return null by default
      return null;
    });
  });

  describe('Twitch Chat to Stream Chat migration', () => {
    it('migrates twitchchat next to a null entry instead of throwing', () => {
      const result = withDashboardDefaults({
        ...defaultDashboard,
        widgets: [
          null,
          { id: 'twitchchat', enabled: true, config: { channel: 'old' } },
        ] as unknown as typeof defaultDashboard.widgets,
      });

      expect(result.widgets.some((w) => w.id === 'twitchchat')).toBe(false);
      const streamChats = result.widgets.filter((w) => w.id === 'streamchat');
      expect(streamChats).toHaveLength(1);
      expect(streamChats[0].enabled).toBe(true);
      expect(streamChats[0].config).toMatchObject({
        twitch: { channel: 'old' },
      });
    });

    it('migrates twitchchat in withDashboardDefaults, as used for inactive profiles and imports', () => {
      const layout = { x: 5, y: 6, width: 300, height: 200 };
      const result = withDashboardDefaults({
        ...defaultDashboard,
        widgets: [
          {
            id: 'twitchchat',
            enabled: true,
            layout,
            config: { channel: 'oldchannel' },
          },
        ],
      });

      expect(result.widgets.some((w) => w.id === 'twitchchat')).toBe(false);
      const streamChats = result.widgets.filter((w) => w.id === 'streamchat');
      expect(streamChats).toHaveLength(1);
      expect(streamChats[0].enabled).toBe(true);
      expect(streamChats[0].layout).toEqual(layout);
      expect(streamChats[0].config).toMatchObject({
        twitch: { channel: 'oldchannel' },
      });
    });

    it('loads a saved twitchchat widget as streamchat with its settings', () => {
      const layout = { x: 11, y: 22, width: 333, height: 444 };
      const saved = {
        ...defaultDashboard,
        widgets: [
          ...defaultDashboard.widgets.filter((w) => w.id !== 'streamchat'),
          {
            id: 'twitchchat',
            enabled: true,
            layout,
            config: { fontSize: 24, channel: 'oldchannel' },
          },
        ],
      };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return { default: saved };
        return null;
      });

      const result = getOrCreateDefaultDashboard();

      expect(result.widgets.some((w) => w.id === 'twitchchat')).toBe(false);
      const streamChats = result.widgets.filter((w) => w.id === 'streamchat');
      expect(streamChats).toHaveLength(1);
      expect(streamChats[0].enabled).toBe(true);
      expect(streamChats[0].layout).toEqual(layout);
      expect(streamChats[0].config).toMatchObject({
        display: { fontSize: 24, showPlatformIcons: true },
        twitch: { channel: 'oldchannel' },
        youtube: { channel: '' },
      });
    });
  });

  describe('createDefaultDashboardIfNotExists', () => {
    it('should create default dashboard if none exists', () => {
      // Mock readData to return null for dashboards, but 'default' for currentProfile
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        return null; // No dashboards exist
      });

      getOrCreateDefaultDashboard();

      expect(mockWriteData).toHaveBeenCalledWith('dashboards', {
        default: defaultDashboard,
      });
    });

    it('should not create default dashboard if one already exists', () => {
      // Mock readData to return existing dashboard for 'dashboards' key
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return { default: defaultDashboard };
        return null;
      });

      getOrCreateDefaultDashboard();

      expect(mockWriteData).not.toHaveBeenCalled();
    });
  });

  describe('listDashboards', () => {
    it('should return an empty object if no dashboards exist', () => {
      // Use default mockImplementation which returns null for 'dashboards' key

      const dashboards = listDashboards();

      expect(dashboards).toEqual({});
    });

    it('should return existing dashboards', () => {
      const dashboardsData = { default: defaultDashboard };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return dashboardsData;
        return null;
      });

      const dashboards = listDashboards();

      expect(dashboards).toEqual(dashboardsData);
    });
  });

  describe('getDashboard', () => {
    it('should return null if no dashboards exist', () => {
      // Use default mockImplementation which returns null for 'dashboards' key

      const dashboard = getDashboard('default');

      expect(dashboard).toBeNull();
    });

    it('should return the requested dashboard if it exists', () => {
      const dashboardsData = { default: defaultDashboard };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return dashboardsData;
        return null;
      });

      const dashboard = getDashboard('default');

      expect(dashboard).toEqual(defaultDashboard);
    });
  });

  describe('saveDashboard', () => {
    it('should save a new dashboard', () => {
      const newDashboard: DashboardLayout = {
        widgets: [],
        generalSettings: { fontSize: 'sm' },
      };
      // Use default mockImplementation which returns null for 'dashboards' key

      saveDashboard('newDashboard', newDashboard);

      expect(mockWriteData).toHaveBeenCalledWith('dashboards', {
        newDashboard,
      });
    });

    it('should update an existing dashboard and preserve other dashboards', () => {
      const customDashboard: DashboardLayout = {
        widgets: [],
        generalSettings: { fontSize: 'xl' },
      };
      const existingDashboards = {
        default: defaultDashboard,
        custom: customDashboard,
      };
      const updatedDashboard: DashboardLayout = {
        widgets: [],
        generalSettings: { fontSize: 'lg', colorPalette: 'black' },
      };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return existingDashboards;
        return null;
      });

      saveDashboard('default', updatedDashboard);

      expect(mockWriteData).toHaveBeenCalledWith('dashboards', {
        default: {
          ...defaultDashboard,
          ...updatedDashboard,
          generalSettings: {
            ...defaultDashboard.generalSettings,
            ...updatedDashboard.generalSettings,
          },
        },
        custom: customDashboard,
      });
    });
  });

  describe('updateDashboardWidget', () => {
    it('should throw an error if the default dashboard does not exist', () => {
      // Use default mockImplementation which returns null for 'dashboards' key

      const updatedWidget = {
        id: 'input',
        enabled: true,
        layout: { x: 100, y: 100, width: 600, height: 120 },
      };

      expect(() => updateDashboardWidget(updatedWidget)).toThrow(
        'Default dashboard not found'
      );
    });

    it('should update an existing widget in the default dashboard', () => {
      const existingWidget = {
        id: 'input',
        enabled: true,
        layout: { x: 0, y: 0, width: 300, height: 100 },
      };
      const updatedWidget = {
        id: 'input',
        enabled: false,
        layout: { x: 100, y: 100, width: 600, height: 120 },
      };
      const existingDashboard: DashboardLayout = {
        widgets: [existingWidget],
        generalSettings: { fontSize: 'sm' },
      };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return { default: existingDashboard };
        return null;
      });

      updateDashboardWidget(updatedWidget);

      expect(mockWriteData).toHaveBeenCalledWith('dashboards', {
        default: {
          widgets: [updatedWidget],
          generalSettings: { fontSize: 'sm' },
        },
      });
    });

    it('should update an existing widget in a specific dashboard', () => {
      const existingWidget = {
        id: 'input',
        enabled: true,
        layout: { x: 0, y: 0, width: 300, height: 100 },
      };
      const updatedWidget = {
        id: 'input',
        enabled: true,
        layout: { x: 100, y: 100, width: 600, height: 120 },
      };
      const existingDashboard: DashboardLayout = {
        widgets: [existingWidget],
        generalSettings: { fontSize: 'sm' },
      };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return { custom: existingDashboard };
        return null;
      });

      updateDashboardWidget(updatedWidget, 'custom');

      expect(mockWriteData).toHaveBeenCalledWith('dashboards', {
        custom: {
          widgets: [updatedWidget],
          generalSettings: { fontSize: 'sm' },
        },
      });
    });

    it('should not update a widget if it does not exist in the dashboard', () => {
      const updatedWidget = {
        id: 'input',
        enabled: true,
        layout: { x: 100, y: 100, width: 600, height: 120 },
      };
      const existingDashboard: DashboardLayout = {
        widgets: [],
        generalSettings: { fontSize: 'sm' },
      };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return { default: existingDashboard };
        return null;
      });

      updateDashboardWidget(updatedWidget);

      expect(mockWriteData).not.toHaveBeenCalledWith();
    });
  });

  describe('getOrCreateDefaultDashboard', () => {
    it('should return the default dashboard if it exists', () => {
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return { default: defaultDashboard };
        return null;
      });

      const dashboard = getOrCreateDefaultDashboard();

      expect(dashboard).toEqual(defaultDashboard);
    });

    it('should create and return the default dashboard if it does not exist', () => {
      // Use default mockImplementation which returns null for 'dashboards' key

      const dashboard = getOrCreateDefaultDashboard();

      expect(dashboard).toEqual(defaultDashboard);
      expect(mockWriteData).toHaveBeenCalledWith('dashboards', {
        default: defaultDashboard,
      });
    });

    it('should add missing widgets to the default dashboard if some widgets are missing', () => {
      const incompleteDashboard = {
        generalSettings: { fontSize: 'sm' },
        widgets: defaultDashboard.widgets.slice(0, 1),
      };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return { default: incompleteDashboard };
        return null;
      });

      const dashboard = getOrCreateDefaultDashboard();

      expect(dashboard.widgets).toEqual(defaultDashboard.widgets);
      expect(mockWriteData).toHaveBeenCalledWith('dashboards', {
        default: defaultDashboard,
      });
    });

    it('should not modify the default dashboard if all widgets are present', () => {
      const completeDashboard = { ...defaultDashboard };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return { default: completeDashboard };
        return null;
      });

      const dashboard = getOrCreateDefaultDashboard();

      expect(dashboard).toEqual(completeDashboard);
      expect(mockWriteData).not.toHaveBeenCalled();
    });
  });

  describe('active dashboard without widgets', () => {
    it('loads it with the default widgets instead of throwing', () => {
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards')
          return {
            default: { generalSettings: defaultDashboard.generalSettings },
          };
        return null;
      });

      const dashboard = getOrCreateDefaultDashboard();

      expect(dashboard.widgets.map((w) => w.id)).toEqual(
        defaultDashboard.widgets.map((w) => w.id)
      );
      expect(mockWriteData).toHaveBeenCalledWith('dashboards', {
        default: dashboard,
      });
    });
  });

  describe('applyDefaultsToAllProfiles', () => {
    it('fills in config values for profiles other than the active one', () => {
      const stored: Record<string, DashboardLayout> = {
        default: defaultDashboard,
        race: {
          ...defaultDashboard,
          widgets: defaultDashboard.widgets.map((w) =>
            w.id === 'tachometer'
              ? { ...w, config: { background: { opacity: 40 } } }
              : w
          ),
        },
      };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return {
            default: { id: 'default', name: 'Default' },
            race: { id: 'race', name: 'Race' },
            empty: { id: 'empty', name: 'No dashboard yet' },
          };
        if (key === 'dashboards') return stored;
        return null;
      });

      applyDefaultsToAllProfiles();

      const [, written] = mockWriteData.mock.calls.find(
        ([key, value]) => key === 'dashboards' && value.race
      ) as [string, Record<string, DashboardLayout>];
      const tachometer = written.race.widgets.find(
        (w) => w.id === 'tachometer'
      );
      const defaults = defaultDashboard.widgets.find(
        (w) => w.id === 'tachometer'
      )?.config as Record<string, unknown>;
      expect(tachometer?.config).toEqual({
        ...defaults,
        background: { ...(defaults.background as object), opacity: 40 },
      });
      // A profile without a stored dashboard is left for first use.
      expect(written).not.toHaveProperty('empty');
    });

    it('repairs malformed inactive dashboards instead of stopping startup', () => {
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return {
            default: { id: 'default', name: 'Default' },
            broken: { id: 'broken', name: 'Broken' },
            nulls: { id: 'nulls', name: 'Null widget' },
            gone: null,
          };
        if (key === 'dashboards')
          return {
            default: defaultDashboard,
            broken: {},
            nulls: { ...defaultDashboard, widgets: [null] },
          };
        return null;
      });

      expect(() => applyDefaultsToAllProfiles()).not.toThrow();

      // One write for every inactive profile; bad entries fall back to the
      // defaults (R8.3) instead of leaving the whole profile unmigrated.
      expect(mockWriteData).toHaveBeenCalledOnce();
      const [key, written] = mockWriteData.mock.calls[0] as [
        string,
        Record<string, DashboardLayout>,
      ];
      expect(key).toBe('dashboards');
      expect(written.broken.widgets.map((w) => w.id)).toEqual(
        defaultDashboard.widgets.map((w) => w.id)
      );
      expect(written.nulls.widgets).not.toContain(null);
      expect(written.nulls.widgets).toHaveLength(
        defaultDashboard.widgets.length
      );
    });

    it('repairs a stored widget from its defaults and keeps the rest', () => {
      const instanceLayout = { x: 10, y: 20, width: 300, height: 200 };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return {
            default: { id: 'default', name: 'Default' },
            race: { id: 'race', name: 'Race' },
          };
        if (key === 'dashboards')
          return {
            default: defaultDashboard,
            race: {
              ...defaultDashboard,
              widgets: [
                ...defaultDashboard.widgets.map((w) =>
                  w.id === 'tachometer'
                    ? {
                        id: 'tachometer',
                        layout: {},
                        config: { background: { opacity: 40 } },
                      }
                    : w
                ),
                {
                  id: 'standings-2',
                  type: 'standings',
                  layout: instanceLayout,
                },
                {
                  id: 'standings-3',
                  type: 'standings',
                  enabled: true,
                  layout: { x: 0, y: 0, width: -300, height: 0 },
                },
                {
                  id: 'fuel-2',
                  type: 5,
                  enabled: true,
                  layout: instanceLayout,
                },
                { id: 'unknown', enabled: true },
              ],
            },
          };
        return null;
      });

      applyDefaultsToAllProfiles();

      const [, written] = mockWriteData.mock.calls[0] as [
        string,
        Record<string, DashboardLayout>,
      ];
      const byId = (id: string) =>
        written.race.widgets.find((w) => w.id === id);
      const defaultOf = (id: string) =>
        defaultDashboard.widgets.find((w) => w.id === id);

      expect(byId('tachometer')?.layout).toEqual(
        defaultOf('tachometer')?.layout
      );
      // A missing `enabled` stays off, as it was read before.
      expect(byId('tachometer')?.enabled).toBe(false);
      expect(byId('tachometer')?.config?.background).toMatchObject({
        opacity: 40,
      });
      // An extra instance keeps its own layout.
      expect(byId('standings-2')?.layout).toEqual(instanceLayout);
      expect(byId('standings-2')?.enabled).toBe(false);
      // An unusable layout comes from the instance's type.
      expect(byId('standings-3')?.layout).toEqual(
        defaultOf('standings')?.layout
      );
      expect(byId('standings-3')?.enabled).toBe(true);
      // A type that isn't a string is dropped.
      expect(byId('fuel-2')).not.toHaveProperty('type');
      // Nothing to fall back on for the layout.
      expect(byId('unknown')).toBeUndefined();
      // Both the drop and the repair are logged.
      const warned = mockLoggerWarn.mock.calls.map(([message, id]) => [
        message,
        id,
      ]);
      expect(warned).toContainEqual([
        '[toStoredWidget] Dropped widget with no usable layout:',
        'unknown',
      ]);
      expect(warned).toContainEqual([
        '[toStoredWidget] Replaced an invalid layout with the default for:',
        'tachometer',
      ]);
    });

    it('never throws on unreadable stored data', () => {
      mockReadData.mockImplementation(() => {
        throw new Error('corrupt store');
      });
      expect(() => applyDefaultsToAllProfiles()).not.toThrow();
    });
  });

  describe('setCurrentProfile', () => {
    it('fills in the stored dashboard before emitting it', () => {
      const stored: Record<string, DashboardLayout> = {
        default: defaultDashboard,
        race: {
          ...defaultDashboard,
          widgets: defaultDashboard.widgets.map((w) =>
            w.id === 'tachometer'
              ? { ...w, config: { background: { opacity: 40 } } }
              : w
          ),
        },
      };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return {
            default: { id: 'default', name: 'Default' },
            race: { id: 'race', name: 'Race' },
          };
        if (key === 'dashboards') return stored;
        return null;
      });

      setCurrentProfile('race');

      const defaults = defaultDashboard.widgets.find(
        (w) => w.id === 'tachometer'
      )?.config as Record<string, unknown>;
      expect(mockEmitDashboardUpdated).toHaveBeenCalledOnce();
      const [emitted] = mockEmitDashboardUpdated.mock.calls[0] as [
        DashboardLayout,
      ];
      expect(
        emitted.widgets.find((w) => w.id === 'tachometer')?.config
      ).toEqual({
        ...defaults,
        background: { ...(defaults.background as object), opacity: 40 },
      });
      expect(mockWriteData).toHaveBeenCalledWith('currentProfile', 'race');
    });
  });

  describe('moving onto the new overlay look', () => {
    it('moves a profile still on Lato, the old default, to Figtree once', () => {
      const result = withDashboardDefaults({
        widgets: [],
        generalSettings: { fontType: 'lato', fontSize: 'lg' },
      });

      expect(result.generalSettings).toMatchObject({
        fontType: 'figtree',
        fontSize: 'lg',
        redesignDefaultsApplied: true,
      });
      expect(withDashboardDefaults(result)).toEqual(result);
    });

    it('keeps Lato when it was picked after the move', () => {
      const result = withDashboardDefaults({
        widgets: [],
        generalSettings: { fontType: 'lato', redesignDefaultsApplied: true },
      });

      expect(result.generalSettings?.fontType).toBe('lato');
    });

    it('keeps any other font and marks the profile as moved', () => {
      const result = withDashboardDefaults({
        widgets: [],
        generalSettings: { fontType: 'inter' },
      });

      expect(result.generalSettings).toMatchObject({
        fontType: 'inter',
        redesignDefaultsApplied: true,
      });
    });

    it('gives a profile with no font Figtree', () => {
      const result = withDashboardDefaults({ widgets: [] });

      expect(result.generalSettings?.fontType).toBe('figtree');
    });

    const filledConfig = {
      stylingOptions: {
        driverPosition: { background: true },
        driverNumber: { background: true, border: true },
      },
      classHeaderStyle: {
        className: { colorBackground: true },
        classInfo: { colorBackground: false },
      },
    };
    const configOf = (result: DashboardLayout, id: string) =>
      result.widgets.find((w) => w.id === id)?.config as typeof filledConfig;

    it('turns the old filled Standings and Relative cells off once', () => {
      const result = withDashboardDefaults({
        widgets: [
          { id: 'standings', enabled: true, config: filledConfig },
          {
            id: 'relative-2',
            type: 'relative',
            enabled: true,
            config: filledConfig,
          },
        ],
      } as unknown as DashboardLayout);

      for (const id of ['standings', 'relative-2']) {
        const config = configOf(result, id);
        expect(config.stylingOptions.driverPosition.background).toBe(false);
        expect(config.stylingOptions.driverNumber).toEqual({
          background: false,
          border: true,
        });
        expect(config.classHeaderStyle.className.colorBackground).toBe(false);
        expect(config.classHeaderStyle.classInfo.colorBackground).toBe(false);
      }
      expect(withDashboardDefaults(result)).toEqual(result);
    });

    it('keeps a fill switched on after the move', () => {
      const result = withDashboardDefaults({
        generalSettings: { redesignDefaultsApplied: true },
        widgets: [{ id: 'standings', enabled: true, config: filledConfig }],
      } as unknown as DashboardLayout);

      const config = configOf(result, 'standings');
      expect(config.stylingOptions.driverNumber.background).toBe(true);
      expect(config.classHeaderStyle.className.colorBackground).toBe(true);
    });

    it('leaves the fills of other widgets alone', () => {
      const result = withDashboardDefaults({
        widgets: [{ id: 'battle', enabled: true, config: filledConfig }],
      } as unknown as DashboardLayout);

      expect(
        configOf(result, 'battle').stylingOptions.driverNumber.background
      ).toBe(true);
    });
  });

  describe('configuration reset', () => {
    it('resets shared scales, including migrated standings and custom instances, while preserving the layout', () => {
      const layout = { x: 20, y: 40, width: 400, height: 300 };
      const dashboard = withDashboardDefaults({
        widgets: [
          {
            id: 'standings',
            enabled: false,
            layout,
            config: { scale: 125, background: { opacity: 40 } },
          },
          {
            id: 'fuel-2',
            type: 'fuel',
            enabled: true,
            placement: 'gantry',
            layout: { ...layout, x: 100 },
            scale: 75,
            config: {},
          },
        ],
      });
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'race';
        if (key === 'dashboards') return { race: dashboard };
        return null;
      });

      const reset = resetDashboard(false, 'race');

      expect(reset.widgets.every((widget) => widget.scale === 100)).toBe(true);
      expect(reset.widgets[0]).toMatchObject({
        id: 'standings',
        enabled: false,
        layout,
      });
      expect(reset.widgets[0].config).toEqual(
        defaultDashboard.widgets.find((widget) => widget.id === 'standings')
          ?.config
      );
      expect(reset.widgets[1]).toMatchObject({
        id: 'fuel-2',
        type: 'fuel',
        enabled: true,
        placement: 'gantry',
        layout: { ...layout, x: 100 },
        scale: 100,
      });
      expect(dashboard.widgets[0].scale).toBe(125);
      expect(dashboard.widgets[1].scale).toBe(75);
      expect(mockWriteData).toHaveBeenCalledWith('dashboards', { race: reset });
    });

    it('switches off what the widget group had switched on when resetting configs', () => {
      const layout = { x: 1, y: 2, width: 30, height: 40 };
      const member = { x: 0, y: 0, width: 9, height: 9 };
      const dashboard = withDashboardDefaults({
        widgets: [
          {
            id: 'widgetgroup',
            enabled: true,
            layout,
            config: {
              members: [
                { widgetId: 'flag', ...member, restoreDisabled: true },
                { widgetId: 'radar', ...member },
              ],
            },
          },
          { id: 'flag', enabled: true, layout, config: {} },
          { id: 'radar', enabled: true, layout, config: {} },
        ],
      });
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'race';
        if (key === 'dashboards') return { race: dashboard };
        return null;
      });

      const { widgets } = resetDashboard(false, 'race');
      const enabled = (id: string) =>
        widgets.find((widget) => widget.id === id)?.enabled;

      expect(enabled('flag')).toBe(false);
      expect(enabled('radar')).toBe(true);
      expect(enabled('widgetgroup')).toBe(true);
    });

    it('empties every widget group when resetting config', () => {
      const layout = { x: 1, y: 2, width: 30, height: 40 };
      const dashboard = withDashboardDefaults({
        widgets: [
          {
            id: 'widgetgroup-2',
            type: 'widgetgroup',
            enabled: true,
            layout,
            config: {
              members: [
                {
                  widgetId: 'flag',
                  x: 0,
                  y: 0,
                  width: 9,
                  height: 9,
                  restoreDisabled: true,
                },
              ],
            },
          },
          { id: 'flag', enabled: true, layout, config: {} },
        ],
      });
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'race';
        if (key === 'dashboards') return { race: dashboard };
        return null;
      });

      const { widgets } = resetDashboard(false, 'race');
      const widget = (id: string) => widgets.find((item) => item.id === id);

      expect(widget('widgetgroup-2')?.config?.members).toEqual([]);
      expect(widget('flag')?.enabled).toBe(false);
    });
  });

  describe('widget scale migration', () => {
    const layout = { x: 20, y: 40, width: 400, height: 300 };

    it('moves standings scales, including custom instances, without mutating saved data', () => {
      const dashboard: DashboardLayout = {
        widgets: [
          { id: 'standings', enabled: true, layout, config: { scale: 125 } },
          {
            id: 'standings-2',
            type: 'standings',
            enabled: true,
            layout,
            config: { scale: 75, background: { opacity: 40 } },
          },
          { id: 'laptimelog', enabled: true, layout, config: { scale: 150 } },
        ],
      };
      const migrated = withDashboardDefaults(dashboard);
      expect(migrated.widgets[0].scale).toBe(125);
      expect(migrated.widgets[0].config).not.toHaveProperty('scale');
      expect(migrated.widgets[1]).toMatchObject({
        scale: 75,
        layout,
        config: { background: { opacity: 40 } },
      });
      expect(migrated.widgets[1].config).not.toHaveProperty('scale');
      expect(migrated.widgets[2].config?.scale).toBe(150);
      expect(migrated.widgets[2].scale).toBeUndefined();
      expect(dashboard.widgets[0].config?.scale).toBe(125);
      expect(withDashboardDefaults(migrated)).toEqual(migrated);
    });

    it('prefers the shared scale and normalizes malformed values', () => {
      const migrated = withDashboardDefaults({
        widgets: [
          {
            id: 'standings',
            enabled: true,
            layout,
            scale: 80,
            config: { scale: 150 },
          },
          { id: 'fuel', enabled: true, layout, scale: 1000 },
          { id: 'fuel-2', type: 'fuel', enabled: true, layout, scale: -10 },
          {
            id: 'fuel-3',
            type: 'fuel',
            enabled: true,
            layout,
            scale: '125' as unknown as number,
          },
          {
            id: 'standings-2',
            type: 'standings',
            enabled: true,
            layout,
            config: { scale: null },
          },
        ],
      });
      expect(migrated.widgets.slice(0, 5).map((w) => w.scale)).toEqual([
        80, 200, 50, 100, 100,
      ]);
    });
  });

  describe('custom instance defaults', () => {
    const layout = { x: 20, y: 40, width: 400, height: 300 };

    it('fills a second instance from the defaults of its type', () => {
      const migrated = withDashboardDefaults({
        widgets: [
          {
            id: 'standings-g1',
            type: 'standings',
            enabled: true,
            placement: 'gantry',
            layout,
            config: { background: { opacity: 40 } },
          },
        ],
      });
      const instance = migrated.widgets.find((w) => w.id === 'standings-g1');
      const defaults = defaultDashboard.widgets.find(
        (w) => w.id === 'standings'
      )?.config as Record<string, unknown>;
      expect(instance?.config?.background).toEqual({ opacity: 40 });
      expect(instance?.config?.displayOrder).toEqual(defaults.displayOrder);
      expect(instance?.placement).toBe('gantry');
    });
  });

  describe('Input widget saved before the input source choice', () => {
    const layout = { x: 622, y: 864, width: 396, height: 92 };
    // The widget as a dashboard stored it when the source was the Use Raw
    // Inputs checkbox, with a few settings moved off their defaults.
    const savedConfig = (useRawValues: unknown) => ({
      useRawValues,
      trace: {
        enabled: true,
        includeThrottle: true,
        includeBrake: true,
        includeAbs: false,
        includeSteer: true,
        includeClutch: false,
        strokeWidth: 5,
        maxSamples: 400,
      },
      bar: {
        enabled: true,
        includeClutch: false,
        includeBrake: true,
        includeThrottle: true,
        includeAbs: true,
      },
      gear: {
        enabled: true,
        size: 100,
        showspeed: true,
        showspeedunit: true,
        unit: 'auto',
      },
      abs: { enabled: false },
      steer: { enabled: true, config: { style: 'lmp', color: 'dark' } },
      background: { opacity: 80 },
      showOnlyWhenOnTrack: true,
      displayOrder: ['trace', 'bar', 'gear', 'steer'],
    });
    const inputIn = (dashboard: DashboardLayout, id = 'input') =>
      dashboard.widgets.find((w) => w.id === id)?.config as Record<
        string,
        Record<string, unknown>
      >;
    const load = (useRawValues: unknown) =>
      withDashboardDefaults({
        widgets: [
          {
            id: 'input',
            enabled: true,
            layout,
            config: savedConfig(useRawValues),
          },
        ],
      });

    it('keeps Use Raw Inputs as it was: on is the Pedals source, off is Car', () => {
      // The choice is still stored as the boolean, so there is nothing to
      // convert and an older build reads a newer dashboard the same way.
      expect(inputIn(load(true)).useRawValues).toBe(true);
      expect(inputIn(load(false)).useRawValues).toBe(false);
    });

    it('starts a dashboard that never had the setting on the Car source', () => {
      expect(inputIn(load(undefined)).useRawValues).toBe(false);
      expect(inputIn(withDashboardDefaults({ widgets: [] })).useRawValues).toBe(
        false
      );
    });

    it('fills in what the widget has gained and keeps what was saved', () => {
      const config = inputIn(load(true));

      // The two marks are on; everything else new is off or as it was.
      expect(config.trace).toMatchObject({
        includeTc: true,
        absStyle: 'overlay',
        includeAbs: false,
        strokeWidth: 5,
      });
      expect(config.bar).toMatchObject({
        includeTc: true,
        dual: false,
        brakeFromPressure: false,
        showMaxMarker: true,
        includeFfb: false,
        includeClutch: false,
      });
      expect(config.steer).toEqual({
        enabled: true,
        config: { style: 'lmp', color: 'dark' },
        angleReadout: 'beyond270',
        rotationArc: 'never',
        rangeDeg: 0,
        showWheelAngle: false,
      });
      expect(config.steerMeter).toEqual({
        enabled: false,
        markDeg: 90,
        showAngle: true,
      });
      // No layout was saved, so none is invented: the meter stays out.
      expect(config.layoutTree).toBeUndefined();
      // Loading it again changes nothing.
      const loaded = load(true);
      expect(withDashboardDefaults(loaded)).toEqual(loaded);
    });

    it('keeps the source of a second Input widget its own', () => {
      const migrated = withDashboardDefaults({
        widgets: [
          {
            id: 'input',
            enabled: true,
            layout,
            config: savedConfig(false),
          },
          {
            id: 'input-x1',
            type: 'input',
            enabled: true,
            layout,
            config: savedConfig(true),
          },
        ],
      });

      expect(inputIn(migrated).useRawValues).toBe(false);
      expect(inputIn(migrated, 'input-x1').useRawValues).toBe(true);
      expect(inputIn(migrated, 'input-x1').bar.includeTc).toBe(true);
    });
  });

  describe('Standings and Relative saved before the lap average columns', () => {
    const layout = { x: 6, y: 10, width: 560, height: 774 };
    const NEW_COLUMNS = ['avgLast5', 'avgLast10'];
    const NEW_KEYS = [...NEW_COLUMNS, 'averagesOver'];
    const without = (config: Record<string, unknown>, keys: string[]) =>
      Object.fromEntries(
        Object.entries(config).filter(([key]) => !keys.includes(key))
      );

    // A widget as a build before Avg 5 and Avg 10 stored it: what it has
    // today without them, and then the driver's own settings on top, with
    // the columns in an order of their own.
    const savedConfig = (type: 'standings' | 'relative') => {
      const now = structuredClone(
        getWidgetDefaultConfig(type)
      ) as unknown as Record<string, unknown>;
      const order = (now.displayOrder as string[]).filter(
        (name) => !NEW_COLUMNS.includes(name)
      );
      return {
        ...without(now, NEW_KEYS),
        background: { opacity: 55 },
        lastTime: { enabled: true, timeFormat: 'mixed', markInvalid: false },
        fastestTime: { enabled: false, timeFormat: 'seconds-full' },
        avgLapTime: {
          enabled: true,
          numLaps: 7,
          timeFormat: 'full',
          excludePitLaps: true,
        },
        lmuVirtualEnergy: { enabled: true },
        showOnlyWhenOnTrack: true,
        displayOrder: [
          'lastTime',
          'lmuVirtualEnergy',
          ...order.filter(
            (name) => name !== 'lastTime' && name !== 'lmuVirtualEnergy'
          ),
        ],
      };
    };
    const stored = (): DashboardLayout => ({
      widgets: [
        {
          id: 'standings',
          enabled: true,
          layout,
          config: savedConfig('standings'),
        },
        // The Gantry's own Standings layout is a Standings widget too.
        {
          id: 'standings-g1',
          type: 'standings',
          placement: 'gantry',
          enabled: true,
          layout,
          config: savedConfig('standings'),
        },
        {
          id: 'relative',
          enabled: false,
          layout,
          config: savedConfig('relative'),
        },
      ],
    });
    const configOf = (dashboard: DashboardLayout, id: string) =>
      dashboard.widgets.find((w) => w.id === id)?.config as Record<
        string,
        unknown
      >;

    it.each([
      ['standings', 'standings'],
      ['standings-g1', 'standings'],
      ['relative', 'relative'],
    ] as const)(
      'gives %s the two columns, switched off, and keeps every stored setting',
      (id, type) => {
        const before = savedConfig(type);

        const loaded = withDashboardDefaults(stored());
        const config = configOf(loaded, id);

        // Everything the profile held, value for value.
        expect(without(config, [...NEW_KEYS, 'displayOrder'])).toEqual(
          without(before, ['displayOrder'])
        );
        // The columns in the order the driver left them, plus the two new.
        const order = config.displayOrder as string[];
        expect(order.filter((name) => !NEW_COLUMNS.includes(name))).toEqual(
          before.displayOrder
        );
        expect(order).toHaveLength(before.displayOrder.length + 2);
        // Beside the rolling average, where a new dashboard has them.
        const rolling = order.indexOf('avgLapTime');
        expect(order.slice(rolling + 1, rolling + 3)).toEqual(NEW_COLUMNS);
        // Off, over clean laps: the widget looks as it did.
        expect(config.avgLast5).toEqual({ enabled: false, timeFormat: 'full' });
        expect(config.avgLast10).toEqual({
          enabled: false,
          timeFormat: 'full',
        });
        expect(config.averagesOver).toBe('clean');
        // The widget itself is untouched: where it is and whether it is on.
        expect(loaded.widgets.find((w) => w.id === id)).toMatchObject({
          enabled: id !== 'relative',
          layout,
        });
      }
    );

    it('changes nothing more when the profile is loaded again', () => {
      const loaded = withDashboardDefaults(stored());

      expect(withDashboardDefaults(loaded)).toEqual(loaded);
    });

    it('keeps the columns as the driver then sets them', () => {
      const loaded = withDashboardDefaults(stored());
      const chosen: DashboardLayout = {
        ...loaded,
        widgets: loaded.widgets.map((widget) =>
          widget.id === 'standings'
            ? {
                ...widget,
                config: {
                  ...widget.config,
                  avgLast5: { enabled: true, timeFormat: 'mixed' },
                  averagesOver: 'all',
                },
              }
            : widget
        ),
      };

      const config = configOf(withDashboardDefaults(chosen), 'standings');

      expect(config.avgLast5).toEqual({ enabled: true, timeFormat: 'mixed' });
      expect(config.avgLast10).toEqual({ enabled: false, timeFormat: 'full' });
      expect(config.averagesOver).toBe('all');
    });
  });

  describe('Standings and Relative saved before the vs stint column', () => {
    const layout = { x: 6, y: 10, width: 560, height: 774 };
    const NEW_KEYS = ['stintPace', 'paceAgainst'];
    const without = (config: Record<string, unknown>, keys: string[]) =>
      Object.fromEntries(
        Object.entries(config).filter(([key]) => !keys.includes(key))
      );

    // A widget as the build before the column stored it: what it has today
    // without it, and then the driver's own settings on top, with the
    // averages on and the columns in an order of their own.
    const savedConfig = (type: 'standings' | 'relative') => {
      const now = structuredClone(
        getWidgetDefaultConfig(type)
      ) as unknown as Record<string, unknown>;
      const order = (now.displayOrder as string[]).filter(
        (name) => name !== 'stintPace'
      );
      return {
        ...without(now, NEW_KEYS),
        background: { opacity: 55 },
        avgLast5: { enabled: true, timeFormat: 'mixed' },
        averagesOver: 'all',
        showOnlyWhenOnTrack: true,
        displayOrder: [
          'avgLast10',
          'lastTime',
          ...order.filter(
            (name) => name !== 'avgLast10' && name !== 'lastTime'
          ),
        ],
      };
    };
    const stored = (): DashboardLayout => ({
      widgets: [
        {
          id: 'standings',
          enabled: true,
          layout,
          config: savedConfig('standings'),
        },
        // The Gantry's own Standings layout is a Standings widget too.
        {
          id: 'standings-g1',
          type: 'standings',
          placement: 'gantry',
          enabled: true,
          layout,
          config: savedConfig('standings'),
        },
        {
          id: 'relative',
          enabled: false,
          layout,
          config: savedConfig('relative'),
        },
      ],
    });
    const configOf = (dashboard: DashboardLayout, id: string) =>
      dashboard.widgets.find((w) => w.id === id)?.config as Record<
        string,
        unknown
      >;

    it.each([
      ['standings', 'standings', 'lapCount'],
      ['standings-g1', 'standings', 'lapCount'],
      ['relative', 'relative', 'trackLimits'],
    ] as const)(
      'gives %s the column, switched off, and keeps every stored setting',
      (id, type, next) => {
        const before = savedConfig(type);

        const loaded = withDashboardDefaults(stored());
        const config = configOf(loaded, id);

        // Everything the profile held, value for value.
        expect(without(config, [...NEW_KEYS, 'displayOrder'])).toEqual(
          without(before, ['displayOrder'])
        );
        // The columns in the order the driver left them, plus the new one,
        // ahead of the column a new dashboard has after it.
        const order = config.displayOrder as string[];
        expect(order.filter((name) => name !== 'stintPace')).toEqual(
          before.displayOrder
        );
        expect(order).toHaveLength(before.displayOrder.length + 1);
        expect(order[order.indexOf('stintPace') + 1]).toBe(next);
        // Off, against the previous stint: the widget looks as it did, and
        // no race is recorded for it.
        expect(config.stintPace).toEqual({ enabled: false });
        expect(config.paceAgainst).toBe('stint');
        // The widget itself is untouched: where it is and whether it is on.
        expect(loaded.widgets.find((w) => w.id === id)).toMatchObject({
          enabled: id !== 'relative',
          layout,
        });
      }
    );

    it('changes nothing more when the profile is loaded again', () => {
      const loaded = withDashboardDefaults(stored());

      expect(withDashboardDefaults(loaded)).toEqual(loaded);
    });

    it('keeps the column as the driver then sets it', () => {
      const loaded = withDashboardDefaults(stored());
      const chosen: DashboardLayout = {
        ...loaded,
        widgets: loaded.widgets.map((widget) =>
          widget.id === 'standings'
            ? {
                ...widget,
                config: {
                  ...widget.config,
                  stintPace: { enabled: true },
                  paceAgainst: 'driver',
                },
              }
            : widget
        ),
      };

      const config = configOf(withDashboardDefaults(chosen), 'standings');

      expect(config.stintPace).toEqual({ enabled: true });
      expect(config.paceAgainst).toBe('driver');
      // The Relative beside it was not touched.
      expect(
        configOf(withDashboardDefaults(chosen), 'relative').stintPace
      ).toEqual({ enabled: false });
    });
  });

  describe('Timing Tower and Class Rivals saved before the laps on a set of tyres', () => {
    const layout = { x: 40, y: 60, width: 900, height: 700 };
    const without = (config: Record<string, unknown>, keys: string[]) =>
      Object.fromEntries(
        Object.entries(config).filter(([key]) => !keys.includes(key))
      );

    // The two widgets as the build before stored them: the tower's Tyres
    // column a switch and nothing else, Class Rivals with no such column,
    // and the driver's own settings on top.
    const savedTower = () => ({
      ...(structuredClone(
        getWidgetDefaultConfig('timingtower')
      ) as unknown as Record<string, unknown>),
      background: { opacity: 60 },
      tyres: { enabled: true },
      pitStops: { enabled: false },
      paceAgainst: 'driver',
    });
    const savedRivals = () => ({
      ...without(
        structuredClone(
          getWidgetDefaultConfig('classrivals')
        ) as unknown as Record<string, unknown>,
        ['showTyres']
      ),
      background: { opacity: 45 },
      carsAhead: 3,
      showPace: false,
    });
    const stored = (
      tower: Record<string, unknown> = savedTower()
    ): DashboardLayout => ({
      widgets: [
        { id: 'timingtower', enabled: true, layout, config: tower },
        { id: 'classrivals', enabled: false, layout, config: savedRivals() },
      ],
    });
    const configOf = (dashboard: DashboardLayout, id: string) =>
      dashboard.widgets.find((w) => w.id === id)?.config as Record<
        string,
        unknown
      >;

    it('gives the tower the laps and the tread, switched on, and keeps every stored setting', () => {
      const before = savedTower();

      const loaded = withDashboardDefaults(stored());
      const config = configOf(loaded, 'timingtower');

      expect(without(config, ['tyres'])).toEqual(without(before, ['tyres']));
      // On beside the compound, with what four tyres take left to the sim.
      expect(config.tyres).toEqual({
        enabled: true,
        set: true,
        changeSeconds: 0,
      });
      expect(loaded.widgets[0]).toMatchObject({ enabled: true, layout });
    });

    it('keeps a Tyres column the driver had switched off, off', () => {
      const loaded = withDashboardDefaults(
        stored({ ...savedTower(), tyres: { enabled: false } })
      );

      expect(configOf(loaded, 'timingtower').tyres).toEqual({
        enabled: false,
        set: true,
        changeSeconds: 0,
      });
    });

    it('gives Class Rivals the Tyres column, switched on, and keeps every stored setting', () => {
      const before = savedRivals();

      const loaded = withDashboardDefaults(stored());
      const config = configOf(loaded, 'classrivals');

      expect(without(config, ['showTyres'])).toEqual(before);
      expect(config.showTyres).toBe(true);
      // Where it is and whether it is on are the driver's.
      expect(loaded.widgets[1]).toMatchObject({ enabled: false, layout });
    });

    it('changes nothing more when the profile is loaded again', () => {
      const loaded = withDashboardDefaults(stored());

      expect(withDashboardDefaults(loaded)).toEqual(loaded);
    });

    it('keeps the settings as the driver then leaves them', () => {
      const loaded = withDashboardDefaults(stored());
      const chosen: DashboardLayout = {
        ...loaded,
        widgets: loaded.widgets.map((widget) =>
          widget.id === 'timingtower'
            ? {
                ...widget,
                config: {
                  ...widget.config,
                  tyres: { enabled: true, set: false, changeSeconds: 18 },
                },
              }
            : { ...widget, config: { ...widget.config, showTyres: false } }
        ),
      };

      const again = withDashboardDefaults(chosen);

      expect(configOf(again, 'timingtower').tyres).toEqual({
        enabled: true,
        set: false,
        changeSeconds: 18,
      });
      expect(configOf(again, 'classrivals').showTyres).toBe(false);
    });
  });

  describe('Pit Wall saved before the Custom layout', () => {
    const layout = { x: 0, y: 0, width: 1600, height: 900 };
    const stored = (config: Record<string, unknown>): DashboardLayout => ({
      widgets: [{ id: 'pitwall', enabled: true, layout, config }],
    });
    const configOf = (dashboard: DashboardLayout) =>
      dashboard.widgets.find((w) => w.id === 'pitwall')?.config as Record<
        string,
        unknown
      >;
    // What the user arranged: three panels, saved in the order they are
    // read on the page.
    const arranged = [
      { widget: 'standings', x: 0, y: 0, w: 12, h: 16 },
      { widget: 'fuel', x: 12, y: 0, w: 6, h: 8 },
      { widget: 'racelog', x: 12, y: 8, w: 12, h: 8 },
    ];

    it('is given no list of panels, so the Custom layout shows as it starts', () => {
      // As the build before stored it: a layout and a tab.
      const loaded = withDashboardDefaults(
        stored({ layout: 'watching', tab: 'overview' })
      );

      expect(configOf(loaded)).toEqual({ layout: 'watching', tab: 'overview' });
      expect(configOf(loaded)).not.toHaveProperty('custom');
      // Where and whether it is on are the user's.
      expect(loaded.widgets[0]).toMatchObject({ enabled: true, layout });
      // Read by the page: the layout chosen is kept, and Custom, when it is
      // chosen, is the copy of Race.
      expect(sanitizePitWallConfig(configOf(loaded))).toEqual({
        layout: 'watching',
        tab: 'overview',
      });
      expect(
        resolvePitWall(loaded, undefined, { layout: 'custom' }).tab.cells
      ).toBe(PIT_WALL_CUSTOM_START);
    });

    it('fills in the tab for a profile saved before the tabs, and still no list', () => {
      const loaded = withDashboardDefaults(stored({ layout: 'compact' }));

      expect(configOf(loaded)).toEqual({ layout: 'compact', tab: 'overview' });
    });

    it('gives a new profile no list either', () => {
      expect(getWidgetDefaultConfig('pitwall')).not.toHaveProperty('custom');
      expect(
        configOf(withDashboardDefaults({ widgets: [] } as DashboardLayout))
      ).toEqual({ layout: 'race', tab: 'overview' });
    });

    it('keeps the list the user arranged whole, in its order', () => {
      const loaded = withDashboardDefaults(
        stored({ layout: 'custom', tab: 'overview', custom: arranged })
      );

      expect(configOf(loaded)).toEqual({
        layout: 'custom',
        tab: 'overview',
        custom: arranged,
      });
      expect(
        resolvePitWall(loaded).panels.map((panel) => panel.slot.widget)
      ).toEqual(['standings', 'fuel', 'racelog']);
    });

    it('keeps a list beside another layout, for when Custom is chosen again', () => {
      const loaded = withDashboardDefaults(
        stored({ layout: 'race', tab: 'overview', custom: arranged })
      );

      expect(configOf(loaded).custom).toEqual(arranged);
      expect(resolvePitWall(loaded).layout.id).toBe('race');
    });

    it('keeps a page the user emptied empty', () => {
      const loaded = withDashboardDefaults(
        stored({ layout: 'custom', tab: 'overview', custom: [] })
      );

      expect(configOf(loaded).custom).toEqual([]);
      expect(resolvePitWall(loaded).panels).toEqual([]);
    });

    it('stores a broken list as it came and leaves the reading of it to the page', () => {
      // The merge fills in what is missing and mends nothing: the page
      // reads the list as untrusted every time it is handed one.
      const broken = [
        { widget: 'timingtower', x: 0, y: 0, w: 30, h: 4 },
        'rubbish',
        arranged[1],
        { widget: 'fuel', x: 0, y: 8, w: 4, h: 4 },
        { widget: 'spaceship', x: 0, y: 12, w: 4, h: 4 },
      ];
      const loaded = withDashboardDefaults(
        stored({ layout: 'custom', tab: 'overview', custom: broken })
      );

      expect(configOf(loaded).custom).toEqual(broken);
      expect(sanitizePitWallConfig(configOf(loaded)).custom).toEqual([
        arranged[1],
      ]);
      expect(() => resolvePitWall(loaded)).not.toThrow();
    });

    it('reads a list that is no list as none, and shows the copy of Race', () => {
      const loaded = withDashboardDefaults(
        stored({ layout: 'custom', tab: 'overview', custom: 'everything' })
      );

      expect(resolvePitWall(loaded).tab.cells).toBe(PIT_WALL_CUSTOM_START);
    });

    it('changes nothing more when the profile is loaded again', () => {
      for (const config of [
        { layout: 'watching', tab: 'overview' },
        { layout: 'custom', tab: 'overview', custom: arranged },
      ]) {
        const loaded = withDashboardDefaults(stored(config));

        expect(withDashboardDefaults(loaded)).toEqual(loaded);
      }
    });
  });

  describe('Lap trace layout migration', () => {
    const layout = { x: 20, y: 40, width: 400, height: 120 };
    const lapTraceIn = (dashboard: DashboardLayout) =>
      dashboard.widgets.find((w) => w.id === 'laptrace')?.config as Record<
        string,
        unknown
      >;

    it('builds the layout from the old settings before the defaults fill in', () => {
      const migrated = withDashboardDefaults({
        widgets: [
          {
            id: 'laptrace',
            enabled: true,
            layout,
            config: {
              showLastCorner: true,
              lastCornerPosition: 'bottom',
              brakeCueBars: false,
              brakeCueBarSide: 'right',
            },
          },
        ],
      });
      const config = lapTraceIn(migrated);
      // The panel below the trace and no strip, as the old settings had it,
      // not the three-column default.
      expect(JSON.stringify(config.layoutTree)).toContain('corners');
      expect(JSON.stringify(config.layoutTree)).not.toContain('brakeCue');
      expect(config).not.toHaveProperty('showLastCorner');
      expect(config).not.toHaveProperty('brakeCueBarSide');
      // Everything else still comes from the defaults.
      expect(config.metersAhead).toBe(200);
      expect(withDashboardDefaults(migrated)).toEqual(migrated);
    });

    it('starts a new lap trace from the default layout', () => {
      const migrated = withDashboardDefaults({ widgets: [] });
      const defaults = defaultDashboard.widgets.find((w) => w.id === 'laptrace')
        ?.config as Record<string, unknown>;
      expect(lapTraceIn(migrated).layoutTree).toEqual(defaults.layoutTree);
    });
  });

  describe('Radar tuning migration', () => {
    it('drops the pole-side learning tuning and keeps the rest', () => {
      const radarDefaults = defaultDashboard.widgets.find(
        (w) => w.id === 'radar'
      )?.config as Record<string, unknown>;
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards')
          return {
            default: {
              ...defaultDashboard,
              widgets: defaultDashboard.widgets.map((w) =>
                w.id === 'radar'
                  ? {
                      ...w,
                      config: {
                        ...radarDefaults,
                        tuning: {
                          laneRate: 2,
                          poleLearnAfterS: 15,
                          poleFlipFrames: 30,
                        },
                      },
                    }
                  : w
              ),
            },
          };
        return null;
      });

      const tuning = getOrCreateDefaultDashboard().widgets.find(
        (w) => w.id === 'radar'
      )?.config?.tuning as Record<string, unknown>;

      expect(tuning.laneRate).toBe(2);
      expect(tuning).not.toHaveProperty('poleLearnAfterS');
      expect(tuning).not.toHaveProperty('poleFlipFrames');
      expect(tuning.gridMaxSpeedMs).toBeDefined();
    });
  });

  describe('Gantry threshold migration', () => {
    const gantryDefaults = defaultDashboard.widgets.find(
      (w) => w.id === 'gantry'
    )?.config as Record<string, number | string>;

    const dashboardWithGantryConfig = (config: Record<string, unknown>) => ({
      ...defaultDashboard,
      widgets: defaultDashboard.widgets.map((w) =>
        w.id === 'gantry' ? { ...w, config } : w
      ),
    });

    const loadWith = (config: Record<string, unknown>) => {
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards')
          return { default: dashboardWithGantryConfig(config) };
        return null;
      });
      const dashboard = getOrCreateDefaultDashboard();
      return dashboard.widgets.find((w) => w.id === 'gantry')?.config as Record<
        string,
        number | string
      >;
    };

    it('resets thresholds saved before the current version', () => {
      // A config from the frame-count era. Those values are all valid seconds,
      // so nothing rejects them — only the version marker gives them away.
      const config = loadWith({
        ...gantryDefaults,
        thresholdsVersion: undefined,
        slowDurationSeconds: 10,
        offTrackDurationSeconds: 3,
        pitEntryDurationSeconds: 3,
      });

      expect(config.thresholdsVersion).toBe(3);
      expect(config.slowDurationSeconds).toBe(
        gantryDefaults.slowDurationSeconds
      );
      expect(config.impactDecelKmhPerSec).toBe(
        gantryDefaults.impactDecelKmhPerSec
      );
      expect(config.offTrackDurationSeconds).toBe(
        gantryDefaults.offTrackDurationSeconds
      );
      expect(config.pitEntryDurationSeconds).toBe(
        gantryDefaults.pitEntryDurationSeconds
      );
    });

    it('keeps thresholds saved at the current version', () => {
      const config = loadWith({
        ...gantryDefaults,
        thresholdsVersion: 3,
        offTrackDurationSeconds: 0.8,
        slowSpeedThreshold: 25,
      });

      expect(config.offTrackDurationSeconds).toBe(0.8);
      expect(config.slowSpeedThreshold).toBe(25);
    });

    it('leaves non-threshold settings alone when resetting', () => {
      const config = loadWith({
        ...gantryDefaults,
        thresholdsVersion: undefined,
        offTrackDurationSeconds: 3,
        speedUnit: 'mph',
        sessionRetention: 10,
      });

      expect(config.speedUnit).toBe('mph');
      expect(config.sessionRetention).toBe(10);
      expect(config.offTrackDurationSeconds).toBe(
        gantryDefaults.offTrackDurationSeconds
      );
    });
  });

  describe('generalSettings', () => {
    it('should add general settings from the default dashboard if none exist', () => {
      const dashboard: DashboardLayout = { widgets: [] };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return { default: dashboard };
        return null;
      });

      const updatedDashboard = getOrCreateDefaultDashboard();

      expect(updatedDashboard.generalSettings).toEqual(
        defaultDashboard.generalSettings
      );
    });

    it('should preserve general settings from the existing dashboard', () => {
      const dashboard: DashboardLayout = {
        widgets: [],
        generalSettings: { fontSize: 'sm' },
      };
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return { default: dashboard };
        return null;
      });

      const updatedDashboard = getOrCreateDefaultDashboard();

      expect(updatedDashboard.generalSettings).toEqual({
        ...defaultDashboard.generalSettings,
        fontSize: 'sm',
      });
    });
    it('removes legacy settingsTheme and persists palette normalization idempotently', () => {
      const dashboard = {
        ...defaultDashboard,
        generalSettings: {
          ...defaultDashboard.generalSettings,
          settingsTheme: 'legacy',
          colorPalette: 'legacy-palette',
        },
      } as unknown as DashboardLayout;
      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return { default: dashboard };
        return null;
      });

      getOrCreateDefaultDashboard();

      const firstWrite = mockWriteData.mock.calls.find(
        ([key]) => key === 'dashboards'
      )?.[1] as Record<string, DashboardLayout>;
      expect(firstWrite.default.generalSettings).not.toHaveProperty(
        'settingsTheme'
      );
      expect(firstWrite.default.generalSettings?.colorPalette).toBe('default');

      mockReadData.mockImplementation((key: string) => {
        if (key === 'currentProfile') return 'default';
        if (key === 'profiles')
          return { default: { id: 'default', name: 'Default' } };
        if (key === 'dashboards') return firstWrite;
        return null;
      });
      mockWriteData.mockReset();

      getOrCreateDefaultDashboard();

      expect(mockWriteData).not.toHaveBeenCalled();
      expect(getDashboard('default')?.generalSettings?.colorPalette).toBe(
        'default'
      );
    });
  });

  describe('defaultDashboard widgets', () => {
    it('should have showOnlyWhenOnTrack property in Track Map widget', () => {
      const mapWidget = defaultDashboard.widgets.find((w) => w.id === 'map');

      expect(mapWidget).toBeDefined();
      expect(mapWidget?.config?.showOnlyWhenOnTrack).toBe(false);
    });

    it('should have showOnlyWhenOnTrack property in Flat Track Map widget', () => {
      const flatMapWidget = defaultDashboard.widgets.find(
        (w) => w.id === 'flatmap'
      );

      expect(flatMapWidget).toBeDefined();
      expect(flatMapWidget?.config?.showOnlyWhenOnTrack).toBe(false);
    });
  });
});
