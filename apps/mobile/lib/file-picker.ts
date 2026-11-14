import * as FileSystem from 'expo-file-system';
import type { FinalizeDocumentUpload, FinalizePhotoUpload } from '@vehicle-os/contracts';
import { api } from './api';

/**
 * Picking a file, without letting a missing native module take the app down.
 *
 * `expo-document-picker` is a native module. Importing it at the top of a screen throws
 * "Cannot read property 'EventEmitter' of undefined" when the runtime does not have it
 * compiled in — and because that happens while the module graph is loading,
 * `AppRegistry.registerComponent` never runs and *every* screen goes blank behind Expo Go's
 * spinner. One unavailable feature took out the whole app.
 *
 * So it is required at the moment of use, and its absence is a message rather than a crash.
 */

export interface PickedFile {
  readonly name: string;
  readonly uri: string;
  readonly mimeType: string;
  readonly size: number;
}

export class PickerUnavailableError extends Error {
  constructor() {
    super('Attaching files needs a development build. Use the web for now.');
    this.name = 'PickerUnavailableError';
  }
}

/**
 * The picker is there but failed: out of memory, the photo library refused, an iCloud original
 * that would not download. Said as what it is — "needs a development build" was wrong on every
 * release build, where the picker is always there.
 */
export class PickerFailedError extends Error {
  constructor(what: 'files' | 'photos' | 'camera', cause?: unknown) {
    super(
      what === 'camera'
        ? 'The camera could not be opened. Try again.'
        : `Your ${what} could not be opened. Try again.`,
      { cause },
    );
    this.name = 'PickerFailedError';
  }
}

/** The module's native half is missing from this build — the only case that is not a failure. */
const missingNative = (error: unknown) =>
  error instanceof Error &&
  /native module|EventEmitter|not (?:available|linked)/i.test(error.message);

/** What the API's schema accepts; the picker is limited to the same list. */
export const ACCEPTED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'text/plain',
];

interface DocumentPickerModule {
  getDocumentAsync: (options: { type: string[]; copyToCacheDirectory: boolean }) => Promise<{
    canceled: boolean;
    assets: { name: string; uri: string; mimeType?: string; size?: number }[] | null;
  }>;
}

function loadPicker(): DocumentPickerModule {
  try {
    /*
     * A deliberate `require`, not an `import`. A static import is hoisted and runs while the
     * module graph loads, which is exactly what took the app down; this one runs when
     * somebody taps the button, where the failure can be caught and explained.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-document-picker') as DocumentPickerModule;
  } catch {
    throw new PickerUnavailableError();
  }
}

/** Returns the chosen file, or null if the picker was dismissed. */
export async function pickFile(): Promise<PickedFile | null> {
  const picker = loadPicker();

  let result;
  try {
    result = await picker.getDocumentAsync({
      type: ACCEPTED_TYPES,
      copyToCacheDirectory: true,
    });
  } catch (error) {
    // The module loaded but its native half is not there — the same situation, found later.
    if (missingNative(error)) throw new PickerUnavailableError();
    throw new PickerFailedError('files', error);
  }

  const asset = result.canceled ? null : (result.assets?.[0] ?? null);
  if (!asset) return null;
  return {
    name: asset.name,
    uri: asset.uri,
    mimeType: asset.mimeType ?? 'application/pdf',
    size: asset.size ?? 0,
  };
}

interface ImagePickerModule {
  requestCameraPermissionsAsync: () => Promise<{ granted: boolean }>;
  launchCameraAsync: (options: ImageOptions) => Promise<ImageResult>;
  launchImageLibraryAsync: (options: ImageOptions) => Promise<ImageResult>;
}
interface ImageOptions {
  mediaTypes: 'images'[];
  quality: number;
  exif: boolean;
  allowsMultipleSelection?: boolean;
  selectionLimit?: number;
}
interface ImageResult {
  canceled: boolean;
  assets:
    | {
        uri: string;
        fileName?: string | null;
        mimeType?: string;
        fileSize?: number;
        width?: number;
        height?: number;
      }[]
    | null;
}

interface ManipulatorModule {
  manipulateAsync: (
    uri: string,
    actions: { resize: { width?: number; height?: number } }[],
    options: { compress: number; format: string },
  ) => Promise<{ uri: string }>;
  SaveFormat: { JPEG: string };
}

/**
 * The longest edge a photo is sent at. A phone camera's 12–48 MP original is 3–10 MB of detail
 * nobody zooms to on a receipt or a car card; 2048 px is sharp on any screen, readable for the
 * receipt reader, and a fifth of the bytes to send on a cellular link.
 */
const LONGEST_EDGE = 2048;

/**
 * A picked photo as it will be sent: no larger than `LONGEST_EDGE`, and JPEG — an iPhone's HEIC
 * is not something every browser or Android version can show. A phone whose build lacks the
 * manipulator, or a resize that fails, sends the original rather than nothing.
 */
async function prepare(
  asset: NonNullable<ImageResult['assets']>[number],
  quality: number,
  index: number,
): Promise<PickedFile> {
  const mimeType = asset.mimeType ?? 'image/jpeg';
  const base = asset.fileName?.replace(/\.[^.]+$/, '') ?? `photo-${Date.now()}-${index}`;
  const original: PickedFile = {
    // Indexed, so several picked in the same millisecond do not share a name.
    name: asset.fileName ?? `${base}.${mimeType.split('/')[1] ?? 'jpg'}`,
    uri: asset.uri,
    mimeType,
    size: asset.fileSize ?? 0,
  };
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  const tooBig = Math.max(width, height) > LONGEST_EDGE;
  if (!tooBig && !/hei[cf]/.test(mimeType)) return original;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const manipulator = require('expo-image-manipulator') as ManipulatorModule;
    const resize = tooBig
      ? [{ resize: width >= height ? { width: LONGEST_EDGE } : { height: LONGEST_EDGE } }]
      : [];
    const { uri } = await manipulator.manipulateAsync(asset.uri, resize, {
      compress: quality,
      format: manipulator.SaveFormat.JPEG,
    });
    const info = await FileSystem.getInfoAsync(uri);
    return { name: `${base}.jpg`, uri, mimeType: 'image/jpeg', size: info.exists ? info.size : 0 };
  } catch {
    return original;
  }
}

export class CameraDeniedError extends Error {
  constructor() {
    super('Garaj needs the camera. Allow it in Settings, or upload instead.');
    this.name = 'CameraDeniedError';
  }
}

/**
 * A photo from the camera or the library, as the same `PickedFile` a document is.
 *
 * Required at the moment of use for the same reason as the document picker. Quality 0.8 re-encodes
 * to JPEG, so an iPhone's HEIC arrives as something every screen can draw; EXIF is not asked for,
 * because location in it is never shared unless someone opts in (§31). A receipt that is going to
 * be read asks for less: still sharp to read, and small enough to send to be read.
 */
export async function pickPhoto(
  source: 'camera' | 'library',
  quality = 0.8,
): Promise<PickedFile | null> {
  return (await pickPhotos(source, 1, quality))[0] ?? null;
}

/** Up to `limit` at once from the library; the camera always gives one. */
export async function pickPhotos(
  source: 'camera' | 'library',
  limit: number,
  quality = 0.8,
): Promise<PickedFile[]> {
  let picker: ImagePickerModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    picker = require('expo-image-picker') as ImagePickerModule;
  } catch {
    throw new PickerUnavailableError();
  }

  const options: ImageOptions = {
    mediaTypes: ['images'],
    quality,
    exif: false,
    ...(source === 'library' && limit > 1
      ? { allowsMultipleSelection: true, selectionLimit: limit }
      : {}),
  };
  let result: ImageResult;
  try {
    if (source === 'camera') {
      const permission = await picker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new CameraDeniedError();
      result = await picker.launchCameraAsync(options);
    } else {
      result = await picker.launchImageLibraryAsync(options);
    }
  } catch (error) {
    if (error instanceof CameraDeniedError) throw error;
    if (missingNative(error)) throw new PickerUnavailableError();
    throw new PickerFailedError(source === 'camera' ? 'camera' : 'photos', error);
  }

  if (result.canceled || !result.assets) return [];
  return Promise.all(result.assets.map((asset, index) => prepare(asset, quality, index)));
}

/** A file on the phone as base64, without the data-URL prefix: how a photo goes to be read. */
export async function readBase64(uri: string): Promise<string> {
  // Read natively, straight to base64: no Blob and data-URL copies of the photo in JS memory.
  try {
    return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  } catch (error) {
    throw new Error('The photo could not be read.', { cause: error });
  }
}

/**
 * A picked file travels between screens as route params — strings only, so it survives a
 * navigation without a store. `fromParams` returns null when the screen was opened without one.
 */
export const fileParams = (file: PickedFile) => ({
  fileUri: file.uri,
  fileName: file.name,
  fileType: file.mimeType,
  fileSize: String(file.size),
});
export type FileParams = Partial<ReturnType<typeof fileParams>>;

export function fromParams(params: FileParams): PickedFile | null {
  if (!params.fileUri || !params.fileName || !params.fileType) return null;
  return {
    uri: params.fileUri,
    name: params.fileName,
    mimeType: params.fileType,
    size: Number(params.fileSize) || 0,
  };
}

/**
 * The three-step upload — ask for a signed URL, PUT the bytes, confirm — for a file on the phone.
 *
 * The api-client's helpers take a browser `File`, which React Native does not have. The bytes come
 * off the local URI as a Blob instead, which also gives the real size when a picker did not.
 */
/**
 * The bytes, from the file straight to storage on the native side.
 *
 * `fetch(uri).blob()` pulled the whole file into JS memory first — a 20 MB scan as a 20 MB
 * string on the JS heap, then a copy for the request body. `uploadAsync` streams it from disk,
 * and the size signed into the ticket is the file's own, so storage cannot refuse a mismatch.
 */
async function send(file: PickedFile, ticket: (size: number) => Promise<{ uploadUrl: string }>) {
  const info = await FileSystem.getInfoAsync(file.uri);
  if (!info.exists) throw new Error('The file is no longer on this phone. Attach it again.');
  const { uploadUrl } = await ticket(info.size || file.size);
  /*
   * A rejection here is the connection going, not storage answering: said as a network failure,
   * so the queue waits for signal instead of counting it toward giving up on the file.
   */
  const sent = await FileSystem.uploadAsync(uploadUrl, file.uri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'content-type': file.mimeType },
  }).catch((error: unknown) => {
    throw new Error('Network request failed during the upload.', { cause: error });
  });
  if (sent.status < 200 || sent.status >= 300) {
    throw new Error(`Upload failed with status ${sent.status}`);
  }
}

export async function uploadDocumentFile(
  vehicleId: string,
  file: PickedFile,
  metadata: FinalizeDocumentUpload,
  /** Chosen by the queue, so a replay after a lost reply files one document, not two. */
  id?: string,
) {
  let documentId = '';
  await send(file, async (size) => {
    const ticket = await api.documents.requestUpload(
      vehicleId,
      { name: file.name, type: file.mimeType, size },
      id,
    );
    documentId = ticket.documentId;
    return ticket;
  });
  return api.documents.finalize(vehicleId, documentId, metadata);
}

export async function uploadPhotoFile(
  vehicleId: string,
  file: PickedFile,
  options: FinalizePhotoUpload = {},
  /** Chosen by the queue, so a replay after a lost reply files one photo, not two. */
  id?: string,
) {
  let photoId = '';
  await send(file, async (size) => {
    const ticket = await api.photos.requestUpload(
      vehicleId,
      { name: file.name, type: file.mimeType, size },
      id,
    );
    photoId = ticket.photoId;
    return ticket;
  });
  await api.photos.finalize(vehicleId, photoId, options);
}
