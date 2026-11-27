import { describe, expect, it } from 'vitest';
import { emailPreviews, notificationEmail, passwordResetEmail } from './email-templates';

const reminder = {
  notificationType: 'MAINTENANCE_OVERDUE' as const,
  title: 'Oil <b>change</b>',
  body: `Dad's "M3" is 200 km past its oil change.`,
  payload: {},
  vehicleId: 'v1',
};

describe('email templates', () => {
  it('escapes what users typed', () => {
    const { html, subject } = notificationEmail(reminder);
    expect(subject).toBe('Overdue: Oil <b>change</b>');
    expect(html).toContain('Oil &lt;b&gt;change&lt;/b&gt;');
    expect(html).toContain('Dad&#39;s &quot;M3&quot;');
    expect(html).not.toContain('<b>change');
  });

  it('puts the link in both parts', () => {
    const link = 'https://api.example/reset?token=a&b=1';
    const email = passwordResetEmail(link);
    expect(email.text).toContain(link);
    expect(email.html).toContain('href="https://api.example/reset?token=a&amp;b=1"');
  });

  it('only links the web app when it is a real https address', () => {
    expect(notificationEmail(reminder, 'http://localhost:3000').html).not.toContain('/vehicles/');
    expect(notificationEmail(reminder, 'https://app.example/').html).toContain(
      'https://app.example/vehicles/v1',
    );
  });

  it('words expiry by the days left', () => {
    const doc = {
      ...reminder,
      notificationType: 'INSURANCE_EXPIRING' as const,
      title: 'Insurance',
    };
    expect(notificationEmail({ ...doc, payload: { daysRemaining: -3 } }).subject).toBe(
      'Expired: Insurance',
    );
    const soon = notificationEmail({
      ...doc,
      payload: { daysRemaining: 12, expiresOn: '2027-03-09' },
    });
    expect(soon.subject).toBe('Expiring soon: Insurance');
    expect(soon.text).toContain('Expires: 9 March 2027');
  });

  it('renders every preview whole', () => {
    for (const email of emailPreviews('https://api.example')) {
      expect(email.subject).toBeTruthy();
      expect(email.html).not.toMatch(/undefined|null|\[object/);
      expect(email.text).not.toMatch(/undefined|\[object/);
    }
  });
});
