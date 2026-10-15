# Contributing

Thanks for helping! Bug reports, data corrections and pull requests are all welcome.

## Reporting

- **Something broken or confusing:** open a [bug report](https://github.com/muhammet842/orbital-congestion-simulator-premium/issues/new?template=bug_report.yml).
- **A wrong or missing frequency:** use the [radio data form](https://github.com/muhammet842/orbital-congestion-simulator-premium/issues/new?template=radio_data.yml). Radio data mostly comes from the SatNOGS DB and the AMSAT list, so a fix there helps every tool that uses them.
- **Security problems:** please report privately, see [SECURITY.md](SECURITY.md).

## Running it locally

Node.js 22.22 or newer:

```bash
npm install
npm run dev
```

## Before opening a pull request

```bash
npm run build        # type-check + production build
npm test             # unit tests
npm run check:i18n   # every language has every key
```

- New UI text goes into **all five languages** in `src/i18n/translations.ts` (en, tr, de, ru, zh). If you can't translate, copy the English text and say so in the PR.
- Text from external data (names, owners, frequencies) must go through `escapeHtml` before it reaches the page.
- Don't commit refreshed satellite catalogs by hand; the daily workflow publishes them (see [docs/OPERATIONS.md](docs/OPERATIONS.md)).
- Pull requests into `main` also run the Playwright browser tests in CI.

Keep pull requests small and focused, and describe what you tested.
