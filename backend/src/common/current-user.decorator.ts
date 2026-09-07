import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserData {
  id: string;
  type: string;
  role: string;
  clientId: string | null;
}

/** Injeta `req.user` (preenchido pela `JwtStrategy`) no parâmetro do handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserData =>
    ctx.switchToHttp().getRequest().user,
);
