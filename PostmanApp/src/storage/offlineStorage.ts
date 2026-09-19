import AsyncStorage from "@react-native-async-storage/async-storage";

// Namespaced cache for last-known-good server data (spec §19) and the
// pending-mutation queue. Plain AsyncStorage is sufficient here: payloads
// are small (a day's deliveries/route for one postman), and TanStack Query
// already handles in-memory caching — this layer exists purely so the app
// has *something* to render on a cold, offline launch.
const KEYS = {
  profile: "cache:profile",
  deliveries: "cache:deliveries",
  route: "cache:route",
  mutationQueue: "offline:mutationQueue"
} as const;

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export const offlineStorage = {
  getCachedProfile: <T>() => readJson<T>(KEYS.profile),
  setCachedProfile: (value: unknown) => writeJson(KEYS.profile, value),

  getCachedDeliveries: <T>() => readJson<T>(KEYS.deliveries),
  setCachedDeliveries: (value: unknown) => writeJson(KEYS.deliveries, value),

  getCachedRoute: <T>() => readJson<T>(KEYS.route),
  setCachedRoute: (value: unknown) => writeJson(KEYS.route, value),

  getMutationQueue: <T>() => readJson<T[]>(KEYS.mutationQueue).then((v) => v ?? []),
  setMutationQueue: (value: unknown[]) => writeJson(KEYS.mutationQueue, value),

  async clearAll(): Promise<void> {
    await AsyncStorage.multiRemove(Object.values(KEYS));
  }
};
