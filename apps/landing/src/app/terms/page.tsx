import type { Metadata } from 'next';
import { LegalPage } from '../../components/legal-page';
import { BRAND, CONTACT_EMAIL, pageMetadata } from '../../site';

export const metadata: Metadata = pageMetadata(
  '/terms',
  'Terms of use',
  `The terms for using ${BRAND}: your account and content, plans and subscriptions, renewals and cancelling, and what we are and are not responsible for.`,
);

const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

/**
 * The end-user terms the app links from its paywall and settings. The subscription paragraph
 * carries the disclosures both stores ask for around auto-renewal, and "From the App Store"
 * carries Apple's minimum terms for a developer's own licence agreement.
 */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      path="/terms"
      intro={`The agreement between you and ${BRAND} when you use the apps, the web app or this website.`}
    >
      <h2 id="agreement">The agreement</h2>
      <p>
        By creating an account or using {BRAND}, you agree to these terms and to our{' '}
        <a href="/privacy">privacy policy</a>. If you do not agree, please do not use it. You must
        be at least 13, and old enough where you live to agree to these terms yourself.
      </p>

      <h2 id="account">Your account</h2>
      <p>
        Give us an email address you can reach, keep your password to yourself, and tell us at{' '}
        {mail} if you think someone else has used your account. You are responsible for what happens
        in it.
      </p>

      <h2 id="content">Your content</h2>
      <p>
        The records, photos and documents you add are yours. You let us store, process and show them
        only to run {BRAND} for you and for the people you choose to share them with: the members of
        a garage you invite, or anyone holding a vehicle link you publish, until you revoke it. Only
        add what you have the right to add.
      </p>

      <h2 id="use">Using it fairly</h2>
      <ul>
        <li>
          No unlawful, harmful or infringing content, and no one else’s data without their say.
        </li>
        <li>
          No attempts to break, overload, scrape or reverse-engineer the service, or to reach data
          that is not yours. The API and MCP server are for your own garages, within their limits.
        </li>
        <li>No reselling or passing off {BRAND} as your own.</li>
      </ul>

      <h2 id="plans">Plans, subscriptions and renewals</h2>
      <p>
        {BRAND} is free to use within the Free plan’s limits. Plus and Business add vehicles,
        garages, people and features, and are sold as subscriptions (monthly or yearly) or, where
        offered, as a one-time purchase. Prices are shown before you buy, in your currency.
      </p>
      <ul>
        <li>
          <strong>In the app:</strong> payment is charged to your Google Play or Apple account when
          you confirm the purchase.
        </li>
        <li>
          <strong>Auto-renewal:</strong> a subscription renews automatically at the same price and
          length unless you cancel it at least 24 hours before the current period ends. Your account
          is charged for the renewal within the 24 hours before that.
        </li>
        <li>
          <strong>Cancelling:</strong> manage or cancel it any time in your store account’s
          subscription settings (Google Play: Profile → Payments &amp; subscriptions →
          Subscriptions; iPhone: Settings → your name → Subscriptions). On the web, cancel in{' '}
          <strong>Settings</strong> → <strong>Plan and billing</strong>. You keep the plan until the
          end of the period you paid for.
        </li>
        <li>
          <strong>Free trials:</strong> where one is offered, it turns into a paid subscription when
          it ends unless you cancel before then. Any unused part of a trial ends when you buy a
          subscription.
        </li>
        <li>
          <strong>Refunds:</strong> purchases made in the app are refunded under Google Play’s or
          Apple’s refund policies; ask them. For a web purchase, email {mail}. Nothing here limits
          refund rights the law gives you.
        </li>
        <li>
          <strong>Changes:</strong> if a price or a plan’s contents change, we will tell you before
          it applies to you, and you can cancel before it does.
        </li>
      </ul>
      <p>
        Deleting your account does not cancel a subscription bought through a store: cancel it there
        too.
      </p>

      <h2 id="advice">Reminders, estimates and AI</h2>
      <p>
        Reminders, health scores, costs per distance, fuel economy and anything an AI feature
        suggests are guides worked out from what you entered. They can be wrong or late. They are
        not a substitute for your vehicle’s manual, a mechanic or official notices, and we are not
        responsible for maintenance that was missed or done because of them. Check anything that
        matters, such as a recall or an inspection date, at its source.
      </p>

      <h2 id="service">The service</h2>
      <p>
        We work to keep {BRAND} available and your data safe, but we cannot promise it will never be
        interrupted. We may change or retire features, with notice in the app when a change affects
        what you pay for. You can export your data at any time (Settings → Your data).
      </p>

      <h2 id="ending">Ending</h2>
      <p>
        You can stop using {BRAND} and <a href="/delete-account">delete your account</a> at any
        time. We may suspend or close an account that breaks these terms or puts others at risk;
        where we can, we will tell you first and let you export your data.
      </p>

      <h2 id="liability">Liability</h2>
      <p>
        {BRAND} is provided “as is”. As far as the law allows, we are not liable for indirect or
        consequential loss, or for loss of data you could have exported, and our total liability to
        you is limited to what you paid us in the 12 months before the claim. Nothing in these terms
        limits rights you have as a consumer that cannot be limited by contract.
      </p>

      <h2 id="app-store">If you got the app from the App Store</h2>
      <ul>
        <li>
          These terms are between you and {BRAND}, not Apple. Apple is not responsible for the app
          or its content, and has no obligation to maintain or support it.
        </li>
        <li>
          Your licence is to use the app on Apple devices you own or control, as the App Store’s
          Usage Rules allow, and is not transferable.
        </li>
        <li>
          If the app fails to meet a warranty that applies, you may tell Apple, and Apple will
          refund its purchase price; Apple has no other warranty obligation for it.
        </li>
        <li>
          {BRAND}, not Apple, handles any claim about the app: product liability, legal or
          regulatory compliance, consumer protection, or a third party’s intellectual property.
        </li>
        <li>
          You confirm you are not in a country under a US government embargo, and not on a US
          government list of prohibited or restricted parties.
        </li>
        <li>
          Apple and its subsidiaries are third-party beneficiaries of these terms, and may enforce
          them against you.
        </li>
      </ul>

      <h2 id="changes">Changes</h2>
      <p>
        If these terms change in a way that matters, we will say so in the app before the change
        applies. Using {BRAND} after that means you accept the new terms.
      </p>

      <h2 id="contact">Contact</h2>
      <p>Questions about these terms, support and legal notices: {mail}.</p>
    </LegalPage>
  );
}
