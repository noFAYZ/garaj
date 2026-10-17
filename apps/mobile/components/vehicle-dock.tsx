import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { activityQuery, documentsQuery } from '@vehicle-os/api-client/react';
import type { ActivityMode, QuickAction } from '@/components/add-activity';
import { AddSheet } from '@/components/add-sheet';
import { Dock, type DockAction, type DockItem } from '@/components/dock';
import { pressingPapers } from '@/components/vehicle-documents';
import { api } from '@/lib/api';
import { pickPhoto, type PickedFile } from '@/lib/file-picker';
import { haptic } from '@/lib/motion';

export type VehicleTab = 'activity' | 'planned' | 'statistics' | 'documents';

/**
 * The vehicle's sections, named as the web's strip names them — Logs, Reminders, Stats, Docs — in
 * the order a thumb wants them. Left is what the vehicle is doing: the record behind it and the
 * jobs in front of it. Right is what that adds up to and the paperwork proving it.
 */
const TABS = [
  // The web's strip wears the same four icons.
  { key: 'activity', label: 'Logs', icon: 'logbook', activeIcon: 'logbookActive' },
  { key: 'planned', label: 'Reminders', icon: 'reminder', activeIcon: 'reminderActive' },
  { key: 'statistics', label: 'Stats', icon: 'analytics', activeIcon: 'analyticsActive' },
  { key: 'documents', label: 'Docs', icon: 'papers', activeIcon: 'papersActive' },
] as const satisfies readonly (DockItem & { key: VehicleTab })[];

/**
 * The vehicle's own dock.
 *
 * The sections used to be a segmented strip stuck under the hero — a second row of navigation
 * competing with the app's dock at the bottom of every other screen, in a different shape, in a
 * different place, reachable only by scrolling back up to it. Here the vehicle borrows the
 * pattern the rest of the app already uses: a dock at the thumb, a pill that slides to where you
 * are, and + as the one solid ink shape, because recording something is the action and not a
 * place.
 *
 * Its + is bound to this vehicle. The app's + has to ask which vehicle first; standing inside
 * one, that question is already answered, so the sheet opens straight onto what to add. Holding
 * it goes to the camera, exactly as it does on the app's dock — one gesture, learned once.
 */
export function VehicleDock({
  vehicleId,
  vehicleName,
  quickRequest,
  onQuickHandled,
  value,
  onChange,
}: {
  vehicleId: string;
  vehicleName: string | undefined;
  /** Set by the hero's odometer press, to open the sheet straight on that form. */
  quickRequest?: QuickAction | null;
  onQuickHandled?: () => void;
  value: VehicleTab;
  onChange: (value: VehicleTab) => void;
}) {
  const [sheet, setSheet] = useState<{
    file: PickedFile | null;
    quick: QuickAction | null;
    mode?: ActivityMode;
  } | null>(null);

  /*
   * Where the dock says you are. It moves the moment a place is pressed, so the wash, the label and
   * the icon's pop run while the section is still being built behind it; when the screen moves on
   * its own (the hero's shortcuts), it follows `value`.
   */
  const [shown, setShown] = useState(value);
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    setShown(value);
  }

  /*
   * A press on the hero's odometer opens this sheet on that form. Adjusted during render rather
   * than in an effect, so the sheet is open in the same paint as the press.
   */
  const [seenRequest, setSeenRequest] = useState(quickRequest ?? null);
  if ((quickRequest ?? null) !== seenRequest) {
    setSeenRequest(quickRequest ?? null);
    if (quickRequest) setSheet({ file: null, quick: quickRequest });
  }

  // Both sections fetch their own data; these reads come from the same cache entries.
  const activity = useQuery(activityQuery(api, vehicleId));
  const documents = useQuery(documentsQuery(api, vehicleId));

  const planned = activity.data?.planned ?? [];
  const late = planned.filter(
    (item) => item.kind === 'SCHEDULE' && item.schedule.status === 'OVERDUE',
  ).length;
  const soon = planned.filter(
    (item) => item.kind === 'SCHEDULE' && item.schedule.status === 'DUE_SOON',
  ).length;

  const papers = pressingPapers(
    (documents.data?.data ?? []).filter((document) => document.uploadedAt !== null),
  );

  /*
   * What is waiting behind a section, as the web's count on its icon — so the section you are not
   * on still reports in. Statistics never has one: it reports, it does not queue work.
   */
  const counts: Record<VehicleTab, number> = {
    activity: 0,
    planned: late + soon,
    statistics: 0,
    documents: papers.expired + papers.soon,
  };

  const camera = async () => {
    haptic.success();
    try {
      const file = await pickPhoto('camera');
      if (file) setSheet({ file, quick: null });
    } catch {
      // The sheet explains a refused or missing camera; the shortcut just opens it.
      setSheet({ file: null, quick: null });
    }
  };

  /*
   * Bound to this vehicle, the hand skips the question every form starts with. The pump-side three
   * and a reminder finish inside the sheet without leaving the vehicle.
   */
  const quick = (kind: QuickAction) => () => setSheet({ file: null, quick: kind });
  const actions: DockAction[] = [
    {
      key: 'fuel',
      emoji: '⛽',
      label: 'Fill-up',
      hint: 'Litres, cost, odometer',
      onPress: quick('fuel'),
    },
    {
      key: 'odometer',
      emoji: '🗺️',
      label: 'Odometer reading',
      hint: 'Just the number',
      onPress: quick('odometer'),
    },
    {
      key: 'service',
      emoji: '🧰',
      label: 'Service done',
      hint: 'What was done, and its cost',
      onPress: quick('service'),
    },
    {
      key: 'planned',
      emoji: '🗓️',
      label: 'Reminder',
      hint: 'Once, or every so often',
      onPress: () => setSheet({ file: null, quick: null, mode: 'planned' }),
    },
    {
      key: 'receipt',
      emoji: '🧾',
      label: 'Photo a receipt',
      hint: 'Or a document, or the car',
      onPress: () => void camera(),
    },
    {
      key: 'more',
      emoji: '✨',
      label: 'Everything else',
      hint: 'Expenses, documents, photos',
      onPress: () => setSheet({ file: null, quick: null }),
    },
  ];

  return (
    <Dock
      items={TABS.map((tab) => ({
        ...tab,
        count: counts[tab.key],
        countTone:
          tab.key === 'planned'
            ? late > 0
              ? 'destructive'
              : 'warning'
            : papers.expired > 0
              ? 'destructive'
              : 'warning',
        a11yLabel:
          counts[tab.key] > 0 ? `${tab.label}, ${counts[tab.key]} need attention` : undefined,
      }))}
      activeKey={shown}
      onSelect={(key) => {
        setShown(key as VehicleTab);
        onChange(key as VehicleTab);
      }}
      actions={actions}
      add={{
        a11yLabel: vehicleName ? `Add to ${vehicleName}` : 'Add to this vehicle',
        open: sheet !== null,
        onPress: () => setSheet({ file: null, quick: null }),
        onLongPress: () => void camera(),
      }}
    >
      {sheet ? (
        <AddSheet
          initialFile={sheet.file}
          initialQuick={sheet.quick}
          initialMode={sheet.mode ?? null}
          vehicleId={vehicleId}
          subject={vehicleName}
          onClose={() => {
            setSheet(null);
            onQuickHandled?.();
          }}
        />
      ) : null}
    </Dock>
  );
}
