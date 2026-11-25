'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Button, Field } from '@/components/ui/primitives';

/**
 * Asking for a reset link. The answer is the same whether or not the address has an account —
 * a different one would make this form a way to find out who uses Garaj.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.requestPasswordReset({ email: email.trim() });
      if (result.error) setError(result.error.message ?? 'Could not send the link.');
      else setSent(true);
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        {sent ? (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            If {email.trim()} has a Garaj account, a link to choose a new password is on its way. It
            works for an hour.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Enter the email you sign in with and we&apos;ll send you a link.
            </p>
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="primary" loading={busy} className="mt-2 w-full">
              Send link
            </Button>
          </form>
        )}
        <p className="mt-6 text-sm text-muted-foreground">
          <Link href="/sign-in" className="rounded text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
