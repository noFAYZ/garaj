import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { AddSheet } from '@/components/add-sheet';
import { Dock, type DockAction, type DockItem } from '@/components/dock';
import type { QuickAction } from '@/components/add-activity';
import { useAddRequests, type AddRequest } from '@/lib/add-request';
import { pickPhoto, type PickedFile } from '@/lib/file-picker';
import { startStore } from '@/lib/store';
import { useProfile } from '@/lib/vehicle-units';

/**
 * Three places, one action.
 *
 * PRD §6.6 puts mobile on quick entry, reminders and checking tasks; depth — analytics,
 * documents, comparisons — is the web's job (§6.7).
 *
 * You is a screen, not a destination you set out for: it is reached from your own initials on
 * the Garage page, beside the bell, the way the web keeps it behind the avatar. The route is
 * unchanged — it is off the bar, not gone.
 */
const TABS: readonly DockItem[] = [
  // The web's own icon set. Garage is the dashboard the app opens on, so it wears tiles, not a door.
  { key: 'index', label: 'Garage', icon: 'dashboard' },
  { key: 'vehicles', label: 'Vehicles', icon: 'vehicles' },
];

export default function TabsLayout() {
  // Signed in from here down: RevenueCat starts now, so an unfinished purchase gets finished.
  const userId = useProfile().data?.id;
  useEffect(() => {
    if (userId) startStore(userId);
  }, [userId]);
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        // Each tab sets its title in the page, so there is no bar to float.
        headerShown: false,
        sceneStyle: { backgroundColor: 'transparent' },
        // A tab out of sight stops re-rendering — the garage's clock and carousel, a list a
        // sync just refreshed — and catches up in one render when it is chosen again.
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Garage' }} />
      <Tabs.Screen name="vehicles" options={{ title: 'Vehicles' }} />
      <Tabs.Screen name="tasks" options={{ title: 'Tasks' }} />
      <Tabs.Screen name="settings" options={{ title: 'You' }} />
    </Tabs>
  );
}

/**
 * The slice of the tab bar's props this bar actually uses.
 *
 * Structural rather than imported from `@react-navigation/bottom-tabs`: expo-router already
 * depends on that package, and installing a second copy to borrow one type gave the app two
 * navigator instances and two React contexts — the tab bar rendered nothing.
 */
interface TabBarProps {
  readonly state: {
    readonly index: number;
    readonly routes: readonly { readonly key: string; readonly name: string }[];
  };
  readonly emitter: {
    emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => {
      defaultPrevented?: boolean;
    };
  };
  readonly navigateToTab: (routeKey: string) => void;
}

/**
 * The app's dock: the shared chrome, wired to the navigator.
 *
 * You is a registered screen with no place in the bar, so the active route can be one this dock
 * does not draw. Nothing is selected then, which is the honest answer.
 *
 * Tasks carries the web's count — what is late or due today, red once anything is late — from the
 * dashboard the Garage tab already holds, so the bar asks for nothing of its own.
 */
function TabBar({ state, emitter, navigateToTab }: TabBarProps) {
  const [sheet, setSheet] = useState<{
    file: PickedFile | null;
    quick?: QuickAction;
    request?: AddRequest;
  } | null>(null);
  // Home's Up next, its quick actions and the lists' "add" open this drawer on its form.
  useAddRequests(({ quick, ...request }) =>
    setSheet(quick ? { file: null, quick } : { file: null, request }),
  );
  const activeName = state.routes[state.index]?.name ?? '';

  const camera = async () => {
    try {
      const file = await pickPhoto('camera');
      if (file) setSheet({ file });
    } catch {
      // The sheet explains a refused or missing camera; the shortcut just opens it.
      setSheet({ file: null });
    }
  };

  const go = (name: string) => {
    const route = state.routes.find((candidate) => candidate.name === name);
    if (!route) return;
    const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!event.defaultPrevented) navigateToTab(route.key);
  };

  /*
   * What the key deals, in the order a thumb reaches for them at a pump — the vehicle's own dock's
   * order, cut to five that each open something none of the others do. The odometer is left to
   * a fill-up (which takes it) and the sheet; a new vehicle to the Vehicles tab and the sheet.
   * Fill-up and service open their quick entry in the drawer, which asks which vehicle on top, so
   * a fill-up never leaves this screen; the rest go to their forms.
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
      key: 'service',
      emoji: '🧰',
      label: 'Service done',
      hint: 'What was done, and what it cost',
      onPress: quick('service'),
    },
    {
      key: 'planned',
      emoji: '🗓️',
      label: 'Reminder',
      hint: 'Once, or every so often',
      onPress: () => setSheet({ file: null, request: { mode: 'planned' } }),
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
      hint: 'Documents, garages, uploads',
      onPress: () => setSheet({ file: null }),
    },
  ];

  return (
    <Dock
      items={TABS}
      activeKey={activeName}
      onSelect={go}
      actions={actions}
      add={{
        a11yLabel: 'Add something',
        open: sheet !== null,
        onPress: () => setSheet({ file: null }),
        onLongPress: () => void camera(),
      }}
    >
      {sheet ? (
        <AddSheet
          initialFile={sheet.file}
          initialQuick={sheet.quick}
          initialRequest={sheet.request ?? null}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </Dock>
  );
}
