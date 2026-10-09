import { redirect } from 'next/navigation';

/**
 * Value lives in Statistics now, beside the spending and health it is read against. This route
 * stays so links already out there — bookmarks, notifications, search results — still land.
 */
export default async function ValueRedirect({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;
  redirect(`/vehicles/${vehicleId}/statistics`);
}
