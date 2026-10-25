/**
 * Keyboard behaviour shared by the pop-up windows (Radio, Future Projection,
 * Spotter):
 * - focus moves into the window when it opens;
 * - Tab and Shift+Tab stay inside it instead of wandering into the page behind;
 * - Escape closes only this window (not also the phone side panel underneath);
 * - focus returns to the control that opened it when it closes.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[hidden]') && el.getClientRects().length > 0,
  );
}

/**
 * Starts the behaviour for `panel`; call the returned function when the
 * window closes. `initialFocus` picks the first control to focus (default:
 * the first focusable one).
 */
export function attachModalKeyboard(
  panel: HTMLElement,
  onEscape: () => void,
  initialFocus?: HTMLElement | null,
): () => void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      // Handled here: the side-panel listener on window must not also act on it.
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusableIn(panel);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!panel.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  document.addEventListener('keydown', onKeydown);
  (initialFocus ?? focusableIn(panel)[0] ?? panel).focus();

  return () => {
    document.removeEventListener('keydown', onKeydown);
    if (opener?.isConnected) opener.focus();
  };
}
