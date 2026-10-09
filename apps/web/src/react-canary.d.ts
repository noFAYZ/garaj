/// <reference types="react/canary" />

/*
 * `experimental.viewTransition` swaps in Next's bundled experimental React, which exports the
 * component as `unstable_ViewTransition`; the canary types only know it as `ViewTransition`.
 * ponytail: delete this file once React ships `<ViewTransition>` stable.
 */
declare module 'react' {
  export const unstable_ViewTransition: ExoticComponent<ViewTransitionProps>;
}

export {};
