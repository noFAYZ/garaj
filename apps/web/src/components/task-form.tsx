'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Task } from '@vehicle-os/contracts';
import { TASK_CATEGORIES, TASK_PRIORITIES } from '@vehicle-os/domain';
import { ApiError } from '@vehicle-os/api-client';
import { garagesQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { FormError, ModalActions } from '@/components/ui/modal';
import { DateField } from '@/components/ui/date-picker';
import { humanise } from '@/lib/format';
import { ANY_VALUE, SelectField } from '@/components/ui/select-field';
import { Button, Field, SectionCard } from '@/components/ui/primitives';

/**
 * Creating a task.
 *
 * `vehicleId` fixes the task to one vehicle (the vehicle tab); left out, the garage and the
 * vehicle are both chosen here, because a task at `/tasks` can belong to any of them —
 * including none, which is what garage-level work like "renew the insurance" is.
 */
/**
 * One form for adding and for correcting.
 *
 * The fields are identical, and a second copy would drift from this one the first time a
 * field is added — the correction form would quietly stop offering something the entry form
 * asks for.
 */
export function TaskForm({
  vehicleId,
  garageId,
  task,
  onDone,
  bare = false,
}: {
  vehicleId?: string;
  garageId?: string;
  /** Present when correcting an existing task; absent when adding one. */
  task?: Task;
  onDone: () => void;
  /**
   * The form alone, for a dialog that already has its own title. Inside a modal the card's heading
   * was a second header under the first, and its buttons sat apart from every other dialog's.
   */
  bare?: boolean;
}) {
  const queryClient = useQueryClient();
  const garages = useQuery({ ...garagesQuery(api), enabled: !garageId });
  const vehicles = useQuery({ ...vehiclesQuery(api), enabled: !vehicleId });

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [priority, setPriority] = useState<Task['priority']>(task?.priority ?? 'MEDIUM');
  const [category, setCategory] = useState<Task['category']>(task?.category ?? TASK_CATEGORIES[0]);
  const [chosenVehicle, setChosenVehicle] = useState(task?.vehicleId ?? vehicleId ?? '');
  const [chosenGarage, setChosenGarage] = useState(task?.garageId ?? garageId ?? '');

  // A vehicle already names its garage, so picking one settles the tenant without a second
  // question — and the garage select is only there for tasks that name no vehicle at all.
  const vehicleList = vehicles.data?.data ?? [];
  const garageList = garages.data ?? [];
  const resolvedGarage =
    garageId ??
    vehicleList.find((vehicle) => vehicle.id === chosenVehicle)?.garageId ??
    chosenGarage ??
    garageList[0]?.id;

  const mutation = useMutation({
    mutationFn: () =>
      task
        ? api.tasks.update(task.id, {
            title,
            priority,
            category,
            // Nullable on update, so an emptied box clears the value rather than being
            // silently ignored — which is the only way to remove a due date once set.
            description: description || null,
            dueDate: dueDate || null,
          })
        : api.tasks.create({
            garageId: resolvedGarage!,
            title,
            priority,
            category,
            ...(chosenVehicle ? { vehicleId: chosenVehicle } : {}),
            ...(description ? { description } : {}),
            ...(dueDate ? { dueDate } : {}),
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onDone();
    },
  });

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fields : undefined;

  const form = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <Field
        label="What needs doing"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Book the annual inspection"
        error={fieldErrors?.title}
        required
      />

      <Field
        label="Details"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        error={fieldErrors?.description}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <DateField
          label="Due"
          value={dueDate}
          onChange={setDueDate}
          hint="Leave empty for someday."
          error={fieldErrors?.dueDate}
        />

        <SelectField
          label="Priority"
          value={priority}
          onChange={(value) => setPriority(value as Task['priority'])}
          options={TASK_PRIORITIES.map((value) => ({ value, label: humanise(value) }))}
        />

        <SelectField
          label="Category"
          value={category}
          onChange={(value) => setCategory(value as Task['category'])}
          options={TASK_CATEGORIES.map((value) => ({ value, label: humanise(value) }))}
        />
      </div>

      {/*
       * Not when correcting: the update does not move a task between vehicles, so a vehicle
       * select there was a control that changed nothing on save.
       */}
      {!vehicleId && !task ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/*
           * `SelectField` rather than a hand-built label and select: those labels pointed at
           * ids nothing carried, so clicking "Vehicle" did nothing.
           */}
          <SelectField
            label="Vehicle"
            value={chosenVehicle || ANY_VALUE}
            onChange={(next) => setChosenVehicle(next === ANY_VALUE ? '' : next)}
            options={[
              { value: ANY_VALUE, label: 'No vehicle — garage work' },
              ...vehicleList.map((vehicle) => ({
                value: vehicle.id,
                label: vehicle.displayName,
              })),
            ]}
          />

          {chosenVehicle || garageId ? null : (
            <SelectField
              label="Garage"
              value={chosenGarage}
              onChange={setChosenGarage}
              options={garageList.map((garage) => ({ value: garage.id, label: garage.name }))}
            />
          )}
        </div>
      ) : null}

      {mutation.isError && !fieldErrors ? (
        <FormError>{(mutation.error as Error).message}</FormError>
      ) : null}

      {/* In a dialog it ends like every dialog (`ModalActions`); on the page, the action leads. */}
      {bare ? (
        <ModalActions>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={mutation.isPending}
            disabled={!resolvedGarage}
          >
            {/* The edit form said "Add task" too, which reads as making a second copy. */}
            {task ? 'Save changes' : 'Add task'}
          </Button>
        </ModalActions>
      ) : (
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="primary"
            loading={mutation.isPending}
            disabled={!resolvedGarage}
          >
            {task ? 'Save changes' : 'Add task'}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      )}
    </form>
  );

  if (bare) return form;

  return (
    <SectionCard
      title={task ? 'Edit this task' : 'Add a task'}
      description={
        task
          ? 'The vehicle it belongs to is fixed; everything else can change.'
          : 'Anything that needs doing, with or without a date.'
      }
    >
      {form}
    </SectionCard>
  );
}
