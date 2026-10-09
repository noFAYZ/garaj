import { Fragment } from 'react';

/**
 * A description from the spec, with its `backticked` spans set as code — the only markup the API's
 * own descriptions use, so this is all the Markdown the docs need.
 */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, index) =>
        index % 2 === 1 ? (
          <code
            key={index}
            className="rounded-md bg-muted px-1 py-px font-mono text-[0.8125em] text-foreground"
          >
            {part}
          </code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
