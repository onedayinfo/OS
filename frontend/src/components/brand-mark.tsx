'use client';
import { useBranding } from '@/lib/branding';

/** Logo da empresa quando houver; senão o nome (ou "Sistema de OS"). */
export function BrandMark({ className }: { className?: string }) {
  const { hasLogo, logoUrl, companyName } = useBranding();
  if (hasLogo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={companyName ?? 'Logo'} className={className ?? 'h-8 w-auto'} />;
  }
  return (
    <span className={className ?? 'text-sm font-semibold'}>{companyName ?? 'Sistema de OS'}</span>
  );
}
