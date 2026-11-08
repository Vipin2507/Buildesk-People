import type { UserAccount } from "../types";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function findAccountByEmail(accounts: UserAccount[], email: string): UserAccount | undefined {
  const key = normalizeEmail(email);
  return accounts.find((item) => item.email === key);
}

