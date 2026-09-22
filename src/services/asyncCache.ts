/** Bounded cache that shares in-flight work and retries failed computations. */
export function asyncCache<K, V>(compute: (key: K) => Promise<V>, capacity = 32) {
  const entries = new Map<K, Promise<V>>();
  return (key: K): Promise<V> => {
    const cached = entries.get(key);
    if (cached) {
      entries.delete(key);
      entries.set(key, cached);
      return cached;
    }
    const pending = compute(key);
    entries.set(key, pending);
    if (entries.size > capacity) entries.delete(entries.keys().next().value!);
    void pending.catch(() => {
      if (entries.get(key) === pending) entries.delete(key);
    });
    return pending;
  };
}
