import type { Decorator } from '@storybook/react-vite';
import { useEffect, useRef } from 'react';
import type {
  ChannelBridge,
  ChannelName,
  ChannelPayloads,
} from '@irdashies/types';

/**
 * Plays a recorded run of snapshots on one channel, at the rate it was made
 * for, and then holds the last one.
 *
 * For a widget that draws history, such as the input trace: a single
 * snapshot gives it one sample, where a run fills the history and leaves the
 * story standing on the moment it is about. The run starts with the first
 * subscriber, so nothing is played to an empty room. Other channels are
 * served a fixed snapshot, as ChannelSnapshotDecorator does.
 */
export const ChannelPlaybackDecorator = <K extends ChannelName>(
  channel: K,
  frames: readonly ChannelPayloads[K][],
  snapshots: Partial<ChannelPayloads> = {},
  rateHz = 60
): Decorator => {
  const DecoratorComponent: Decorator = (Story) => {
    const previousBridge = useRef(window.channelBridge);
    // One run per mounted story, kept across its re-renders.
    const playback = useRef<ChannelBridge | null>(null);
    const stop = useRef<() => void>(() => undefined);
    if (playback.current === null) {
      const listeners = new Set<(payload: ChannelPayloads[K]) => void>();
      let index = 0;
      let timer: ReturnType<typeof setInterval> | undefined;
      const halt = () => {
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
      };
      const advance = () => {
        if (index >= frames.length - 1) return halt();
        index += 1;
        for (const listener of listeners) listener(frames[index]);
      };
      stop.current = halt;
      playback.current = {
        subscribe: <C extends ChannelName>(
          subscribed: C,
          callback: (payload: ChannelPayloads[C]) => void
        ) => {
          if ((subscribed as ChannelName) !== channel) {
            const snapshot = snapshots[subscribed];
            if (snapshot !== undefined) {
              callback(snapshot as ChannelPayloads[C]);
            }
            return () => undefined;
          }
          const listener = callback as unknown as (
            payload: ChannelPayloads[K]
          ) => void;
          listeners.add(listener);
          if (frames.length > 0) listener(frames[index]);
          if (timer === undefined && index < frames.length - 1) {
            timer = setInterval(advance, 1000 / rateHz);
          }
          return () => {
            listeners.delete(listener);
            if (listeners.size === 0) halt();
          };
        },
      };
    }
    window.channelBridge = playback.current;
    useEffect(
      () => () => {
        stop.current();
        if (previousBridge.current === undefined) {
          Reflect.deleteProperty(window, 'channelBridge');
        } else {
          window.channelBridge = previousBridge.current;
        }
      },
      []
    );
    return <Story />;
  };
  return DecoratorComponent;
};
