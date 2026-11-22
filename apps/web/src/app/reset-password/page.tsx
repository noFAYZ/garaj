'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Button, Field } from '@/components/ui/primitives';

/** Same floor as the API (`minPasswordLength`), checked here so the form can say it first. */
const MIN_LENGTH = 12;

/**
 * Where the reset email lands — from the web or the phone, since the phone has no page of its
 * own to choose a password on. Setting one signs out every other session, so whoever knew the
 * old password is out too; the person then signs in wherever they started.
 */
export default function ResetPasswordPage() {
  return (
    // `useSearchParams` reads the token on the client; the boundary lets the page prerender.
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const token = useSearchParams().get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords are different.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(
          result.error.code === 'INVALID_TOKEN'
            ? 'This link has expired or was already used. Ask for a new one.'
            : (result.error.message ?? 'Could not change the password.'),
        );
      } else {
        setDone(true);
      }
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        {done ? (
          <>
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              Done. Sign in with your new password — on the web, or back in the Garaj app.
            </p>
            <Link
              href="/sign-in"
              className="mt-6 inline-block rounded text-sm text-foreground underline underline-offset-4"
            >
              Sign in
            </Link>
          </>
        ) : !token ? (
          <p className="mt-3 text-sm text-muted-foreground">
            This page opens from the link in a reset email.{' '}
            <Link href="/forgot-password" className="text-foreground underline underline-offset-4">
              Ask for one
            </Link>
            .
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <Field
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Field
              label="Again"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}{' '}
                {error.startsWith('This link') ? (
                  <Link href="/forgot-password" className="underline underline-offset-4">
                    New link
                  </Link>
                ) : null}
              </p>
            ) : null}
            <Button type="submit" variant="primary" loading={busy} className="mt-2 w-full">
              Set password
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
