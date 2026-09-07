import { Suspense } from 'react';
import { SetPasswordForm } from '@/components/set-password-form';

export default function AppSetPasswordPage() {
  return (
    <Suspense>
      <SetPasswordForm area="app" />
    </Suspense>
  );
}
