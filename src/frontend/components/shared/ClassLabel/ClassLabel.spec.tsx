import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LMU_CLASS_COLOURS } from '@irdashies/types';
import { ClassLabel } from './ClassLabel';

const HIGHLIGHT = 960745;

describe('ClassLabel', () => {
  it('prints the class name as it stands, bold on the solid class colour', () => {
    render(
      <ClassLabel
        name="Hypercar"
        color={LMU_CLASS_COLOURS.Hypercar}
        highlightColor={HIGHLIGHT}
        isMultiClass
      />
    );
    const label = screen.getByTestId('class-label');

    expect(label.tagName).toBe('SPAN');
    expect(label.textContent).toBe('Hypercar');
    expect(label.className).toBe(
      'bg-[#ff000a] border-[#ff000a] font-bold whitespace-nowrap border-l-4'
    );
  });

  it('takes an iRacing class colour from the palette', () => {
    render(<ClassLabel name="GTP" color={0xffda59} isMultiClass />);

    expect(screen.getByTestId('class-label').className).toContain(
      'bg-yellow-500 border-yellow-500'
    );
  });

  it('uses the highlight colour in a single-class session', () => {
    render(
      <ClassLabel
        name="LMGT3"
        color={LMU_CLASS_COLOURS.LMGT3}
        highlightColor={HIGHLIGHT}
        isMultiClass={false}
      />
    );
    const label = screen.getByTestId('class-label');

    expect(label.className).not.toContain('#00ff6a');
    expect(label.className).toContain('border-l-4');
  });

  it('adds the padding and text size its caller sets', () => {
    render(
      <ClassLabel
        name="LMP2"
        color={LMU_CLASS_COLOURS.LMP2}
        isMultiClass
        className="px-2 py-1"
      />
    );

    expect(screen.getByTestId('class-label').className).toBe(
      'bg-[#0690ff] border-[#0690ff] font-bold whitespace-nowrap border-l-4 px-2 py-1'
    );
  });

  it('draws a short bar in the class colour before the name when not filled', () => {
    render(
      <ClassLabel
        name="LMP2"
        color={LMU_CLASS_COLOURS.LMP2}
        isMultiClass
        filled={false}
        className="px-2"
      />
    );

    const label = screen.getByTestId('class-label');
    expect(label).toHaveTextContent('LMP2');
    expect(label.className).not.toContain('bg-[#0690ff]');
    expect(label.className).toContain('px-2');
    const bar = label.querySelector('[aria-hidden]');
    expect(bar?.className).toContain('bg-[#0690ff]');
  });
});
