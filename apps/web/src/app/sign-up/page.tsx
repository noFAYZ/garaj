'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signUp } from '@/lib/auth-client';
import { FullScreenStatus } from '@/components/ui/full-screen-status';
import { Button, Field } from '@/components/ui/primitives';

/** Matches the API's Better Auth configuration; a shorter one is rejected server-side. */
const MIN_PASSWORD_LENGTH = 12;

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // From the press, not from the answer — see the note in the sign-in page.
  const [phase, setPhase] = useState<'idle' | 'creating' | 'arriving'>('idle');
  const busy = phase !== 'idle';

  // Checked here purely to save a round trip; the server enforces it regardless.
  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (passwordTooShort) return;

    setPhase('creating');
    setError(null);

    const result = await signUp.email({ name, email, password });

    if (result.error) {
      setError(result.error.message ?? 'Could not create your account.');
      setPhase('idle');
      return;
    }

    setPhase('arriving');
    router.replace('/');
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      {busy ? (
        <FullScreenStatus
          message={phase === 'arriving' ? 'Setting up your garage…' : 'Creating your account…'}
        />
      ) : null}
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Create your garage</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Start recording everything about your vehicles.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <Field
            label="Name"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
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
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            error={passwordTooShort ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
          />

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={passwordTooShort}
            className="mt-2 w-full"
          >
            Create account
          </Button>
        </form>

        <p className="mt-6 text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/sign-in" className="rounded text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
