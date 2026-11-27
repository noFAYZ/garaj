import type { Metadata } from 'next';
import { LegalPage } from '../../components/legal-page';
import { BRAND, CONTACT_EMAIL, pageMetadata } from '../../site';

export const metadata: Metadata = pageMetadata(
  '/delete-account',
  'Delete your account',
  `How to delete your ${BRAND} account, in the app, on the web or by email, and exactly what is deleted with it.`,
);

const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

/**
 * The deletion page Google Play asks for: how to delete the account from inside the app, and
 * from outside it for someone who no longer has the app installed.
 */
export default function DeleteAccountPage() {
  return (
    <LegalPage
      title="Delete your account"
      path="/delete-account"
      intro={`Three ways to delete your ${BRAND} account, and what goes with it.`}
    >
      <h2 id="app">In the app</h2>
      <ol>
        <li>
          Open <strong>You</strong>: your picture at the top of the Garage screen.
        </li>
        <li>
          Tap <strong>Account</strong> → <strong>Delete account</strong>, and confirm.
        </li>
      </ol>

      <h2 id="web">On the web</h2>
      <p>
        Sign in to the {BRAND} web app, open <strong>Settings</strong> → <strong>Account</strong>,
        and delete it there.
      </p>

      <h2 id="email">Without signing in</h2>
      <p>
        Email {mail} from the address on the account and ask for it to be deleted. We will confirm
        it is yours, delete it within 30 days, and reply once it is done.
      </p>

      <h2 id="what">What is deleted</h2>
      <ul>
        <li>Your account: name, email, password and settings.</li>
        <li>
          Every garage you own and everything in it: vehicles, entries, expenses, income, parts,
          reminders, tasks, documents and photos, including the stored files.
        </li>
        <li>Your notifications and your phones’ push tokens.</li>
        <li>A plan you pay for on the web is cancelled.</li>
      </ul>
      <p>
        Garages owned by someone else are theirs, so the entries you added there stay. Backups roll
        off within 30 days. Deletion cannot be undone, so export your data first (Settings → Your
        data) if you want a copy.
      </p>

      <h2 id="subscription">A subscription bought in the app</h2>
      <p>
        Deleting the account does not stop a subscription bought through Google Play or the App
        Store. Cancel it in the store first: in Google Play, <strong>Profile</strong> →{' '}
        <strong>Payments &amp; subscriptions</strong> → <strong>Subscriptions</strong>; on an
        iPhone, <strong>Settings</strong> → your name → <strong>Subscriptions</strong>.
      </p>
    </LegalPage>
  );
}
