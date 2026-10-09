/**
 * Error taxonomy (Architecture.md §11).
 *
 * Every failure the API returns on purpose is an `AppError` with a stable machine-readable
 * `code`. Anything else that reaches the handler is a bug, and is reported as a generic 500
 * with the details kept in the logs — a stack trace or a Postgres constraint name in a
 * response body tells an attacker about the schema and tells the user nothing.
 */

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', fields?: Record<string, string>) {
    super('VALIDATION_ERROR', message, 400, fields);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super('FORBIDDEN', message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${toCode(resource)}_NOT_FOUND`, `${resource} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(code, message, 409);
  }
}

/**
 * The request was valid, the caller is who they say they are and may do this in principle —
 * their plan does not include it (GAPS §10).
 *
 * 402 rather than 403 because the two are fixed differently and a client should be able to
 * tell them apart without reading prose: 403 is a door that will not open, 402 is a door with
 * a price on it. The body names the entitlement and the cheapest tier that has it, so the
 * upgrade prompt can say what it costs rather than "upgrade to continue".
 */
export class PaymentRequiredError extends AppError {
  constructor(
    readonly entitlement: string,
    readonly requiredPlan: string,
    message: string,
  ) {
    super('PLAN_REQUIRED', message, 402, { entitlement, requiredPlan });
  }
}

/**
 * The plan's ceiling, not its feature list: one more vehicle than it holds.
 *
 * 409 rather than 402 — nothing here is unavailable, there is simply already as much of it as
 * the plan carries, and the caller can also fix it by removing one. The fields say which limit
 * and what it is, so the message can be specific.
 */
export class PlanLimitError extends AppError {
  constructor(limit: string, allowed: number, requiredPlan: string | null, message: string) {
    super('PLAN_LIMIT', message, 409, {
      limit,
      allowed: String(allowed),
      ...(requiredPlan ? { requiredPlan } : {}),
    });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super('RATE_LIMITED', message, 429);
  }
}

/**
 * A dependency this request cannot proceed without is missing or down — an unconfigured
 * provider, an upstream that answered with an error. Not a 500: the request was valid and
 * the fault is nothing the caller did or can fix by changing it.
 */
export class ServiceUnavailableError extends AppError {
  constructor(message: string, code = 'SERVICE_UNAVAILABLE') {
    super(code, message, 503);
  }
}

/**
 * A resource in a garage the caller does not belong to must be indistinguishable from a
 * resource that does not exist (PRD §75).
 *
 * Returning 403 here would confirm the id is real — enumerate ids, collect the 403s, and
 * you have learned which vehicles exist in other people's garages. 404 leaks nothing, so
 * every tenant-scoped lookup that fails the membership check funnels through this.
 */
export function notFoundOrForbidden(resource: string): never {
  throw new NotFoundError(resource);
}

function toCode(resource: string): string {
  return resource
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/\s+/g, '_')
    .toUpperCase();
}
