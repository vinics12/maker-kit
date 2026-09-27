# Specification Quality Checklist: Estado compacto em `.maker` sem perder bases de reconciliação

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-27
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- A chave de config `state.bases` e os comandos `maker update/doctor/init` são contrato visível ao
  consumidor, não detalhe de implementação; nomes de arquivos e layout interno do formato compacto
  ficam para o architect.
- Clarification 16 registra a decisão do humano: alvo ≤ 17 arquivos versionados em `.maker`
  (15 de estado/conteúdo + 2 arquivos de controle do git).
- Revisão 1 (spec-reviewer CRITICAL) endereçada: lista de comandos que gravam/leem bases, AC-09
  qualificado, AC-30 novo, órfãs toleradas até o update, default distinguível, AC-10 separado.
- Gate 1 (revisão do humano): default de `state.bases` passou a `"pack"` (Clarification 17);
  `"files"` é opt-out explícito; installs sem formato declarado migram no próximo update; `add`/
  `remove`/`agent add` não migram (Clarification 18); ACs 31–33 novos.
- Revisão pós-Gate 1 (spec-reviewer CRITICAL): add/remove/agent add preservam o campo de formato
  do manifest; só init/update registram; init segue regras de migração; "install não migrado"
  definido; FR-006b (versões antigas não degradam silenciosamente); ACs 34–35 novos.
- Gate 1 (regra nova): em pack o manifest vive no lockfile, sem `.maker/manifest.json` nem
  `.maker/bases/` (Clarification 20); coexistência manifest+lockfile aborta (Clarification 21);
  SC-001 ≤ 16; ACs 36–38 novos; numeração da US3 corrigida.
- Revisão (spec-reviewer CRITICAL): lockfile arquivo único; manifest ilegível/conflitado aborta
  (FR-010a, AC-39); lockfile amigável a merge (FR-009a, AC-40); coexistência qualificada.
