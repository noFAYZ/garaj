'use client';

import { SettingsPanel } from '@/components/settings-panel';

/**
 * The settings page.
 *
 * The header opens the same panel in a dialog; this route stays for a direct link and for
 * anyone who would rather have it as a page. Both render `SettingsPanel`, so neither can
 * drift from the other.
 */
export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
      <SettingsPanel />
    </div>
  );
}
