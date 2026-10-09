'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import type { PlannedItem } from '@vehicle-os/contracts';
import { activityQuery, queryKeys, vehicleQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { afterFade, clearRequest } from '@/lib/open-add';
import { TaskItem } from '@/components/task-item';
import { Button, EmptyState } from '@/components/ui/primitives';
import { SectionHeading } from '@/components/ui/overview';
import { ListSkeleton, Loading } from '@/components/ui/skeleton';
import { AddEntryDialog, isAddMode, type AddMode } from '@/components/vehicle/add-entry';
import { ScheduleRow } from '@/components/vehicle/schedule-row';

const DAY = 24 * 60 * 60 * 1000;

/** Days from local midnight today to a `YYYY-MM-DD` day; negative when it has passed. */
function daysUntil(day: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((new Date(`${day}T00:00:00`).getTime() - today) / DAY);
}

/** Late, or due within the week — the same line the task rows colour amber at. */
function needsYou(item: PlannedItem): boolean {
  if (item.kind === 'SCHEDULE') {
    return item.schedule.status === 'OVERDUE' || item.schedule.status === 'DUE_SOON';
  }
  return item.task.dueDate !== null && daysUntil(item.task.dueDate) <= 7;
}

/**
 * What the vehicle is waiting on, as a tab of its own: repeating services and one-off jobs, in two
 * groups — what needs you (late, or due within the week) and what is coming up. It used to be a rail
 * of small cards under the hero on every tab; here each gets its full row — a schedule's gauge of
 * the interval used, a task's due line — with logging, editing and deleting on the row.
 *
 * Adding opens the add dialog straight on Reminder, in place (`?add=planned`, from the strip's key or
 * the empty state), so planning one never leaves the tab. The same activity entry the Logs tab
 * reads, so neither fetches twice.
 */
export default function RemindersPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const needsId = useId();
  const laterId = useId();

  const vehicle = useQuery(vehicleQuery(api, vehicleId));
  const activity = useQuery(activityQuery(api, vehicleId));
  const planned = activity.data?.planned ?? [];

  // As on Logs: not until the route's cross-fade is over, or the dialog opens under its snapshot.
  const requested = searchParams.get('add');
  const [adding, setAdding] = useState<AddMode | null>(null);
  useEffect(() => {
    if (isAddMode(requested)) return afterFade(() => setAdding(requested));
  }, [requested]);

  /*
   * Logging a service can move the odometer, restart a schedule's clock and change spending, so
   * the whole vehicle subtree goes — plus the task centre and the cross-garage due list.
   */
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicle(vehicleId) });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.due() });
  };
  const close = () => {
    setAdding(null);
    if (requested) clearRequest();
  };

  const needs = planned.filter(needsYou);
  const later = planned.filter((item) => !needsYou(item));
  const schedules = planned.flatMap((item) => (item.kind === 'SCHEDULE' ? [item.schedule] : []));
  const odometer = vehicle.data?.currentOdometer ?? null;

  const row = (item: PlannedItem) =>
    item.kind === 'TASK' ? (
      <TaskItem key={`task-${item.task.id}`} task={item.task} showVehicle={false} />
    ) : (
      <ScheduleRow
        key={`schedule-${item.schedule.id}`}
        vehicleId={vehicleId}
        schedule={item.schedule}
        currentOdometer={odometer}
        onChanged={refresh}
      />
    );

  return (
    <div className="flex flex-col gap-10">
      {adding ? (
        <AddEntryDialog
          vehicleId={vehicleId}
          garageId={vehicle.data?.garageId}
          mode={adding}
          onModeChange={setAdding}
          schedules={schedules}
          onDone={() => {
            close();
            refresh();
          }}
          onClose={close}
        />
      ) : null}

      {activity.isPending ? (
        <Loading label="Loading reminders">
          <ListSkeleton rows={3} />
        </Loading>
      ) : planned.length === 0 ? (
        <EmptyState
          title="Nothing planned"
          description="Repeating services and one-off jobs wait here, what needs you first."
          action={
            <Button variant="primary" aria-haspopup="dialog" onClick={() => setAdding('planned')}>
              <Plus className="size-4" aria-hidden="true" />
              Add a reminder
            </Button>
          }
        />
      ) : (
        <>
          {needs.length > 0 ? (
            <section aria-labelledby={needsId} className="flex animate-rise flex-col gap-4">
              <SectionHeading id={needsId} title="Needs you" count={needs.length} />
              <ul className="flex flex-col gap-2">{needs.map(row)}</ul>
            </section>
          ) : null}
          {later.length > 0 ? (
            <section aria-labelledby={laterId} className="flex animate-rise flex-col gap-4">
              <SectionHeading id={laterId} title="Coming up" count={later.length} />
              <ul className="flex flex-col gap-2">{later.map(row)}</ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
