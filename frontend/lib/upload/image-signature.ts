export const MAX_ORIGINAL_IMAGE_BYTES = 20 * 1024 * 1024;

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

const startsWith = (bytes: Uint8Array, signature: number[]) =>
  signature.every((value, index) => bytes[index] === value);

export async function validateImageSignature(file: File): Promise<SupportedImageMime> {
  if (file.size <= 0) throw new Error(`${file.name} is empty.`);
  if (file.size > MAX_ORIGINAL_IMAGE_BYTES) {
    throw new Error(`${file.name} is larger than 20 MB.`);
  }

  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  let detected: SupportedImageMime | null = null;

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) detected = 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    detected = 'image/png';
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    detected = 'image/webp';
  }

  if (!detected) {
    throw new Error(`${file.name} is not a valid JPEG, PNG, or WebP image.`);
  }
  if (file.type.startsWith('image/') && file.type !== detected) {
    throw new Error(`${file.name} has a file signature that does not match its MIME type.`);
  }
  return detected;
}
