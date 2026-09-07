import { Suspense } from 'react';
import { SetPasswordForm } from '@/components/set-password-form';

export default function PortalSetPasswordPage() {
  return (
    <Suspense>
      <SetPasswordForm area="portal" />
    </Suspense>
  );
}
