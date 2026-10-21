/**
 * One small outline icon set for the whole interface: 24×24 grid, 1.75 px
 * stroke, round caps, drawn in `currentColor` so icons follow the text colour
 * (muted by default, accent on hover/active). Use these instead of emoji so
 * every control looks like part of the same product.
 */
const paths = {
  /** Left panel: filters & lists. */
  panelLeft: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/>',
  /** Right panel: details. */
  panelRight: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/>',
  /** Radio: antenna with waves. */
  radio: '<path d="M12 12v8"/><circle cx="12" cy="10" r="1.6"/><path d="M8.5 6.5a5 5 0 0 0 0 7"/><path d="M15.5 6.5a5 5 0 0 1 0 7"/><path d="M5.6 3.8a9 9 0 0 0 0 12.4"/><path d="M18.4 3.8a9 9 0 0 1 0 12.4"/>',
  /** Future projection: rising trend. */
  projection: '<path d="M3.5 19.5h17"/><path d="M5 15.5l4.5-4.5 3.5 3 6-6.5"/><path d="M15 7.5h4v4"/>',
  /** More menu. */
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  /** Guided tour / help. */
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7"/><path d="M12 16.8v.2"/>',
  /** Language. */
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z"/>',
  /** External link. */
  external: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5L11 13"/><path d="M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10"/>',
  /** Section disclosure. */
  chevronDown: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
  /** "More about this" next to a heading. */
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8v.2"/>',
  /** Close a dialog. */
  close: '<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>',
  /** Warning (only for the closest passes). */
  alert: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4"/><path d="M12 16.8v.2"/>',
} as const;

export type IconName = keyof typeof paths;

/** Inline SVG markup for an icon; decorative (aria-hidden) unless labelled by its control. */
export function icon(name: IconName, size = 18): string {
  return `<svg class="icon icon--${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

/** The GitHub mark (a brand logo, filled rather than outlined). */
export function githubMark(size = 16): string {
  return `<svg class="icon icon--github" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.68 7.68 0 0 1 8 4.77c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`;
}
