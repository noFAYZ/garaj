import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { activityQuery, documentsQuery } from '@vehicle-os/api-client/react';
import { AddSheet, type QuickContext } from '@/components/add-sheet';
import { Dock, type DockAction, type DockItem } from '@/components/dock';
import type { QuickAction } from '@/components/quick-entry-form';
import { expiry } from '@/components/vehicle-documents';
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
  { key: 'activity', label: 'Logs', icon: 'timeline' },
  { key: 'planned', label: 'Reminders', icon: 'calendar' },
  { key: 'statistics', label: 'Stats', icon: 'chart' },
  { key: 'documents', label: 'Docs', icon: 'document' },
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
  quickContext,
  quickRequest,
  onQuickHandled,
  value,
  onChange,
}: {
  vehicleId: string;
  vehicleName: string | undefined;
  /** The unit, currency and last reading a quick entry needs; absent until the vehicle lands. */
  quickContext?: QuickContext;
  /** Set by the hero's odometer press, to open the sheet straight on that form. */
  quickRequest?: QuickAction | null;
  onQuickHandled?: () => void;
  value: VehicleTab;
  onChange: (value: VehicleTab) => void;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<{ file: PickedFile | null; quick: QuickAction | null } | null>(
    null,
  );

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

  const docs = (documents.data?.data ?? []).filter((document) => document.uploadedAt !== null);
  const docStates = docs.map(expiry);
  const expired = docStates.filter((state) => state?.tone === 'destructive').length;
  const expiring = docStates.filter((state) => state?.tone === 'warning').length;

  /*
   * What is waiting behind a section, as the web's count on its icon — so the section you are not
   * on still reports in. Statistics never has one: it reports, it does not queue work.
   */
  const counts: Record<VehicleTab, number> = {
    activity: 0,
    planned: late + soon,
    statistics: 0,
    documents: expired + expiring,
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
   * finish inside the sheet without leaving the vehicle; until the vehicle has loaded (and with it
   * its unit and currency) they go to the full form instead of guessing.
   */
  const quick = (kind: QuickAction, eventType: string) => () =>
    quickContext
      ? setSheet({ file: null, quick: kind })
      : router.push({ pathname: '/add/done', params: { vehicleId, kind: eventType } });
  const actions: DockAction[] = [
    {
      key: 'fuel',
      emoji: '⛽',
      label: 'Fill-up',
      hint: 'Litres, cost, odometer',
      onPress: quick('fuel', 'FUEL'),
    },
    {
      key: 'odometer',
      emoji: '🗺️',
      label: 'Odometer reading',
      hint: 'Just the number',
      onPress: quick('odometer', 'NOTE'),
    },
    {
      key: 'service',
      emoji: '🔧',
      label: 'Service done',
      hint: 'What was done, and its cost',
      onPress: quick('service', 'MAINTENANCE'),
    },
    {
      key: 'planned',
      emoji: '🗓️',
      label: 'Reminder',
      hint: 'Once, or every so often',
      onPress: () => router.push({ pathname: '/add/planned', params: { vehicleId } }),
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
            : expired > 0
              ? 'destructive'
              : 'warning',
        a11yLabel:
          counts[tab.key] > 0 ? `${tab.label}, ${counts[tab.key]} need attention` : undefined,
      }))}
      activeKey={value}
      onSelect={(key) => onChange(key as VehicleTab)}
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
          vehicleId={vehicleId}
          subject={vehicleName}
          quickContext={quickContext}
          onClose={() => {
            setSheet(null);
            onQuickHandled?.();
          }}
        />
      ) : null}
    </Dock>
  );
}
