import { useCallback, useEffect, useRef, useState } from 'react';
import { useRaceLogSnapshot } from '@irdashies/context';
import { mergeRaceLog, prependRaceLog } from '@irdashies/domain/raceLog';
import type { RaceEvent, RaceLogSnapshot } from '@irdashies/types';
import logger from '@irdashies/utils/logger';

interface Held {
  /** The snapshot the events were last brought up to. */
  source: RaceLogSnapshot | undefined;
  /** The race they are of. */
  token: string;
  /** Oldest first. */
  events: readonly RaceEvent[];
}

const NO_EVENTS: readonly RaceEvent[] = [];
const NOTHING: Held = { source: undefined, token: '', events: NO_EVENTS };

export interface RaceLogEvents {
  /** Names the race; '' while none is being recorded. */
  raceToken: string;
  /** The events held, oldest first: the channel's, and any read before them. */
  events: readonly RaceEvent[];
  /** The log holds events from before the oldest one here, and can be asked. */
  hasEarlier: boolean;
  /** An earlier page is on its way. */
  loading: boolean;
  /** Asks for the page before the oldest event held. */
  loadEarlier: () => void;
}

/**
 * The race's log as a list to draw.
 *
 * The channel carries the most recent events. What has moved out of it
 * since the widget came on screen is kept, so that a reader who has
 * scrolled down does not lose their place, and a page from before that is
 * asked of the race history's bridge when the reader wants one: never on a
 * timer. Another race (`raceToken`) drops everything first. Outside
 * Electron there is no bridge, and the list is the channel's alone.
 */
export const useRaceLogEvents = (): RaceLogEvents => {
  const snapshot = useRaceLogSnapshot();
  const [held, setHeld] = useState<Held>(NOTHING);
  // The token of a race whose log has been read back to its first event.
  const [readBackTo, setReadBackTo] = useState('');
  const [loading, setLoading] = useState(false);

  // Derived from the snapshot as it arrives, which React allows during
  // render when it is guarded like this: no frame is drawn from a list that
  // is one snapshot behind.
  if (snapshot !== held.source) {
    const token = snapshot?.raceToken ?? '';
    setHeld({
      source: snapshot,
      token,
      events: !snapshot
        ? NO_EVENTS
        : token === held.token
          ? mergeRaceLog(held.events, snapshot.events)
          : snapshot.events,
    });
  }

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const token = held.token;
  const first = held.events[0]?.seq;
  const total = snapshot?.total ?? 0;
  const canAsk =
    typeof window !== 'undefined' && !!window.raceHistoryBridge?.getEvents;
  const hasEarlier =
    canAsk &&
    token !== '' &&
    readBackTo !== token &&
    first !== undefined &&
    first > 1 &&
    total > held.events.length;

  const loadEarlier = useCallback(() => {
    const bridge = window.raceHistoryBridge;
    if (!bridge?.getEvents || first === undefined || loading) return;
    setLoading(true);
    bridge
      .getEvents(undefined, first)
      .then((page) => {
        if (!mounted.current) return;
        // Nothing before it after all: not asked again for this race.
        if (page.length === 0) setReadBackTo(token);
        setHeld((now) =>
          now.token === token
            ? { ...now, events: prependRaceLog(page, now.events) }
            : now
        );
      })
      .catch((error: unknown) => {
        logger.warn('Race log: could not read earlier events', error);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
  }, [first, token, loading]);

  return {
    raceToken: token,
    events: held.events,
    hasEarlier,
    loading,
    loadEarlier,
  };
};
