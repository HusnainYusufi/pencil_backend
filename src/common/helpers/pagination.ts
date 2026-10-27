export interface PageQuery {
  page: number;
  pageSize: number;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

export const toSkipTake = ({ page, pageSize }: PageQuery) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

export function buildPage<T>(items: T[], total: number, { page, pageSize }: PageQuery): Page<T> {
  return {
    items,
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

/**
 * Keyset (cursor) pagination for large, append-heavy tables (journal lines,
 * audit logs): stable under inserts and O(1) per page regardless of depth.
 */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export const encodeCursor = (value: Record<string, string | number>): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

export function decodeCursor<T extends Record<string, string | number>>(cursor: string): T | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/** Fetch `limit + 1` rows, then call this to split off the look-ahead row. */
export function buildCursorPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => Record<string, string | number>,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null };
}
