'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { Task } from '@vehicle-os/contracts';
import type { TaskPriority } from '@vehicle-os/domain';
import { queryKeys } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { Icon } from '@/components/icons';
import { formatDate, formatDistance, humanise } from '@/lib/format';
import { TaskForm } from '@/components/task-form';
import { Modal } from '@/components/ui/modal';
import { ConfirmDelete, RowMenu } from '@/components/ui/row-actions';
import { dueLabel, taskDays } from '@/lib/due';
import { Button } from '@/components/ui/primitives';
import { CARD, ReminderStatus } from '@/components/vehicle/schedule-row';
import { cn } from '@/lib/utils';

/** Priority as a dot: loud enough to scan a list by, quiet enough not to compete with the title. */
/** "SEP" and "25", from an ISO day, without a timezone shifting it to the day before. */
const monthOf = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { month: 'short' });
const dayOf = (day: string) => String(Number(day.slice(8, 10)));

const PRIORITY_DOT: Record<TaskPriority, string> = {
  URGENT: 'bg-destructive',
  HIGH: 'bg-warning',
  MEDIUM: 'bg-muted-foreground',
  LOW: 'bg-border-strong',
};

const PRIORITY_TEXT: Record<TaskPriority, string> = {
  URGENT: 'text-destructive',
  HIGH: 'text-warning',
  MEDIUM: 'text-muted-foreground',
  LOW: 'text-muted-foreground',
};

/**
 * When a task is due, said the way a person would: late, today, in a few days, or on a date.
 *
 * Days are counted between local midnights — a task due today is not "due in 0.4 days" because it
 * is the afternoon.
 */

/**
 * One task, with the only control it needs on the row: done or not.
 *
 * Everything else — reassigning, re-pricing, changing the category — is editing, and a list row
 * that can do all of it is a form pretending to be a list. Those open behind ⋯, as dialogs.
 */
export function TaskItem({
  task,
  showVehicle = true,
  layout = 'row',
}: {
  task: Task;
  showVehicle?: boolean;
  /** `card`: the same task and actions as a small upright tile, one line high. */
  layout?: 'row' | 'card';
}) {
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<'edit' | 'delete' | null>(null);
  const done = task.status === 'COMPLETED';

  /*
   * Every task list and bucket count changes when one task is ticked off or removed — and a
   * vehicle's task is also a planned item in that vehicle's activity, which lives under the
   * vehicle key rather than `tasks`, so it is invalidated by name.
   */
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    if (task.vehicleId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.activity(task.vehicleId) });
    }
  };

  const remove = useMutation({
    mutationFn: () => api.tasks.remove(task.id),
    onSuccess: () => {
      setSheet(null);
      invalidate();
    },
  });

  const toggle = useMutation({
    mutationFn: () => api.tasks.update(task.id, { status: done ? 'TODO' : 'COMPLETED' }),
    onSuccess: invalidate,
  });

  const due = dueLabel(task);

  const sheets = (
    <>
      {sheet === 'edit' ? (
        <Modal
          title="Edit task"
          description="The vehicle it belongs to stays fixed; everything else can change."
          icon="edit"
          size="lg"
          onClose={() => setSheet(null)}
        >
          <TaskForm task={task} onDone={() => setSheet(null)} bare />
        </Modal>
      ) : null}

      {sheet === 'delete' ? (
        <ConfirmDelete
          title={`Delete “${task.title}”?`}
          description="It is removed from the task list and from this vehicle's activity."
          confirmLabel="Delete task"
          pending={remove.isPending}
          error={remove.isError ? (remove.error as Error).message : null}
          onConfirm={() => remove.mutate()}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );

  const checkbox = (
    <button
      type="button"
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
      aria-pressed={done}
      aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
      aria-busy={toggle.isPending || undefined}
      className={cn(
        // 24px at least: the box is the row's one control, and a thumb misses a 20px target.
        'grid size-7 shrink-0 place-items-center rounded-lg transition-[background-color,color,scale] duration-200 active:scale-90',
        'aria-busy:animate-pulse',
        done
          ? 'bg-success text-background'
          : 'bg-muted text-transparent ring-1 ring-inset ring-border-strong hover:bg-border hover:text-muted-foreground',
      )}
    >
      {/* Re-keyed so the tick pops in each time it is checked, not only on first render. */}
      <Icon
        key={String(done)}
        name="check"
        size={16}
        className={done ? 'animate-pop' : undefined}
      />
    </button>
  );

  const menu = (className: string) => (
    <RowMenu
      label={`More for ${task.title}`}
      className={className}
      items={[
        { label: 'Edit task', icon: 'edit', onSelect: () => setSheet('edit') },
        {
          label: 'Delete task',
          icon: 'trash',
          destructive: true,
          onSelect: () => setSheet('delete'),
        },
      ]}
    />
  );

  if (layout === 'card') {
    const days = taskDays(task);
    // Late is red, this week amber — on the leaf's strip and on the chip.
    const tone = done
      ? 'done'
      : days === null
        ? 'later'
        : days < 0
          ? 'late'
          : days <= 7
            ? 'soon'
            : 'later';
    const detail = [
      due?.text ?? (task.dueDate ? `Due ${formatDate(task.dueDate)}` : 'No due date'),
      task.dueOdometer !== null ? `By ${formatDistance(task.dueOdometer, null)}` : null,
      `${humanise(task.priority)} priority`,
      humanise(task.category),
    ]
      .filter(Boolean)
      .join('. ');
    return (
      <li id={`task-${task.id}`} className={CARD}>
        <span className="absolute left-1 top-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-pressed={done}
            aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
            title={done ? 'Reopen' : 'Done'}
            loading={toggle.isPending}
            onClick={() => toggle.mutate()}
          >
            <Icon name={done ? 'refresh' : 'check'} size={16} />
          </Button>
        </span>
        <span className="absolute right-1 top-1">{menu('')}</span>

        {/*
         * A one-off job is a date, not an interval — so where a schedule has its ring, a task has a
         * leaf off a tear-off calendar, the ring's size so a rail of both lines up.
         */}
        <span
          role="img"
          aria-label={detail}
          title={detail}
          className="relative flex w-12 shrink-0 flex-col rounded-lg bg-muted text-center"
        >
          {/* Priority as a pin in the leaf's corner: seen down a rail without a word. */}
          <span
            aria-hidden="true"
            className={cn(
              'absolute -right-0.5 -top-0.5 z-10 size-2.5 rounded-full ring-2 ring-background',
              PRIORITY_DOT[task.priority],
            )}
          />
          <span
            className={cn(
              'rounded-t-lg font-mono text-[9px] font-bold uppercase leading-4 tracking-widest',
              {
                done: 'bg-success text-background',
                late: 'bg-destructive text-destructive-foreground',
                soon: 'bg-warning text-background',
                later: 'bg-border text-muted-foreground',
              }[tone],
            )}
          >
            {done ? 'Done' : task.dueDate ? monthOf(task.dueDate) : 'Any'}
          </span>
          <span className="grid h-8 place-items-center font-mono text-lg font-bold tabular-nums text-foreground">
            {done ? <Icon name="check" size={16} /> : task.dueDate ? dayOf(task.dueDate) : '—'}
          </span>
        </span>

        <p
          className={cn(
            'line-clamp-2 text-center text-sm font-semibold leading-tight',
            done ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        >
          {task.title}
        </p>
        <ReminderStatus tone={tone}>
          {done
            ? 'Complete'
            : days === null
              ? 'Any time'
              : days < 0
                ? `${-days}d late`
                : days === 0
                  ? 'Today'
                  : `In ${days}d`}
        </ReminderStatus>

        {sheets}
      </li>
    );
  }

  return (
    <li
      id={`task-${task.id}`}
      className="group scroll-mt-36 rounded-2xl bg-card/50 p-4 transition-colors hover:bg-card"
    >
      <div className="flex items-start gap-4">
        {/* The box sits in a tile-sized slot, so tasks and schedules line up down one column. */}
        <span className="grid size-12 shrink-0 place-items-center">{checkbox}</span>

        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-start justify-between gap-3">
            <p
              className={cn(
                'min-w-0 truncate text-sm font-semibold transition-colors',
                done
                  ? 'text-muted-foreground line-through decoration-muted-foreground/60'
                  : 'text-foreground',
              )}
            >
              {task.title}
            </p>

            {/*
             * Always in the DOM and focusable. Revealed on hover only where hovering exists —
             * controls that appear only on hover are unreachable by touch.
             */}
            {menu(
              '-my-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100',
            )}
          </div>

          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {due ? (
              <time dateTime={task.dueDate ?? undefined} className={cn('font-semibold', due.tone)}>
                {due.text}
              </time>
            ) : task.dueDate ? (
              <time dateTime={task.dueDate} className="tabular-nums">
                {formatDate(task.dueDate)}
              </time>
            ) : null}

            <span className={cn('inline-flex items-center gap-1.5', PRIORITY_TEXT[task.priority])}>
              <span
                aria-hidden="true"
                className={cn('size-1.5 rounded-full', PRIORITY_DOT[task.priority])}
              />
              {humanise(task.priority)}
            </span>

            <span>{humanise(task.category)}</span>

            {task.dueOdometer !== null ? (
              <span className="font-mono tabular-nums">
                by {formatDistance(task.dueOdometer, null)}
              </span>
            ) : null}

            {showVehicle && task.vehicleId && task.vehicleName ? (
              <Link
                href={`/vehicles/${task.vehicleId}`}
                className="rounded font-medium underline-offset-2 hover:text-foreground hover:underline"
              >
                {task.vehicleName}
              </Link>
            ) : null}
          </p>

          {task.description ? (
            <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{task.description}</p>
          ) : null}
        </div>
      </div>

      {sheets}
    </li>
  );
}
