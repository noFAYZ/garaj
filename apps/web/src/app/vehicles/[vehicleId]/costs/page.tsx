import { redirect } from 'next/navigation';

/**
 * Spending lives in Statistics now, with its chart and the cost-per-distance figures. This route
 * stays so links already out there — bookmarks, notifications, search results — still land.
 */
export default async function SpendingRedirect({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;
  redirect(`/vehicles/${vehicleId}/statistics`);
}
