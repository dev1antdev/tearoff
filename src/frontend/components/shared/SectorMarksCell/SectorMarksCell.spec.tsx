import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectorMarksCell } from './SectorMarksCell';

const cell = (element: React.ReactElement) =>
  render(
    <table>
      <tbody>
        <tr>{element}</tr>
      </tbody>
    </table>
  ).container.querySelector('[data-column="sectors"]') as HTMLElement;

const marks = (td: HTMLElement) =>
  Array.from(td.querySelectorAll<HTMLElement>('[data-sector]'));

describe('SectorMarksCell', () => {
  it('draws one square a sector, in driving order', () => {
    const td = cell(
      <SectorMarksCell s1="classBest" s2="ownBest" s3="slower" />
    );

    expect(marks(td).map((mark) => mark.dataset.sector)).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(marks(td).map((mark) => mark.dataset.tone)).toEqual([
      'classBest',
      'ownBest',
      'slower',
    ]);
  });

  it('colours them purple, green, amber and grey', () => {
    const first = marks(
      cell(<SectorMarksCell s1="classBest" s2="ownBest" s3="slower" />)
    );
    expect(first[0].className).toContain('bg-purple-400');
    expect(first[1].className).toContain('bg-green-400');
    expect(first[2].className).toContain('bg-amber-400');

    const none = marks(cell(<SectorMarksCell s1="none" s2="none" s3="none" />));
    none.forEach((mark) => expect(mark.className).toContain('bg-slate-600'));
  });

  it('says in words what the colours say', () => {
    const td = cell(<SectorMarksCell s1="classBest" s2="slower" s3="none" />);

    expect(td.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'S1 best of the class, S2 slower than own best, S3 no time yet'
    );
  });

  it('has no text of its own', () => {
    expect(
      cell(<SectorMarksCell s1="ownBest" s2="ownBest" s3="ownBest" />)
        .textContent
    ).toBe('');
  });
});
