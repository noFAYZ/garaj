import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@vehicle-os/api-client';

/**
 * The queue is the one piece of this app with rules subtle enough to get wrong, and the one
 * piece that cannot be checked by looking at a screen: its whole job happens while there is
 * no network. So it is tested here rather than on a device.
 *
 * AsyncStorage and the API client are both replaced — the first is a native module with no
 * JS implementation off-device, and the second is what "offline" means.
 */
const store = new Map<string, string>();

/*
 * The file side of the queue, stubbed. `local-files` and `file-picker` reach expo's native
 * modules, whose sources are Flow — unparseable here, and nothing to do with the rules under
 * test. The upload path is exercised through these instead.
 */
const kept = new Set<string>();

vi.mock('./local-files', () => ({
  keepLocally: (_uri: string, id: string) => {
    const path = `/kept/${id}`;
    kept.add(path);
    return Promise.resolve(path);
  },
  forgetLocally: (path: string) => {
    kept.delete(path);
    return Promise.resolve();
  },
}));

const uploads: { target: string; vehicleId: string }[] = [];

const uploadDocument = vi.fn();

vi.mock('./file-picker', () => ({
  uploadDocumentFile: (vehicleId: string, ...rest: unknown[]) => {
    const outcome = uploadDocument(vehicleId, ...rest);
    uploads.push({ target: 'document', vehicleId });
    return outcome ?? Promise.resolve({});
  },
  uploadPhotoFile: (vehicleId: string) => {
    uploads.push({ target: 'photo', vehicleId });
    return Promise.resolve({});
  },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  },
}));

const createEvent = vi.fn();
const updateTask = vi.fn();
const logMaintenance = vi.fn();
const createVehicle = vi.fn();

vi.mock('./api', () => ({
  api: {
    events: { create: (...args: unknown[]) => createEvent(...args) },
    maintenance: {
      complete: vi.fn(),
      log: (...args: unknown[]) => logMaintenance(...args),
      createPlan: vi.fn(),
    },
    tasks: { update: (...args: unknown[]) => updateTask(...args) },
    vehicles: {
      create: (...args: unknown[]) => createVehicle(...args),
      update: vi.fn(),
      archive: vi.fn(),
    },
    users: { updateMe: vi.fn() },
    garages: { update: vi.fn() },
  },
}));

const { clearQueue, discard, enqueue, enqueueUpload, flush, keptFiles, pendingCount } =
  await import('./offline');

/** The queue ids of everything holding a file, so a test can discard one by id. */
const keptFilesEntries = async () => {
  const paths = await keptFiles();
  return paths.map((path) => path.replace('/kept/', ''));
};

const apiError = (status: number) => new ApiError(status, 'CODE', 'message', 'req');

beforeEach(async () => {
  store.clear();
  createEvent.mockReset();
  updateTask.mockReset();
  logMaintenance.mockReset();
  await clearQueue();
});

describe('enqueue', () => {
  it('keeps entries and counts them', async () => {
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'One' } });
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'Two' } });

    expect(await pendingCount()).toBe(2);
  });

  /** The entry has to survive the process dying between the pump and the next launch. */
  it('writes through to storage rather than holding entries in memory', async () => {
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'One' } });

    expect(store.get('vehicleos.pending-writes')).toContain('One');
  });
});

describe('flush', () => {
  it('sends everything and empties the queue when the network is there', async () => {
    createEvent.mockResolvedValue({});
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'One' } });
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'Two' } });

    const result = await flush();

    expect(result).toEqual({ sent: 2, failed: 0, remaining: 0 });
    expect(await pendingCount()).toBe(0);
  });

  /*
   * A fill-up and the odometer reading that follows it are not independent: sending them out
   * of order gives the vehicle a reading it then has to un-learn.
   */
  it('sends in the order they were recorded', async () => {
    createEvent.mockResolvedValue({});
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'First' } });
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'Second' } });

    await flush();

    expect(createEvent.mock.calls.map((call) => (call[1] as { title: string }).title)).toEqual([
      'First',
      'Second',
    ]);
  });

  /** No signal: nothing is lost, and nothing is sent out of order on the next attempt. */
  it('keeps everything when the very first send fails on the network', async () => {
    createEvent.mockRejectedValue(new Error('Network request failed'));
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'One' } });
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'Two' } });

    const result = await flush();

    expect(result).toEqual({ sent: 0, failed: 0, remaining: 2 });
    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  it('keeps what is left after a partial run', async () => {
    createEvent
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Network request failed'));
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'One' } });
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'Two' } });
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'Three' } });

    const result = await flush();

    expect(result).toEqual({ sent: 1, failed: 0, remaining: 2 });
    expect(await pendingCount()).toBe(2);
  });

  /*
   * The server has said this write is invalid, and it will still be invalid on the tenth
   * attempt. It must not block the entries behind it — and it must not vanish either, or the
   * person never learns their fill-up was not saved.
   */
  it('sets aside an entry the server rejected, with the reason, and sends the rest', async () => {
    createEvent.mockRejectedValueOnce(apiError(400)).mockResolvedValueOnce({});
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'Bad' } });
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'Good' } });

    const result = await flush();

    expect(result).toEqual({ sent: 1, failed: 1, remaining: 0 });
    expect(await pendingCount()).toBe(0);
    expect(store.get('vehicleos.pending-writes')).toContain('"error":"message"');

    // Not sent again on the next run.
    await flush();
    expect(createEvent).toHaveBeenCalledTimes(2);
  });

  it('lets a failed entry be discarded', async () => {
    createEvent.mockRejectedValueOnce(apiError(422));
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'Bad' } });
    await flush();

    const failed = JSON.parse(store.get('vehicleos.pending-writes')!) as { id: string }[];
    await discard(failed[0]!.id);

    expect(JSON.parse(store.get('vehicleos.pending-writes')!)).toEqual([]);
  });

  /** Overlapping runs would each send the head of the queue, and the server would record it twice. */
  it('shares one run between overlapping calls', async () => {
    createEvent.mockResolvedValue({});
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'Once' } });

    await Promise.all([flush(), flush(), flush()]);

    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  /** An expired session is not a verdict on the entry either: it waits for sign-in. */
  it('keeps an entry refused only because the session expired', async () => {
    createEvent.mockRejectedValue(apiError(401));
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'One' } });

    expect(await flush()).toEqual({ sent: 0, failed: 0, remaining: 1 });
  });

  /** A 500 is the server having a bad minute, not a verdict on the entry. */
  it('keeps an entry the server failed to process', async () => {
    createEvent.mockRejectedValue(apiError(500));
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'One' } });

    expect(await flush()).toEqual({ sent: 0, failed: 0, remaining: 1 });
  });

  it('does nothing, cheaply, when there is nothing queued', async () => {
    expect(await flush()).toEqual({ sent: 0, failed: 0, remaining: 0 });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('routes each kind of entry to its own endpoint', async () => {
    createEvent.mockResolvedValue({});
    updateTask.mockResolvedValue({});
    await enqueue({ kind: 'event', vehicleId: 'v1', body: { title: 'One' } });
    logMaintenance.mockResolvedValue({});
    await enqueue({ kind: 'task-status', taskId: 't1', status: 'COMPLETED' });
    await enqueue({ kind: 'maintenance-log', vehicleId: 'v1', body: { title: 'Service' } });

    await flush();

    expect(createEvent).toHaveBeenCalledWith('v1', { title: 'One' });
    expect(updateTask).toHaveBeenCalledWith('t1', { status: 'COMPLETED' });
    expect(logMaintenance).toHaveBeenCalledWith('v1', { title: 'Service' });
  });

  /*
   * The whole point of a queued upload: the bytes outlive the moment. A cache copy would be gone
   * by the time the phone found signal.
   */
  it('keeps an upload s bytes, sends them, and only then lets them go', async () => {
    await clearQueue();
    await enqueueUpload({
      kind: 'upload',
      target: 'document',
      vehicleId: 'v1',
      uri: 'file:///cache/scan.jpg',
      name: 'scan.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
      body: { documentType: 'REGISTRATION' },
    });

    expect(kept.size).toBe(1);
    expect(await pendingCount()).toBe(1);

    await flush();

    expect(uploads).toContainEqual({ target: 'document', vehicleId: 'v1' });
    // The copy is only released once the server has it.
    expect(kept.size).toBe(0);
    expect(await pendingCount()).toBe(0);
  });

  it('keeps the bytes when the upload cannot be sent', async () => {
    await clearQueue();
    kept.clear();
    uploads.length = 0;
    uploadDocument.mockRejectedValueOnce(new Error('offline'));

    await enqueueUpload({
      kind: 'upload',
      target: 'document',
      vehicleId: 'v1',
      uri: 'file:///cache/scan.jpg',
      name: 'scan.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
      body: {},
    });
    await flush();

    expect(await pendingCount()).toBe(1);
    expect(kept.size).toBe(1);
  });

  /** Discarding a failed upload must not leave its bytes on the phone for ever. */
  it('releases the bytes when an upload is discarded', async () => {
    await clearQueue();
    kept.clear();
    await enqueueUpload({
      kind: 'upload',
      target: 'photo',
      vehicleId: 'v1',
      uri: 'file:///cache/car.jpg',
      name: 'car.jpg',
      mimeType: 'image/jpeg',
      size: 2048,
      body: {},
    });

    const [entry] = await keptFilesEntries();
    await discard(entry!);

    expect(kept.size).toBe(0);
    expect(await pendingCount()).toBe(0);
  });

  it('sends a vehicle and its photo in the order they were queued', async () => {
    await clearQueue();
    kept.clear();
    uploads.length = 0;
    createVehicle.mockResolvedValue({});

    await enqueue({ kind: 'vehicle-create', body: { id: 'veh-1', garageId: 'g1' } });
    await enqueueUpload({
      kind: 'upload',
      target: 'photo',
      vehicleId: 'veh-1',
      uri: 'file:///cache/new.jpg',
      name: 'new.jpg',
      mimeType: 'image/jpeg',
      size: 10,
      body: { setAsPrimary: true },
    });

    await flush();

    // The vehicle first: its photo names an id the server has to have seen already.
    expect(createVehicle).toHaveBeenCalledWith({ id: 'veh-1', garageId: 'g1' });
    expect(uploads).toEqual([{ target: 'photo', vehicleId: 'veh-1' }]);
  });

  /** An app that cannot start until someone clears its storage is worse than a lost entry. */
  it('survives a corrupt queue rather than throwing', async () => {
    await clearQueue();
    store.set('vehicleos.pending-writes', '{not json');

    expect(await pendingCount()).toBe(0);
    expect(await flush()).toEqual({ sent: 0, failed: 0, remaining: 0 });
  });
});
