'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useSession } from '@/lib/auth';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const schema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});
type FormValues = z.infer<typeof schema>;

const TITLES = {
  app: 'Acesso da equipe',
  portal: 'Portal do cliente',
} as const;

export function LoginForm({ area }: { area: 'app' | 'portal' }) {
  const router = useRouter();
  const { login } = useSession();
  const [sendingReset, setSendingReset] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    try {
      await login(values.email, values.password);
      router.replace(`/${area}`);
    } catch {
      toast.error('E-mail ou senha inválidos.');
    }
  }

  async function onForgotPassword() {
    const email = getValues('email').trim();
    if (!email) {
      toast.error('Preencha o e-mail primeiro.');
      return;
    }
    setSendingReset(true);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email } });
    } catch {
      // não revela se o e-mail existe
    } finally {
      setSendingReset(false);
      toast.success('Se o e-mail existir, enviamos o link.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{TITLES[area]}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" autoComplete="email" {...register('email')} />
              {errors.email && (
                <p className="text-sm text-red-600">{errors.email.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-sm text-red-600">{errors.password.message}</p>
              )}
            </div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Entrando…' : 'Entrar'}
            </Button>
            <button
              type="button"
              onClick={onForgotPassword}
              disabled={sendingReset}
              className="self-start text-sm text-primary hover:underline disabled:opacity-50"
            >
              Esqueci a senha
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
