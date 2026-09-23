/**
 * Application bootstrap.
 *
 * Load order matters:
 *   1. Fetch `public/data/tle.json` and build TrackedObject[] + stats
 *   2. initState → create Layout + left/right/time panels
 *   3. SceneManager (meshes + rAF) — must exist before deep links frame a sat
 *   4. Deep link, Kessler panel, how-to tour
 *
 * There is no backend for orbital data; the catalog is the committed JSON
 * refreshed by `npm run fetch-tle` / GitHub Actions. See `.cursor/rules/project-map.mdc`.
 */
import './style.css';
import { loadTleDataset, createTrackedObjects, computeStats } from './data/tleLoader';
import { getState, initState } from './state/appState';
import { SceneManager } from './scene/SceneManager';
import { createLayout } from './ui/Layout';
import { initLeftPanel } from './ui/LeftPanel';
import { initRightPanel } from './ui/RightPanel';
import { initTimeControls } from './ui/TimeControls';
import { initDeepLink } from './routing/deepLink';
import { initKesslerPanel } from './ui/KesslerPanel';
import { initHowToGuide } from './ui/HowToGuide';
import { findConjunctions } from './orbital/conjunction';
import { applyTranslations, t } from './i18n/i18n';

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;

  showLoading(app);

  try {
    showLoading(app, t('boot.loading'));

    const dataset = await loadTleDataset();

    if (dataset.objects.length === 0) {
      showError(app, t('boot.no_objects'));
      return;
    }

    const objects = createTrackedObjects(dataset);
    const stats = computeStats(objects, dataset.fetchedAt);
    initState(objects, stats);

    app.innerHTML = '';
    const { leftPanel, rightPanel, sceneContainer, timeBar } = createLayout(app);
    initLeftPanel(leftPanel);
    initRightPanel(rightPanel);
    initTimeControls(timeBar);

    // Static [data-i18n] headings are hardcoded in English in their markup
    // (as a no-JS-yet placeholder) and only otherwise get translated on a
    // *later* language switch — without this, a first-time visitor whose
    // browser/stored language resolves to non-English would see an
    // untranslated shell until they touched the language dropdown.
    applyTranslations(document);

    const sceneManager = new SceneManager(sceneContainer);
    await sceneManager.initOrbitalMeshes(objects);
    sceneManager.start();

    // Deep linking: sync ?object=NORAD / ?event=ID ↔ app state.
    // Must run after the scene is ready so a linked satellite gets framed
    // correctly on first load.
    initDeepLink(objects);

    // Future Projection: header button opening the Kessler-syndrome "what if" panel.
    initKesslerPanel();

    // First-visit walkthrough + header "?" reopen control.
    initHowToGuide();

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__debugConjunctions = (isoTime?: string) =>
        findConjunctions(getState().objects, isoTime ? new Date(isoTime) : new Date());
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : t('boot.load_failed');
    showError(app, message);
    console.error(err);
  }
}

function showLoading(app: HTMLElement, message = t('boot.loading')): void {
  app.innerHTML = `
    <div class="loading-screen">
      <div class="loading-spinner" aria-hidden="true"></div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function showError(app: HTMLElement, message: string): void {
  app.innerHTML = `
    <div class="error-screen">
      <h1>${escapeHtml(t('boot.error_title'))}</h1>
      <p class="muted">${escapeHtml(message)}</p>
      <p class="muted">${escapeHtml(t('boot.error_hint'))}</p>
    </div>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

main();
