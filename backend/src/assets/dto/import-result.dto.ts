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
/** Nome da planilha sem correspondência no cadastro; `chave` identifica a escolha em `resolucoes`. */
export interface ImportPendencia {
  chave: string;
  tipo: 'cliente' | 'local' | 'tipo';
  nome: string;
  /** Só em `local`: cliente da planilha. */
  cliente?: string;
  linhas: number;
  /** Ids de `opcoes` com nome parecido. */
  sugestoes: string[];
  /** Cadastrados aos quais dá para vincular. */
  opcoes: { id: string; name: string }[];
}
export interface ImportResult {
  created: number;
  errors: ImportRowError[];
  /** Só na pré-visualização (`?dryRun=true`). */
  rows?: ImportPreviewRow[];
  pendencias?: ImportPendencia[];
}
