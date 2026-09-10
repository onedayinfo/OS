export interface ImportRowError {
  line: number;
  message: string;
}
export interface ImportResult {
  created: number;
  errors: ImportRowError[];
}
