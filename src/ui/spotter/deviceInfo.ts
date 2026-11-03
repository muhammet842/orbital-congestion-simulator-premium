/**
 * Which phone, operating system and browser a Spotter measurement came from,
 * so iPhone and Android readings can be analysed apart.
 *
 * Read from the browser's User-Agent text and, where the browser offers it
 * (Chrome and Edge on Android), from `navigator.userAgentData`. Chrome on
 * Android deliberately hides the model ("K") and freezes the Android version
 * at 10 in the User-Agent text; userAgentData gives the real ones. iPhones
 * never reveal the model, only "iPhone".
 */

export interface DeviceInfo {
  /** 'iOS', 'Android' or 'other' (anything else, e.g. a computer). */
  platform: 'iOS' | 'Android' | 'other';
  /** e.g. "Android 14", "iOS 17.5", "Windows". */
  os: string;
  /** e.g. "Pixel 7", "iPhone"; empty when the browser does not say. */
  model: string;
  /** e.g. "Chrome 130", "Safari 17". */
  browser: string;
  userAgent: string;
}

/** What `navigator.userAgentData.getHighEntropyValues` returns (the fields used here). */
export interface UserAgentHints {
  platform?: string;
  platformVersion?: string;
  model?: string;
}

function browserName(ua: string): string {
  const pick = (re: RegExp, name: string) => {
    const m = re.exec(ua);
    return m ? `${name} ${m[1]}` : null;
  };
  return (
    pick(/EdgA?\/(\d+)/, 'Edge') ??
    pick(/SamsungBrowser\/(\d+)/, 'Samsung Internet') ??
    pick(/CriOS\/(\d+)/, 'Chrome') ??
    pick(/FxiOS\/(\d+)/, 'Firefox') ??
    pick(/OPR\/(\d+)/, 'Opera') ??
    pick(/Firefox\/(\d+)/, 'Firefox') ??
    pick(/Chrome\/(\d+)/, 'Chrome') ??
    pick(/Version\/(\d+)[\d.]*.*Safari\//, 'Safari') ??
    ''
  );
}

/** Device details from a User-Agent text and optional userAgentData hints. */
export function describeDevice(userAgent: string, hints: UserAgentHints = {}): DeviceInfo {
  const ua = userAgent ?? '';
  const apple = /\b(iPhone|iPad|iPod)\b/.exec(ua);
  const appleOs = /\bOS (\d+)[_.](\d+)/.exec(ua);
  const android = /Android (\d+(?:\.\d+)?)/.exec(ua);
  let platform: DeviceInfo['platform'] = 'other';
  let os = '';
  let model = '';

  if (apple) {
    platform = 'iOS';
    os = appleOs ? `${apple[1] === 'iPad' ? 'iPadOS' : 'iOS'} ${appleOs[1]}.${appleOs[2]}` : 'iOS';
    model = apple[1];
  } else if (android || hints.platform === 'Android') {
    platform = 'Android';
    // Hints are used only when they also say Android (a computer imitating a phone reports its own system).
    const androidHints = hints.platform === 'Android' ? hints : {};
    const realVersion = androidHints.platformVersion ? androidHints.platformVersion.split('.')[0] : null;
    os = `Android ${realVersion ?? android?.[1] ?? ''}`.trim();
    // "Linux; Android 14; Pixel 7 Build/…" or "Linux; Android 10; K)" (hidden).
    const fromUa = /Android [\d.]+; ([^;)]+?)(?: Build\/|\))/.exec(ua)?.[1]?.trim() ?? '';
    model = androidHints.model?.trim() || (fromUa === 'K' ? '' : fromUa);
  } else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return { platform, os, model, browser: browserName(ua), userAgent: ua };
}

let hints: UserAgentHints = {};

/** Asks the browser for the real model and Android version, where it can tell (Chromium on Android). */
export async function loadUserAgentHints(): Promise<void> {
  const data = (navigator as Navigator & {
    userAgentData?: { getHighEntropyValues?: (keys: string[]) => Promise<UserAgentHints> };
  }).userAgentData;
  try {
    if (data?.getHighEntropyValues) hints = await data.getHighEntropyValues(['platform', 'platformVersion', 'model']);
  } catch {
    // Not offered: the User-Agent text alone is used.
  }
}

/** This device, from the User-Agent text and any hints already loaded. */
export function currentDevice(): DeviceInfo {
  return describeDevice(navigator.userAgent, hints);
}
