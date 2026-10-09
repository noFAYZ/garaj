import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MethodBadge } from '../../../components/code';
import { Endpoint } from '../../../components/endpoint';
import { PageHead, Unavailable } from '../../../components/page';
import { Rich } from '../../../components/rich';
import { anchorOf, chapters, displayPath, loadSpec, titleOf } from '../../../lib/openapi';

export const revalidate = 300;

type Props = { params: Promise<{ tag: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params;
  return { title: titleOf(tag) };
}

/** One area of the API: its operations listed at the top, then each in full. */
export default async function Chapter({ params }: Props) {
  const { tag } = await params;
  const spec = await loadSpec();
  if (!spec.ok) return <Unavailable reason={spec.reason} />;

  const chapter = chapters(spec.value).find((candidate) => candidate.slug === tag);
  if (!chapter) notFound();

  return (
    <div className="flex flex-col gap-8">
      <PageHead
        eyebrow={`API reference · ${String(chapter.operations.length).padStart(2, '0')} endpoints`}
        title={titleOf(chapter.tag.name)}
        lead={<Rich text={chapter.tag.description ?? ''} />}
      />

      <nav aria-label="On this page" className="rounded-2xl bg-card/60 p-2">
        <ul className="flex flex-col">
          {chapter.operations.map((operation) => (
            <li key={anchorOf(operation)}>
              <Link
                href={`#${anchorOf(operation)}`}
                className="flex min-w-0 items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-card"
              >
                <MethodBadge method={operation.method} small />
                <code className="min-w-0 truncate font-mono text-sm text-foreground">
                  {displayPath(operation.path)}
                </code>
                <span className="hidden min-w-0 flex-1 truncate text-right text-sm text-muted-foreground sm:block">
                  {operation.summary}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-6">
        {chapter.operations.map((operation) => (
          <Endpoint key={anchorOf(operation)} operation={operation} />
        ))}
      </div>
    </div>
  );
}
