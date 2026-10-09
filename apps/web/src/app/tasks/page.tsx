'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { TaskBuckets } from '@vehicle-os/contracts';
import { taskBucketsQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { TaskForm } from '@/components/task-form';
import { TaskItem } from '@/components/task-item';
import { Button, EmptyState } from '@/components/ui/primitives';
import { ListSkeleton, Loading, Skeleton } from '@/components/ui/skeleton';

/**
 * The task centre (PRD §29).
 *
 * The buckets and their counts arrive ready to render — bucketed against the user's own
 * timezone, not the browser's. Re-bucketing here would make the same task "today" on a
 * laptop in a hotel abroad and overdue at home.
 */
const SECTIONS: { key: keyof TaskBuckets['counts']; label: string; tone?: string }[] = [
  { key: 'overdue', label: 'Overdue', tone: 'text-destructive' },
  { key: 'today', label: 'Today', tone: 'text-warning' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'someday', label: 'Someday' },
];

/** A number still loading, inside a sentence whose words are already drawn. */
function InlineCount() {
  return <Skeleton className="inline-block h-3.5 w-4 align-middle" />;
}

export default function TasksPage() {
  const [adding, setAdding] = useState(false);
  const buckets = useQuery(taskBucketsQuery(api));

  if (buckets.isError) {
    return <EmptyState title="Could not load tasks" description={buckets.error.message} />;
  }

  const data = buckets.data;
  const total = data ? Object.values(data.counts).reduce((sum, count) => sum + count, 0) : 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Tasks</h1>
          {/* The words are the same for everyone; only the two counts wait. */}
          <p className="mt-1 text-sm text-muted-foreground">
            {data ? data.counts.overdue : <InlineCount />} overdue ·{' '}
            {data ? data.counts.today : <InlineCount />} due today
          </p>
        </div>

        <Button variant="primary" onClick={() => setAdding((open) => !open)}>
          <Plus className="size-4" aria-hidden="true" />
          Add task
        </Button>
      </div>

      {adding ? <TaskForm onDone={() => setAdding(false)} /> : null}

      {buckets.isPending ? (
        <Loading label="Loading tasks">
          {/*
           * Rows only, no heading placeholders. Which buckets appear — Overdue, Today — is
           * itself the data, so a guessed heading would be a claim the page cannot yet make.
           */}
          <ListSkeleton rows={4} />
        </Loading>
      ) : total === 0 ? (
        <EmptyState
          title="Nothing on the list"
          description="Tasks are the things that need doing but are not a service interval — an inspection to book, a part to order."
        />
      ) : (
        SECTIONS.map(({ key, label, tone }) => {
          const list = data?.[key] ?? [];
          if (list.length === 0) return null;
          return (
            <section key={key} aria-labelledby={`tasks-${key}`}>
              <h2
                id={`tasks-${key}`}
                className={`mb-3 text-sm font-medium ${tone ?? 'text-foreground'}`}
              >
                {label} <span className="tabular-nums text-muted-foreground">({list.length})</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {list.map((task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
