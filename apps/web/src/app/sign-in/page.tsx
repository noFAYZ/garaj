'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signIn } from '@/lib/auth-client';
import Image from 'next/image';
import logoText from '@/public/logo-text.png';
import logoTextLight from '@/public/logo-text-light.png';
import { FullScreenStatus } from '@/components/ui/full-screen-status';
import { Button, Field } from '@/components/ui/primitives';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  /*
   * What the screen says while the session changes, held until this page is replaced.
   *
   * It starts with the press, not with the answer: checking the credentials is the slow part, and
   * a form sitting still through it looked like nothing had happened, then a jump.
   */
  const [phase, setPhase] = useState<'idle' | 'checking' | 'arriving'>('idle');
  const busy = phase !== 'idle';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPhase('checking');
    setError(null);

    try {
      const result = await signIn.email({ email, password });

      if (result.error) {
        /*
         * The provider's message, unchanged. It deliberately does not distinguish "no such
         * account" from "wrong password" — telling them apart turns the form into a way to
         * discover which email addresses have accounts.
         */
        setError(result.error.message ?? 'Could not sign in.');
        setPhase('idle');
        return;
      }

      setPhase('arriving');
      router.replace('/');
    } catch {
      // The API was unreachable, so there is no provider message to show — without this the
      // button stays disabled on "Signing in…" and the form is dead until a reload.
      setError('Could not reach the server. Try again.');
      setPhase('idle');
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      {busy ? (
        <FullScreenStatus
          message={phase === 'arriving' ? 'Taking you to your garage…' : 'Signing you in…'}
        />
      ) : null}
      <div className="w-full max-w-sm">
        {/* The wordmark per theme: black type on paper, white type on carbon. */}
        <h1>
          <span className="sr-only">Garaj</span>
          <Image src={logoText} alt="" priority className="h-11 w-auto dark:hidden" />
          <Image src={logoTextLight} alt="" priority className="hidden h-11 w-auto dark:block" />
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your vehicles. Their entire story. One place.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {/* Announced when it appears, rather than only being visible. */}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" variant="primary" loading={busy} className="mt-2 w-full">
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-sm text-muted-foreground">
          No account?{' '}
          <Link href="/sign-up" className="rounded text-foreground underline underline-offset-4">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
