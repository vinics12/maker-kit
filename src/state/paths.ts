// Constantes de caminho isoladas aqui (sem imports) para que nenhum outro módulo precise conhecer
// os literais concretos do estado — só `src/state/*` os importa.
export const MANIFEST_FILE = ".maker/manifest.json";
export const LOCKFILE = ".maker/maker.lock";
export const BASES_DIR = ".maker/bases";

/** Protegem as bases de conversão de EOL e ignoram temporários; liberados para mediação apesar de estarem em `.maker`. */
export const GIT_CONTROL_FILES: readonly string[] = [".maker/.gitattributes", ".maker/.gitignore"];

export function basePath(hash: string): string {
  return `${BASES_DIR}/${hash}`;
}

export function isBaseName(name: string): boolean {
  return /^[a-f0-9]{64}$/.test(name);
}

/**
 * manifest.json, maker.lock e .maker/addons/<id>.json: aplicados por último na transação e, entre eles,
 * create/update antes de remove (crash no meio de uma migração deixa coexistência, nunca "sem estado").
 */
export function isStateMetadata(path: string): boolean {
  return path === MANIFEST_FILE || path === LOCKFILE || /^\.maker\/addons\/[^/]+\.json$/.test(path);
}
