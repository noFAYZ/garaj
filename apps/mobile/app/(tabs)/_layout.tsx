import { useQuery } from '@tanstack/react-query';
import { Tabs, useRouter } from 'expo-router';
import { useState } from 'react';
import { dashboardQuery } from '@vehicle-os/api-client/react';
import { AddSheet } from '@/components/add-sheet';
import { Dock, type DockAction, type DockItem } from '@/components/dock';
import { api } from '@/lib/api';
import { pickPhoto, type PickedFile } from '@/lib/file-picker';
import { haptic } from '@/lib/motion';
import { useTheme } from '@/lib/theme';

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
  // The web's own icons for the same places: its header's garage, its vehicles, its task list.
  { key: 'index', label: 'Garage', icon: 'garage' },
  { key: 'vehicles', label: 'Vehicles', icon: 'vehicles' },
  { key: 'tasks', label: 'Tasks', icon: 'task' },
];

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        // Each tab sets its title in the page, so there is no bar to float.
        headerShown: false,
        sceneStyle: { backgroundColor: theme.background },
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
  readonly navigation: {
    navigate: (name: string) => void;
    emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => {
      defaultPrevented: boolean;
    };
  };
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
function TabBar({ state, navigation }: TabBarProps) {
  const router = useRouter();
  const [sheet, setSheet] = useState<{ file: PickedFile | null } | null>(null);
  const activeName = state.routes[state.index]?.name ?? '';
  const attention = useQuery(dashboardQuery(api)).data?.attention;
  const late = attention?.overdueTasks ?? 0;
  const today = attention?.tasksDueToday ?? 0;

  const camera = async () => {
    haptic.success();
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
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!event.defaultPrevented) navigation.navigate(name);
  };

  /*
   * What the key deals, in the order a thumb reaches for them at a pump. Each form asks which
   * vehicle; the fill-up and the service arrive already set to their kind.
   */
  const actions: DockAction[] = [
    {
      key: 'fuel',
      emoji: '⛽',
      label: 'Fill-up',
      hint: 'Litres, cost, odometer',
      onPress: () => router.push({ pathname: '/add/done', params: { kind: 'FUEL' } }),
    },
    {
      key: 'service',
      emoji: '🔧',
      label: 'Service done',
      hint: 'What was done, and what it cost',
      onPress: () => router.push({ pathname: '/add/done', params: { kind: 'MAINTENANCE' } }),
    },
    {
      key: 'planned',
      emoji: '🗓️',
      label: 'Reminder',
      hint: 'Once, or every so often',
      onPress: () => router.push('/add/planned'),
    },
    {
      key: 'receipt',
      emoji: '🧾',
      label: 'Photo a receipt',
      hint: 'Or a document, or the car',
      onPress: () => void camera(),
    },
    {
      key: 'vehicle',
      emoji: '🚗',
      label: 'New vehicle',
      onPress: () => router.push('/add/vehicle'),
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
      items={TABS.map((tab) =>
        tab.key === 'tasks' && late + today > 0
          ? {
              ...tab,
              count: late + today,
              countTone: late > 0 ? 'destructive' : 'warning',
              a11yLabel: `Tasks, ${late > 0 ? `${late} late` : `${today} due today`}`,
            }
          : tab,
      )}
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
      {sheet ? <AddSheet initialFile={sheet.file} onClose={() => setSheet(null)} /> : null}
    </Dock>
  );
}
