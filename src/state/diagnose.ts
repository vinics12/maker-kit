import type { BaseProblem } from "./lockfile.js";
import { BASES_DIR, LOCKFILE, MANIFEST_FILE } from "./paths.js";
import type { StateSnapshot } from "./store.js";
import { pendingDefaultMigration, type ConfiguredFormat } from "./format.js";

// Sem constante dedicada em paths.ts (não é manifest/lockfile/bases): mantido local, único uso.
const TRANSACTIONS_DIR = ".maker/transactions";

export type DoctorSeverity = "fail" | "warn" | "info";

export type DoctorFindingCode =
  | "pending-transaction" | "coexistence" | "unreadable" | "unknown-version" | "manifest-invalid"
  | "manifest-conflict" | "base-missing" | "base-corrupt" | "entry-truncated" | "entry-malformed"
  | "orphan-bases" | "loose-file-bases" | "bases-conflict-markers" | "pending-default-migration"
  | "config-invalid" | "config-unreadable";

export interface DoctorFinding {
  severity: DoctorSeverity;
  code: DoctorFindingCode;
  message: string;
  action: string;
  hash?: string;
  files?: string[];
}

const SEVERITY_RANK: Record<DoctorSeverity, number> = { fail: 0, warn: 1, info: 2 };

/** O `(linha N` já está formatado pelo emissor original (store.ts/lockfile.ts); só reaproveitamos o número. */
function lineFromMessage(message: string): string {
  return message.match(/\(linha (\d+)/)?.[1] ?? "?";
}

function stateErrorFinding(snapshot: StateSnapshot): DoctorFinding {
  const error = snapshot.error!;
  switch (error.kind) {
    case "coexistence":
      return {
        severity: "fail", code: "coexistence",
        message: `${MANIFEST_FILE} e ${LOCKFILE} coexistem`,
        action: "escolha um estado e remova o outro, ou restaure .maker do histórico do git",
      };
    case "unreadable": {
      // Só o manifest.json pode ficar ilegível sem lockfile presente; qualquer outra combinação é o lockfile.
      const isManifest = snapshot.hasManifestJson && !snapshot.hasLockfile;
      return {
        severity: "fail", code: "unreadable",
        message: isManifest ? "manifest ilegível" : "lockfile ilegível",
        action: `restaure ${isManifest ? MANIFEST_FILE : LOCKFILE} do histórico do git`,
      };
    }
    case "unknown-version":
      return {
        severity: "fail", code: "unknown-version",
        message: "versão de formato do lockfile desconhecida",
        action: "atualize o maker",
      };
    case "manifest-invalid":
      return {
        severity: "fail", code: "manifest-invalid",
        message: `seção de manifest do lockfile inválida (linha ${lineFromMessage(error.message)})`,
        action: `restaure ${LOCKFILE} do histórico do git`,
      };
    case "manifest-conflict":
      return {
        severity: "fail", code: "manifest-conflict",
        message: `marcadores de conflito do git na seção de manifest (linha ${lineFromMessage(error.message)})`,
        action: `resolva o conflito em ${LOCKFILE} ou restaure do histórico do git`,
      };
  }
}

function crlfSuffix(snapshot: StateSnapshot): string {
  return snapshot.crlfSuspected ? " o lockfile parece ter sido convertido para CRLF" : "";
}

function baseProblemFinding(problem: BaseProblem, snapshot: StateSnapshot): DoctorFinding {
  const hash = problem.hash ?? "?";
  if (problem.kind === "hash-mismatch") {
    if (problem.recovered) {
      return {
        severity: "fail", code: "base-corrupt",
        message: `base corrompida ${hash} [${problem.origin}]: ${problem.detail} (recuperável: fins de linha convertidos para CRLF)`,
        action: "rode maker update para regravá-la; confira .maker/.gitattributes",
        hash,
      };
    }
    return {
      severity: "fail", code: "base-corrupt",
      message: `base corrompida ${hash} [${problem.origin}]: ${problem.detail}`,
      action: `restaure a base ${hash} do histórico do git; confira .maker/.gitattributes (fim de linha)${crlfSuffix(snapshot)}`,
      hash,
    };
  }
  if (problem.kind === "size-mismatch") {
    return {
      severity: "fail", code: "entry-truncated",
      message: `entrada truncada ${hash}: ${problem.detail}`,
      action: `restaure ${LOCKFILE} do histórico do git`,
      hash,
    };
  }
  if (problem.kind === "truncated") {
    return {
      severity: "fail", code: "entry-truncated",
      message: `entrada truncada ${hash}: sem @end`,
      action: `restaure ${LOCKFILE} do histórico do git`,
      hash,
    };
  }
  // malformed
  return {
    severity: "fail", code: "entry-malformed",
    message: `entrada malformada no lockfile (linha ${problem.line ?? "?"})`,
    action: `restaure ${LOCKFILE} do histórico do git`,
  };
}

function referencedBaseHashes(snapshot: StateSnapshot): Map<string, string[]> {
  const byHash = new Map<string, string[]>();
  for (const [path, entry] of Object.entries(snapshot.manifest!.files)) {
    if (!entry.baseHash) continue;
    byHash.set(entry.baseHash, [...(byHash.get(entry.baseHash) ?? []), path]);
  }
  return byHash;
}

function baseMissingFindings(snapshot: StateSnapshot, referenced: Map<string, string[]>): DoctorFinding[] {
  const problemHashes = new Set(snapshot.problems.map((problem) => problem.hash).filter((hash): hash is string => !!hash));
  const findings: DoctorFinding[] = [];
  for (const [hash, files] of [...referenced.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (snapshot.bases.has(hash) || problemHashes.has(hash)) continue;
    findings.push({
      severity: "fail", code: "base-missing",
      message: `base ausente ${hash} (referenciada por ${files.join(", ")})`,
      action: `restaure a base ${hash} do histórico do git; sem a base, o próximo maker update preserva o arquivo e pede mediação`,
      hash, files,
    });
  }
  return findings;
}

function orphanBasesFinding(snapshot: StateSnapshot, referenced: Map<string, string[]>): DoctorFinding | null {
  const orphanCount = [...snapshot.bases.keys()].filter((hash) => !referenced.has(hash)).length;
  if (!orphanCount) return null;
  return {
    severity: "warn", code: "orphan-bases",
    message: `${orphanCount} base(s) órfã(s) no armazenamento`,
    action: "rode maker update para podá-las",
  };
}

function looseFileBasesFinding(snapshot: StateSnapshot): DoctorFinding | null {
  if (snapshot.inUse !== "pack" || !snapshot.looseFileBases.length) return null;
  return {
    severity: "warn", code: "loose-file-bases",
    message: `bases por arquivo em ${BASES_DIR} junto ao lockfile`,
    action: "rode maker update para consolidar no formato configurado",
  };
}

function conflictMarkersFinding(snapshot: StateSnapshot): DoctorFinding | null {
  if (!snapshot.conflictMarkersInBases) return null;
  return {
    severity: "warn", code: "bases-conflict-markers",
    message: "marcadores de conflito do git na seção de bases",
    action: "rode maker update para regravar o lockfile",
  };
}

function configFindings(configured: ConfiguredFormat): DoctorFinding[] {
  if (configured.kind === "invalid") {
    return [{ severity: "fail", code: "config-invalid", message: configured.message, action: "corrija state.bases em maker.config.json" }];
  }
  if (configured.kind === "unreadable") {
    return [{ severity: "warn", code: "config-unreadable", message: configured.message, action: "corrija o JSON de maker.config.json; o formato das bases segue o registrado" }];
  }
  return [];
}

function pendingDefaultMigrationFinding(snapshot: StateSnapshot, configured: ConfiguredFormat): DoctorFinding | null {
  if (!pendingDefaultMigration({ inUse: snapshot.inUse!, recorded: snapshot.recorded }, configured)) return null;
  return {
    severity: "info", code: "pending-default-migration",
    message: `o próximo maker update migrará as bases para o formato "pack"`,
    action: `para manter bases por arquivo, declare "state": { "bases": "files" } em maker.config.json`,
  };
}

/**
 * Leitura pura sobre um `StateSnapshot` já obtido: nunca lê disco, nunca lança. `pendingTransactions`
 * e `error` (sem manifest) fecham a lista com um único achado — não há o que mais verificar.
 */
export function diagnoseState(snapshot: StateSnapshot, configured: ConfiguredFormat): DoctorFinding[] {
  if (snapshot.pendingTransactions) {
    return [{
      severity: "fail", code: "pending-transaction",
      message: `transação pendente em ${TRANSACTIONS_DIR}`,
      action: "rode um comando que altera o install (ex.: maker update) para recuperá-la",
    }];
  }

  if (snapshot.error) return [stateErrorFinding(snapshot)];

  if (!snapshot.manifest || !snapshot.inUse) return [];

  const referenced = referencedBaseHashes(snapshot);
  const findings: DoctorFinding[] = [
    ...snapshot.problems.map((problem) => baseProblemFinding(problem, snapshot)),
    ...baseMissingFindings(snapshot, referenced),
  ];
  const orphan = orphanBasesFinding(snapshot, referenced);
  if (orphan) findings.push(orphan);
  const loose = looseFileBasesFinding(snapshot);
  if (loose) findings.push(loose);
  const conflicts = conflictMarkersFinding(snapshot);
  if (conflicts) findings.push(conflicts);
  findings.push(...configFindings(configured));
  const pendingMigration = pendingDefaultMigrationFinding(snapshot, configured);
  if (pendingMigration) findings.push(pendingMigration);

  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
