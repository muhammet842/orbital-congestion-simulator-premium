/**
 * Writes text only when it changed. Rewriting identical text still replaces
 * the text node and makes the browser redo layout, which adds up in loops
 * that run every animation frame.
 */
export function setTextIfChanged(el: Element | null | undefined, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}
