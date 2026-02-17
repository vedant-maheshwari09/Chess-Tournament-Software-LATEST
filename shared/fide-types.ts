export interface FideDirectoryEntry {
  fideId: string;
  name: string;
  federation: string;
  sex?: string;
  title?: string;
  rating?: number | null;
  birthDate?: string;
}
