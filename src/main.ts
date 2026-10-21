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
import './fonts';
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
import { initRadioPanel } from './ui/RadioPanel';
import { initHowToGuide } from './ui/HowToGuide';
import { findConjunctions, setUpcomingConjunctionWorkerFactory } from './orbital/conjunction';
import { BOOT_ERROR_MESSAGE_KEY, classifyBootError, hasWebGL } from './bootErrors';
import { applyTranslations, t } from './i18n/i18n';
import { escapeHtml } from './ui/escapeHtml';
import { initAnalytics } from './analytics';
import { showMovedNotice } from './movedNotice';

async function main(): Promise<void> {
  initAnalytics();
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;
  // Old address: say where the site went, then open the same page there.
  if (showMovedNotice(app)) return;

  showLoading(app);

  if (!hasWebGL()) {
    showError(app, t(BOOT_ERROR_MESSAGE_KEY.webgl));
    return;
  }

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

    // 24h close-approach sweep runs in its own worker (main-thread idle-slice
    // fallback if workers are unavailable or the worker fails).
    if (typeof Worker !== 'undefined') {
      setUpcomingConjunctionWorkerFactory(
        () =>
          new Worker(new URL('./workers/conjunction.worker.ts', import.meta.url), {
            type: 'module',
          }),
      );
    }

    const sceneManager = new SceneManager(sceneContainer);
    await sceneManager.initOrbitalMeshes(objects);
    sceneManager.start();

    // Deep linking: sync ?object=NORAD / ?event=ID ↔ app state.
    // Must run after the scene is ready so a linked satellite gets framed
    // correctly on first load.
    initDeepLink(objects);

    // Future Projection: header button opening the Kessler-syndrome "what if" panel.
    initKesslerPanel();

    // Radio: band/mode filters for satellites you can actually receive; opens from
    // the header or from a shared ?radio=… link.
    initRadioPanel();

    // First-visit walkthrough + header "?" reopen control.
    initHowToGuide();

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__debugConjunctions = (isoTime?: string) =>
        findConjunctions(getState().objects, isoTime ? new Date(isoTime) : new Date());
    }
  } catch (err) {
    // Developers get the raw error in the console; visitors get a plain explanation.
    console.error(err);
    showError(app, t(BOOT_ERROR_MESSAGE_KEY[classifyBootError(err)]));
  }
}

function showLoading(app: HTMLElement, message = t('boot.loading')): void {
  app.innerHTML = `
    <div class="loading-screen" role="status">
      <span class="loading-mark" aria-hidden="true">
        <span class="loading-mark__core"></span>
        <span class="loading-mark__orbit"><span class="loading-mark__sat"></span></span>
      </span>
      <p class="loading-brand">${escapeHtml(t('brand.full'))}</p>
      <p class="loading-message">${escapeHtml(message)}</p>
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


main();
