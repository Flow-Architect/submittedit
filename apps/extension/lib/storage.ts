import {
  createInitialExtensionState,
  EXTENSION_STORAGE_KEY,
  type ExtensionLocalState,
  resolveStoredExtensionState,
  validateExtensionState,
} from "./storage-schema";

export interface LocalStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export type LoadDisposition = "current" | "initialized" | "migrated" | "reset-malformed";

export interface LoadedExtensionState {
  state: ExtensionLocalState;
  disposition: LoadDisposition;
}

export async function loadExtensionState(
  area: LocalStorageArea,
  now = new Date().toISOString(),
): Promise<LoadedExtensionState> {
  const stored = await area.get(EXTENSION_STORAGE_KEY);
  if (!(EXTENSION_STORAGE_KEY in stored)) {
    const state = createInitialExtensionState(now);
    await area.set({ [EXTENSION_STORAGE_KEY]: state });
    return { state, disposition: "initialized" };
  }

  const resolved = resolveStoredExtensionState(stored[EXTENSION_STORAGE_KEY], now);
  if (resolved.kind === "current") {
    return { state: resolved.state, disposition: "current" };
  }

  await area.set({ [EXTENSION_STORAGE_KEY]: resolved.state });
  return {
    state: resolved.state,
    disposition: resolved.kind === "migrated" ? "migrated" : "reset-malformed",
  };
}

export async function saveExtensionState(
  area: LocalStorageArea,
  state: ExtensionLocalState,
  now = new Date().toISOString(),
): Promise<ExtensionLocalState> {
  const next = { ...state, updatedAt: now };
  const validated = validateExtensionState(next);
  if (!validated) {
    throw new Error("SubmittedIt refused to store an invalid local state.");
  }
  await area.set({ [EXTENSION_STORAGE_KEY]: validated });
  return validated;
}

export async function resetExtensionState(
  area: LocalStorageArea,
  now = new Date().toISOString(),
): Promise<ExtensionLocalState> {
  const state = createInitialExtensionState(now);
  await area.set({ [EXTENSION_STORAGE_KEY]: state });
  return state;
}

export async function deleteAllExtensionData(
  area: LocalStorageArea,
  now = new Date().toISOString(),
): Promise<ExtensionLocalState> {
  await area.remove(EXTENSION_STORAGE_KEY);
  return resetExtensionState(area, now);
}
