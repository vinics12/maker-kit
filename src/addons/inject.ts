/**
 * Injeção idempotente e reversível de blocos em arquivos do motor, delimitada por
 * marcadores HTML-comment. Aplicar 2× produz o mesmo resultado; remover deleta o bloco.
 */

export const startMarker = (id: string): string => `<!-- maker:addon:${id}:start -->`;
export const endMarker = (id: string): string => `<!-- maker:addon:${id}:end -->`;

export function hasBlock(content: string, id: string): boolean {
  return content.includes(startMarker(id)) && content.includes(endMarker(id));
}

interface UpsertOpts {
  /** Se presente no texto, este literal é substituído pelo bloco (1ª inserção). */
  replacePlaceholder?: string;
  /** Senão, insere logo antes deste heading (ex.: "## Governance"). */
  beforeHeading?: string;
}

function wrap(id: string, block: string): string {
  return `${startMarker(id)}\n${block.trimEnd()}\n${endMarker(id)}`;
}

/** Insere ou atualiza o bloco do add-on. Retorna o novo conteúdo. */
export function upsertBlock(
  content: string,
  id: string,
  block: string,
  opts: UpsertOpts = {},
): string {
  const wrapped = wrap(id, block);
  const s = startMarker(id);
  const e = endMarker(id);

  if (content.includes(s) && content.includes(e)) {
    const re = new RegExp(`${escapeRe(s)}[\\s\\S]*?${escapeRe(e)}`);
    return content.replace(re, wrapped);
  }
  if (opts.replacePlaceholder && content.includes(opts.replacePlaceholder)) {
    return content.replace(opts.replacePlaceholder, wrapped);
  }
  if (opts.beforeHeading && content.includes(opts.beforeHeading)) {
    return content.replace(opts.beforeHeading, `${wrapped}\n\n${opts.beforeHeading}`);
  }
  return `${content.trimEnd()}\n\n${wrapped}\n`;
}

/** Remove o bloco do add-on (e linhas em branco adjacentes). Retorna o novo conteúdo. */
export function stripBlock(content: string, id: string): string {
  const s = startMarker(id);
  const e = endMarker(id);
  if (!content.includes(s) || !content.includes(e)) return content;
  const re = new RegExp(`\\n*${escapeRe(s)}[\\s\\S]*?${escapeRe(e)}\\n*`);
  return content.replace(re, "\n").replace(/\n{3,}/g, "\n\n");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
