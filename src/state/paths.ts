// Constantes de caminho isoladas aqui (sem imports) para que nenhum outro módulo precise conhecer
// os literais concretos do estado — só `src/state/*` os importa.
export const MANIFEST_FILE = ".maker/manifest.json";
export const LOCKFILE = ".maker/maker.lock";
export const BASES_DIR = ".maker/bases";
export const ADDONS_DIR = ".maker/addons";

/** Protegem as bases de conversão de EOL e ignoram temporários; liberados para mediação apesar de estarem em `.maker`. */
export const GIT_CONTROL_FILES: readonly string[] = [".maker/.gitattributes", ".maker/.gitignore"];

export function basePath(hash: string): string {
  return `${BASES_DIR}/${hash}`;
}

export function isBaseName(name: string): boolean {
  return /^[a-f0-9]{64}$/.test(name);
}

export function addonStateFile(id: string): string {
  return `${ADDONS_DIR}/${id}.json`;
}

export function isAddonStateFile(path: string): boolean {
  return /^\.maker\/addons\/[^/]+\.json$/.test(path);
}

/**
 * manifest.json, maker.lock, .maker/addons/<id>.json e o diretório .maker/addons: aplicados por último
 * na transação e, entre eles, create/update antes de remove (crash no meio de uma migração deixa
 * coexistência, nunca "sem estado"). O diretório entra porque a migração files → pack o remove depois
 * de criar o lockfile.
 */
export function isStateMetadata(path: string): boolean {
  return path === MANIFEST_FILE || path === LOCKFILE || path === ADDONS_DIR || isAddonStateFile(path);
}
