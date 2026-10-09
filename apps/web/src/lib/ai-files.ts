/**
 * Files attached to a GarajAI line: what the model is sent, and how they are previewed.
 *
 * The model reads a photo at a reading size, not as shot — a 12-megapixel receipt is four
 * megabytes of upload for text a 1600-pixel copy holds just as well. The original still goes up
 * with the entry when it is approved; only the copy for reading is shrunk.
 */

import type { AiAttachment } from '@vehicle-os/contracts';
import { useEffect, useState } from 'react';
import { isImage } from '@/components/onboard-uploads';

const MAX_SIDE = 1600;
/** The contract's ceiling is ~3 MB of file once encoded; a bigger PDF is not sent to be read. */
const MAX_PDF = 2.9 * 1024 * 1024;

/** A file as the model can read it, or `null` for one it cannot (a spreadsheet, a HEIC). */
export async function toAttachment(file: File): Promise<AiAttachment | null> {
  if (file.type === 'application/pdf') {
    return file.size > MAX_PDF ? null : { mimeType: 'application/pdf', data: await base64(file) };
  }
  if (!isImage(file)) return null;
  try {
    // Throws for what the browser cannot decode (HEIC outside Safari): left out, not failed.
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82),
    );
    return blob ? { mimeType: 'image/jpeg', data: await base64(blob) } : null;
  } catch {
    return null;
  }
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** A preview URL for a file, revoked when the file changes or the preview goes. */
export function useObjectUrl(file: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setUrl(null);
    };
  }, [file]);
  return url;
}
