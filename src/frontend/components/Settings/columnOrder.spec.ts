import { describe, expect, it } from 'vitest';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { columnOrder } from './columnOrder';

const KNOWN = ['position', 'driverName', 'gap', 'avgLast5', 'stintPace'];

describe('columnOrder', () => {
  it('lists the known columns in the order given', () => {
    expect(
      columnOrder(KNOWN, [
        'gap',
        'stintPace',
        'position',
        'avgLast5',
        'driverName',
      ])
    ).toEqual(['gap', 'stintPace', 'position', 'avgLast5', 'driverName']);
  });

  it('puts a column the order does not name after those it does', () => {
    // An order saved before Avg 5 and the stint pace column existed.
    expect(columnOrder(KNOWN, ['gap', 'position', 'driverName'])).toEqual([
      'gap',
      'position',
      'driverName',
      'avgLast5',
      'stintPace',
    ]);
    expect(columnOrder(KNOWN, undefined)).toEqual(KNOWN);
  });

  it('leaves out an id that is no column of the page, and lists none twice', () => {
    expect(
      columnOrder(KNOWN, ['gap', 'lmuBadge', 'gap', 'position', 'gap'])
    ).toEqual(['gap', 'position', 'driverName', 'avgLast5', 'stintPace']);
  });

  it.each(['standings', 'relative'] as const)(
    'has the columns added since in the %s widget’s default order, each once',
    (widget) => {
      const order = getWidgetDefaultConfig(widget).displayOrder;
      for (const added of ['avgLast5', 'avgLast10', 'stintPace']) {
        expect(order.filter((id) => id === added)).toEqual([added]);
      }
      expect(new Set(order).size).toBe(order.length);
    }
  );
});
