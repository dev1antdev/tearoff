import { describe, expect, it, vi } from 'vitest';
import type { PitStopRecord } from '@irdashies/types';
import { createPitStopArchive } from './pitStopArchive';
import type { PitStopHistoryStore } from './storage/pitStopHistory';

const stop = { id: 1, carIdx: 4, exitTime: 150 } as unknown as PitStopRecord;
const key = { subSessionId: 4242, sessionNum: 0 };

const fakeStore = (kept: PitStopRecord[] | null = [stop]) => ({
  load: vi.fn<PitStopHistoryStore['load']>(() => Promise.resolve()),
  get: vi.fn<PitStopHistoryStore['get']>(() => kept),
  save: vi.fn<PitStopHistoryStore['save']>(),
  flush: vi.fn<PitStopHistoryStore['flush']>(() => Promise.resolve()),
});

describe('the pit stops’ store on disk', () => {
  it('reads and writes under a session id that names one event', async () => {
    const store = fakeStore();
    const archive = createPitStopArchive({
      canArchive: () => true,
      store: () => store,
    });

    expect(await archive.load(key)).toEqual([stop]);
    archive.save(key, [stop]);

    expect(store.load).toHaveBeenCalledOnce();
    expect(store.get).toHaveBeenCalledWith(key);
    expect(store.save).toHaveBeenCalledWith(key, [stop]);
  });

  it('is left alone under a session id the next race will have too', async () => {
    // Le Mans Ultimate: the same track on the same server is the same id.
    // What was kept under it is another race's stops.
    const store = fakeStore();
    const makeStore = vi.fn(() => store);
    const archive = createPitStopArchive({
      canArchive: () => false,
      store: makeStore,
    });

    expect(await archive.load(key)).toBeNull();
    archive.save(key, [stop]);

    // Not so much as opened.
    expect(makeStore).not.toHaveBeenCalled();
    expect(store.load).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('asks again on every call: the simulator can change while the app runs', async () => {
    let unique = false;
    const store = fakeStore();
    const archive = createPitStopArchive({
      canArchive: () => unique,
      store: () => store,
    });

    expect(await archive.load(key)).toBeNull();
    unique = true;
    expect(await archive.load(key)).toEqual([stop]);
    archive.save(key, [stop]);
    unique = false;
    archive.save(key, [stop]);

    expect(store.save).toHaveBeenCalledOnce();
  });
});
