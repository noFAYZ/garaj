import { redirect } from 'next/navigation';

/**
 * A vehicle's tasks are planned items in its activity now, beside its repeating schedules.
 * This route stays so links already out there land on the activity instead of a 404; the
 * garage-wide task centre is still `/tasks`.
 */
export default async function VehicleTasksRedirect({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;
  redirect(`/vehicles/${vehicleId}`);
}
