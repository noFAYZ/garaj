// Expo's default config plus Sentry's serializer, which stamps bundles and source maps with debug IDs.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getSentryExpoConfig(projectRoot);

/*
 * Metro does not understand a pnpm workspace on its own: the `@vehicle-os/*` packages live
 * outside the app directory, and pnpm resolves everything else through symlinks into
 * `node_modules/.pnpm`.
 */
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/*
 * Hierarchical lookup stays ON, which is the opposite of the usual monorepo advice.
 *
 * That advice assumes a hoisted layout, where every package is reachable from the root and
 * walking up the tree only wastes time. pnpm's layout is the reverse: `expo`'s own
 * dependencies are symlinked into *its* `node_modules`, so resolving `expo-modules-core`
 * from inside `expo` requires walking up from the requiring file. Turning that off is why
 * the app could not bundle at all.
 */
config.resolver.disableHierarchicalLookup = false;

/*
 * `@vehicle-os/api-client/react` is a subpath in that package's `exports` map. Metro reads
 * `exports` only when this is on — without it the workspace packages resolve at their root
 * and every subpath import fails, which is a confusing way to be told the package is fine.
 */
config.resolver.unstable_enablePackageExports = true;

/*
 * One React, always the app's own.
 *
 * `@vehicle-os/api-client` carries a devDependency on React 19 (it is typechecked against
 * the web app), so hierarchical lookup finds *that* copy when resolving `react` from inside
 * the package — while React Native uses 18.3.1. Two Reacts means two different element
 * `$$typeof` symbols, and every element crossing the boundary is rejected with "Objects are
 * not valid as a React child" — including the ones the error overlay itself renders.
 */
const reactRoot = path.join(projectRoot, 'index.js');

/*
 * Every Text and TextInput in the app's fonts (Albert Sans, Cascadia Mono for figures).
 *
 * React Native has no cascade, and since 0.88 its Text and TextInput are plain functions: nothing
 * to patch at run time. So whatever loads RN's own files (the `react-native` index, Animated.Text,
 * any library) is handed the app's wrappers in `lib/`, which add the font to the style. Only the
 * wrappers themselves get the originals.
 */
const FONT_WRAPPERS = [
  ['/react-native/Libraries/Text/Text.js', path.join(projectRoot, 'lib', 'font-text.tsx')],
  [
    '/react-native/Libraries/Components/TextInput/TextInput.js',
    path.join(projectRoot, 'lib', 'font-text-input.tsx'),
  ],
];
const samePath = (a, b) => path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
function dressText(context, resolution) {
  if (resolution.type !== 'sourceFile') return resolution;
  const file = resolution.filePath.replace(/\\/g, '/');
  for (const [original, wrapper] of FONT_WRAPPERS) {
    if (file.endsWith(original) && !samePath(context.originModulePath, wrapper)) {
      return { type: 'sourceFile', filePath: wrapper };
    }
  }
  return resolution;
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return context.resolveRequest({ ...context, originModulePath: reactRoot }, moduleName, platform);
  }
  /*
   * TypeBox through its CommonJS build. Its ESM build declares `export var Object`, and the
   * CommonJS shim Metro wraps ESM in calls `Object.defineProperty` before that hoisted `var` is
   * set: "Cannot read property 'defineProperty' of undefined" on launch. Metro picks the ESM
   * build for `import` statements since SDK 58.
   */
  // Sentry probes this expo-router internal inside a try/catch; SDK 58 removed it, and Metro
  // warns about the dead `exports` entry on every bundle. Empty reads to Sentry as "no store".
  if (moduleName === 'expo-router/build/global-state/router-store') return { type: 'empty' };
  if (moduleName === '@sinclair/typebox' || moduleName.startsWith('@sinclair/typebox/')) {
    return context.resolveRequest({ ...context, isESMImport: false }, moduleName, platform);
  }
  return dressText(context, context.resolveRequest(context, moduleName, platform));
};

module.exports = config;
