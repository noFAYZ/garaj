import type { Metadata } from 'next';
import { CONTACT_EMAIL, LegalPage } from '../../components/legal-page';

export const metadata: Metadata = {
  title: 'Privacy policy — Garaj',
  description: 'What Garaj collects, why, who processes it, and how to delete it.',
  alternates: { canonical: '/privacy' },
};

/**
 * What the product actually does with data, written from the code: each processor named here
 * is one the API or the apps call. Change this page in the same change as a new one.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="18 November 2026">
      <p>
        Garaj keeps the history of the vehicles you own: services, costs, paperwork, photos and
        reminders. This page says what that involves, in plain terms. It covers the Garaj website,
        web app and mobile apps.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your name, email address and password (stored only as a
          one-way hash), and your preferences — units, currency, time zone, language.
        </li>
        <li>
          <strong>Your records:</strong> the vehicles, entries, expenses, income, reminders, tasks,
          documents and photos you add, and the people you share a garage with.
        </li>
        <li>
          <strong>Photos:</strong> location data inside a photo is removed when it is uploaded,
          unless you choose to keep it.
        </li>
        <li>
          <strong>Your phone, if you allow notifications:</strong> a push token, so reminders reach
          you, and which platform it is.
        </li>
        <li>
          <strong>Crash reports from the mobile app:</strong> what went wrong and on which version,
          so it can be fixed. They do not include your records.
        </li>
        <li>
          <strong>Purchases:</strong> which plan you bought and when. Card and payment details stay
          with the store or payment provider; we never see them.
        </li>
      </ul>
      <p>We do not sell your data, show advertising, or track you across other apps and sites.</p>

      <h2>Why</h2>
      <p>
        To run the product you asked for: to keep and show your records, send the reminders you set
        up, let the people you invite see a shared garage, take payment for a paid plan, and keep
        the service secure and working.
      </p>

      <h2>Who processes it for us</h2>
      <ul>
        <li>Hosting, database and file-storage providers, which hold the data for us.</li>
        <li>Resend, which sends our emails (reminders, password resets).</li>
        <li>Expo, Apple and Google, which deliver push notifications to your phone.</li>
        <li>
          Google Gemini, when you use an AI feature (asking a question, or reading a receipt or a
          vehicle photo) — only what that request contains is sent.
        </li>
        <li>
          A background-removal service, for your vehicle&apos;s main photo, so its card can show the
          vehicle on its own.
        </li>
        <li>
          Stripe, for a plan bought on the web; Google Play (and the App Store) with RevenueCat, for
          a plan bought in the mobile app.
        </li>
        <li>Sentry, for crash reports from the mobile app.</li>
        <li>
          The US NHTSA, when you look up a VIN or check for recalls — only the VIN or the vehicle is
          sent.
        </li>
      </ul>

      <h2>Keeping and deleting it</h2>
      <p>
        Your data is kept while your account exists. A document you delete can be restored for 30
        days, then it is removed for good. Deleting your account removes it, every garage you own
        and everything in them — records, documents and photos. Garages owned by someone else keep
        the records you added there.
      </p>
      <p>
        You can delete your account in the app (You → Account → Delete account) or on the web
        (Settings). See <a href="/delete-account">deleting your account</a> for how, and what it
        does. Deleting the account does not cancel a subscription bought through Google Play or the
        App Store — cancel that in the store.
      </p>

      <h2>Your rights</h2>
      <p>
        You can see and correct your data in the app, export it (Settings → Data), and delete it.
        For anything else — a copy of what we hold, a question, a complaint — email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Children</h2>
      <p>Garaj is not meant for children under 13, and we do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes in a way that matters, we will say so in the app before it applies.
        The date at the top shows when it last changed.
      </p>
    </LegalPage>
  );
}
