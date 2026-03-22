import { randomUUID } from 'node:crypto';

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function estimateTokenCount(text: string): number {
  if (!text.trim()) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.trim().split(/\s+/).length * 1.33));
}

export function safeLower(value: string | undefined | null): string {
  return (value ?? '').toLowerCase();
}
