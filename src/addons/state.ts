import { addonStateSchema, type AddonState } from "../state/addon-state.js";
import { inspectState } from "../state/store.js";

export { addonStateSchema, type AddonState };

/** Lê o estado de um add-on pelo formato em uso. `StateError` (coexistência/ilegível) propaga. */
export async function readAddonState(targetDir: string, id: string): Promise<AddonState | null> {
  const snapshot = await inspectState(targetDir);
  if (snapshot.error) throw snapshot.error;
  const record = snapshot.addons.get(id);
  if (record) return record;
  const problem = snapshot.addonProblems.find((item) => item.id === id);
  if (problem) throw new Error(problem.detail);
  return null;
}

/** Só para log: falso em qualquer erro de leitura (coexistência, lockfile ilegível, etc.). */
export async function isAddonApplied(targetDir: string, id: string): Promise<boolean> {
  try {
    const snapshot = await inspectState(targetDir);
    if (snapshot.error) return false;
    return snapshot.addons.has(id);
  } catch {
    return false;
  }
}
