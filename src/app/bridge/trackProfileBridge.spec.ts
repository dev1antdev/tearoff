import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TrackNote,
  TrackProfile,
  TrackProfileKey,
  TrackProfileSummary,
} from '../../types';
import type { TrackProfileBridgeOptions } from './trackProfileBridge';

const mock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }
    ),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
    windows: [] as {
      isDestroyed: () => boolean;
      webContents: { id: number; send: ReturnType<typeof vi.fn> };
    }[],
  };
});
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {},
  ipcMain: { handle: mock.handle, removeHandler: mock.removeHandler },
  BrowserWindow: { getAllWindows: () => mock.windows },
}));

import { setupTrackProfileBridge } from './trackProfileBridge';

const TRACK_ID = 694510461;
const TRACK_KEY = `lmu:${TRACK_ID}`;

const note = (extra: Partial<TrackNote> = {}): TrackNote => ({
  id: 'n1',
  distanceM: 285,
  kind: 'track',
  text: 'Andretti Hairpin',
  comment: '',
  pit: false,
  ...extra,
});

const profile = (extra: Partial<TrackProfile> = {}): TrackProfile => ({
  version: 1,
  simulator: 'lmu',
  trackId: TRACK_ID,
  trackName: 'WeatherTech Raceway Laguna Seca',
  trackLengthM: 3590.35,
  pointsCount: 360,
  elevationM: Array.from({ length: 360 }, (_, bucket) => bucket / 10),
  elevationSource: 'recorded',
  elevationLaps: 1,
  xM: Array.from({ length: 360 }, () => 0),
  zM: Array.from({ length: 360 }, () => 0),
  sectorStartPct: [0, 0.39, 0.792],
  sectorSource: 'learned',
  notes: [note()],
  updatedAt: 1_793_000_000_000,
  ...extra,
});

const STORED_KEY: TrackProfileKey = {
  simulator: 'lmu',
  trackId: TRACK_ID,
  trackName: 'WeatherTech Raceway Laguna Seca',
  trackLengthM: 3590.35,
  pointsCount: 360,
};

const SESSION_KEY: TrackProfileKey = {
  simulator: 'iracing',
  trackId: 163,
  trackName: 'Circuit de Spa-Francorchamps',
  trackLengthM: 6996.3,
  pointsCount: 700,
};

const summary: TrackProfileSummary = {
  simulator: 'lmu',
  trackId: TRACK_ID,
  trackName: 'WeatherTech Raceway Laguna Seca',
  trackLengthM: 3590.35,
  elevationSource: 'recorded',
  notes: 1,
  updatedAt: 1_793_000_000_000,
};

/** What stands in for the store: one profile, at Laguna Seca. */
const setup = ({
  stored = profile() as TrackProfile | null,
  sessionKey = null as TrackProfileKey | null,
} = {}) => {
  let listener: (() => void) | undefined;
  let nextId = 0;
  const store = {
    whenLoaded: vi.fn(async (simulator: string, trackId: number) =>
      stored && simulator === 'lmu' && trackId === TRACK_ID ? stored : null
    ),
    list: vi.fn(async () => [summary]),
    saveNotes: vi.fn(async (_key: TrackProfileKey, notes: unknown) =>
      (notes as TrackNote[]).map((each) => ({ ...each }))
    ),
    importNotes: vi.fn(async () => [note(), note({ id: 'imported' })]),
    exportNotes: vi.fn(async () => 'distance,track note,comment,tags\n'),
    clearElevation: vi.fn(async () => true),
    onChanged: vi.fn((callback: () => void) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    }),
  } satisfies TrackProfileBridgeOptions['store'];
  const dispose = setupTrackProfileBridge({
    store,
    getSessionTrackKey: () => sessionKey,
    newId: () => `id-${(nextId += 1)}`,
  });
  return { store, dispose, emitChanged: () => listener?.() };
};

const sender = (id: number) => ({
  id,
  once: vi.fn(),
  removeListener: vi.fn(),
});

const invoke = (channel: string, ...args: unknown[]) => {
  const handler = mock.handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({ sender: sender(1) }, ...args);
};

/** The outcome of a request, whether it was refused at once or later. */
const outcome = async (channel: string, ...args: unknown[]) => {
  try {
    return { value: await invoke(channel, ...args) };
  } catch (error) {
    return { error };
  }
};

const window = (id: number, destroyed = false) => ({
  isDestroyed: () => destroyed,
  webContents: { id, send: vi.fn() },
});

const BAD_KEYS = [
  undefined,
  null,
  7,
  {},
  ['lmu', TRACK_ID],
  '',
  'lmu',
  `lmu:`,
  `:${TRACK_ID}`,
  `LMU:${TRACK_ID}`,
  `lmu:${TRACK_ID}:1`,
  'lmu:1.5',
  'lmu:1e3',
  'lmu:99999999999999999999',
  '../lmu:1',
  'lmu/../x:1',
  `lmu:${TRACK_ID}.json`,
  ` lmu:${TRACK_ID}`,
];

beforeEach(() => {
  mock.handlers.clear();
  mock.windows.length = 0;
  vi.clearAllMocks();
});

describe('track profile bridge', () => {
  describe('reading', () => {
    it('lists the stored tracks', async () => {
      setup();

      expect(await invoke('trackProfile:listTracks')).toEqual([summary]);
    });

    it('hands over a stored profile without its heights and its line', async () => {
      const { store } = setup();

      const details = await invoke('trackProfile:getProfile', TRACK_KEY);

      expect(store.whenLoaded).toHaveBeenCalledWith('lmu', TRACK_ID);
      expect(details).toEqual({
        trackKey: TRACK_KEY,
        simulator: 'lmu',
        trackId: TRACK_ID,
        trackName: 'WeatherTech Raceway Laguna Seca',
        trackLengthM: 3590.35,
        elevationSource: 'recorded',
        elevationLaps: 1,
        sectorSource: 'learned',
        notes: [note()],
        updatedAt: 1_793_000_000_000,
      });
    });

    it('describes the track of the running session before anything is stored for it', async () => {
      setup({ sessionKey: SESSION_KEY });

      expect(await invoke('trackProfile:getProfile', 'iracing:163')).toEqual({
        trackKey: 'iracing:163',
        simulator: 'iracing',
        trackId: 163,
        trackName: 'Circuit de Spa-Francorchamps',
        trackLengthM: 6996.3,
        elevationSource: null,
        elevationLaps: 0,
        sectorSource: 'nominal',
        notes: [],
        updatedAt: 0,
      });
    });

    it('knows nothing of a track that is neither stored nor being driven', async () => {
      setup({ sessionKey: SESSION_KEY });

      expect(await invoke('trackProfile:getProfile', 'iracing:164')).toBeNull();
      expect(await invoke('trackProfile:getProfile', 'lmu:163')).toBeNull();
    });

    it('exports the notes of one kind as text', async () => {
      const { store } = setup();

      expect(await invoke('trackProfile:exportNotes', TRACK_KEY, 'pace')).toBe(
        'distance,track note,comment,tags\n'
      );
      expect(store.exportNotes).toHaveBeenCalledWith('lmu', TRACK_ID, 'pace');
    });
  });

  describe('saving notes', () => {
    it('files them under what the store holds for the track, not what was sent', async () => {
      const { store } = setup();
      const sent = [note({ text: 'Turn 2' })];

      const kept = await invoke('trackProfile:saveNotes', TRACK_KEY, sent);

      expect(store.saveNotes).toHaveBeenCalledWith(STORED_KEY, [
        note({ text: 'Turn 2' }),
      ]);
      expect(kept).toEqual([note({ text: 'Turn 2' })]);
    });

    it('starts a track with nothing stored from the running session', async () => {
      const { store } = setup({ sessionKey: SESSION_KEY });

      await invoke('trackProfile:saveNotes', 'iracing:163', [note()]);

      expect(store.saveNotes).toHaveBeenCalledWith(SESSION_KEY, [note()]);
    });

    it('refuses a track that is neither stored nor being driven', async () => {
      const { store } = setup({ sessionKey: SESSION_KEY });

      expect(
        await invoke('trackProfile:saveNotes', 'iracing:999', [note()])
      ).toBeNull();
      expect(store.saveNotes).not.toHaveBeenCalled();
    });

    it('gives a new note an id', async () => {
      const { store } = setup();

      await invoke('trackProfile:saveNotes', TRACK_KEY, [
        note(),
        {
          distanceM: 900,
          kind: 'pace',
          text: 'Brake',
          comment: '',
          pit: false,
        },
        { id: '', distanceM: 60, kind: 'track', text: 'Pit exit', pit: true },
      ]);

      expect(store.saveNotes).toHaveBeenCalledWith(STORED_KEY, [
        note(),
        {
          id: 'id-1',
          distanceM: 900,
          kind: 'pace',
          text: 'Brake',
          comment: '',
          pit: false,
        },
        {
          id: 'id-2',
          distanceM: 60,
          kind: 'track',
          text: 'Pit exit',
          comment: '',
          pit: true,
        },
      ]);
    });

    it('passes on only the fields a note has, cut to their lengths', async () => {
      const { store } = setup();

      await invoke('trackProfile:saveNotes', TRACK_KEY, [
        {
          ...note({ text: 'x'.repeat(200), comment: 'y'.repeat(600) }),
          trackLengthM: 1,
          constructor: 'x',
          path: 'C:\\Windows',
        },
      ]);

      const [[, sent]] = store.saveNotes.mock.calls;
      const [saved] = sent as Record<string, unknown>[];
      expect(Object.keys(saved).sort()).toEqual([
        'comment',
        'distanceM',
        'id',
        'kind',
        'pit',
        'text',
      ]);
      expect(saved.text).toHaveLength(120);
      expect(saved.comment).toHaveLength(500);
    });

    it.each([
      ['not a list', { 0: note() }],
      ['a note that is not an object', [note(), 'Turn 2']],
      ['a list in a list', [[note()]]],
      [
        'a distance that is not a number',
        [note({ distanceM: '285' as never })],
      ],
      ['a distance that is not finite', [note({ distanceM: Number.NaN })]],
      ['a negative distance', [note({ distanceM: -1 })]],
      ['a kind that is not one', [note({ kind: 'pit' as never })]],
      ['a text that is not text', [note({ text: 7 as never })]],
      ['a comment that is not text', [note({ comment: {} as never })]],
      ['a pit mark that is not a switch', [note({ pit: 'yes' as never })]],
      ['an id that is not text', [note({ id: 7 as never })]],
      ['an id too long to be one', [note({ id: 'x'.repeat(65) })]],
      [
        'more notes than a track holds',
        Array.from({ length: 501 }, (_, index) => note({ id: `n${index}` })),
      ],
    ])('refuses %s whole', async (_what, notes) => {
      const { store } = setup();

      const { error } = await outcome(
        'trackProfile:saveNotes',
        TRACK_KEY,
        notes
      );

      expect(error).toBeInstanceOf(TypeError);
      expect(store.saveNotes).not.toHaveBeenCalled();
      expect(store.whenLoaded).not.toHaveBeenCalled();
    });
  });

  describe('importing a notes file', () => {
    it('passes the text on, with the kind to fall back on', async () => {
      const { store } = setup();
      const text = 'distance,pace note,comment,tags\n180.5,"Brake",,\n';

      const kept = await invoke(
        'trackProfile:importNotes',
        TRACK_KEY,
        'pace',
        text
      );

      expect(store.importNotes).toHaveBeenCalledWith(STORED_KEY, 'pace', text);
      expect(kept).toHaveLength(2);
    });

    it('refuses text longer than a notes file may be', async () => {
      const { store } = setup();

      const { error } = await outcome(
        'trackProfile:importNotes',
        TRACK_KEY,
        'track',
        'x'.repeat(1_024_001)
      );

      expect(error).toBeInstanceOf(TypeError);
      expect(store.importNotes).not.toHaveBeenCalled();
    });

    it('takes a file of exactly the longest length', async () => {
      const { store } = setup();

      await invoke(
        'trackProfile:importNotes',
        TRACK_KEY,
        'track',
        'x'.repeat(1_024_000)
      );

      expect(store.importNotes).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, null, 7, {}, ['distance'], Buffer.from('distance')])(
      'refuses a file that is not text: %s',
      async (fileText) => {
        const { store } = setup();

        const { error } = await outcome(
          'trackProfile:importNotes',
          TRACK_KEY,
          'track',
          fileText
        );

        expect(error).toBeInstanceOf(TypeError);
        expect(store.importNotes).not.toHaveBeenCalled();
      }
    );

    it('refuses a track that is neither stored nor being driven', async () => {
      const { store } = setup();

      expect(
        await invoke(
          'trackProfile:importNotes',
          'iracing:163',
          'track',
          'distance,track note\n'
        )
      ).toBeNull();
      expect(store.importNotes).not.toHaveBeenCalled();
    });
  });

  describe('the kind of note', () => {
    it.each(['trackProfile:importNotes', 'trackProfile:exportNotes'])(
      '%s takes track and pace and nothing else',
      async (channel) => {
        const { store } = setup();

        for (const bad of [
          undefined,
          null,
          'Track',
          'pit',
          '',
          0,
          {},
          'toString',
        ]) {
          const { error } = await outcome(
            channel,
            TRACK_KEY,
            bad,
            'distance\n'
          );
          expect(error).toBeInstanceOf(TypeError);
        }
        expect(store.importNotes).not.toHaveBeenCalled();
        expect(store.exportNotes).not.toHaveBeenCalled();
      }
    );
  });

  describe('the track', () => {
    it.each([
      'trackProfile:getProfile',
      'trackProfile:saveNotes',
      'trackProfile:importNotes',
      'trackProfile:exportNotes',
      'trackProfile:clearElevation',
    ])('%s takes a track key and nothing else', async (channel) => {
      const { store } = setup();

      for (const bad of BAD_KEYS) {
        const { error } = await outcome(channel, bad, [], 'track');
        expect(error, String(bad)).toBeInstanceOf(TypeError);
      }
      for (const method of Object.values(store)) {
        if (method !== store.onChanged) expect(method).not.toHaveBeenCalled();
      }
    });

    it('takes a negative track id, as a hashed name may be', async () => {
      const { store } = setup();

      await invoke('trackProfile:clearElevation', 'lmu:-694510461');

      expect(store.clearElevation).toHaveBeenCalledWith('lmu', -694510461);
    });
  });

  it('forgets the elevation of the track named', async () => {
    const { store } = setup();

    expect(await invoke('trackProfile:clearElevation', TRACK_KEY)).toBe(true);
    expect(store.clearElevation).toHaveBeenCalledWith('lmu', TRACK_ID);
  });

  describe('changes', () => {
    it('are told only to the windows that asked', () => {
      const { emitChanged } = setup();
      const listening = window(1);
      const other = window(2);
      const closed = window(3, true);
      mock.windows.push(listening, other, closed);
      mock.handlers.get('trackProfile:subscribe')?.(
        { sender: sender(1) },
        'changed'
      );
      mock.handlers.get('trackProfile:subscribe')?.(
        { sender: sender(3) },
        'changed'
      );

      emitChanged();

      expect(listening.webContents.send).toHaveBeenCalledExactlyOnceWith(
        'trackProfile:changed'
      );
      expect(other.webContents.send).not.toHaveBeenCalled();
      expect(closed.webContents.send).not.toHaveBeenCalled();
    });

    it('stop being told to a window that no longer asks', () => {
      const { emitChanged } = setup();
      const listening = window(1);
      mock.windows.push(listening);
      mock.handlers.get('trackProfile:subscribe')?.(
        { sender: sender(1) },
        'changed'
      );
      mock.handlers.get('trackProfile:unsubscribe')?.(
        { sender: sender(1) },
        'changed'
      );

      emitChanged();

      expect(listening.webContents.send).not.toHaveBeenCalled();
    });

    it('cannot be subscribed to as anything but changes', () => {
      setup();

      expect(() =>
        mock.handlers.get('trackProfile:subscribe')?.(
          { sender: sender(1) },
          'all'
        )
      ).toThrow();
    });
  });

  it('removes its handlers and stops listening when disposed', () => {
    const { dispose, emitChanged } = setup();
    const listening = window(1);
    mock.windows.push(listening);
    mock.handlers.get('trackProfile:subscribe')?.(
      { sender: sender(1) },
      'changed'
    );

    dispose();
    emitChanged();

    expect(mock.handlers.size).toBe(0);
    expect(listening.webContents.send).not.toHaveBeenCalled();
  });
});
