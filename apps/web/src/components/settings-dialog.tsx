'use client';

import { Settings } from 'lucide-react';
import { SETTINGS_SECTIONS } from '@/components/settings-panel';
import { Button } from '@/components/ui/primitives';
import { SettingsModal } from '@/components/ui/settings-modal';

/**
 * Settings, from the header.
 *
 * The same sectioned modal as a garage's settings: a sidebar of sections, one panel at a time, a
 * frame that does not change height. Settings are a detour from whatever you were doing, and a
 * modal returns you to it — a route would not.
 *
 * The sections are `SETTINGS_SECTIONS`, the same list `/settings` stacks, so a setting added to
 * one is in the other by construction.
 *
 * Mounted only while open (the shell renders it conditionally); `open` is accepted for the call
 * sites that pass it, and opening is the modal's own mount.
 */
export function SettingsDialog({ onClose }: { open?: boolean; onClose: () => void }) {
  return (
    <SettingsModal
      title="Settings"
      description="How Garaj looks and measures, for you."
      icon="settings"
      onClose={onClose}
      sections={SETTINGS_SECTIONS.map(
        ({ value, title, description, icon: SectionIcon, Content }) => ({
          value,
          label: title,
          description,
          icon: <SectionIcon className="size-4" aria-hidden="true" />,
          content: <Content />,
        }),
      )}
    />
  );
}

/** The header's gear. Its own component so the shell holds one piece of state, not two. */
export function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Open settings"
      onClick={onOpen}
      className="group rounded-full"
    >
      <Settings
        className="size-4 transition-transform duration-500 ease-out group-hover:rotate-90"
        aria-hidden="true"
      />
    </Button>
  );
}
