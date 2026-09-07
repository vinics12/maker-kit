import { z } from "zod";

/** Um knob interativo do add-on (só string na v1). */
export const addonKnobSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "knob.name deve ser identificador simples"),
  prompt: z.string(),
  default: z.string().default(""),
});

/** Um fragmento anexado a um agente do motor. */
export const agentFragmentSchema = z.object({
  agent: z.string(), // nome do agente-alvo (sem .md), ex.: "code-reviewer"
  file: z.string(), // path relativo ao dir do add-on, ex.: "agents/code-reviewer.fragment.md.hbs"
});

/** Um arquivo materializado pelo add-on (memória, skill, doc de referência). */
export const addonFileSchema = z.object({
  from: z.string(), // path relativo ao dir do add-on
  to: z.string(), // path relativo ao target, ex.: ".specify/memory/saas-reference.md"
});

export const addonManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id deve ser kebab-case"),
  name: z.string(),
  description: z.string().default(""),
  version: z.string().default("0.1.0"),
  knobs: z.array(addonKnobSchema).default([]),
  /** .hbs injetados na seção "Princípios do Projeto" da constitution. */
  principles: z.array(z.string()).default([]),
  /** fragmentos anexados a agentes específicos. */
  agentFragments: z.array(agentFragmentSchema).default([]),
  /** arquivos novos escritos no target (renderizados se .hbs). */
  files: z.array(addonFileSchema).default([]),
});

export type AddonManifest = z.infer<typeof addonManifestSchema>;
export type AddonKnob = z.infer<typeof addonKnobSchema>;
