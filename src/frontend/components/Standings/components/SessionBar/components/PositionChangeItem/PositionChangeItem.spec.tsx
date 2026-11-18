import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionBarConfig } from '@irdashies/types';
import { PositionChangeItem } from './PositionChangeItem';

const scene = vi.hoisted(() => ({
  change: undefined as number | undefined,
  scope: undefined as string | undefined,
}));

vi.mock('@irdashies/domain', () => ({
  useGridPlaceChange: (scope: string) => {
    scene.scope = scope;
    return scene.change;
  },
}));

const item = (settings?: Partial<SessionBarConfig>) =>
  render(
    <PositionChangeItem
      settings={settings as SessionBarConfig | undefined}
      standalone={false}
    />
  ).container;

const caret = (container: HTMLElement) =>
  container.querySelector('[data-item="positionChange"] > span');

describe('PositionChangeItem', () => {
  beforeEach(() => {
    scene.change = undefined;
    scene.scope = undefined;
  });

  it('draws places gained in green with the count', () => {
    // Started seventh in class, now second.
    scene.change = 5;
    const container = item();

    expect(container.textContent).toBe('5');
    expect(caret(container)?.className).toContain('text-green-400');
  });

  it('draws places lost in red with the count', () => {
    // Started second, now fourth.
    scene.change = -2;
    const container = item();

    expect(container.textContent).toBe('2');
    expect(caret(container)?.className).toContain('text-red-400');
  });

  it('draws a dash when level', () => {
    scene.change = 0;
    const container = item();

    expect(container.textContent).toBe('');
    expect(container.querySelector('svg')).not.toBeNull();
    expect(caret(container)?.className).toContain('text-slate-400');
  });

  it('is not rendered outside a race or without a grid result', () => {
    // The hook answers undefined for both.
    scene.change = undefined;

    expect(item()).toBeEmptyDOMElement();
  });

  it('measures in class unless the setting says overall', () => {
    scene.change = 1;
    item();
    expect(scene.scope).toBe('class');

    item({ positionChange: { enabled: true, scope: 'overall' } });
    expect(scene.scope).toBe('overall');
  });
});
