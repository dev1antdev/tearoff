import {
  ENDURANCE_SAMPLE_STINTS,
  sampleLedger,
} from '@irdashies/domain/ledger/ledgerSample';

/**
 * What the widget draws in demo mode: an endurance race two stops in, five
 * laps into the fourth stint, in a car that runs on virtual energy.
 */
export const DEMO_STINT_HISTORY = sampleLedger({
  stints: ENDURANCE_SAMPLE_STINTS,
});
