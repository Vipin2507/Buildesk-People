export function photoSrc(id: string, updatedAt?: string | null): string | undefined {
  if (!updatedAt) return undefined;
  return `/api/people/${encodeURIComponent(id)}/photo?v=${encodeURIComponent(updatedAt)}`;
}

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const PHOTO_MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export function photoFileProblem(file: File): string | null {
  const named = /\.(jpe?g|png|webp)$/i.test(file.name);
  const typed = PHOTO_TYPES.includes(file.type);
  if (file.type && !typed) return "Use a JPEG, PNG, or WebP image.";
  if (!file.type && !named) return "Use a JPEG, PNG, or WebP image.";
  if (!typed && !named) return "Use a JPEG, PNG, or WebP image.";
  if (file.size > PHOTO_MAX_SOURCE_BYTES) return "That image is larger than 8 MB.";
  return null;
}
