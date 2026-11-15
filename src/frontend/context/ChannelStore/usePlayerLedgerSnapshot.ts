import type { ChannelBridge } from '@irdashies/types';
import { useChannelSnapshot } from './useChannelSnapshot';

/**
 * The player's finished laps and stints, from the always-on ledger: what
 * each lap cost and which stint it belongs to. Sent whole to a window that
 * subscribes late, so a widget shown mid-stint still has all of it.
 */
export const usePlayerLedgerSnapshot = (
  enabled = true,
  bridge?: ChannelBridge
) => useChannelSnapshot('player-ledger.snapshot', undefined, bridge, enabled);
