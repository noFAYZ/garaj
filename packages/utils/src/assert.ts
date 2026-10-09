/**
 * Exhaustiveness guard for discriminated unions. Placing this in a switch's `default`
 * turns "a new enum member was added and one switch was not updated" from a runtime
 * surprise into a compile error at the switch that forgot it.
 */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

export function assertDefined<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}
