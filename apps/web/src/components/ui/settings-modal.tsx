'use client';

import type { ReactNode } from 'react';
import type { IconName } from '@/components/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/motion/tabs';
import { Modal } from './modal';

export interface SettingsSection {
  value: string;
  label: string;
  /** A line under the section's title, saying what it covers or where it applies. */
  description?: string;
  icon: ReactNode;
  /** A count beside the label, such as the number of members. */
  badge?: number;
  content: ReactNode;
}

/**
 * Settings in sections: a sidebar of them on the left, the chosen one on the right.
 *
 * The frame is a fixed height and the panel scrolls inside it. Sized to content, the modal grew and
 * shrank as sections changed, and the centred frame jumped under the pointer; fixed, only the
 * panel's contents move.
 *
 * A sidebar rather than tabs across the top, because settings grow a section at a time and a list
 * down the side takes another without crowding the rest. On a phone there is no room beside the
 * panel, so it folds back into a scrolling row above it.
 */
export function SettingsModal({
  title,
  description,
  icon,
  sections,
  defaultValue,
  footer,
  onClose,
}: {
  title: string;
  description?: string;
  icon?: IconName;
  sections: SettingsSection[];
  defaultValue?: string;
  /**
   * A bar under the panel, in the frame rather than in the scroll — for a modal whose sections
   * are one form with one save. Inside the panel it would scroll away mid-edit, and a save
   * button per section would ask which section a change belonged to.
   */
  footer?: ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal title={title} description={description} icon={icon} size="xl" fill onClose={onClose}>
      <Tabs
        defaultValue={defaultValue ?? sections[0]?.value}
        className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:grid-rows-1 sm:gap-8"
      >
        <TabsList className="scrollbar-slim flex h-fit flex-row items-stretch gap-1 overflow-x-auto rounded-2xl bg-muted/60 p-1.5 sm:flex-col">
          {sections.map((section) => (
            <TabsTrigger
              key={section.value}
              value={section.value}
              className="w-full justify-start gap-2.5 px-3 py-2"
            >
              {section.icon}
              {section.label}
              {section.badge !== undefined ? (
                <span className="ml-auto pl-2 font-mono text-xs tabular-nums opacity-70">
                  {section.badge}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {sections.map((section) => (
          <TabsContent
            key={section.value}
            value={section.value}
            // The scroll lives here, not on the modal: the header and the sidebar stay put.
            // `-mr-3 pr-3` gives the scrollbar a gutter of its own instead of overlapping fields.
            className="scrollbar-slim -mr-3 mt-0 min-h-0 overflow-y-auto overscroll-contain pr-3"
          >
            <div className="mb-5">
              <h3 className="text-base font-semibold tracking-tight text-foreground">
                {section.label}
              </h3>
              {section.description ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{section.description}</p>
              ) : null}
            </div>
            {section.content}
          </TabsContent>
        ))}
      </Tabs>
      {footer}
    </Modal>
  );
}
