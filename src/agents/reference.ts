const ADAPTER_INSTRUCTION = /Read `?(\.maker\/workflow\/agents\/[a-z0-9-]+\.md)`? completely before acting/;

/** Caminho do papel compartilhado referenciado pela instrução gerada do adapter, se houver. */
export function sharedRoleReference(content: string): string | undefined {
  return content.match(ADAPTER_INSTRUCTION)?.[1];
}

export function adapterInstruction(sharedPath: string): string {
  return `Read \`${sharedPath}\` completely before acting and follow it as your role instructions.\n`;
}
