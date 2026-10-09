import { describe, expect, it } from 'vitest';
import type { PlannedItem } from '@vehicle-os/contracts';
import { orderPlanned } from './planned-order';

const schedule = (title: string, status: string, nextDueDate: string | null): PlannedItem =>
  ({ kind: 'SCHEDULE', schedule: { title, status, nextDueDate } }) as unknown as PlannedItem;

const task = (title: string, dueDate: string | null): PlannedItem =>
  ({ kind: 'TASK', task: { title, dueDate } }) as unknown as PlannedItem;

const titles = (items: PlannedItem[]) =>
  items.map((item) => (item.kind === 'SCHEDULE' ? item.schedule.title : item.task.title));

const TODAY = '2026-09-13';

describe('orderPlanned', () => {
  it('puts an overdue task and an overdue schedule together, ahead of everything else', () => {
    const ordered = orderPlanned(
      [
        schedule('Tyres', 'OK', '2027-03-01'),
        task('Book inspection', '2026-09-01'),
        schedule('Oil', 'OVERDUE', '2026-08-20'),
        task('Order wipers', null),
      ],
      TODAY,
    );

    expect(titles(ordered)).toEqual(['Oil', 'Book inspection', 'Tyres', 'Order wipers']);
  });

  it('treats a task due within two weeks as due soon, and one further out as later', () => {
    const ordered = orderPlanned(
      [task('Next month', '2026-10-20'), task('Next week', '2026-09-20')],
      TODAY,
    );

    expect(titles(ordered)).toEqual(['Next week', 'Next month']);
  });

  it('orders by date within a band, undated last', () => {
    const ordered = orderPlanned(
      [
        schedule('Unscheduled', 'UNSCHEDULED', null),
        task('No date', null),
        schedule('Later', 'OK', '2027-06-01'),
        schedule('Sooner', 'OK', '2027-01-01'),
      ],
      TODAY,
    );

    expect(titles(ordered).slice(0, 2)).toEqual(['Sooner', 'Later']);
    expect(titles(ordered).slice(2).sort()).toEqual(['No date', 'Unscheduled']);
  });
});
