// Usage: node --import ./research/perf/register-ts.mjs <script> (see ts-hooks.mjs).
import { register } from 'node:module';

register('./ts-hooks.mjs', import.meta.url);
