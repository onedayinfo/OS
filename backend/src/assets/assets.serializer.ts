import type { Asset } from '@prisma/client';

export type SerializedAsset = Omit<Asset, 'credentialsEnc'> & { hasCredentials: boolean };

/** Nunca deixa `credentialsEnc` sair da API; expõe só o booleano. */
export function serializeAsset<T extends { credentialsEnc: string | null }>(
  asset: T,
): Omit<T, 'credentialsEnc'> & { hasCredentials: boolean } {
  const { credentialsEnc, ...rest } = asset;
  return { ...rest, hasCredentials: credentialsEnc != null };
}
