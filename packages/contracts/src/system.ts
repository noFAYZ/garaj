import { Type, type Static } from '@sinclair/typebox';

export const HealthResponse = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('degraded')]),
  version: Type.String(),
  uptimeSeconds: Type.Number(),
  checks: Type.Object({
    database: Type.Union([Type.Literal('up'), Type.Literal('down')]),
    // 'disabled' is not 'down': the first means the deployment deliberately runs without
    // Redis, the second means it was configured and is unreachable. Collapsing them would
    // make an in-process test run look like an outage.
    redis: Type.Union([Type.Literal('up'), Type.Literal('down'), Type.Literal('disabled')]),
  }),
});
export type HealthResponse = Static<typeof HealthResponse>;
