'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { AiAnswer } from '@vehicle-os/contracts';
import { api } from '@/lib/api';
import { ASK_EXAMPLES } from '@/components/ask-console';
import { Icon } from '@/components/icons';
import { Button, SectionCard, TileRow } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { humanise } from '@/lib/format';

/**
 * Natural-language questions (PRD §35).
 *
 * The sources are shown, not hidden behind a disclosure: an answer built from records the
 * reader can name is checkable, and one that arrives bare is a claim they have to take on
 * trust. It is also the only visible difference between this and a chatbot guessing.
 */
export default function AskPage() {
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);

  const ask = useMutation<AiAnswer, Error, string>({
    mutationFn: (value) => api.ai.ask({ question: value }),
  });

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 3) return;
    setQuestion(trimmed);
    setAsked(trimmed);
    ask.mutate(trimmed);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Ask</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Answered from your own records — never from what a model assumes about the make.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(question);
        }}
        className="flex gap-2"
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What has the M3 cost me this year?"
          aria-label="Your question"
          maxLength={500}
          className="h-11 min-w-0 flex-1 rounded-xl bg-input px-4 text-sm text-foreground placeholder:text-muted-foreground"
        />
        <Button type="submit" variant="primary" loading={ask.isPending} className="h-11 shrink-0">
          Ask
        </Button>
      </form>

      {/* The examples stay until something has been asked — after that they are clutter. */}
      {!asked ? (
        <div className="flex flex-wrap gap-2">
          {ASK_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => submit(example)}
              className="rounded-full bg-card/50 px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {ask.isPending ? (
        <SectionCard>
          <div role="status" aria-live="polite" className="flex flex-col gap-2">
            <span className="sr-only">Working out the answer</span>
            <Skeleton className="h-4 w-full" aria-hidden="true" />
            <Skeleton className="h-4 w-11/12" aria-hidden="true" />
            <Skeleton className="h-4 w-2/3" aria-hidden="true" />
          </div>
        </SectionCard>
      ) : null}

      {ask.isError ? (
        <SectionCard>
          <p role="alert" className="text-sm text-destructive">
            {ask.error.message}
          </p>
        </SectionCard>
      ) : null}

      {ask.data ? (
        <SectionCard>
          <p className="text-label uppercase text-muted-foreground">{asked}</p>
          <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-foreground">
            {ask.data.answer}
          </p>

          {ask.data.sources.length > 0 ? (
            <div className="mt-6">
              <h2 className="text-label uppercase text-muted-foreground">Read from</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {ask.data.sources.map((source, index) => (
                  <li key={`${source.tool}-${index}`}>
                    <TileRow
                      accent="primary"
                      leading={<Icon name="info" size={16} />}
                      title={humanise(source.tool.replace(/^get_/, ''))}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-4 text-xs text-muted-foreground">Answered by {ask.data.model}.</p>
        </SectionCard>
      ) : null}
    </div>
  );
}
