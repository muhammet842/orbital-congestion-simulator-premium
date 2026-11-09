# AI use

AI tools were used **heavily** in building this project. This document describes honestly which tools were used, when, for which work, and how the results were checked. The git history was never rewritten; the traces of AI use (commit trailers, the `.cursor/rules/` files) remain in the repository as they are.

*Last updated: 9 November 2026.*

## Tools and periods

| Period | Tool | Trace in the git history |
|---|---|---|
| July – September 2026 | **Cursor**: an AI-assisted code editor | **171 commits** between 8 July and 2 September with a `Co-authored-by: Cursor` line. The two files in `.cursor/rules/` (`project-map.mdc`, `tle-refresh.mdc`) are rules that introduce the project to Cursor's AI (added on 2 September). |
| Since 12 October 2026 | **Claude Code** (Anthropic): the Claude Opus 5.5 and Claude Sonnet 5.5 models | **36 commits** between 12 and 15 October with a `Co-Authored-By: Claude …` line; a "Generated with Claude Code" note in the descriptions of PR #1–#12. |

### ⚠️ Contribution the git history does not show

At the author's request, Claude Code stopped adding the "Generated with Claude Code" note to PR descriptions from PR #13 (14 October 2026), and the `Co-Authored-By: Claude` line to commits after 15 October 2026. So the git history shows **less** of the AI's contribution than there really is:

- **PR #44 onwards** were made with Claude Code. The code, tests, commit messages and PR descriptions were written by Claude Code, then read and merged by the author.
- **PR #13 – #43** are from the same period and the same way of working. ☐ *(To be confirmed by the author: which of them were made with Claude Code.)*
- The Dependabot PRs (#24–#31, #48–#51, #68) are automatic dependency updates, opened by a GitHub tool, not by AI.
- The daily data commits (`github-actions[bot]`, 61 commits) come from an automated workflow.

**From 9 November 2026 the commit signatures are back:** commits made with Claude Code carry the `Co-Authored-By: Claude …` line again.

## What the AI did

### The application

- **Most of the code** was written with AI tools ☐ *(to be confirmed or corrected by the author: the parts written by hand or rewritten)*: the interface, the 3D scene (Three.js), position calculation with SGP4, the 24-hour close-approach sweep and the Web Workers, the Kessler projection, the Satellite Radio panel, Spotter, the launch list, the daily data workflow, CI and tests. How they work: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).
- **Translations:** the interface texts in languages other than English (Turkish, German, Russian, Chinese) were translated by AI. ☐ *(To be confirmed by the author: which languages a native speaker has checked.)*
- **Tests:** most of the unit tests and the browser tests were written by AI.
- **Documentation:** the README and the documents under `docs/` and `research/` were written by AI.

### Research tooling (November 2026, Claude Code)

Following a task list set by the author:

| Work | Folder / PR |
|---|---|
| Daily TLE archive and recovery of past days | `tle-archive` release, PR #69 |
| TLE age vs. position difference | [`research/tle-age/`](../research/tle-age/README.md), PR #70 |
| Performance flags and measurement scripts | [`research/perf/`](../research/perf/README.md), PR #71 |
| SGP4 verification (Vallado et al. 2006 test set) | [`research/sgp4-verify/`](../research/sgp4-verify/README.md), PR #72 |
| Spotter accuracy protocol, measurement readout and analysis | [`research/spotter/`](../research/spotter/PROTOCOL.md), PR #73 – #75 |
| Architecture overview | [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), PR #76 |

In this work the AI wrote the scripts, ran the measurements on the author's computer and produced the result files. The method rules set by the author (for example computing TLE age from the line-1 epochs, keeping the main period apart, the extra round with CPU slowdown) are the author's own decisions. The main method choices the AI **proposed itself**, and the author approved, were:

- keeping the archive in a GitHub Release as gzip-compressed 3LE files rather than on a branch;
- the rule that discards meaningless results SGP4 returns without an error (a predicted position more than 1,000 km outside the newer orbit's lowest-to-highest range is invalid);
- Tukey's rule (Q3 + 3 × IQR) for outliers, and the median as the main result;
- in the SGP4 verification, the MATLAB output as the main reference and the Fortran output as the cross-check, and the `afspc` mode diagnostic to show where a difference comes from;
- in the performance measurement, picking objects evenly by NORAD number, an alternating run order, and measuring frame time in a fixed window without waiting for the sweep;
- in the Spotter protocol, the targets with a known true direction (distant landmark, Polaris, spirit level) and computing the true direction on WGS-84.

### Outside the code

- **Feedback and draft suggestions** for project description texts and a forum announcement. The final texts are written by the author. ☐ *(To be confirmed by the author.)*
- **Written reports about the project are not written by AI**; the author writes them.

## How the results were checked

- **Automated tests:** unit tests (Vitest); browser tests (Playwright); lint, type checking and a build on every change. The same checks run on GitHub for every PR.
- **Verification against an independent reference:** the app's SGP4 library agrees within 1 mm with 32 of the 33 test cases published with Vallado et al. (2006); the source of the difference in the remaining case is shown ([`research/sgp4-verify/`](../research/sgp4-verify/README.md)).
- **Reproducibility:** every measurement can be rerun with one command and gives the same results with the same data. The data sources and file hashes (SHA-256) are given in the documents.
- **Manual checks:** interface changes were tried in a browser at phone and desktop sizes, and screenshots were reviewed.
- **The AI's mistakes:** the AI also made mistakes while working, and some were caught in review. Examples: the protocol giving the wrong GPS warning threshold for Spotter (20 m, while the code uses 80 m), due north written as "360.00°", a measurement flag lost when the address changed, and a meaningless error value produced for an unplanned case (the spirit level). All were fixed.
