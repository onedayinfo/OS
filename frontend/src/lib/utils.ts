// ponytail: junta classes; troque por clsx+tailwind-merge se precisar de merge real
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
