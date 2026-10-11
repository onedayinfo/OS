/** Violação de unicidade do Prisma (P2002). */
export function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'P2002';
}
