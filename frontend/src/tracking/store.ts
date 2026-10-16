/**
 * The hike in progress, kept in IndexedDB until it is saved or discarded (TM05-111), so a
 * reload, a crashed tab or a phone that unloads the page in the background does not lose
 * it. Nothing here goes to the server.
 *
 * One hike at a time, under one key. It records who started it: a hike started by one
 * account is not offered to another that signs in on the same browser, and a signed-out
 * hike is offered to whoever is signed in next (they are the one holding the phone).
 *
 * The storage itself is a small get/set/delete interface, so node --test runs this module
 * against a Map and the browser against IndexedDB.
 */

import type { Recording } from "./track.ts";

export interface KeyValue {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

const KEY = "active-hike";

export class ActiveHikeStore {
  private readonly kv: KeyValue;
  constructor(kv: KeyValue) {
    this.kv = kv;
  }

  async save(recording: Recording): Promise<void> {
    await this.kv.set(KEY, recording);
  }

  /** The hike in progress, if there is one and it is this user's to see. */
  async load(username: string | null): Promise<Recording | null> {
    const stored = (await this.kv.get(KEY)) as Recording | undefined;
    if (!stored || typeof stored !== "object" || !Array.isArray(stored.segments)) return null;
    if (stored.owner !== null && stored.owner !== username) return null;
    return stored;
  }

  /** Discarded, or saved to the server: gone from this browser. */
  async clear(): Promise<void> {
    await this.kv.delete(KEY);
  }
}

export function memoryKeyValue(): KeyValue & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => structuredClone(data.get(key)),
    set: async (key, value) => void data.set(key, structuredClone(value)),
    delete: async (key) => void data.delete(key),
  };
}

const DB = "campsite";
const STORE = "tracking";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      }),
  );
}

/** IndexedDB, or (private windows where it throws) memory for this page's life. */
export function browserKeyValue(): KeyValue {
  if (typeof indexedDB === "undefined") return memoryKeyValue();
  const fallback = memoryKeyValue();
  return {
    get: (key) => run("readonly", (store) => store.get(key)).catch(() => fallback.get(key)),
    set: (key, value) =>
      run("readwrite", (store) => store.put(value, key)).then(
        () => undefined,
        () => fallback.set(key, value),
      ),
    delete: (key) =>
      run("readwrite", (store) => store.delete(key)).then(
        () => undefined,
        () => fallback.delete(key),
      ),
  };
}
