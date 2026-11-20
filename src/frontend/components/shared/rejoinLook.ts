import type { RejoinState } from '@irdashies/domain/traffic/pitExitTraffic';

/**
 * How a rejoin or pit-exit warning is drawn on its panel: the state's word
 * is the one bright spot, filled when the driver has to act, and a caution
 * or a danger also rings the panel in its colour, so the warning reads at a
 * glance without the whole widget turning one colour.
 */
export const REJOIN_LOOK: Record<
  RejoinState,
  { pill: string; outline: string }
> = {
  clear: { pill: 'bg-green-500/20 text-green-300', outline: '' },
  caution: {
    pill: 'bg-amber-500 text-slate-950',
    outline: 'outline-2 -outline-offset-2 outline-amber-400',
  },
  danger: {
    pill: 'bg-red-600 text-white',
    outline: 'outline-2 -outline-offset-2 outline-red-500',
  },
};
