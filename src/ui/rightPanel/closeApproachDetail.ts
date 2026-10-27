/**
 * A selected close approach: verdict, risk label and the live verification values.
 */
import {
  getDistanceAtTime,
  getRelativeVelocityAtTime,
  getVerificationAssessment,
  getColocatedObjectNames,
  formatRelativeVelocityKmS,
  getVerificationRewindMs,
  isCoOrbitingPair,
} from '../../orbital/conjunction';
import type { ConjunctionEvent } from '../../types';
import { formatUtcDateTime, getSimulationTime, getState } from '../../state/appState';
import { t } from '../../i18n/i18n';
import { escapeHtml } from '../escapeHtml';

function verificationRiskClass(status: string): string {
  if (status === 'COLLISION CONFIRMED') return 'conjunction-risk--confirmed';
  if (status === 'COLLISION AVERTED') return 'conjunction-risk--averted';
  if (status === 'CRITICAL RISK') return 'conjunction-risk--critical';
  if (status === 'LOW RISK' || status === 'NO RISK') return 'conjunction-risk--low';
  return 'conjunction-risk--monitor';
}

/** Canonical English risk/status labels from conjunction.ts → i18n keys for display. */
const RISK_LABEL_KEYS: Record<string, string> = {
  'NO RISK': 'risk.no',
  'LOW RISK': 'risk.low',
  MONITORING: 'risk.monitoring',
  'CRITICAL RISK': 'risk.critical',
  PENDING: 'risk.pending',
  APPROACHING: 'risk.approaching',
  'COLLISION CONFIRMED': 'risk.confirmed',
  'COLLISION AVERTED': 'risk.averted',
  UNAVAILABLE: 'risk.unavailable',
};

function translateRiskLabel(label: string): string {
  const key = RISK_LABEL_KEYS[label];
  return key ? t(key, label) : label;
}

/**
 * Rebuilds the localized hint text from the assessment's status/riskLabel
 * rather than translating conjunction.ts's English `hint` string directly —
 * keeps the orbital-math module UI-agnostic (see getVerificationAssessment).
 */
function translateVerificationHint(
  assessment: ReturnType<typeof getVerificationAssessment>,
  cpaDistanceKm: number,
): string {
  if (assessment.riskLabel === 'UNAVAILABLE') return t('conj.hint_unavailable');
  if (assessment.status === 'COLLISION CONFIRMED') {
    return t('conj.hint_confirmed').replace('{km}', cpaDistanceKm.toFixed(3));
  }
  if (assessment.status === 'COLLISION AVERTED') {
    return t('conj.hint_averted').replace('{km}', cpaDistanceKm.toFixed(3));
  }
  if (assessment.status === 'APPROACHING') return t('conj.hint_approaching');
  return t('conj.hint_paused');
}

export function refreshConjunctionVerification(container: HTMLElement, conjunction: ConjunctionEvent): void {
  const detailEl = container.querySelector('#object-detail');
  if (!detailEl) return;

  const state = getState();
  const simTime = getSimulationTime();
  const liveDistance = getDistanceAtTime(
    state.objects,
    conjunction.indexA,
    conjunction.indexB,
    simTime,
  );
  const liveRelativeVelocity = getRelativeVelocityAtTime(
    state.objects,
    conjunction.indexA,
    conjunction.indexB,
    simTime,
  );
  const assessment = getVerificationAssessment(
    liveDistance,
    simTime.getTime(),
    conjunction.time.getTime(),
    conjunction.distanceKm,
    state.verificationTime?.playing ?? false,
  );

  const simTimeEl = detailEl.querySelector('[data-field="sim-time"]');
  const liveDistanceEl = detailEl.querySelector('[data-field="live-distance"]');
  const relativeVelocityEl = detailEl.querySelector('[data-field="relative-velocity"]');
  const timeToCpaEl = detailEl.querySelector('[data-field="time-to-cpa"]');
  const riskEl = detailEl.querySelector('[data-field="verification-risk"]');
  const hintEl = detailEl.querySelector('[data-field="verification-hint"]');

  if (simTimeEl) simTimeEl.textContent = formatUtcDateTime(simTime);
  if (liveDistanceEl) {
    liveDistanceEl.textContent =
      liveDistance == null ? '—' : `${liveDistance.toFixed(3)} km`;
  }
  if (relativeVelocityEl) {
    relativeVelocityEl.textContent =
      liveRelativeVelocity == null ? '—' : formatRelativeVelocityKmS(liveRelativeVelocity);
  }
  if (timeToCpaEl) {
    const msToCpa = conjunction.time.getTime() - simTime.getTime();
    timeToCpaEl.textContent =
      msToCpa > 0
        ? t('conj.t_minus').replace('{s}', String(Math.ceil(msToCpa / 1000)))
        : t('conj.t_plus').replace('{s}', String(Math.ceil(-msToCpa / 1000)));
  }
  if (riskEl) {
    riskEl.textContent = translateRiskLabel(assessment.riskLabel);
    riskEl.className = verificationRiskClass(assessment.riskLabel);
  }
  if (hintEl) hintEl.textContent = translateVerificationHint(assessment, conjunction.distanceKm);
}

export function renderConjunctionDetail(detailEl: Element, conjunction: ConjunctionEvent): void {
  const state = getState();
  const colocatedA = getColocatedObjectNames(state.objects, conjunction.indexA);
  const colocatedB = getColocatedObjectNames(state.objects, conjunction.indexB);
  let colocatedNote = '';
  if (colocatedA.length > 1 || colocatedB.length > 1) {
    const appearsWith =
      colocatedA.length > 1
        ? `${t('conj.colocated_appears_with')
            .replace('{name}', escapeHtml(conjunction.objectA))
            .replace('{names}', escapeHtml(colocatedA.filter((n) => n !== conjunction.objectA).join(', ')))} `
        : '';
    colocatedNote = `<p class="muted conjunction-colocated-note">${t('conj.colocated_prefix')} ${appearsWith}${t('conj.colocated_suffix')}</p>`;
  } else if (isCoOrbitingPair(conjunction.relativeVelocityKmS)) {
    colocatedNote = `<p class="muted conjunction-colocated-note">${t('conj.coorbiting_note')}</p>`;
  }

  detailEl.innerHTML = `
    <h2 class="panel-heading panel-heading--alert">${t('conj.heading')}</h2>
    <div class="conjunction-detail-title">
      ${escapeHtml(conjunction.objectA)} vs ${escapeHtml(conjunction.objectB)}
    </div>
    <dl class="detail-list">
      <div class="detail-row"><dt>${t('conj.cpa_event')}</dt><dd>${formatUtcDateTime(conjunction.time)}</dd></div>
      <div class="detail-row"><dt>${t('conj.sim_time')}</dt><dd data-field="sim-time">—</dd></div>
      <div class="detail-row"><dt>${t('conj.time_to_cpa')}</dt><dd data-field="time-to-cpa">—</dd></div>
      <div class="detail-row"><dt>${t('conj.live_separation')}</dt><dd data-field="live-distance">—</dd></div>
      <div class="detail-row"><dt>${t('conj.cpa_minimum')}</dt><dd>${conjunction.distanceKm.toFixed(3)} km</dd></div>
      <div class="detail-row"><dt>${t('conj.relative_velocity')}</dt><dd data-field="relative-velocity">—</dd></div>
      <div class="detail-row"><dt>${t('conj.risk_assessment')}</dt><dd data-field="verification-risk" class="conjunction-risk--monitor">—</dd></div>
    </dl>
    ${colocatedNote}
    <p class="muted conjunction-accuracy-note">${t('conj.accuracy_note')}</p>
    <p class="muted conjunction-detail-hint" data-field="verification-hint">
      ${t('conj.hint_rewound').replace('{s}', String(Math.round(getVerificationRewindMs(conjunction.relativeVelocityKmS) / 1000)))}
    </p>
    <button type="button" id="btn-exit-conjunction" class="btn-exit-conjunction">
      ${t('conj.return_global')}
    </button>
  `;
}
