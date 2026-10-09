import { useRouter } from 'expo-router';
import { Segmented } from '@/lib/instrument';

/**
 * What + offers, phrased as answers to the sheet's question rather than as categories — so the
 * row is the whole instruction and needs no line under it explaining itself.
 */
export const ADD_ACTIONS = [
  { href: '/add/done', icon: 'checkmark-done-outline', label: 'Something done', hint: '' },
  { href: '/add/planned', icon: 'calendar-outline', label: 'Something planned', hint: '' },
  { href: '/add/document', icon: 'document-text-outline', label: 'A document', hint: '' },
  { href: '/add/vehicle', icon: 'car-sport-outline', label: 'A new vehicle', hint: '' },
] as const;

/**
 * The first question on both add screens: did it happen, or is it coming up? Switching keeps the
 * vehicle and swaps the screen in place, so back still returns to wherever the add started.
 */
export function AddMode({
  mode,
  vehicleId,
}: {
  mode: 'done' | 'planned';
  vehicleId: string | undefined;
}) {
  const router = useRouter();
  return (
    <Segmented
      value={mode}
      options={[
        { value: 'done', label: 'Done' },
        { value: 'planned', label: 'Coming up' },
      ]}
      onChange={(next) =>
        router.replace({
          pathname: next === 'done' ? '/add/done' : '/add/planned',
          params: vehicleId ? { vehicleId } : {},
        })
      }
    />
  );
}
