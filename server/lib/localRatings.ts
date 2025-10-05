import { createReadStream, existsSync } from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

type ExtraRatingType = "quick" | "blitz" | "rapid";

export interface RatingField {
  value?: string;
  raw?: string;
}

export interface LocalRatingResult {
  id: string;
  name: string;
  rating?: RatingField;
  quickRating?: RatingField;
  blitzRating?: RatingField;
  rapidRating?: RatingField;
  location?: string;
  title?: string;
  federation?: string;
  sex?: string;
  birthYear?: string;
  metadata?: Record<string, string | undefined>;
}

export interface LocalSearchParams {
  term?: string;
  firstName?: string;
  lastName?: string;
  id?: string;
}

interface USCFEntryInternal {
  id: string;
  name: string;
  state?: string;
  expiration?: string;
  rating?: RatingField;
  quickRating?: RatingField;
  blitzRating?: RatingField;
  searchVector: string;
  normalizedFullName: string;
  normalizedLastFirst: string;
}

interface USCFMutableEntry {
  id: string;
  name: string;
  state?: string;
  expiration?: string;
  rating?: RatingField;
  quickRating?: RatingField;
  blitzRating?: RatingField;
}

interface FideEntryInternal {
  id: string;
  name: string;
  federation?: string;
  sex?: string;
  title?: string;
  rating?: RatingField;
  rapidRating?: RatingField;
  blitzRating?: RatingField;
  birthYear?: string;
  searchVector: string;
  normalizedFullName: string;
  normalizedLastFirst: string;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_CANDIDATES = Array.from(
  new Set(
    [
      process.env.RATINGS_DATA_ROOT?.trim() ?? undefined,
      process.cwd(),
      path.resolve(process.cwd(), ".."),
      MODULE_DIR,
      path.resolve(MODULE_DIR, ".."),
      path.resolve(MODULE_DIR, "..", ".."),
    ].filter((value): value is string => Boolean(value)),
  ),
);

function resolveDataPath(relativePath: string, envKey?: string) {
  const envValue = envKey ? process.env[envKey]?.trim() : undefined;
  if (envValue) {
    return path.resolve(envValue);
  }

  for (const root of DEFAULT_ROOT_CANDIDATES) {
    const candidate = path.resolve(root, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Fall back to the first candidate to produce a helpful error downstream.
  const fallbackRoot = DEFAULT_ROOT_CANDIDATES[0] ?? process.cwd();
  return path.resolve(fallbackRoot, relativePath);
}

const USCF_BLITZ_FILE = resolveDataPath("GDB2510T.TXT", "USCF_BLITZ_FILE");
const USCF_QUICK_FILE = resolveDataPath("GDQ2510T.TXT", "USCF_QUICK_FILE");
const FIDE_FILE = resolveDataPath("players_list-fide-oct-2025.txt", "FIDE_PLAYER_LIST_FILE");

let uscfDataPromise: Promise<USCFEntryInternal[]> | null = null;
let fideDataPromise: Promise<FideEntryInternal[]> | null = null;

type SearchInput = string | LocalSearchParams;

export async function searchUSCF(input: SearchInput, limit = 25): Promise<LocalRatingResult[]> {
  const { query, tokens } = resolveSearchInput(input);
  if (!hasSufficientInput(query) || !tokens.length) return [];
  const data = await ensureUSCFData();
  const results = collectMatches(data, tokens, limit, query);
  return results.map((entry) => ({
    id: entry.id,
    name: entry.name,
    rating: entry.rating,
    quickRating: entry.quickRating,
    blitzRating: entry.blitzRating,
    location: entry.state,
    metadata: entry.expiration ? { expiration: entry.expiration } : undefined,
  }));
}

export async function searchFide(input: SearchInput, limit = 25): Promise<LocalRatingResult[]> {
  const { query, tokens } = resolveSearchInput(input);
  if (!hasSufficientInput(query) || !tokens.length) return [];
  const data = await ensureFideData();
  const results = collectMatches(data, tokens, limit, query);
  return results.map((entry) => ({
    id: entry.id,
    name: entry.name,
    rating: entry.rating,
    rapidRating: entry.rapidRating,
    blitzRating: entry.blitzRating,
    federation: entry.federation,
    title: entry.title,
    sex: entry.sex,
    birthYear: entry.birthYear,
  }));
}

async function ensureUSCFData(): Promise<USCFEntryInternal[]> {
  if (!uscfDataPromise) {
    uscfDataPromise = loadUSCFData();
  }
  return uscfDataPromise;
}

async function ensureFideData(): Promise<FideEntryInternal[]> {
  if (!fideDataPromise) {
    fideDataPromise = loadFideData();
  }
  return fideDataPromise;
}

async function loadUSCFData(): Promise<USCFEntryInternal[]> {
  assertFileExists(USCF_BLITZ_FILE, "USCF blitz ratings file not found");
  assertFileExists(USCF_QUICK_FILE, "USCF quick ratings file not found");

  const map = new Map<string, USCFMutableEntry>();

  await parseUSCFFile(USCF_BLITZ_FILE, map, "blitz");
  await parseUSCFFile(USCF_QUICK_FILE, map, "quick");

  return Array.from(map.values()).map(finalizeUSCFEntry);
}

async function loadFideData(): Promise<FideEntryInternal[]> {
  assertFileExists(FIDE_FILE, "FIDE player list file not found");

  const entries: FideEntryInternal[] = [];
  const reader = readline.createInterface({
    input: createReadStream(FIDE_FILE),
    crlfDelay: Infinity,
  });

  let isFirstLine = true;
  for await (const rawLine of reader) {
    if (isFirstLine) {
      isFirstLine = false;
      continue;
    }
    const line = rawLine.replace(/\r/g, "");
    if (!line.trim()) continue;
    const parsed = parseFideLine(line);
    if (!parsed) continue;
    entries.push(finalizeFideEntry(parsed));
  }

  return entries;
}

async function parseUSCFFile(filePath: string, map: Map<string, USCFMutableEntry>, extraType: ExtraRatingType) {
  const reader = readline.createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const rawLine of reader) {
    const line = rawLine.replace(/\r/g, "");
    if (!line.trim()) continue;
    const record = parseUSCFLine(line);
    if (!record) continue;

    const current = map.get(record.id) ?? {
      id: record.id,
      name: record.name,
      state: record.state,
      expiration: record.expiration,
    };

    if (!current.name && record.name) current.name = record.name;
    if (!current.state && record.state) current.state = record.state;
    if (!current.expiration && record.expiration) current.expiration = record.expiration;
    if (!current.rating && record.rating) current.rating = record.rating;

    if (record.extraRating) {
      if (extraType === "quick") {
        current.quickRating = record.extraRating;
      } else if (extraType === "blitz") {
        current.blitzRating = record.extraRating;
      }
    }

    map.set(record.id, current);
  }
}

function parseUSCFLine(line: string) {
  const parts = line.split("\t").map((part) => part.trim());
  while (parts.length && parts[parts.length - 1] === "") {
    parts.pop();
  }
  if (parts.length < 4) return null;

  let extraRatingRaw: string | undefined;
  if (parts.length > 5) {
    extraRatingRaw = parts.pop();
  }
  const ratingRaw = parts.pop();
  const state = parts.pop();
  const expiration = parts.pop();
  const id = parts.pop();
  const name = parts.join(" ").replace(/\s+/g, " ").trim();

  if (!id || !name) return null;

  return {
    id,
    name,
    state: state || undefined,
    expiration: expiration || undefined,
    rating: parseUSCFRating(ratingRaw),
    extraRating: parseUSCFRating(extraRatingRaw),
  };
}

function parseFideLine(line: string) {
  const id = line.slice(0, 12).trim();
  if (!id) return null;
  const name = line.slice(12, 73).trim();
  if (!name) return null;

  const federation = line.slice(76, 79).trim() || undefined;
  const sex = line.slice(79, 81).trim() || undefined;
  const title = line.slice(81, 85).trim() || undefined;
  const rating = parseFideRating(line.slice(105, 118));
  const rapidRating = parseFideRating(line.slice(117, 130));
  const blitzRating = parseFideRating(line.slice(129, 142));
  const birthYear = line.slice(144, 149).trim() || undefined;

  return {
    id,
    name,
    federation,
    sex,
    title,
    rating,
    rapidRating,
    blitzRating,
    birthYear,
  };
}

function parseUSCFRating(raw?: string): RatingField | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const valueMatch = trimmed.match(/\d{1,4}/);
  const value = valueMatch?.[0];
  return value ? { value, raw: trimmed } : { raw: trimmed };
}

function parseFideRating(segment: string): RatingField | undefined {
  const ratingValue = extractPrimaryNumber(segment);
  if (!ratingValue || ratingValue === "0") return undefined;
  return { value: ratingValue, raw: ratingValue };
}

function extractPrimaryNumber(segment: string): string | undefined {
  const matches = segment.match(/\d+/g);
  if (!matches) return undefined;
  const preferred = matches.find((value) => value.length >= 3);
  return preferred ?? matches[0];
}

function finalizeUSCFEntry(entry: USCFMutableEntry): USCFEntryInternal {
  const normalizedFullName = normalizeForSearch(toFirstLast(entry.name));
  const normalizedLastFirst = normalizeForSearch(entry.name.replace(",", " "));
  const tokenSet = new Set<string>();
  addTokens(tokenSet, normalizedFullName);
  addTokens(tokenSet, normalizedLastFirst);
  addTokens(tokenSet, entry.id);
  if (entry.state) addTokens(tokenSet, entry.state);

  return {
    id: entry.id,
    name: entry.name,
    state: entry.state,
    expiration: entry.expiration,
    rating: entry.rating,
    quickRating: entry.quickRating,
    blitzRating: entry.blitzRating,
    searchVector: Array.from(tokenSet).join(" "),
    normalizedFullName,
    normalizedLastFirst,
  };
}

function finalizeFideEntry(entry: Omit<FideEntryInternal, "searchVector" | "normalizedFullName" | "normalizedLastFirst">): FideEntryInternal {
  const normalizedFullName = normalizeForSearch(toNameFirstLast(entry.name));
  const normalizedLastFirst = normalizeForSearch(entry.name.replace(",", " "));
  const tokenSet = new Set<string>();
  addTokens(tokenSet, normalizedFullName);
  addTokens(tokenSet, normalizedLastFirst);
  addTokens(tokenSet, entry.id);
  if (entry.federation) addTokens(tokenSet, entry.federation);
  if (entry.title) addTokens(tokenSet, entry.title);

  return {
    ...entry,
    searchVector: Array.from(tokenSet).join(" "),
    normalizedFullName,
    normalizedLastFirst,
  };
}

function collectMatches<T extends { searchVector: string; normalizedFullName: string; normalizedLastFirst: string; id: string }>(
  data: T[],
  tokens: string[],
  limit: number,
  query: string,
): T[] {
  const queryNormalized = normalizeForSearch(query);
  const matches: { entry: T; score: number }[] = [];

  for (const entry of data) {
    if (!tokens.every((token) => entry.searchVector.includes(token))) {
      continue;
    }

    const score = computeScore(entry, tokens, queryNormalized);
    matches.push({ entry, score });
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.normalizedFullName.localeCompare(b.entry.normalizedFullName);
  });

  return matches.slice(0, limit).map((match) => match.entry);
}

function resolveSearchInput(input: SearchInput) {
  if (typeof input === "string") {
    const trimmed = input.trim();
    return { query: trimmed, tokens: tokensFromQuery(trimmed) };
  }

  const parts = [input.id, input.lastName, input.firstName, input.term]
    .map((value) => (value ?? "").trim())
    .filter((value) => value.length > 0);

  const combined = parts.join(" ").trim();
  return { query: combined, tokens: tokensFromQuery(combined) };
}

function computeScore(
  entry: { normalizedFullName: string; normalizedLastFirst: string; id: string },
  tokens: string[],
  fullQuery: string,
): number {
  let score = 0;
  if (fullQuery && entry.normalizedFullName.startsWith(fullQuery)) score += 6;
  if (fullQuery && entry.normalizedLastFirst.startsWith(fullQuery)) score += 4;

  for (const token of tokens) {
    if (!token) continue;
    if (entry.normalizedFullName.startsWith(token)) score += 3;
    else if (entry.normalizedFullName.includes(` ${token}`)) score += 2;
    if (entry.normalizedLastFirst.startsWith(token)) score += 3;
    else if (entry.normalizedLastFirst.includes(` ${token}`)) score += 1;
    if (entry.id.startsWith(token)) score += 8;
    else if (entry.id.includes(token)) score += 3;
  }

  return score;
}

function normalizeForSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokensFromQuery(query: string) {
  return normalizeForSearch(query)
    .split(" ")
    .filter((token) => token && (token.length >= 2 || /^\d+$/.test(token)));
}

function addTokens(target: Set<string>, value: string) {
  const normalized = normalizeForSearch(value);
  if (!normalized) return;
  for (const token of normalized.split(" ")) {
    if (token) target.add(token);
  }
}

function toFirstLast(name: string) {
  const [last, first] = name.split(",");
  return [first?.trim() ?? "", last?.trim() ?? ""].filter(Boolean).join(" ");
}

function toNameFirstLast(name: string) {
  const [last, first] = name.split(",");
  const trimmedFirst = first?.trim() ?? "";
  const trimmedLast = last?.trim() ?? "";
  return trimmedFirst && trimmedLast ? `${trimmedFirst} ${trimmedLast}` : name.trim();
}

function assertFileExists(filePath: string, message: string) {
  if (!existsSync(filePath)) {
    throw new Error(`${message}: ${filePath}`);
  }
}

function hasSufficientInput(query: string) {
  const trimmed = query.trim();
  if (trimmed.length >= 2) return true;
  return /^\d+$/.test(trimmed) && trimmed.length > 0;
}
