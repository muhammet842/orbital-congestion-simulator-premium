/**
 * Name/NORAD heuristics that fill country + owner when SATCAT join is missing.
 * Prefer NORAD overrides (e.g. ISS 25544) over regex. Docked modules such as
 * ISS (NAUKA) are merged into their stack before this runs (dockedStacks.ts),
 * but the patterns still cover them when undocked. Keep TURKISH_NORAD_IDS in
 * sync with scripts/fetch-tle.mjs PRIORITY_NORAD_IDS.
 */
import type { ObjectCategory } from '../types';

export const TURKISH_NORAD_IDS = new Set([
  41875,
  39030,
  56178,
  47306,
  50212,
  60233,
  98268, // RAFS (Rubidium Atomic Frequency Standard) — no public TLE yet, see fetch-tle.mjs
]);

interface MetadataRule {
  pattern: RegExp;
  country: string;
  owner: string;
}

/**
 * Name / NORAD heuristics used only when tle.json has no country/owner.
 * Prefer SATCAT OWNER enrichment written by `scripts/fetch-tle.mjs`
 * (see `scripts/enrichFromSatcat.mjs`); these rules are the fallback.
 */
/** Most specific patterns first — first match wins. */
const NAME_RULES: MetadataRule[] = [
  { pattern: /GOKTURK|GÖKTÜRK/i, country: 'Türkiye 🇹🇷', owner: 'TSK / TAI' },
  { pattern: /IMECE|İMECE/i, country: 'Türkiye 🇹🇷', owner: 'TÜBİTAK UZAY' },
  { pattern: /TURKSAT|TÜRKSAT/i, country: 'Türkiye 🇹🇷', owner: 'Türksat A.Ş.' },
  { pattern: /RASAT|BILSAT|BİLSAT|GÖKTÜRK/i, country: 'Türkiye 🇹🇷', owner: 'TÜBİTAK UZAY' },

  {
    pattern: /ISS\s*\(|^ISS$|NAUKA|ZARYA|POISK|RASSVET|COLUMBUS|DESTINY|HARMONY|UNITY|KIBO|CUPOLA|BEAM|NACHOS|PRSS|COTS/i,
    country: 'International 🌍',
    owner: 'NASA / Roscosmos / ESA',
  },
  { pattern: /CSS|TIANGONG|TIANHE|WENTIAN|MENGTIAN|TIANZHOU|SHENZHOU/i, country: 'China 🇨🇳', owner: 'CMSA / CNSA' },

  { pattern: /STARLINK/i, country: 'USA 🇺🇸', owner: 'SpaceX' },
  { pattern: /ONEWEB/i, country: 'United Kingdom 🇬🇧', owner: 'Eutelsat OneWeb' },
  { pattern: /KUIPER/i, country: 'USA 🇺🇸', owner: 'Amazon / Kuiper Systems' },
  { pattern: /BLUEWALKER|BLUE WALKER/i, country: 'USA 🇺🇸', owner: 'AST SpaceMobile' },

  { pattern: /^HST$|HUBBLE/i, country: 'USA 🇺🇸', owner: 'NASA / ESA' },
  { pattern: /GOES|NOAA|JPSS|NPOESS|DMSP|TIROS/i, country: 'USA 🇺🇸', owner: 'NOAA / NASA' },
  { pattern: /LANDSAT|TERRA|AQUA|AURA|NPP|SUOMI/i, country: 'USA 🇺🇸', owner: 'NASA / USGS' },
  { pattern: /GPS|NAVSTAR|NROL|NRO\s|USA\s*\d/i, country: 'USA 🇺🇸', owner: 'US Space Force / NRO' },
  { pattern: /IRIDIUM|ORBCOMM|GLOBALSTAR|GEOSAT/i, country: 'USA 🇺🇸', owner: 'Commercial US Operator' },
  { pattern: /PLANET|SKYSAT|SKY SAT|FLOCK/i, country: 'USA 🇺🇸', owner: 'Planet Labs' },
  { pattern: /SPIRE|LEMUR/i, country: 'USA 🇺🇸', owner: 'Spire Global' },
  { pattern: /CYGNUS|DRAGON|DRAGONFLY|CRS-/i, country: 'USA 🇺🇸', owner: 'Northrop Grumman / SpaceX' },
  { pattern: /AEROCUBE|CUTE|DELLINGR|CP\d|EXP\d|SPORT|CAPSTONE|LADEE|LCROSS|ICEYE/i, country: 'USA 🇺🇸', owner: 'NASA / US Research' },

  { pattern: /FENGYUN|FY-\d|SHIYAN|SHIJIAN|BEIDOU|BDS|YAOGAN|TIANLIAN|CHINASAT|ZHONGXING|GAOFEN|HAIYANG|TIANHUI|JILIN/i, country: 'China 🇨🇳', owner: 'CNSA / CASIC' },

  { pattern: /COSMOS|SL-\d|GLONASS|METEOR-M|RESURS|CANOPUS|STRELA|GONETS|EXPRESS|YAMAL|LUCH|ARKTIKA/i, country: 'Russia 🇷🇺', owner: 'Roscosmos' },
  { pattern: /PROGRESS|SOYUZ|BION|KOSMOS/i, country: 'Russia 🇷🇺', owner: 'Roscosmos' },

  { pattern: /SENTINEL|GALILEO|METOP|ENVISAT|PROBA|SPOT|SMOS|SWARM|CHEOPS|OPS-SAT|BIROS/i, country: 'Europe 🇪🇺', owner: 'ESA / EUMETSAT' },
  { pattern: /ASTRA|EUTELSAT|SES-|O3B|HISPASAT|HOTBIRD/i, country: 'Europe 🇪🇺', owner: 'SES / Eutelsat' },

  { pattern: /INTELSAT|INMARSAT|JCSAT|SUPERBIRD|OPTUS|ASTRA/i, country: 'International 🌍', owner: 'Commercial Operator' },

  { pattern: /HAYABUSA|IGS-|QZS|MICHIBIKI|JCSAT|SUPERBIRD|GCOM|ALOS|HIMAWARI/i, country: 'Japan 🇯🇵', owner: 'JAXA / MEXT' },

  { pattern: /CARTOSAT|GSAT|INSAT|RISAT|ANURAG|EMISAT|HYSIS|OCEANSAT|RESOURCESAT/i, country: 'India 🇮🇳', owner: 'ISRO' },

  { pattern: /KOMPSAT|KOREASAT|ANASIS|CAS500|STSAT/i, country: 'South Korea 🇰🇷', owner: 'KARI / KTSAT' },

  { pattern: /YAHSAT|AL YAH|KHALIFASAT|MEASAT/i, country: 'UAE 🇦🇪', owner: 'Yahsat / MBRSC' },
  { pattern: /ARABSAT|SAUDISAT|SHARJAH/i, country: 'Saudi Arabia 🇸🇦', owner: 'Arabsat' },
  { pattern: /AISSAT|NORSAT|NCUBE|HYPSO/i, country: 'Norway 🇳🇴', owner: 'Norwegian Space Agency' },
  { pattern: /SWEDSAT|PRISMA|MATA/i, country: 'Sweden 🇸🇪', owner: 'Swedish Space Corp.' },
  { pattern: /CANX|RADARSAT|SCISAT|CASSIOPE|NEOSSAT/i, country: 'Canada 🇨🇦', owner: 'CSA / MDA' },
  { pattern: /SKYNET|CARBONITE|TECHDEMOSAT/i, country: 'United Kingdom 🇬🇧', owner: 'UK Space Agency' },
  { pattern: /ASTRA|HISPASAT/i, country: 'Spain 🇪🇸', owner: 'Hisdesat / ESA' },
  { pattern: /TELECOM|SYRACUSE|SPIRALE/i, country: 'France 🇫🇷', owner: 'CNES / DGA' },
  { pattern: /BELLA|OPS-SAT|ESAIL/i, country: 'Europe 🇪🇺', owner: 'ESA' },
  { pattern: /ANGOSAT|AMAZONIA|SGDC|STAR ONE|SCD/i, country: 'Brazil 🇧🇷', owner: 'AEB / INPE' },
  { pattern: /AFRICASAT|NILESAT|NIGCOMSAT/i, country: 'Africa 🌍', owner: 'Regional Operator' },
  { pattern: /OPTUS|SKY MIMO|SKYMED/i, country: 'Australia 🇦🇺', owner: 'Optus / CSIRO' },
  { pattern: /^MARINA$|OM9MAR/i, country: 'Slovakia 🇸🇰', owner: 'Amateur radio (OM9MAR)' },
];

const FEATURED_OVERRIDES = new Map<number, { country: string; owner: string }>([
  [25544, { country: 'International 🌍', owner: 'NASA / Roscosmos / ESA' }],
  [20580, { country: 'USA 🇺🇸', owner: 'NASA / ESA' }],
  [48274, { country: 'China 🇨🇳', owner: 'CMSA' }],
  [41875, { country: 'Türkiye 🇹🇷', owner: 'TSK / TAI' }],
  [39030, { country: 'Türkiye 🇹🇷', owner: 'TSK / TAI' }],
  [56178, { country: 'Türkiye 🇹🇷', owner: 'TÜBİTAK UZAY' }],
  [47306, { country: 'Türkiye 🇹🇷', owner: 'Türksat A.Ş.' }],
  [50212, { country: 'Türkiye 🇹🇷', owner: 'Türksat A.Ş.' }],
  [60233, { country: 'Türkiye 🇹🇷', owner: 'Türksat A.Ş.' }],
  // Amateur radio cubesat (OM9MAR); origin Slovakia — SatNOGS / IARU.
  [69920, { country: 'Slovakia 🇸🇰', owner: 'Amateur radio (OM9MAR)' }],
]);

function hasValue(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

export function inferMetadata(
  name: string,
  category: ObjectCategory,
  noradId: number,
): { country: string; owner: string } {
  const featured = FEATURED_OVERRIDES.get(noradId);
  if (featured) return featured;

  for (const rule of NAME_RULES) {
    if (rule.pattern.test(name)) {
      return { country: rule.country, owner: rule.owner };
    }
  }

  if (category === 'stations') {
    return { country: 'International 🌍', owner: 'Space Agency Consortium' };
  }

  if (category === 'debris') {
    if (/COSMOS\s*2251|COSMOS-2251/i.test(name)) {
      return { country: 'Russia 🇷🇺', owner: 'Roscosmos (collision debris)' };
    }
    if (/FENGYUN|FY-1C/i.test(name)) {
      return { country: 'China 🇨🇳', owner: 'CNSA (ASAT debris)' };
    }
    if (/IRIDIUM\s*33|IRIDIUM-33/i.test(name)) {
      return { country: 'USA 🇺🇸', owner: 'Iridium / collision debris' };
    }
    if (/COSMOS|SL-/i.test(name)) return { country: 'Russia 🇷🇺', owner: 'Roscosmos (debris)' };
    if (/FENGYUN|SHIYAN|CZ-/i.test(name)) return { country: 'China 🇨🇳', owner: 'CNSA (debris)' };
    if (/IRIDIUM|USA\s*\d/i.test(name)) return { country: 'USA 🇺🇸', owner: 'US Operator (debris)' };
    if (/STARLINK/i.test(name)) return { country: 'USA 🇺🇸', owner: 'SpaceX (debris)' };
    return { country: 'Unknown 🌐', owner: 'Catalogued debris fragment' };
  }

  if (category === 'active') {
    return { country: 'Unknown 🌐', owner: 'Commercial / state operator (unclassified)' };
  }

  return { country: 'Unknown 🌐', owner: 'Unknown operator' };
}

export function isTurkishSatellite(country: string): boolean {
  return country.includes('Türkiye') || country.includes('Turkey');
}

/** "Norway 🇳🇴" -> "norway": compare countries without flags or spacing. */
function countryKey(country: string): string {
  return country.replace(/[^\p{L}\s]/gu, '').trim().toLowerCase();
}

/** Honest placeholder when no reliable operator is known. */
function unknownOwner(category: ObjectCategory): string {
  if (category === 'debris') return 'Catalogued debris fragment';
  if (category === 'active') return 'Commercial / state operator (unclassified)';
  return 'Unknown operator';
}

export function enrichRecord<T extends { name: string; category: ObjectCategory; noradId: number; country?: string; owner?: string }>(
  record: T,
): T & { country: string; owner: string } {
  const meta = inferMetadata(record.name, record.category, record.noradId);
  const country = hasValue(record.country) ? record.country.trim() : meta.country;
  // A name rule's operator is a guess. When the catalogue (SATCAT) gives a
  // different country, the guess matched the wrong satellite (FUNCUBE-1 is not
  // Norwegian, COSMO-SkyMed is not Australian), so don't show it.
  const guessContradictsCatalog =
    hasValue(record.country) && !/^unknown/i.test(meta.country) && countryKey(record.country) !== countryKey(meta.country);
  return {
    ...record,
    country,
    owner: hasValue(record.owner) ? record.owner.trim() : guessContradictsCatalog ? unknownOwner(record.category) : meta.owner,
  };
}
