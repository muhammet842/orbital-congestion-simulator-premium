/**
 * Details of an upcoming launch.
 */
import { t, getLang } from '../../i18n/i18n';
import { escapeHtml, safeHttpUrl } from '../escapeHtml';
import { findLaunch, formatCountdown, isFinished } from '../../data/launches';
import { durationUnits, formatNet } from '../LaunchesPanel';

/** Details of an upcoming launch: what it is for, where it goes, when. */
export function renderLaunchDetail(detailEl: Element, launchId: string, fallbackName: string): void {
  const launch = findLaunch(launchId);
  if (!launch) {
    detailEl.innerHTML = `
      <div class="detail-header"><div class="norad-id">${escapeHtml(t('launch.detail_label'))}</div>
      <div class="object-name">${escapeHtml(fallbackName)}</div></div>
      <p class="muted">${escapeHtml(t('launch.loading'))}</p>`;
    return;
  }

  const dateTbd = launch.status === 'tbd';
  const statusChip = `<span class="launch-status launch-status--${launch.status}">${escapeHtml(t(`launch.status.${launch.status}`))}</span>`;
  const countdown = dateTbd
    ? escapeHtml(t('launch.status.tbd'))
    : `<span data-field="launch-countdown" data-net="${escapeHtml(launch.net)}">${escapeHtml(formatCountdown(Date.parse(launch.net) - Date.now(), durationUnits()))}</span>`;
  const row = (label: string, value: string | null) =>
    value ? `<div class="detail-row"><dt>${escapeHtml(t(label))}</dt><dd>${escapeHtml(value)}</dd></div>` : '';
  const pad = [launch.padName, launch.locationName].filter(Boolean).join(', ') || null;
  const englishNote = getLang() !== 'en' && launch.missionDescription ? ` <span class="muted launch-detail-lang">${escapeHtml(t('launch.description_english'))}</span>` : '';
  const description = launch.missionDescription
    ? launch.missionDescription
        .split(/\n{2,}/)
        .map((p) => `<p class="launch-detail-text">${escapeHtml(p)}</p>`)
        .join('')
    : `<p class="muted launch-detail-text">${escapeHtml(t('launch.no_description'))}</p>`;
  const webcast = safeHttpUrl(launch.webcastUrl ?? '');

  detailEl.innerHTML = `
    <div class="detail-header">
      <div class="norad-id">${escapeHtml(t(isFinished(launch.status) ? 'launch.detail_label_recent' : 'launch.detail_label'))}</div>
      <div class="object-name">${escapeHtml(launch.name)}</div>
      <div class="launch-detail-when">${statusChip} <span class="launch-detail-countdown">${countdown}</span></div>
      <div class="muted launch-detail-time">${escapeHtml(t('launch.net'))} ${escapeHtml(formatNet(launch.net))}</div>
    </div>
    <section class="launch-detail-mission" aria-labelledby="launch-mission-heading">
      <h3 id="launch-mission-heading">${escapeHtml(t('launch.mission'))}${englishNote}</h3>
      ${description}
    </section>
    <dl class="detail-list">
      ${row('launch.type', launch.missionType)}
      ${row('launch.destination', launch.destination ?? launch.orbit)}
      ${row('launch.rocket', launch.rocket)}
      ${row('launch.provider', launch.provider)}
      ${row('launch.pad', pad)}
    </dl>
    ${webcast !== '#' ? `<a class="btn-orbit-trail launch-detail-watch" href="${escapeHtml(webcast)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('launch.watch'))}</a>` : ''}
    <p class="muted launch-credit">${escapeHtml(t('launch.credit'))}</p>
  `;
}
