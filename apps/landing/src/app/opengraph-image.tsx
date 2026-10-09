import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { DARK_TOKENS, oklchToHex } from '@vehicle-os/ui';

/*
 * The link preview, drawn at build time: the mark, the promise, and one reading from the demo
 * garage's cluster. Colours come from the dark tokens — the preview is the product's own ink, not
 * a second palette.
 */
export const alt = 'Garaj — every vehicle, its whole story';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const ink = (token: keyof typeof DARK_TOKENS) => oklchToHex(DARK_TOKENS[token]);

export default async function OpengraphImage() {
  // The mark lives with the product; this app borrows it rather than keeping a copy.
  const mark = await readFile(join(process.cwd(), '../web/src/public/Logo.png'));

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: ink('background'),
        color: ink('foreground'),
      }}
    >
      <img src={`data:image/png;base64,${mark.toString('base64')}`} height={64} alt="" />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          fontSize: 92,
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: -3,
        }}
      >
        <span>Every vehicle.</span>
        <span style={{ color: ink('mutedForeground') }}>Its whole story.</span>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 28 }}>
        {[
          ['ODOMETER', '092,310 km', ink('foreground')],
          ['HEALTH', '75 / 100', ink('warning')],
          ['BRAKE FLUID', '3 months over', ink('destructive')],
        ].map(([label, value, colour]) => (
          <div
            key={label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '20px 28px',
              borderRadius: 24,
              background: ink('card'),
            }}
          >
            <span style={{ fontSize: 18, letterSpacing: 3, color: ink('mutedForeground') }}>
              {label}
            </span>
            <span style={{ color: colour, fontWeight: 700 }}>{value}</span>
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
