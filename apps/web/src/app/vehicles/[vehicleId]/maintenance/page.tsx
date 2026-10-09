import { redirect } from 'next/navigation';

/**
 * Schedules is part of the vehicle's Activity now: each schedule is managed from its row in Coming up. This route stays so links already out
 * there — bookmarks, notifications, search results — land on the vehicle instead of a 404.
 */
export default async function SchedulesRedirect({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;
  redirect(`/vehicles/${vehicleId}`);
}
