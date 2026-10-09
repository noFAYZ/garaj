import { redirect } from 'next/navigation';

/**
 * History is the vehicle's landing page now, at `/vehicles/:id`. This route stays so links
 * already out there — bookmarks, a shared URL, a notification — land on it instead of a 404.
 */
export default async function HistoryRedirect({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;
  redirect(`/vehicles/${vehicleId}`);
}
