import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboard, useSessionStore } from '@irdashies/context';
import type {
  ChannelBridge,
  ChannelName,
  ChannelPayloads,
  OurCarConfig,
} from '@irdashies/types';
import {
  strategyStage,
  type StrategyStage,
} from '../../../../.storybook/strategyStage';
import { OurCar } from './OurCar';

vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useDashboard: vi.fn(),
}));

/**
 * Our Car's wording over a stub channel bridge, on the STAGED eight-hour
 * race the stories are told with: twenty-two cars in three classes, ours
 * fourth of fourteen LMGT3s on lap 141, with 52 % of its energy at 3.1 % a
 * lap. The channels carry what the real forecast processor makes of the
 * staged cars; nothing here was recorded, because no recording has a stop.
 */

const ALL_SESSIONS = {
  race: true,
  loneQualify: true,
  openQualify: true,
  practice: true,
  offlineTesting: true,
};

/** A bridge that answers each subscription once, with the staged snapshot. */
const stubBridge = (snapshots: Partial<ChannelPayloads>): ChannelBridge => ({
  subscribe: <K extends ChannelName>(
    channel: K,
    callback: (payload: ChannelPayloads[K]) => void
  ) => {
    const snapshot = snapshots[channel];
    if (snapshot !== undefined) callback(snapshot as ChannelPayloads[K]);
    return () => undefined;
  },
});

const show = (
  stage: StrategyStage = {},
  config: Partial<OurCarConfig> = {},
  snapshots: Partial<ChannelPayloads> = {}
) => {
  const staged = strategyStage(stage);
  window.channelBridge = stubBridge({ ...staged.snapshots, ...snapshots });
  useSessionStore.setState({ session: staged.session });
  vi.mocked(useDashboard).mockReturnValue({
    currentDashboard: { widgets: [{ id: 'ourcar', config }] },
  } as unknown as ReturnType<typeof useDashboard>);
  return render(<OurCar />);
};

const tile = (id: string) => ({
  value: screen.getByTestId(`our-car-${id}-value`).textContent,
  note: screen.getByTestId(`our-car-${id}-note`).textContent,
  element: screen.getByTestId(`our-car-${id}`),
});

describe('OurCar (staged)', () => {
  beforeEach(() => {
    vi.mocked(useDashboard).mockReset();
  });

  describe('at the wheel', () => {
    it('states what is aboard, how long it lasts and what ends the stint', () => {
      show();
      expect(screen.getByTestId('our-car')).toHaveAttribute(
        'data-valid',
        'true'
      );
      const budget = screen.getByTestId('our-car-budget');
      expect(within(budget).getByText('Virtual energy')).toBeInTheDocument();
      expect(screen.getByTestId('our-car-budget-value')).toHaveTextContent(
        '52 %'
      );
      expect(screen.getByTestId('our-car-stint')).toHaveTextContent(
        '16 laps · 31 min left in the stint'
      );
      expect(screen.getByTestId('our-car-stint-end')).toHaveTextContent(
        'energy runs out first · 3.1 % a lap'
      );
    });

    it('states the pit window, the stops owed and what the next costs', () => {
      show();
      expect(tile('window')).toMatchObject({
        value: 'laps 154–157',
        note: 'now lap 141',
      });
      expect(tile('stops')).toMatchObject({
        value: '3 more',
        note: 'next costs 58 s',
      });
    });

    it('forecasts the finishing place, and says how it stood ten laps ago', () => {
      show();
      const forecast = tile('forecast');
      // Fourth now: a rival ahead owes a stop more.
      expect(forecast).toMatchObject({
        value: 'P3 in class',
        note: 'was P4 10 laps ago',
      });
      expect(forecast.element).toHaveAttribute('data-tone', 'good');
      expect(forecast.element).toHaveAttribute('data-uncertain', 'false');
    });

    it('says where the planned stop puts the car', () => {
      show();
      expect(tile('rejoin')).toMatchObject({
        value: 'P7, behind #31',
        note: '2.8 s clear of #60',
      });
    });

    it('writes the tyres and the damage in a line each', () => {
      show();
      const tyres = screen.getByTestId('our-car-tyres');
      expect(tyres).toHaveTextContent('84 · 85 · 88 · 89 %');
      expect(tyres).toHaveTextContent('good for 61 laps more');
      const damage = screen.getByTestId('our-car-damage');
      expect(damage).toHaveTextContent('None');
      expect(damage).toHaveTextContent('no repair time');
    });

    it('keeps the gaps and the pace for a team-mate’s stint, and has nothing to say is missing', () => {
      show();
      expect(screen.queryByTestId('our-car-pace')).toBeNull();
      expect(screen.queryByTestId('our-car-not-sent')).toBeNull();
    });

    it('names the damage and the repair of the next stop', () => {
      show({ damaged: true });
      const damage = screen.getByTestId('our-car-damage');
      expect(damage).toHaveTextContent('Aero 93 %, body 88 %');
      expect(damage).toHaveTextContent('repairs 34s at the stop');
    });
  });

  describe('a forecast that rests on less than a reading', () => {
    it('is marked with a ~ and drawn quieter', () => {
      // The stops of the cars around us are assumed, not read or seen.
      show({ rivals: 'assumed' });
      const forecast = tile('forecast');
      expect(forecast.value).toBe('~P4 in class');
      expect(forecast.element).toHaveAttribute('data-uncertain', 'true');
      expect(screen.getByTestId('our-car-forecast-value')).toHaveClass(
        'opacity-70'
      );
    });

    it('marks a rejoin that hangs on a car within the margin', () => {
      // Under iRacing the stop is learned, and the margin is wider for it.
      show({ iracing: true });
      expect(tile('rejoin')).toMatchObject({
        value: '~P7, behind #31',
        note: '2.8 s clear of #60',
      });
    });
  });

  describe('while a team-mate drives', () => {
    it('leads with the gaps to the class cars either side and how fast each closes', () => {
      show({ teamMate: 'Andrei Petrov' });
      const ahead = tile('ahead');
      expect(within(ahead.element).getByText('Car ahead, #91')).toBeTruthy();
      expect(ahead).toMatchObject({
        value: '-12.4 s',
        note: 'closing 0.3 s a lap',
      });
      const behind = tile('behind');
      expect(within(behind.element).getByText('Car behind, #54')).toBeTruthy();
      expect(behind).toMatchObject({
        value: '+7.5 s',
        note: 'pulling away 0.1 s a lap',
      });
    });

    it('shows the last lap and the mean of five, against the stint before', () => {
      show({ teamMate: 'Andrei Petrov' });
      expect(tile('last-lap')).toMatchObject({
        value: '1:54.732',
        note: 'best 1:53.872',
      });
      expect(tile('avg5')).toMatchObject({
        value: '1:54.402',
        note: '+0.29 vs M. Ivanov’s stint',
      });
    });

    it('goes on showing the energy, which the sim goes on sending', () => {
      show({ teamMate: 'Andrei Petrov' });
      expect(screen.getByTestId('our-car-budget-value')).toHaveTextContent(
        '52 %'
      );
      expect(screen.getByTestId('our-car-stint')).toHaveTextContent(
        '16 laps · 31 min left in the stint'
      );
      expect(tile('stops').value).toBe('3 more');
      expect(tile('forecast').value).toBe('P3 in class');
    });

    it('reads -- for the tyres and the damage, and says once what is not sent', () => {
      show({ teamMate: 'Andrei Petrov' });
      expect(screen.getByTestId('our-car-tyres')).toHaveTextContent('Tyres--');
      expect(screen.getByTestId('our-car-damage')).toHaveTextContent(
        'Damage--'
      );
      expect(screen.getAllByTestId('our-car-not-sent')).toHaveLength(1);
      expect(screen.getByTestId('our-car-not-sent')).toHaveTextContent(
        'The game does not send the car’s fuel in litres, its tyre wear or its damage while a team-mate drives. They return when you take the wheel.'
      );
    });

    it('reads -- for everything that hangs on a budget the sim does not send', () => {
      // A car on fuel: nothing of its tank is sent for another driver.
      show({ teamMate: 'Andrei Petrov', fuelCar: true });
      expect(screen.getByTestId('our-car-budget-value')).toHaveTextContent(
        '--'
      );
      expect(screen.getByTestId('our-car-stint')).toHaveTextContent(
        '-- laps left in the stint'
      );
      expect(screen.queryByTestId('our-car-stint-end')).toBeNull();
      expect(tile('window').value).toBe('--');
      expect(tile('stops')).toMatchObject({
        value: '--',
        note: 'what is aboard is not read',
      });
      expect(tile('forecast')).toMatchObject({
        value: '--',
        note: 'what is aboard is not read',
      });
      // The gaps and the rejoin are not the tank's to withhold.
      expect(tile('ahead').value).toBe('-12.4 s');
      expect(tile('rejoin').value).toBe('P7, behind #31');
    });
  });

  describe('under iRacing', () => {
    it('counts fuel in litres or gallons, and reads -- for the tread and damage it does not publish', () => {
      const { unmount } = show({ iracing: true });
      const budget = screen.getByTestId('our-car-budget');
      expect(within(budget).getByText('Fuel')).toBeInTheDocument();
      expect(screen.getByTestId('our-car-budget-value')).toHaveTextContent(
        '52.0 L'
      );
      expect(screen.getByTestId('our-car-stint-end')).toHaveTextContent(
        'fuel runs out first · 3.13 L a lap'
      );
      expect(screen.getByTestId('our-car-tyres')).toHaveTextContent('Tyres--');
      expect(screen.getByTestId('our-car-damage')).toHaveTextContent(
        'Damage--'
      );
      expect(screen.queryByTestId('our-car-not-sent')).toBeNull();
      unmount();

      show({ iracing: true }, { fuelUnits: 'gal' });
      expect(screen.getByTestId('our-car-budget-value')).toHaveTextContent(
        '13.7 gal'
      );
    });
  });

  describe('the stint’s end', () => {
    it('is the tyres where they are worn out before the budget', () => {
      const staged = strategyStage();
      const wear = staged.snapshots['wear.snapshot'];
      if (!wear) throw new Error('the stage has no wear');
      show(
        {},
        {},
        {
          'wear.snapshot': {
            ...wear,
            wheels: wear.wheels.map((wheel) => ({
              ...wheel,
              treadLapsLeft: 9,
            })),
          },
        }
      );
      expect(screen.getByTestId('our-car-stint')).toHaveTextContent(
        '9 laps · 17 min left in the stint'
      );
      expect(screen.getByTestId('our-car-stint-end')).toHaveTextContent(
        'tyres run out first'
      );
    });
  });

  describe('when there is nothing to forecast', () => {
    it('says it is waiting for the green flag', () => {
      show({ session: 'grid' });
      expect(screen.getByTestId('our-car')).toHaveAttribute(
        'data-valid',
        'false'
      );
      expect(screen.getByTestId('our-car-reason')).toHaveTextContent(
        'Waiting for the green flag.'
      );
      expect(screen.queryByTestId('our-car-budget')).toBeNull();
    });

    it('says the session is not a race, where it is set to show in one', () => {
      show({ session: 'practice' }, { sessionVisibility: ALL_SESSIONS });
      expect(screen.getByTestId('our-car-reason')).toHaveTextContent(
        'A forecast needs a race: this session is not one.'
      );
    });

    it('says the camera is on another car', () => {
      const staged = strategyStage();
      const forecast = staged.snapshots['race-forecast.snapshot'];
      if (!forecast) throw new Error('the stage has no forecast');
      show(
        {},
        {},
        {
          'race-forecast.snapshot': {
            ...forecast,
            valid: false,
            reason: 'otherCar',
            cars: [],
            place: null,
            stint: null,
            rejoin: null,
          },
        }
      );
      expect(screen.getByTestId('our-car-reason')).toHaveTextContent(
        'The camera is on another car. The forecast is for your own.'
      );
    });

    it('waits for the session before the channel has answered', () => {
      show({}, {}, { 'race-forecast.snapshot': undefined });
      expect(screen.getByTestId('our-car-reason')).toHaveTextContent(
        'Waiting for the session.'
      );
    });
  });

  describe('its settings', () => {
    it('hides in a session it is not set to show in', () => {
      const { container } = show({ session: 'practice' });
      expect(container).toBeEmptyDOMElement();
    });

    it('hides off track when asked to, and stays through a team-mate’s stint', () => {
      const staged = strategyStage();
      const trackState = staged.snapshots['track-state.snapshot'];
      if (!trackState) throw new Error('the stage has no track state');
      const inGarage = show(
        {},
        { showOnlyWhenOnTrack: true },
        { 'track-state.snapshot': { ...trackState, isInGarage: true } }
      );
      expect(inGarage.container).toBeEmptyDOMElement();
      inGarage.unmount();

      show({ teamMate: 'Andrei Petrov' }, { showOnlyWhenOnTrack: true });
      expect(screen.getByTestId('our-car')).toBeInTheDocument();
    });

    it('shows the gaps and the pace always, or never', () => {
      const always = show({}, { showPace: 'always' });
      expect(screen.getByTestId('our-car-pace')).toBeInTheDocument();
      expect(tile('ahead').value).toBe('-12.4 s');
      always.unmount();

      show({ teamMate: 'Andrei Petrov' }, { showPace: 'never' });
      expect(screen.queryByTestId('our-car-pace')).toBeNull();
    });

    it('leaves out each part that is switched off', () => {
      show(
        {},
        {
          showStops: false,
          showForecast: false,
          showRejoin: false,
          showTyres: false,
          showDamage: false,
        }
      );
      for (const id of ['window', 'stops', 'forecast', 'rejoin']) {
        expect(screen.queryByTestId(`our-car-${id}`)).toBeNull();
      }
      expect(screen.queryByTestId('our-car-tyres')).toBeNull();
      expect(screen.queryByTestId('our-car-damage')).toBeNull();
      expect(screen.getByTestId('our-car-budget')).toBeInTheDocument();
    });

    it('takes a config with fields missing, as an older build saved it', () => {
      show({}, { background: undefined } as unknown as Partial<OurCarConfig>);
      expect(screen.getByTestId('our-car').getAttribute('style')).toContain(
        '--bg-opacity: 80%'
      );
    });
  });
});
