/**
 * Stands in for satellite.js's optional WebAssembly runtime (#wasm-single-thread,
 * #wasm-multi-thread). This app only uses the plain JavaScript SGP4, and the WASM
 * build would ship ~400 KB more, need top-level await (newer browsers only) and
 * a CSP exception to run. Calling the bulk/WASM API fails loudly instead.
 */
export default function createWasmModule(): never {
  throw new Error('The satellite.js WebAssembly runtime is not included in this build.');
}
