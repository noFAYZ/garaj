import type { Metadata } from 'next';
import { EndpointIndex } from '../../components/endpoint-index';
import { PageHead, Unavailable } from '../../components/page';
import { anchorOf, chapters, displayPath, loadSpec, titleOf } from '../../lib/openapi';

export const metadata: Metadata = { title: 'API reference' };
export const revalidate = 300;

export default async function Reference() {
  const spec = await loadSpec();

  return (
    <div className="flex flex-col gap-8">
      <PageHead
        eyebrow="API reference"
        title="Every endpoint"
        lead="Read live from the running API's OpenAPI document — generated from the schemas the server validates against, so it cannot fall behind."
      />
      {!spec.ok ? (
        <Unavailable reason={spec.reason} />
      ) : (
        <EndpointIndex
          rows={chapters(spec.value).flatMap((chapter) =>
            chapter.operations.map((operation) => ({
              href: `/reference/${chapter.slug}#${anchorOf(operation)}`,
              method: operation.method,
              path: displayPath(operation.path),
              summary: operation.summary ?? '',
              chapter: titleOf(chapter.tag.name),
            })),
          )}
        />
      )}
    </div>
  );
}
