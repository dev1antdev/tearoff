import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingNumberListRow } from './SettingNumberListRow';

const show = (values: number[], maxItems = 6) => {
  const onChange = vi.fn();
  render(
    <SettingNumberListRow
      title="Stop Lengths"
      description="Time lost in the pits, one column each."
      values={values}
      min={0}
      max={300}
      units="s"
      maxItems={maxItems}
      nextValue={(current) => (current.at(-1) ?? 20) + 10}
      onChange={onChange}
    />
  );
  return onChange;
};

const fields = () =>
  screen
    .getAllByRole('spinbutton')
    .map((field) => (field as HTMLInputElement).value);

describe('SettingNumberListRow', () => {
  it('shows a field for each value, in order', () => {
    show([30, 40, 50]);
    expect(fields()).toEqual(['30', '40', '50']);
    expect(screen.getByLabelText('Stop Lengths 2')).toBeTruthy();
  });

  it('changes one value and leaves the others', () => {
    const onChange = show([30, 40, 50]);
    fireEvent.change(screen.getByLabelText('Stop Lengths 2'), {
      target: { value: '45' },
    });
    expect(onChange).toHaveBeenCalledWith([30, 45, 50]);
  });

  it('keeps a value inside its limits, and ignores what is not a number', () => {
    const onChange = show([30]);
    const field = screen.getByLabelText('Stop Lengths 1');
    fireEvent.change(field, { target: { value: '900' } });
    expect(onChange).toHaveBeenLastCalledWith([300]);
    fireEvent.change(field, { target: { value: '-5' } });
    expect(onChange).toHaveBeenLastCalledWith([0]);
    fireEvent.change(field, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('takes a value out', () => {
    const onChange = show([30, 40, 50]);
    fireEvent.click(screen.getByLabelText('Remove 40 s'));
    expect(onChange).toHaveBeenCalledWith([30, 50]);
  });

  it('adds the next value while there is room, and no more', () => {
    const onChange = show([30, 40], 3);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith([30, 40, 50]);
  });

  it('offers nothing to add once the list is full', () => {
    show([30, 40, 50], 3);
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('starts an empty list from what it is told', () => {
    const onChange = show([]);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith([30]);
  });
});
