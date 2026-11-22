import type { Metadata } from 'next';
import { CONTACT_EMAIL, LegalPage } from '../../components/legal-page';

export const metadata: Metadata = {
  title: 'Delete your Garaj account',
  description: 'How to delete your Garaj account and what is deleted with it.',
  alternates: { canonical: '/delete-account' },
};

/**
 * The deletion page Google Play asks for: how to delete the account from inside the app, and
 * from outside it for someone who no longer has the app installed.
 */
export default function DeleteAccountPage() {
  return (
    <LegalPage title="Delete your Garaj account" updated="18 November 2026">
      <h2>In the mobile app</h2>
      <p>
        Open <strong>You</strong> (your picture at the top of the Garage screen) →{' '}
        <strong>Account</strong> → <strong>Delete account</strong>, and confirm.
      </p>

      <h2>On the web</h2>
      <p>
        Sign in at the Garaj web app, open <strong>Settings</strong> → <strong>Account</strong>, and
        delete it there.
      </p>

      <h2>Without signing in</h2>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address on the
        account and ask for it to be deleted. We will confirm it is yours, delete it, and reply once
        it is done.
      </p>

      <h2>What is deleted</h2>
      <ul>
        <li>Your account: name, email, password and preferences.</li>
        <li>
          Every garage you own and everything in it — vehicles, entries, expenses, income,
          reminders, tasks, documents and photos, including the stored files.
        </li>
        <li>Your notifications and the push tokens of your phones.</li>
        <li>A plan you pay for on the web is cancelled.</li>
      </ul>
      <p>
        Garages owned by someone else are theirs, so the entries you added there stay. Deletion
        cannot be undone — export your data first (Settings → Data) if you want a copy.
      </p>

      <h2>A subscription bought in the app</h2>
      <p>
        Deleting the account does not stop a subscription bought through Google Play or the App
        Store. Cancel it in the store first: in Google Play, <strong>Profile</strong> →{' '}
        <strong>Payments &amp; subscriptions</strong> → <strong>Subscriptions</strong> → Garaj →{' '}
        <strong>Cancel</strong>.
      </p>
    </LegalPage>
  );
}
