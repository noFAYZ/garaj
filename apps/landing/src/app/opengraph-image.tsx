import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { DARK_TOKENS, oklchToHex } from '@vehicle-os/ui';
import { BRAND } from '../site';

/*
 * The link preview, drawn at build time and shared by every page: the mark, the promise, and the
 * app itself on a phone — a PNG copy of the vehicle capture, as the renderer cannot read WebP.
 * Colours come from the dark tokens, so the preview is the product's own ink.
 */
export const alt = `${BRAND}: when did you last change the oil? ${BRAND} remembers.`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const ink = (token: keyof typeof DARK_TOKENS) => oklchToHex(DARK_TOKENS[token]);
const asData = (file: Buffer) => `data:image/png;base64,${file.toString('base64')}`;

export default async function OpengraphImage() {
  const [mark, phone] = await Promise.all([
    readFile(join(process.cwd(), '../web/src/public/Logo.png')),
    readFile(join(process.cwd(), 'src/assets/og-phone.png')),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 80px',
        background: `radial-gradient(700px 500px at 85% 40%, ${ink('primary')}40, ${ink('background')} 70%)`,
        color: ink('foreground'),
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <img src={asData(mark)} height={56} alt="" />
          <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>{BRAND}</span>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: -3,
          }}
        >
          <span>When did you last</span>
          <span>change the oil?</span>
          <span style={{ color: ink('mutedForeground') }}>{BRAND} remembers.</span>
        </div>
        <span style={{ fontSize: 28, color: ink('mutedForeground') }}>
          Fuel · Services · Parts · Costs · Reminders
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          padding: 9,
          borderRadius: 50,
          background: '#141210',
          transform: 'rotate(4deg)',
          boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
        }}
      >
        <img src={asData(phone)} width={250} height={542} alt="" style={{ borderRadius: 40 }} />
      </div>
    </div>,
    size,
  );
}
