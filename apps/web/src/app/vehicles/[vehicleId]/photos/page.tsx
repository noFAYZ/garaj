'use client';

import { useParams } from 'next/navigation';
import { PhotoManager } from '@/components/vehicle/photo-manager';

/**
 * The photos route. Most visits reach the same manager from the edit button on the vehicle's
 * hero; this stays for the dashboard's Photo quick action and for links already out there.
 */
export default function PhotosPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  return <PhotoManager vehicleId={vehicleId} />;
}
