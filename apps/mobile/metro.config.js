const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

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

// The symlinks pnpm's layout is made of. Metro follows them only when told to.
config.resolver.unstable_enableSymlinks = true;

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
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return context.resolveRequest({ ...context, originModulePath: reactRoot }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
