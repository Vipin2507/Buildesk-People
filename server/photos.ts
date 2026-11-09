import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;
const directory = join(process.cwd(), "data", "photos");

function safeId(employeeId: string): string | null {
  return /^emp_[a-z0-9_]+$/i.test(employeeId) ? employeeId : null;
}

export function photoFile(employeeId: string): string | null {
  const id = safeId(employeeId);
  if (!id) return null;
  return join(directory, `${id}.jpg`);
}

export function isJpeg(bytes: Buffer): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Persist a cropped JPEG. Returns an error message, or null when the file is saved. */
export function writePhoto(employeeId: string, bytes: Buffer): string | null {
  const file = photoFile(employeeId);
  if (!file) return "That employee was not found.";
  if (bytes.length === 0) return "Choose an image before saving.";
  if (bytes.length > MAX_BYTES) return "That image is larger than 2 MB.";
  if (!isJpeg(bytes)) return "Use a JPEG, PNG, or WebP image. The preview is saved as a JPEG.";
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, bytes);
  return null;
}

export function readPhoto(employeeId: string): Buffer | null {
  const file = photoFile(employeeId);
  if (!file || !existsSync(file)) return null;
  return readFileSync(file);
}

export function deletePhoto(employeeId: string): void {
  const file = photoFile(employeeId);
  if (!file || !existsSync(file)) return;
  rmSync(file);
}
