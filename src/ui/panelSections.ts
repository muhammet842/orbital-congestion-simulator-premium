/**
 * Collapsible sections for a flat panel: every `h2.panel-heading[data-i18n]`
 * becomes a toggle for the elements after it (up to the next heading). The
 * section's short explanation (`.panel-lede`, `[data-section-info]`) is folded
 * behind an ⓘ button in the heading, so the panel shows controls first.
 *
 * Hiding uses classes, not `hidden`, because the panels set `hidden` on some
 * of these elements themselves. Open/closed choices persist in localStorage.
 */
import { t } from '../i18n/i18n';
import { icon } from './icons';

const LS_SECTIONS_KEY = 'orbital-sections';

type SectionState = Record<string, boolean>;

function readState(): SectionState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LS_SECTIONS_KEY) ?? 'null');
    return parsed && typeof parsed === 'object' ? (parsed as SectionState) : {};
  } catch {
    return {};
  }
}

function saveState(state: SectionState): void {
  try {
    localStorage.setItem(LS_SECTIONS_KEY, JSON.stringify(state));
  } catch {
    // Private mode / storage full: the choice just isn't remembered.
  }
}

/** Elements that belong to the section started by `heading`. */
function sectionBody(heading: HTMLElement): HTMLElement[] {
  const body: HTMLElement[] = [];
  for (let el = heading.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.matches('.panel-heading') || el.querySelector('.panel-heading')) break;
    body.push(el as HTMLElement);
  }
  return body;
}

/**
 * @param collapsedByDefault heading keys (their data-i18n) that start closed
 *   until the visitor opens them.
 */
export function initPanelSections(root: HTMLElement, collapsedByDefault: readonly string[] = []): void {
  const state = readState();

  root.querySelectorAll<HTMLElement>('h2.panel-heading[data-i18n]').forEach((heading) => {
    const key = heading.dataset.i18n!;
    const body = sectionBody(heading);
    const info = body.filter((el) => el.matches('.panel-lede, [data-section-info]'));

    // The label keeps the translation hook; the heading itself holds buttons.
    heading.removeAttribute('data-i18n');
    heading.classList.add('panel-heading--section');
    heading.innerHTML = `
      <button type="button" class="section-toggle" aria-expanded="true">
        ${icon('chevronDown', 14)}
        <span class="section-toggle-label" data-i18n="${key}">${t(key)}</span>
      </button>
      ${
        info.length
          ? `<button type="button" class="section-info-btn" aria-expanded="false" aria-label="${t('ui.section_info')}" title="${t('ui.section_info')}" data-i18n-aria="ui.section_info" data-i18n-title="ui.section_info">${icon('info', 15)}</button>`
          : ''
      }
    `;

    const toggle = heading.querySelector<HTMLButtonElement>('.section-toggle')!;
    const setCollapsed = (collapsed: boolean): void => {
      toggle.setAttribute('aria-expanded', String(!collapsed));
      heading.classList.toggle('is-collapsed', collapsed);
      for (const el of body) el.classList.toggle('section-collapsed', collapsed);
    };
    setCollapsed(state[key] ?? collapsedByDefault.includes(key));
    toggle.addEventListener('click', () => {
      const collapsed = toggle.getAttribute('aria-expanded') === 'true';
      setCollapsed(collapsed);
      state[key] = collapsed;
      saveState(state);
    });

    const infoBtn = heading.querySelector<HTMLButtonElement>('.section-info-btn');
    if (!infoBtn) return;
    for (const el of info) el.classList.add('section-info');
    infoBtn.addEventListener('click', () => {
      const open = infoBtn.getAttribute('aria-expanded') !== 'true';
      infoBtn.setAttribute('aria-expanded', String(open));
      for (const el of info) el.classList.toggle('section-info--open', open);
      // Opening the explanation of a closed section opens the section too.
      if (open && heading.classList.contains('is-collapsed')) toggle.click();
    });
  });
}
