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
  } catch {
    // The module loaded but its native half is not there — the same situation, found later.
    throw new PickerUnavailableError();
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
  assets: { uri: string; fileName?: string | null; mimeType?: string; fileSize?: number }[] | null;
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
 * because location in it is never shared unless someone opts in (§31).
 */
export async function pickPhoto(source: 'camera' | 'library'): Promise<PickedFile | null> {
  return (await pickPhotos(source, 1))[0] ?? null;
}

/** Up to `limit` at once from the library; the camera always gives one. */
export async function pickPhotos(
  source: 'camera' | 'library',
  limit: number,
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
    quality: 0.8,
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
    throw new PickerUnavailableError();
  }

  if (result.canceled || !result.assets) return [];
  return result.assets.map((asset, index) => {
    const mimeType = asset.mimeType ?? 'image/jpeg';
    return {
      // Indexed, so several picked in the same millisecond do not share a name.
      name: asset.fileName ?? `photo-${Date.now()}-${index}.${mimeType.split('/')[1] ?? 'jpg'}`,
      uri: asset.uri,
      mimeType,
      size: asset.fileSize ?? 0,
    };
  });
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
async function send(file: PickedFile, ticket: (size: number) => Promise<{ uploadUrl: string }>) {
  const blob = await (await fetch(file.uri)).blob();
  const { uploadUrl } = await ticket(blob.size || file.size);
  const sent = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.mimeType },
    body: blob,
  });
  if (!sent.ok) throw new Error(`Upload failed with status ${sent.status}`);
}

export async function uploadDocumentFile(
  vehicleId: string,
  file: PickedFile,
  metadata: FinalizeDocumentUpload,
) {
  let documentId = '';
  await send(file, async (size) => {
    const ticket = await api.documents.requestUpload(vehicleId, {
      name: file.name,
      type: file.mimeType,
      size,
    });
    documentId = ticket.documentId;
    return ticket;
  });
  return api.documents.finalize(vehicleId, documentId, metadata);
}

export async function uploadPhotoFile(
  vehicleId: string,
  file: PickedFile,
  options: FinalizePhotoUpload = {},
) {
  let photoId = '';
  await send(file, async (size) => {
    const ticket = await api.photos.requestUpload(vehicleId, {
      name: file.name,
      type: file.mimeType,
      size,
    });
    photoId = ticket.photoId;
    return ticket;
  });
  await api.photos.finalize(vehicleId, photoId, options);
}
