import { Mail } from 'lucide-react';
import { useState } from 'react';
import { Button, EmptyState } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useEmails, type EmailPreview } from '../lib/queries';
import { href, useRoute } from '../lib/route';
import { Chip, PageHeader, Panel, Segmented } from '../components/ui';

type Theme = 'light' | 'dark';

/*
 * The emails' dark styles sit in one `prefers-color-scheme` block. Rewriting its condition pins the
 * preview to the chosen theme, whatever the console's own OS setting is.
 * ponytail: matches the template's exact media text; if the preview stops switching, look there.
 */
const pin = (html: string, theme: Theme) =>
  html.replace(
    '@media (prefers-color-scheme:dark)',
    theme === 'dark' ? '@media all' : '@media not all',
  );

export function EmailsPage() {
  const emails = useEmails();
  const { id } = useRoute();
  const [view, setView] = useState<'html' | 'text'>('html');
  const [theme, setTheme] = useState<Theme>('light');
  const [width, setWidth] = useState<'desktop' | 'phone'>('desktop');

  const list = emails.data ?? [];
  const current = list.find((email) => email.id === id) ?? list[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Configure"
        title="Emails"
        description="Every email Garajj sends, with sample content. The API renders them with the code that sends them."
      />

      {emails.isError ? (
        <EmptyState
          title="Couldn't load the emails"
          description={emails.error.message}
          action={<Button onClick={() => void emails.refetch()}>Try again</Button>}
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <nav aria-label="Emails" className="flex flex-col gap-5 stagger animate-rise [--i:1]">
            {emails.isPending
              ? Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-xl" />
                ))
              : (['Account', 'Reminder'] as const).map((kind) => (
                  <div key={kind} className="flex flex-col gap-1">
                    <p className="px-3 pb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {kind === 'Account' ? 'Account' : 'Reminders'}
                    </p>
                    {list
                      .filter((email) => email.kind === kind)
                      .map((email) => (
                        <EmailLink key={email.id} email={email} on={email.id === current?.id} />
                      ))}
                  </div>
                ))}
          </nav>

          {current ? (
            <Panel
              title={current.name}
              icon={Mail}
              className="stagger animate-rise [--i:2]"
              aside={<Chip tone={current.kind === 'Account' ? 'ink' : 'info'}>{current.kind}</Chip>}
            >
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Subject</dt>
                <dd className="font-semibold">{current.subject}</dd>
                <dt className="text-muted-foreground">Sent when</dt>
                <dd>{current.when}</dd>
              </dl>

              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  label="Version"
                  size="sm"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'html', label: 'Email' },
                    { value: 'text', label: 'Plain text' },
                  ]}
                />
                {view === 'html' ? (
                  <>
                    <Segmented
                      label="Theme"
                      size="sm"
                      value={theme}
                      onChange={setTheme}
                      options={[
                        { value: 'light', label: 'Light' },
                        { value: 'dark', label: 'Dark' },
                      ]}
                    />
                    <Segmented
                      label="Width"
                      size="sm"
                      value={width}
                      onChange={setWidth}
                      options={[
                        { value: 'desktop', label: 'Desktop' },
                        { value: 'phone', label: 'Phone' },
                      ]}
                    />
                  </>
                ) : null}
              </div>

              <div className="flex justify-center overflow-hidden rounded-xl bg-muted/40 p-3 sm:p-5">
                {view === 'html' ? (
                  <iframe
                    // Remounted per choice, so the height below is measured again.
                    key={`${current.id}-${theme}-${width}`}
                    title={`${current.name} preview`}
                    srcDoc={pin(current.html, theme)}
                    // No scripts in an email; same-origin only so the height can be read.
                    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                    onLoad={(event) => {
                      const doc = event.currentTarget.contentDocument;
                      if (doc)
                        event.currentTarget.style.height = `${doc.documentElement.scrollHeight}px`;
                    }}
                    className={cn(
                      'h-[40rem] rounded-lg border-0 shadow-sm',
                      width === 'phone' ? 'w-[375px] max-w-full' : 'w-full max-w-[680px]',
                    )}
                  />
                ) : (
                  <pre className="w-full max-w-[680px] whitespace-pre-wrap rounded-lg bg-card p-5 font-mono text-xs leading-relaxed">
                    {current.text}
                  </pre>
                )}
              </div>
            </Panel>
          ) : emails.isPending ? (
            <Skeleton className="h-[40rem] w-full rounded-2xl" />
          ) : null}
        </div>
      )}
    </div>
  );
}

function EmailLink({ email, on }: { email: EmailPreview; on: boolean }) {
  return (
    <a
      href={href('emails', email.id)}
      aria-current={on ? 'page' : undefined}
      className={cn(
        'flex flex-col gap-0.5 rounded-xl px-3 py-2.5 transition-colors',
        on ? 'bg-primary-soft' : 'hover:bg-muted/60',
      )}
    >
      <span className={cn('text-sm font-semibold', on ? 'text-foreground' : 'text-foreground/90')}>
        {email.name}
      </span>
      <span className="line-clamp-2 text-xs text-muted-foreground">{email.when}</span>
    </a>
  );
}
