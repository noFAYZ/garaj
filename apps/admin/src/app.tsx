import { useQuery } from '@tanstack/react-query';
import { Component, useState, type FormEvent, type ReactNode } from 'react';
import { FullScreenStatus } from '@/components/ui/full-screen-status';
import { Button, EmptyState, Field } from '@/components/ui/primitives';
import { ApiError, authClient, get, type Overview } from './lib/api';
import { useActivity } from './lib/queries';
import { useRoute } from './lib/route';
import { useSignOut } from './lib/session';
import { CommandPalette } from './components/palette';
import { MobileHeader, Sidebar, Wordmark, type SessionUser } from './components/sidebar';
import { WorkingBar } from './components/working-bar';
import { OverviewPage } from './pages/overview';
import { UsersPage } from './pages/users';
import { GaragesPage } from './pages/garages';
import { VehiclesPage } from './pages/vehicles';
import { SettingsPage } from './pages/settings';
import { SystemPage } from './pages/system';
import { AnalyticsPage } from './pages/analytics';
import { LogsPage } from './pages/logs';

const PAGES: Record<string, () => React.JSX.Element> = {
  overview: OverviewPage,
  users: UsersPage,
  garages: GaragesPage,
  vehicles: VehiclesPage,
  analytics: AnalyticsPage,
  system: SystemPage,
  settings: SettingsPage,
  logs: LogsPage,
};

// --- The gate: signed in, then on the admin list, then the console.

export function App() {
  const session = authClient.useSession() as {
    data: { user: SessionUser } | null;
    isPending: boolean;
  };
  const user = session.data?.user ?? null;

  // The overview doubles as the access check: it is the first read, and a 403 here is the answer.
  const access = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => get<Overview>('/overview'),
    enabled: Boolean(user),
  });

  if (session.isPending) return <FullScreenStatus message="Opening the console…" />;
  if (!user) return <SignIn />;
  if (access.isPending) return <FullScreenStatus message="Checking your access…" />;
  if (access.error instanceof ApiError && access.error.status === 403)
    return <NotAdmin user={user} />;
  return <Shell user={user} />;
}

function GateFrame({ children }: { children: ReactNode }) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-4">
      <div aria-hidden="true" className="drafting pointer-events-none absolute inset-0" />
      <div className="relative flex w-full max-w-sm animate-rise flex-col gap-8">{children}</div>
    </main>
  );
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result = await authClient.signIn.email({ email, password });
    // On success the session hook moves the gate on; this screen unmounts under the status.
    if (result.error) {
      setError(result.error.message ?? 'Those details did not match an account.');
      setPending(false);
    }
  };

  return (
    <GateFrame>
      {pending ? <FullScreenStatus message="Signing you in…" /> : null}
      <div className="flex items-center gap-2.5">
        <Wordmark />
        <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-label uppercase text-foreground">
          Admin
        </span>
      </div>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Sign in to the console</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your Garaj account. Access is limited to the ids in{' '}
          <code className="font-mono text-foreground">ADMIN_USER_IDS</code>.
        </p>
      </div>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error ?? undefined}
        />
        <Button type="submit" variant="primary" size="lg" className="mt-2" loading={pending}>
          Sign in
        </Button>
      </form>
    </GateFrame>
  );
}

function NotAdmin({ user }: { user: SessionUser }) {
  const { pending, signOut } = useSignOut();
  const [copied, setCopied] = useState(false);
  return (
    <GateFrame>
      {pending ? <FullScreenStatus message="Signing you out…" /> : null}
      <Wordmark />
      <EmptyState
        title="This account is not an admin"
        description={`Signed in as ${user.email}. To let it in, add its id to ADMIN_USER_IDS in the API's environment and restart the API.`}
        action={
          <div className="flex flex-col items-center gap-3">
            <code className="rounded-xl bg-muted px-3 py-2 font-mono text-xs break-all">
              {user.id}
            </code>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(user.id).then(() => setCopied(true));
                }}
              >
                {copied ? 'Copied' : 'Copy id'}
              </Button>
              <Button variant="ghost" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          </div>
        }
      />
    </GateFrame>
  );
}

// --- The console -----------------------------------------------------------------------------

function Shell({ user }: { user: SessionUser }) {
  const { section } = useRoute();
  const page = section in PAGES ? section : 'overview';
  const Page = PAGES[page]!;
  // Warm the shared reads every page leans on, so switching sections never starts cold.
  useActivity();

  return (
    <div className="min-h-dvh bg-background [--chrome:6.75rem] lg:[--chrome:0px]">
      <WorkingBar />
      <Sidebar page={page} user={user} />
      <MobileHeader page={page} user={user} />
      <main className="transition-[padding] duration-200 ease-[cubic-bezier(0.2,0.9,0.1,1)] lg:pl-[var(--sidebar-width)]">
        <div className="mx-auto flex max-w-[80rem] flex-col gap-6 px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-10">
          {/* Keyed so each section enters fresh, with its own rise — and a failed one recovers on leaving. */}
          <PageBoundary key={page}>
            <Page />
          </PageBoundary>
        </div>
      </main>
      <CommandPalette />
    </div>
  );
}

/**
 * A page that throws takes down only itself: the sidebar, search and every other page keep
 * working, and the error says what broke instead of leaving a blank console.
 */
class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState
        title="This page hit an error"
        description={this.state.error.message}
        action={<Button onClick={() => this.setState({ error: null })}>Try again</Button>}
      />
    );
  }
}
