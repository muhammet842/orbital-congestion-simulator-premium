// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachModalKeyboard } from './modalKeyboard';

function press(key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  document.activeElement?.dispatchEvent(event);
  return event;
}

describe('attachModalKeyboard', () => {
  let opener: HTMLButtonElement;
  let panel: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="opener">Open</button>
      <div id="panel"><button id="a">A</button><input id="b" /><button id="c">C</button></div>
    `;
    // jsdom has no layout: report every element as visible.
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    opener = document.getElementById('opener') as HTMLButtonElement;
    panel = document.getElementById('panel')!;
    opener.focus();
  });

  afterEach(() => vi.restoreAllMocks());

  it('moves focus into the window, and back to the opener when it closes', () => {
    const detach = attachModalKeyboard(panel, () => {});
    expect(document.activeElement?.id).toBe('a');
    detach();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab and Shift+Tab inside the window', () => {
    attachModalKeyboard(panel, () => {}, document.getElementById('c'));
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
    expect(press('Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('c');
  });

  it('closes on Escape without letting the event reach other listeners', () => {
    const onEscape = vi.fn();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    attachModalKeyboard(panel, onEscape);
    press('Escape');
    window.removeEventListener('keydown', outer);
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('stops listening once detached', () => {
    const onEscape = vi.fn();
    const detach = attachModalKeyboard(panel, onEscape);
    detach();
    press('Escape');
    expect(onEscape).not.toHaveBeenCalled();
  });
});
