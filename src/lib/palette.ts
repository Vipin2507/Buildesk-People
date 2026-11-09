/** Shared brand avatar accents. Stored on employee records as hex; keep stable. */
export const AVATAR_COLORS = [
  "#1d4ed8", /* primary-700 */
  "#0f766e", /* teal-700 */
  "#0369a1", /* sky-700 */
  "#b45309", /* amber-700 */
  "#4338ca", /* indigo-700 */
] as const;

export function avatarColorAt(index: number): string {
  return AVATAR_COLORS[((index % AVATAR_COLORS.length) + AVATAR_COLORS.length) % AVATAR_COLORS.length];
}
