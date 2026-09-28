/** Nome do arquivo de manifest gravado na raiz do install (formato "files"). */
export const MANIFEST_FILE = ".maker/manifest.json";

/** Lockfile do estado compacto (formato "pack"). */
export const LOCKFILE = ".maker/maker.lock";

/** Diretório de bases upstream do formato "files". */
export const BASES_DIR = ".maker/bases";

/** Arquivos de controle do git gerenciados dentro de `.maker` (mediáveis; ver D3/B1). */
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
