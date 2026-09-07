import { z } from "zod";

/**
 * maker.config.json — apenas knobs MECÂNICOS.
 * Nenhuma regra de negócio e nenhuma base técnica imposta aqui: banco, testes e
 * observabilidade são declarados pelo projeto consumidor nos stubs gerados, não neste config.
 */
export const configSchema = z.object({
  project: z.object({
    name: z.string().min(1, "project.name é obrigatório"),
    /** slug kebab-case; derivado de name quando ausente. */
    slug: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "project.slug deve ser kebab-case")
      .optional(),
  }),
  layout: z
    .object({
      /** Globs que o run-spec usa para rotear trabalho de frontend. */
      frontendGlobs: z.array(z.string()).default(["apps/*/src/**", "src/**"]),
      /** Globs que o run-spec usa para rotear trabalho de backend/dados. */
      backendGlobs: z
        .array(z.string())
        .default(["services/**", "functions/**", "api/**"]),
    })
    .default({}),
  commands: z
    .object({
      verify: z.string().default("npm run verify"),
      build: z.string().default("npm run build"),
      test: z.string().default("npm test"),
      dev: z.string().default("npm run dev"),
    })
    .default({}),
});

export type MakerConfig = z.infer<typeof configSchema>;
export type MakerConfigInput = z.input<typeof configSchema>;

/** kebab-case slugify para derivar project.slug a partir do name. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** Normaliza + preenche defaults derivados (slug). Lança ZodError em config inválido. */
export function parseConfig(raw: unknown): MakerConfig {
  const parsed = configSchema.parse(raw);
  if (!parsed.project.slug) {
    parsed.project.slug = slugify(parsed.project.name);
  }
  return parsed;
}
