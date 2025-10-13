export type MatchResultCode =
  | "Pending"
  | "1-0"
  | "0-1"
  | "1/2-1/2"
  | "1F-0F"
  | "0F-1F"
  | "1F-1F"
  | "0F-0F"
  | "1-0U"
  | "0-1U"
  | "1/2-1/2U"
  | "1F-0FU"
  | "0F-1FU"
  | "1F-1FU"
  | "0F-0FU"
  | "1-bye"
  | "1-byeU";

export const HEAD_TO_HEAD_RESULT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "1-0", label: "1-0 (White win)" },
  { value: "0-1", label: "0-1 (Black win)" },
  { value: "1/2-1/2", label: "½-½ (Draw)" },
  { value: "1F-0F", label: "1F-0F (White forfeit win)" },
  { value: "0F-1F", label: "0F-1F (Black forfeit win)" },
  { value: "1F-1F", label: "1F-1F (Double forfeit)" },
  { value: "0F-0F", label: "0F-0F (No result)" },
  { value: "1-0U", label: "1-0U (White win, unrated)" },
  { value: "0-1U", label: "0-1U (Black win, unrated)" },
  { value: "1/2-1/2U", label: "½-½U (Draw, unrated)" },
  { value: "1F-0FU", label: "1F-0FU (White forfeit win, unrated)" },
  { value: "0F-1FU", label: "0F-1FU (Black forfeit win, unrated)" },
  { value: "1F-1FU", label: "1F-1FU (Double forfeit, unrated)" },
  { value: "0F-0FU", label: "0F-0FU (No result, unrated)" },
];

export const BYE_RESULT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "1-0", label: "1-0 (Win)" },
  { value: "0-1", label: "0-1 (Loss)" },
  { value: "1/2-1/2", label: "½-½ (Draw)" },
  { value: "1-bye", label: "1-point bye" },
  { value: "1-0U", label: "1-0U (Win, unrated)" },
  { value: "0-1U", label: "0-1U (Loss, unrated)" },
  { value: "1/2-1/2U", label: "½-½U (Draw, unrated)" },
  { value: "1-byeU", label: "1-point bye (unrated)" },
];

const LEGACY_RESULT_MAP: Record<string, string> = {
  white_wins: "1-0",
  black_wins: "0-1",
  draw: "1/2-1/2",
  bye: "1-bye",
};

export function normalizeMatchResult(result: string | null | undefined): string | null {
  if (!result) {
    return null;
  }
  const trimmed = result.trim();
  if (!trimmed || trimmed === "Pending") {
    return null;
  }
  const mapped = LEGACY_RESULT_MAP[trimmed] ?? trimmed;
  if (mapped.endsWith("U")) {
    return mapped.slice(0, -1);
  }
  return mapped;
}

const RESULT_POINTS: Record<string, { white: number; black: number }> = {
  "1-0": { white: 1, black: 0 },
  "0-1": { white: 0, black: 1 },
  "1/2-1/2": { white: 0.5, black: 0.5 },
  "1F-0F": { white: 1, black: 0 },
  "0F-1F": { white: 0, black: 1 },
  "1F-1F": { white: 0, black: 0 },
  "0F-0F": { white: 0, black: 0 },
  "1-bye": { white: 1, black: 0 },
};

export function getPointsForResult(
  result: string | null | undefined,
  color: "white" | "black",
): number {
  const normalized = normalizeMatchResult(result);
  if (!normalized) {
    return 0;
  }
  const entry = RESULT_POINTS[normalized];
  if (!entry) {
    return 0;
  }
  return entry[color];
}

export function getResultSummary(
  result: string | null | undefined,
): { whitePoints: number; blackPoints: number } {
  return {
    whitePoints: getPointsForResult(result, "white"),
    blackPoints: getPointsForResult(result, "black"),
  };
}

export function isForfeitResult(result: string | null | undefined): boolean {
  const normalized = normalizeMatchResult(result);
  if (!normalized) return false;
  return normalized === "1F-0F" || normalized === "0F-1F" || normalized === "1F-1F" || normalized === "0F-0F";
}
