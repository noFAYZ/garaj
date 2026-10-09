import { API_URL, anchorOf, displayPath, type Operation, type Schema } from '../lib/openapi';
import { CodeBlock, MethodBadge } from './code';
import { Rich } from './rich';
import { SchemaTree, typeLabel } from './schema';

const SAMPLE_ID = '01a0cbbf-7559-7fdb-ab85-30239994e86b';

/** A plausible value for a schema, required fields only, so an example stays short and valid. */
function exampleOf(schema: Schema | undefined, depth = 0): unknown {
  if (!schema || depth > 3) return null;
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((part) => exampleOf(part, depth)));
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf) {
    const first = schema.anyOf.find((member) => member.type !== 'null') ?? schema.anyOf[0];
    return exampleOf(first, depth);
  }
  if (schema.default !== undefined) return schema.default;
  const type = Array.isArray(schema.type) ? schema.type.find((entry) => entry !== 'null') : schema.type;
  switch (type) {
    case 'object': {
      const required = new Set(schema.required ?? []);
      return Object.fromEntries(
        Object.entries(schema.properties ?? {})
          .filter(([name]) => required.has(name) && name !== 'id')
          .map(([name, field]) => [name, exampleOf(field, depth + 1)]),
      );
    }
    case 'array':
      return [exampleOf(schema.items, depth + 1)];
    case 'integer':
      return schema.minimum ?? 1;
    case 'number':
      return 1.5;
    case 'boolean':
      return true;
    case 'string':
      if (schema.format === 'uuid') return SAMPLE_ID;
      if (schema.format === 'date-time') return '2026-09-23T09:30:00.000Z';
      if (schema.format === 'date') return '2026-09-23';
      if (schema.pattern === '^[A-Z]{3}$') return 'EUR';
      return 'string';
    default:
      return null;
  }
}

function curlOf(operation: Operation, body: Schema | undefined): string {
  const path = operation.path.replace(/\{(\w+)\}/g, (_, name: string) => `<${name}>`);
  const lines = [`curl -X ${operation.method.toUpperCase()} "${API_URL}${displayPath(path)}"`];
  lines.push('  -H "Authorization: Bearer $GARAJ_API_KEY"');
  if (body) {
    lines.push('  -H "Content-Type: application/json"');
    lines.push(`  -d '${JSON.stringify(exampleOf(body))}'`);
  }
  return lines.join(' \\\n');
}

/** One operation, complete: what it does, what it takes, what it returns, and how to call it. */
export function Endpoint({ operation }: { operation: Operation }) {
  const body = operation.requestBody?.content?.['application/json']?.schema;
  const parameters = operation.parameters ?? [];
  const responses = Object.entries(operation.responses ?? {});
  const success = responses.filter(([code]) => code.startsWith('2'));
  const failures = responses.map(([code]) => code).filter((code) => !code.startsWith('2'));
  const open = Array.isArray(operation.security) && operation.security.length === 0;

  return (
    <section
      id={anchorOf(operation)}
      className="scroll-mt-20 rounded-3xl bg-card/60 p-2"
      aria-labelledby={`${anchorOf(operation)}-title`}
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <MethodBadge method={operation.method} />
            <code className="min-w-0 break-all font-mono text-sm font-semibold text-foreground">
              {displayPath(operation.path)}
            </code>
            {open ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-semibold text-muted-foreground">
                No key needed
              </span>
            ) : null}
          </div>
          <h3 id={`${anchorOf(operation)}-title`} className="text-lg font-semibold tracking-tight text-foreground">
            <a href={`#${anchorOf(operation)}`} className="hover:underline hover:underline-offset-4">
              {operation.summary ?? `${operation.method.toUpperCase()} ${displayPath(operation.path)}`}
            </a>
          </h3>
          {operation.description ? (
            <p className="max-w-prose text-sm text-muted-foreground"><Rich text={operation.description} />
            </p>
          ) : null}
        </div>

        {parameters.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-label uppercase text-muted-foreground">Parameters</p>
            <div className="scrollbar-slim overflow-x-auto rounded-xl bg-background">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-border/60">
                  {parameters.map((parameter) => (
                    <tr key={`${parameter.in}-${parameter.name}`}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold text-foreground">
                        {parameter.name}
                        {parameter.required ? <span className="text-destructive"> *</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">
                        {parameter.in}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {parameter.schema ? typeLabel(parameter.schema) : ''}
                        {parameter.description ? (
                          <span className="block font-sans text-sm">{parameter.description}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {body ? (
          <div className="flex flex-col gap-1">
            <p className="text-label uppercase text-muted-foreground">Request body</p>
            <SchemaTree schema={body} />
          </div>
        ) : null}

        {success.map(([code, response]) => {
          const schema = response.content?.['application/json']?.schema;
          return (
            <details key={code} className="group rounded-xl bg-background">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm">
                <span className="rounded-md bg-success-soft px-1.5 py-0.5 font-mono text-xs font-bold text-success">
                  {code}
                </span>
                <span className="font-semibold text-foreground">Response</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {schema ? typeLabel(schema) : 'empty'}
                </span>
                <span className="ml-auto text-muted-foreground transition-transform group-open:rotate-180">
                  ⌄
                </span>
              </summary>
              {schema ? (
                <div className="px-3 pb-3">
                  <SchemaTree schema={schema} />
                </div>
              ) : null}
            </details>
          );
        })}

        {failures.length > 0 ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="text-label uppercase">Errors</span>
            {failures.map((code) => (
              <a
                key={code}
                href="/errors"
                className="rounded-md bg-muted px-1.5 py-0.5 font-mono font-semibold text-foreground hover:bg-border"
              >
                {code}
              </a>
            ))}
          </p>
        ) : null}
      </div>
      <CodeBlock code={curlOf(operation, body)} label="curl" />
    </section>
  );
}
