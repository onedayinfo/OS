export interface ImportRowError {
  line: number;
  message: string;
}
export interface ImportPreviewRow {
  line: number;
  cliente: string;
  local: string;
  tipo: string;
  identificacao: string;
  numeroSerie: string;
  remoteId: string;
  error: string | null;
}
export interface ImportResult {
  created: number;
  errors: ImportRowError[];
  /** Só na pré-visualização (`?dryRun=true`). */
  rows?: ImportPreviewRow[];
}
