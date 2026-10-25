import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/i18n/translations.ts'), 'utf8');
const langs = ['en', 'tr', 'de', 'ru', 'zh'];
const maps = {};
let failed = false;

for (const lang of langs) {
  const m = src.match(new RegExp(`const ${lang}: Translations = \\{([\\s\\S]*?)\\n\\};`));
  if (!m) throw new Error(`missing ${lang}`);
  const keys = [...m[1].matchAll(/'([^']+)':/g)].map((x) => x[1]);
  maps[lang] = new Set(keys);
  const dupes = keys.length - maps[lang].size;
  console.log(lang, keys.length, 'dupes', dupes);
  if (dupes > 0) failed = true;
}

for (const lang of langs.slice(1)) {
  const missing = [...maps.en].filter((k) => !maps[lang].has(k));
  const extra = [...maps[lang]].filter((k) => !maps.en.has(k));
  console.log(lang, 'missing vs en', missing.length, missing.slice(0, 10));
  console.log(lang, 'extra vs en', extra.length, extra.slice(0, 10));
  if (missing.length || extra.length) failed = true;
}

// Unused keys: every text costs a translation in five languages, so a key the
// code never asks for should be removed. A key counts as used when it appears
// literally in the app code, or matches a key built from a pattern such as
// `radio.mode.${mode}` (prefix "radio.mode.").
const codeFiles = [join(root, 'index.html')];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|mjs)$/.test(name) && !name.endsWith('.test.ts') && name !== 'translations.ts') codeFiles.push(path);
  }
};
walk(join(root, 'src'));
const code = codeFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
const builtPrefixes = [...code.matchAll(/`([a-z][\w-]*(?:\.[\w-]+)*[._])\$\{/g)].map((m) => m[1]);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unused = [...maps.en].filter(
  (key) =>
    !new RegExp(`(^|[^\\w.])${escape(key)}($|[^\\w.])`).test(code) &&
    !builtPrefixes.some((prefix) => key.startsWith(prefix)),
);
console.log('unused keys', unused.length, unused.slice(0, 20));
if (unused.length) failed = true;

if (failed) {
  console.error('i18n parity check failed');
  process.exit(1);
}
