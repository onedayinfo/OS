import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restringe a rota aos papéis informados. Sem `@Roles`, a rota fica liberada a qualquer usuário autenticado. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
