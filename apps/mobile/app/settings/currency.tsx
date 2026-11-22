import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { garagesQuery } from '@vehicle-os/api-client/react';
import {
  ChoiceHero,
  ChoiceList,
  Flag,
  SettingsPage,
  useProfileUpdate,
} from '@/components/settings-kit';
import { api } from '@/lib/api';
import { formatMoney, toMinorUnits } from '@/lib/format';
import { CURRENCIES } from '@/lib/locale-options';
import { useProfile } from '@/lib/vehicle-units';

/**
 * The currency new records default to, as its own page — the twin of the time zone's: what it is
 * now (the flag, the name, an amount as it will read), then the list to pick from. A pick saves
 * and goes back; the garages this person owns follow it, shared ones keep theirs.
 */
export default function CurrencyScreen() {
  const router = useRouter();
  const me = useProfile().data;
  const garages = useQuery(garagesQuery(api));
  const update = useProfileUpdate();

  const code = me?.defaultCurrency;
  const current = CURRENCIES.find((option) => option.value === code);
  const owned = (garages.data ?? []).filter((garage) => garage.role === 'OWNER').length;
  const sample = code ? formatMoney({ amountMinor: toMinorUnits(68.4, code), currency: code }) : '';

  return (
    <SettingsPage title="Currency">
      <ChoiceHero
        loading={!me}
        leading={code ? <Flag currency={code} large /> : null}
        title={current?.label ?? code ?? ''}
        caption={
          owned > 0
            ? `Reads ${sample} · your ${owned === 1 ? 'garage follows' : `${owned} garages follow`}`
            : `Amounts read ${sample}`
        }
        reading={code ?? ''}
      />
      <ChoiceList
        title="All currencies"
        options={CURRENCIES}
        value={code}
        placeholder="Search currencies"
        leading={(option) => <Flag currency={option.value} />}
        onPick={(defaultCurrency) => {
          if (defaultCurrency !== code) update.mutate({ defaultCurrency });
          router.back();
        }}
      />
    </SettingsPage>
  );
}
