# Security policy

## Reporting a problem

Please **do not open a public issue** for a security problem. Report it privately through GitHub instead:
[Report a vulnerability](https://github.com/muhammet842/orbital-congestion-simulator-premium/security/advisories/new).

Include what you found, how to reproduce it and what impact you think it has. You should get a reply within a week.

## Scope

The live site is a static app with one small server function (`/api/launches`, a cached proxy for Launch Library 2).
It has no accounts and stores nothing about visitors on a server; location used by the Spotter and Radio panels stays in the browser.

Relevant reports include, for example: script injection through catalog or radio data, a weakness in the Content-Security-Policy, the data pipeline publishing unvalidated data, or the API function being abusable.

Only the latest version on `main` (deployed to the live site) is supported.
