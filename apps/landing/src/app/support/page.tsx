import type { Metadata } from 'next';
import { LegalPage } from '../../components/legal-page';
import { BRAND, CONTACT_EMAIL, pageMetadata } from '../../site';

export const metadata: Metadata = pageMetadata(
  '/support',
  'Support',
  `Get help with ${BRAND}: contact us, reset a password, restore or cancel a subscription, export your data or delete your account.`,
);

const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

/** The support page the App Store asks for: a way to reach a person, and the common answers. */
export default function SupportPage() {
  return (
    <LegalPage
      title="Support"
      path="/support"
      intro={`Stuck, or found a bug? Email ${CONTACT_EMAIL} and a person will answer.`}
    >
      <h2 id="contact">Contact us</h2>
      <p>
        Email {mail}. To help us help you, say which phone or browser you use and the app version
        (at the foot of <strong>You</strong>, in the app), and add a screenshot if you can.
      </p>

      <h2 id="password">I forgot my password</h2>
      <p>
        On the sign-in screen, tap <strong>Forgot your password?</strong> and enter your email. The
        link we send works for an hour.
      </p>

      <h2 id="restore">I paid, but the app shows the Free plan</h2>
      <p>
        Open the plans screen and tap <strong>Restore</strong>, signed in with the same Google Play
        or Apple account you paid with. A plan bought on the web shows once you sign in with the
        same {BRAND} account.
      </p>

      <h2 id="cancel">Cancel a subscription</h2>
      <ul>
        <li>
          <strong>Google Play:</strong> Play Store → Profile → Payments &amp; subscriptions →
          Subscriptions → {BRAND} → Cancel.
        </li>
        <li>
          <strong>iPhone:</strong> Settings → your name → Subscriptions → {BRAND} → Cancel.
        </li>
        <li>
          <strong>Web:</strong> Settings → Plan and billing.
        </li>
      </ul>
      <p>
        You keep the plan until the end of the period you paid for. See the{' '}
        <a href="/terms#plans">terms</a> for renewals and refunds.
      </p>

      <h2 id="reminders">Reminders don’t arrive</h2>
      <p>
        Check that notifications for {BRAND} are on in your phone’s settings, and that the reminder
        has a date or distance set. On Android, battery savers can delay notifications: let {BRAND}{' '}
        run in the background.
      </p>

      <h2 id="export">Export my data</h2>
      <p>
        <strong>You</strong> → <strong>Your data</strong>: CSV, JSON or a PDF report, on every plan.
      </p>

      <h2 id="delete">Delete my account</h2>
      <p>
        See <a href="/delete-account">deleting your account</a>, in the app, on the web or by email.
      </p>
    </LegalPage>
  );
}
