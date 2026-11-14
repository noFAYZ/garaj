/**
 * Crash reporting.
 *
 * Sentry, switched on by a DSN in `app.json` (`expo.extra.sentryDsn`) and off without one, so a
 * development build reports nothing and a release build without the key behaves exactly as
 * before. Once on, it hears what nothing else does: uncaught JS errors, unhandled rejections and
 * native crashes — the release-build failures that otherwise only exist as one-star reviews.
 */

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const dsn: unknown = Constants.expoConfig?.extra?.sentryDsn;
const enabled = typeof dsn === 'string' && dsn.length > 0 && !__DEV__;

if (enabled) {
  Sentry.init({
    dsn: dsn as string,
    release: Constants.expoConfig?.version,
    // Errors only: no performance tracing, no session replay — nothing sent that is not a fault.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

/** Reports an error a screen caught (its error boundary), with what it was doing. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
