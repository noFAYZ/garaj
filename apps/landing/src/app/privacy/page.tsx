import type { Metadata } from 'next';
import { LegalPage } from '../../components/legal-page';
import { BRAND, CONTACT_EMAIL, pageMetadata } from '../../site';

export const metadata: Metadata = pageMetadata(
  '/privacy',
  'Privacy policy',
  `What ${BRAND} collects, why, who processes it for us, how long it is kept, and how to see, export or delete it.`,
);

const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

/**
 * What the product actually does with data, written from the code: each processor named here is
 * one the API or the apps call. Change this page in the same change as a new one, and keep it in
 * step with the Data safety form in Play Console and the App Privacy answers in App Store Connect.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      path="/privacy"
      intro={`${BRAND} keeps the history of the vehicles you own. This is what that involves, in plain words.`}
    >
      <h2 id="who">Who we are</h2>
      <p>
        {BRAND} (“we”) runs the {BRAND} mobile apps for Android and iOS, the web app and this
        website. This policy covers all of them. Questions about it, or about your data, go to{' '}
        {mail}.
      </p>

      <h2 id="collect">What we collect</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your name, email address and password (stored only as a
          one-way hash), and your settings: units, currency, time zone and language.
        </li>
        <li>
          <strong>Your records:</strong> the vehicles, entries, fill-ups, expenses, income, trips,
          parts, reminders, tasks, documents and photos you add, and the people you share a garage
          with.
        </li>
        <li>
          <strong>Photos and documents:</strong> only the ones you choose to add. Location data
          inside a photo is removed when it is uploaded, unless you choose to keep it.
        </li>
        <li>
          <strong>Your phone, if you allow notifications:</strong> a push token, so reminders reach
          you, and which platform it is.
        </li>
        <li>
          <strong>Crash reports from the mobile app:</strong> what went wrong, on which version and
          which kind of device, so it can be fixed. They do not contain your records.
        </li>
        <li>
          <strong>Purchases:</strong> which plan you bought, when, and when it renews. Card and
          payment details stay with Google Play, the App Store or Stripe; we never see them.
        </li>
        <li>
          <strong>Messages you send us</strong>, such as a support email, and our replies.
        </li>
      </ul>

      <h2 id="permissions">What the app asks to use</h2>
      <ul>
        <li>
          <strong>Camera and photos:</strong> to photograph a receipt, a document or your vehicle,
          only when you choose to.
        </li>
        <li>
          <strong>Notifications:</strong> to send the reminders you set up.
        </li>
      </ul>
      <p>
        The app does not use your location, contacts or microphone. You can turn any permission off
        in your phone’s settings; the rest of the app keeps working.
      </p>

      <h2 id="not">What we don’t do</h2>
      <p>
        We do not sell your data, show advertising, use advertising or analytics trackers, or track
        you across other apps and websites.
      </p>

      <h2 id="why">Why we use it</h2>
      <ul>
        <li>To run the service you signed up for: keep and show your records, and sync them.</li>
        <li>To send the reminders, emails and notifications you set up.</li>
        <li>To let the people you invite see a shared garage.</li>
        <li>To take payment for a paid plan, and to answer you when you write to us.</li>
        <li>To keep the service secure, fix crashes and prevent abuse.</li>
      </ul>
      <p>
        Where the law asks for a legal basis, it is the contract with you (running the service), our
        legitimate interest in keeping it secure and working, or your consent (notifications and
        device permissions, which you can withdraw at any time).
      </p>

      <h2 id="processors">Who processes it for us</h2>
      <ul>
        <li>Hosting, database and file-storage providers, which hold the data for us.</li>
        <li>Resend, which sends our emails (reminders and password resets).</li>
        <li>
          Expo, Google (Firebase Cloud Messaging) and Apple, which deliver push notifications.
        </li>
        <li>
          Google Gemini, when you use an AI feature (asking a question, or reading a receipt, a
          one-line entry or a vehicle photo). Only what that request contains is sent.
        </li>
        <li>
          Stripe, for a plan bought on the web; Google Play and the App Store, with RevenueCat, for
          a plan bought in the app. RevenueCat receives your account’s ID and the store’s receipt.
        </li>
        <li>Sentry, for crash reports from the mobile app.</li>
        <li>
          The US National Highway Traffic Safety Administration (NHTSA), when a VIN is looked up or
          recalls are checked: only the VIN, or the make, model and year, is sent.
        </li>
        <li>
          logo.dev and flagcdn.com, which serve car makers’ logos and currency flags to the app.
          They receive the name of the make or currency and your device’s IP address, as any image
          request does, and nothing else.
        </li>
      </ul>
      <p>
        Each of them may only use the data to provide their service to us. Some of them are in the
        United States or other countries outside yours; where that applies, the transfer is covered
        by the safeguards they offer, such as standard contractual clauses.
      </p>

      <h2 id="security">Keeping it safe</h2>
      <p>
        Everything travels over encrypted connections (HTTPS). Passwords are stored only as one-way
        hashes, and access to production data is limited to what running the service needs. Files
        you upload are served through short-lived signed links.
      </p>

      <h2 id="retention">How long we keep it</h2>
      <p>
        Your data is kept while your account exists. A document you delete can be restored for 30
        days, then it is removed for good. Crash reports are kept for up to 90 days. Deleting your
        account deletes it, every garage you own and everything in them: records, documents and
        photos. Garages owned by someone else keep the entries you added there. Backups roll off
        within 30 days.
      </p>
      <p>
        Delete your account in the app (<strong>You</strong> → <strong>Account</strong> →{' '}
        <strong>Delete account</strong>) or on the web (<strong>Settings</strong>). See{' '}
        <a href="/delete-account">deleting your account</a> for every way, including without signing
        in. Deleting the account does not cancel a subscription bought through Google Play or the
        App Store: cancel that in the store.
      </p>

      <h2 id="rights">Your rights</h2>
      <p>
        Wherever you live, you can see and correct your data in the app, export it at any time
        (Settings → Your data: CSV, JSON or PDF), and delete it. You can also ask us for a copy of
        what we hold, to restrict or object to how we use it, or to move it elsewhere; email {mail}{' '}
        and we will answer within 30 days. If you are unhappy with our answer, you can complain to
        your local data-protection authority.
      </p>

      <h2 id="cookies">Cookies and local storage</h2>
      <p>
        This website sets no cookies. It remembers your light or dark choice in your browser’s local
        storage. The web app uses cookies only to keep you signed in. Neither is used for tracking.
      </p>

      <h2 id="children">Children</h2>
      <p>
        {BRAND} is not meant for children under 13 (16 in some countries), and we do not knowingly
        collect their data. If you believe a child has given us data, email {mail} and we will
        delete it.
      </p>

      <h2 id="changes">Changes</h2>
      <p>
        If this policy changes in a way that matters, we will say so in the app before the change
        applies. The date at the top shows when it last changed.
      </p>

      <h2 id="contact">Contact</h2>
      <p>Email {mail} about anything on this page.</p>
    </LegalPage>
  );
}
