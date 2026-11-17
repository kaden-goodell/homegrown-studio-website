import type { KvStore } from '@lib/blob-store'

/** An in-memory KvStore for tests. */
export function memoryKv(): KvStore & { data: Map<string, string>; failReads?: boolean } {
  const data = new Map<string, string>()
  const kv: any = {
    data,
    failReads: false,
    async get(k: string) { if (kv.failReads) throw new Error('store down'); return data.get(k) ?? null },
    async set(k: string, v: string) { data.set(k, v) },
    async getWithMeta(k: string) { return { value: data.get(k) ?? null, etag: null } },
    async setIfMatch(k: string, v: string) { data.set(k, v); return true },
    async list(prefix = '') { if (kv.failReads) throw new Error('store down'); return [...data.keys()].filter((k) => k.startsWith(prefix)) },
    async delete(k: string) { data.delete(k) },
  }
  return kv
}
