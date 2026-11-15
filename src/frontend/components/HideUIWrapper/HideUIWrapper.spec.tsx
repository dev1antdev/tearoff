import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { useOverlayHidden } from '@irdashies/context';
import { HideUIWrapper } from './HideUIWrapper';

/** Stands in for a widget: mounting it is subscribing to its channels. */
const Widget = ({
  onMount,
  onUnmount,
}: {
  onMount: () => void;
  onUnmount: () => void;
}) => {
  useEffect(() => {
    onMount();
    return onUnmount;
  }, [onMount, onUnmount]);
  return <div data-testid="widget">widget</div>;
};

describe('HideUIWrapper', () => {
  let toggle: ((hide: boolean) => void) | undefined;
  const unsubscribe = vi.fn();

  const install = () => {
    window.globalKey = {
      onToggle: (callback) => {
        toggle = callback;
        return unsubscribe;
      },
      onWidgetToggle: () => () => undefined,
    };
  };

  afterEach(() => {
    delete window.globalKey;
    toggle = undefined;
    unsubscribe.mockClear();
  });

  it('shows its children until told to hide them', () => {
    install();
    render(
      <HideUIWrapper>
        <div data-testid="widget">widget</div>
      </HideUIWrapper>
    );
    expect(screen.getByTestId('widget').parentElement?.className).toBe('');
  });

  it('hides the overlay without unmounting what is in it', () => {
    // Unmounting is unsubscribing, and a processor with no subscriber is
    // destroyed: a pause used to cost the lap delta, the sector bests and
    // the fuel history.
    install();
    const onMount = vi.fn();
    const onUnmount = vi.fn();
    render(
      <HideUIWrapper>
        <Widget onMount={onMount} onUnmount={onUnmount} />
      </HideUIWrapper>
    );

    act(() => toggle?.(true));
    const hidden = screen.getByTestId('widget');
    expect(hidden.parentElement?.className).toBe('invisible');
    expect(onUnmount).not.toHaveBeenCalled();

    act(() => toggle?.(false));
    // The same element, not a new one: nothing was built again.
    expect(screen.getByTestId('widget')).toBe(hidden);
    expect(hidden.parentElement?.className).toBe('');
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onUnmount).not.toHaveBeenCalled();
  });

  it('tells what is inside it that the overlay is hidden', () => {
    // For what does not stop by being unpainted: a sound, or an element
    // that sets its own visibility over the wrapper's.
    install();
    const Listener = () => (
      <div data-testid="listener">
        {useOverlayHidden() ? 'hidden' : 'shown'}
      </div>
    );
    render(
      <HideUIWrapper>
        <Listener />
      </HideUIWrapper>
    );
    expect(screen.getByTestId('listener').textContent).toBe('shown');

    act(() => toggle?.(true));
    expect(screen.getByTestId('listener').textContent).toBe('hidden');

    act(() => toggle?.(false));
    expect(screen.getByTestId('listener').textContent).toBe('shown');
  });

  it('stops listening when it goes away', () => {
    install();
    const { unmount } = render(
      <HideUIWrapper>
        <div />
      </HideUIWrapper>
    );
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('shows its children where there is nothing to listen to', () => {
    render(
      <HideUIWrapper>
        <div data-testid="widget">widget</div>
      </HideUIWrapper>
    );
    expect(screen.getByTestId('widget')).toBeTruthy();
  });
});
