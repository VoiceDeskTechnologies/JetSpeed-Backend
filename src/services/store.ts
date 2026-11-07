export type Resource = Record<string, unknown> & { id: string; created_at: string };

const tables: Record<string, Resource[]> = {};
const now = () => new Date().toISOString();
const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function list(resource: string): Resource[] {
  return tables[resource] ?? [];
}

export function create(resource: string, value: Record<string, unknown>): Resource {
  const record = { ...value, id: id(), created_at: now() } as Resource;
  tables[resource] = [...(tables[resource] ?? []), record];
  return record;
}

export function find(resource: string, key: string, value: unknown): Resource | undefined {
  return list(resource).find((item) => item[key] === value);
}
