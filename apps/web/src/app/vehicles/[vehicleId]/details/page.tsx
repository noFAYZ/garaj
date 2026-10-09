import { redirect } from 'next/navigation';

/**
 * Details is part of the vehicle's Activity now: health opens from the top of Activity, identity from the ⋯ menu. This route stays so links already out
 * there — bookmarks, notifications, search results — land on the vehicle instead of a 404.
 */
export default async function DetailsRedirect({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;
  redirect(`/vehicles/${vehicleId}`);
}
