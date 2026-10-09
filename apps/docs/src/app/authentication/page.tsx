import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock } from '../../components/code';
import { Callout, PageHead, Prose, Section } from '../../components/page';
import { API_URL, APP_URL } from '../../lib/openapi';

export const metadata: Metadata = { title: 'Authentication' };

export default function Authentication() {
  return (
    <div className="flex flex-col gap-12">
      <PageHead
        eyebrow="Guides · Authentication"
        title="Personal API keys"
        lead="A key acts as you: in every garage you belong to, with your role in each. It is how a script, an integration or an AI client reaches your records without your password."
      />

      <Section title="Send the key" id="send">
        <Prose>
          <p>
            Every request carries it as a bearer token. Keys start with <code>gk_</code>, so a secret
            scanner — or you, reading a log — can tell one apart from anything else.
          </p>
        </Prose>
        <CodeBlock code={`Authorization: Bearer gk_…`} label="header" />
        <CodeBlock
          code={`const response = await fetch('${API_URL}/api/v1/vehicles', {
  headers: { Authorization: \`Bearer \${process.env.GARAJ_API_KEY}\` },
});
const { data: vehicles } = await response.json();`}
          label="JavaScript"
        />
        <CodeBlock
          code={`import os, requests

response = requests.get(
    "${API_URL}/api/v1/vehicles",
    headers={"Authorization": f"Bearer {os.environ['GARAJ_API_KEY']}"},
)
vehicles = response.json()["data"]`}
          label="Python"
        />
      </Section>

      <Section title="Create, rotate, revoke" id="manage">
        <Prose>
          <p>
            Keys are made in <strong>Settings → API &amp; MCP</strong>, named for what they are for,
            and can expire after 30, 90 or 365 days — or last until revoked. The key is shown{' '}
            <strong>once</strong>; Garaj keeps only a hash of it, so a lost key is replaced, not
            recovered.
          </p>
          <p>
            Revoking takes effect at once. To rotate, create the new key, switch the client over,
            then revoke the old one. The list shows when each key was last used, so a key nothing
            uses any more is easy to spot.
          </p>
        </Prose>
        <Callout tone="warning">
          A key cannot create or revoke keys — that takes you, signed in. So a leaked key can never
          mint its own replacement, and revoking it always ends it.
        </Callout>
        <a href={`${APP_URL}/settings`} className="w-fit text-sm font-semibold text-foreground underline-offset-4 hover:underline">
          Manage your keys →
        </a>
      </Section>

      <Section title="What a key can do" id="scope">
        <Prose>
          <p>
            Exactly what you can do in the app — no more. Your role in each garage still decides:
            a viewer&apos;s key reads, an owner&apos;s key can also change settings. Your plan&apos;s limits apply
            the same way, and every change a key makes is written to the garage&apos;s audit log as you.
          </p>
          <p>
            The key endpoints themselves are in the{' '}
            <Link href="/reference/api-keys" className="font-semibold text-foreground underline-offset-4 hover:underline">
              reference
            </Link>
            .
          </p>
        </Prose>
      </Section>
    </div>
  );
}
