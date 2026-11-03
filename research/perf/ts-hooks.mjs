/**
 * Node module hook: lets research scripts import the app's own TypeScript
 * files (src/**), which import each other without the ".ts" extension as
 * Vite allows. When such an import is not found, ".ts" is tried. Node 22.18+
 * strips the TypeScript types itself. Loaded by register-ts.mjs.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.\.?\//.test(specifier) || specifier.endsWith('.ts')) throw err;
    return nextResolve(`${specifier}.ts`, context);
  }
}
