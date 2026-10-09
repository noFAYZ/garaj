import type { Schema } from '../lib/openapi';
import { Rich } from './rich';

/*
 * A JSON Schema as a reader wants it: each field with its type, whether it is required, its
 * limits and what it means; objects nest, arrays say what they hold, a union of constants reads
 * as the list of values it allows.
 */

/** The allowed values when a union is only constants — how TypeBox spells an enum. */
function constants(schema: Schema): unknown[] | null {
  if (schema.enum) return schema.enum;
  if (schema.anyOf?.length && schema.anyOf.every((member) => member.const !== undefined)) {
    return schema.anyOf.map((member) => member.const);
  }
  return null;
}

/** allOf members folded into one object, as an intersection means. */
function flatten(schema: Schema): Schema {
  if (!schema.allOf) return schema;
  return schema.allOf.map(flatten).reduce<Schema>(
    (merged, part) => ({
      ...merged,
      type: 'object',
      properties: { ...merged.properties, ...part.properties },
      required: [...(merged.required ?? []), ...(part.required ?? [])],
    }),
    { ...schema, allOf: undefined },
  );
}

/** A short type label: `string · uuid`, `integer`, `array of object`, `string | null`. */
export function typeLabel(input: Schema): string {
  const schema = flatten(input);
  const values = constants(schema);
  if (values) return 'enum';
  if (schema.anyOf) {
    return schema.anyOf.map(typeLabel).filter((label, index, all) => all.indexOf(label) === index).join(' | ');
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const base = types
    .map((type) => {
      if (type === 'array') return `array of ${schema.items ? typeLabel(schema.items) : 'any'}`;
      if (type === 'string' && schema.format) return `string · ${schema.format}`;
      return type;
    })
    .sort((a, b) => (a === 'null' ? 1 : b === 'null' ? -1 : 0))
    .join(' | ');
  return base || (schema.properties ? 'object' : 'any');
}

function limits(schema: Schema): string[] {
  const notes: string[] = [];
  if (schema.minimum !== undefined && schema.maximum !== undefined) notes.push(`${schema.minimum}–${schema.maximum}`);
  else if (schema.minimum !== undefined) notes.push(`≥ ${schema.minimum}`);
  else if (schema.maximum !== undefined) notes.push(`≤ ${schema.maximum}`);
  if (schema.minLength !== undefined || schema.maxLength !== undefined) {
    notes.push(`${schema.minLength ?? 0}–${schema.maxLength ?? '∞'} chars`);
  }
  if (schema.pattern) notes.push(`matches ${schema.pattern}`);
  if (schema.default !== undefined) notes.push(`default ${JSON.stringify(schema.default)}`);
  return notes;
}

/** The object an array holds, or the object itself — the thing whose fields are worth listing. */
function fieldsOf(input: Schema): Schema | null {
  const schema = flatten(input);
  if (schema.properties) return schema;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes('array') && schema.items) return fieldsOf(schema.items);
  const object = schema.anyOf?.find((member) => flatten(member).properties);
  return object ? flatten(object) : null;
}

export function SchemaTree({ schema, depth = 0 }: { schema: Schema; depth?: number }) {
  const object = fieldsOf(schema);
  if (!object?.properties) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        {typeLabel(schema)}
        {constants(schema) ? `: ${constants(schema)!.map((value) => JSON.stringify(value)).join(', ')}` : ''}
      </p>
    );
  }
  const required = new Set(object.required ?? []);
  return (
    <ul className={depth > 0 ? 'mt-2 border-l border-border pl-4' : 'divide-y divide-border/60'}>
      {Object.entries(object.properties).map(([name, field]) => {
        const values = constants(field);
        const nested = depth < 3 ? fieldsOf(field) : null;
        const notes = limits(field);
        return (
          <li key={name} className="py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <code className="font-mono text-sm font-semibold text-foreground">{name}</code>
              <span className="font-mono text-xs text-muted-foreground">{typeLabel(field)}</span>
              {required.has(name) ? (
                <span className="rounded-full bg-destructive-soft px-1.5 py-px text-[0.6875rem] font-semibold text-destructive">
                  required
                </span>
              ) : null}
              {notes.length ? (
                <span className="font-mono text-[0.6875rem] text-muted-foreground">{notes.join(' · ')}</span>
              ) : null}
            </div>
            {field.description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                <Rich text={field.description} />
              </p>
            ) : null}
            {values ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {values.map((value) => (
                  <code
                    key={String(value)}
                    className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-foreground"
                  >
                    {String(value)}
                  </code>
                ))}
              </div>
            ) : null}
            {nested?.properties ? <SchemaTree schema={nested} depth={depth + 1} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
