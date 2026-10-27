/**
 * Parts of the object details: position text, docked parts, orbit-data note, radio channels.
 */
import { formatGroundPosition, formatSlot } from '../../orbital/groundPosition';
import type { DockedComponent, ObjectSnapshot, RadioFrequency, TrackedObject } from '../../types';
import { tleAgeDays } from '../../data/tleLoader';
import { t } from '../../i18n/i18n';
import { escapeHtml, safeHttpUrl } from '../escapeHtml';
import { prepareRadioRows } from '../../data/radioDisplay';
import { satnogsLikelyObserved, satnogsObservationsUrl } from '../../data/satnogsLinks';

/** Where the object is above the Earth: lat/lon, or just the longitude slot for GEO. */
export function groundPositionText(snapshot: ObjectSnapshot): string {
  return snapshot.layer === 'GEO'
    ? formatSlot(snapshot.longitudeDeg)
    : formatGroundPosition(snapshot.latitudeDeg, snapshot.longitudeDeg);
}
/**
 * One table cell. `data-label` feeds the stacked card layout used in narrow
 * panels (see `.radio-frequency-section` container query in src/styles/details.css), where
 * the header row is hidden and each value carries its own label.
 */
function radioCell(label: string, value: string | undefined): string {
  return `<td data-label="${escapeHtml(label)}"${value ? '' : ' class="radio-cell-empty"'}>${escapeHtml(value ?? '—')}</td>`;
}

/** Modules and vehicles merged into this object (see data/dockedStacks). */
export function renderDockedComponents(parts: DockedComponent[] | undefined): string {
  if (!parts || parts.length === 0) return '';
  const items = parts
    .map((part) => `<li>${escapeHtml(part.name)} <span class="muted">NORAD ${part.noradId}</span></li>`)
    .join('');
  return `<div class="detail-row detail-row--docked"><dt>${t('sat.docked_parts')}</dt><dd><ul class="docked-parts">${items}</ul></dd></div>`;
}

/** Orbit data older than this gets a note: positions and passes drift. */
const ORBIT_DATA_NOTE_AGE_DAYS = 7;

/**
 * Says where the orbit comes from when it isn't the usual fresh CelesTrak TLE:
 * SatNOGS DB elements (e.g. LAPAN-A2 / IO-86), or any elements over a week old.
 */
export function orbitDataNote(obj: TrackedObject): string {
  const days = Math.max(0, Math.round(tleAgeDays(obj.satrec, Date.now())));
  if (obj.tleSource === 'satnogs') {
    return `<p class="muted orbit-data-note">${escapeHtml(t('sat.orbit_satnogs').replace('{d}', String(days)))}</p>`;
  }
  if (days > ORBIT_DATA_NOTE_AGE_DAYS) {
    return `<p class="muted orbit-data-note">${escapeHtml(t('sat.orbit_old').replace('{d}', String(days)))}</p>`;
  }
  return '';
}

export function renderRadioFrequencies(frequencies: RadioFrequency[] | undefined, noradId: number): string {
  const obsUrl = satnogsLikelyObserved(frequencies) ? satnogsObservationsUrl(noradId) : null;
  const prepared = frequencies?.length ? prepareRadioRows(frequencies) : [];
  const hasMarker = prepared.some((row) => row.hasMarker);
  const rows = prepared.length ? prepared.map((frequency) => `
    <tr class="radio-frequency-main${frequency.amateur === false ? ' radio-frequency-row--other' : ''}">
      <td class="radio-cell-service">${escapeHtml(frequency.genericService ? t('sat.radio_generic') : frequency.service)}${frequency.amateur === true ? ` <span class="radio-badge">${t('sat.radio_amateur')}</span>` : ''}</td>
      ${radioCell(t('sat.radio_uplink'), frequency.uplinkMHz)}
      ${radioCell(t('sat.radio_downlink'), frequency.downlinkMHz)}
      ${radioCell(t('sat.radio_listen'), frequency.listenMHz)}
      ${radioCell(t('sat.radio_mode'), frequency.mode)}
    </tr>
    ${frequency.note ? `<tr class="radio-frequency-note"><td colspan="5">${escapeHtml(frequency.note)}</td></tr>` : ''}
    <tr class="radio-frequency-source"><td colspan="5"><a href="${escapeHtml(safeHttpUrl(frequency.sourceUrl))}" target="_blank" rel="noopener noreferrer">${t('sat.radio_source')}</a></td></tr>
  `).join('') : `
    <tr class="radio-frequency-empty">
      <td>${t('sat.radio_no_data')}</td><td>—</td><td>—</td><td>—</td><td>—</td>
    </tr>
  `;

  return `
    <section class="radio-frequency-section" aria-labelledby="radio-frequency-heading">
      <h3 id="radio-frequency-heading">${t('sat.radio_heading')}</h3>
      <p class="muted radio-frequency-disclaimer">${t('sat.radio_disclaimer')}</p>
      <div class="radio-frequency-scroll">
        <table class="radio-frequency-table">
          <thead><tr>
            <th>${t('sat.radio_service')}</th>
            <th>${t('sat.radio_uplink')}</th>
            <th>${t('sat.radio_downlink')}</th>
            <th>${t('sat.radio_listen')}</th>
            <th>${t('sat.radio_mode')}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${hasMarker ? `<p class="muted radio-frequency-disclaimer radio-frequency-marker">${t('sat.radio_marker_note')}</p>` : ''}
      ${obsUrl ? `<p class="radio-observations"><a href="${escapeHtml(obsUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('sat.radio_observations'))} ↗</a></p>` : ''}
    </section>
  `;
}
