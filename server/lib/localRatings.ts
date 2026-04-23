import { createReadStream, existsSync, statSync, createWriteStream, unlink } from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import https from "https";

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

  const fallbackRoot = DEFAULT_ROOT_CANDIDATES[0] ?? process.cwd();
  return path.resolve(fallbackRoot, relativePath);
}

const USCF_BLITZ_FILE = "GDB2510T.TXT";
const USCF_QUICK_FILE = "GDQ2510T.TXT";
const FIDE_FILE = "players_list-fide-oct-2025.txt";
const DB_PATH = resolveDataPath("ratings_cache.sqlite", "RATINGS_CACHE_DB_FILE");

let db: Database.Database | null = null;
let initPromise: Promise<void> | null = null;

function log(message: string, context: string = "system") {
  console.log(`${new Date().toISOString()} [localRatings] [${context}] ${message}`);
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    log(`Downloading ${url} to ${dest}...`);
    const file = createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        log(`Download complete: ${dest}`);
        resolve();
      });
    }).on("error", (err) => {
      unlink(dest, () => {});
      reject(err);
    });
  });
}

export async function ensureDataFiles(): Promise<void> {
  const filesToVerify = [
    { name: USCF_BLITZ_FILE, envUrl: "USCF_BLITZ_URL" },
    { name: USCF_QUICK_FILE, envUrl: "USCF_QUICK_URL" },
    { name: FIDE_FILE, envUrl: "FIDE_PLAYER_LIST_URL" },
  ];

  for (const item of filesToVerify) {
    const filePath = path.resolve(process.cwd(), item.name);
    if (!existsSync(filePath)) {
      const url = process.env[item.envUrl];
      if (url) {
        try {
          await downloadFile(url, filePath);
        } catch (error) {
          log(`Error downloading ${item.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        log(`Warning: ${item.name} is missing and ${item.envUrl} is not set.`);
      }
    }
  }
}

export async function preloadRatingData() {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureDataFiles();
      await initializeDb();
    })();
  }
  return initPromise;
}

function getMtime(fileName: string) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return null;
  return statSync(filePath).mtimeMs;
}

async function initializeDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS uscf (
      id TEXT PRIMARY KEY,
      name TEXT,
      state TEXT,
      expiration TEXT,
      rating_value TEXT,
      rating_raw TEXT,
      quick_rating_value TEXT,
      quick_rating_raw TEXT,
      blitz_rating_value TEXT,
      blitz_rating_raw TEXT,
      search_vector TEXT,
      normalized_full_name TEXT,
      normalized_last_first TEXT
    );
    CREATE TABLE IF NOT EXISTS fide (
      id TEXT PRIMARY KEY,
      name TEXT,
      federation TEXT,
      sex TEXT,
      title TEXT,
      rating_value TEXT,
      rating_raw TEXT,
      rapid_rating_value TEXT,
      rapid_rating_raw TEXT,
      blitz_rating_value TEXT,
      blitz_rating_raw TEXT,
      birth_year TEXT,
      search_vector TEXT,
      normalized_full_name TEXT,
      normalized_last_first TEXT
    );
  `);

  const uscfBlitzMtime = getMtime(USCF_BLITZ_FILE);
  const uscfQuickMtime = getMtime(USCF_QUICK_FILE);
  const fideMtime = getMtime(FIDE_FILE);

  const getMeta = db.prepare(`SELECT value FROM meta WHERE key = ?`);
  const setMeta = db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`);

  const currentUscfMeta = getMeta.get('uscf_mtime') as {value: string} | undefined;
  const currentFideMeta = getMeta.get('fide_mtime') as {value: string} | undefined;

  const expectedUscfMeta = `${uscfBlitzMtime}_${uscfQuickMtime}`;
  const expectedFideMeta = `${fideMtime}`;

  if (currentUscfMeta?.value !== expectedUscfMeta) {
    if (uscfBlitzMtime && uscfQuickMtime) {
      log("Rebuilding USCF database index...", "ratings");
      await buildUscfIndex();
      setMeta.run('uscf_mtime', expectedUscfMeta);
      log("USCF index build complete.", "ratings");
    }
  }

  if (currentFideMeta?.value !== expectedFideMeta) {
    if (fideMtime) {
      log("Rebuilding FIDE database index...", "ratings");
      await buildFideIndex();
      setMeta.run('fide_mtime', expectedFideMeta);
      log("FIDE index build complete.", "ratings");
    }
  }
}

async function buildUscfIndex() {
  const blitzPath = path.resolve(process.cwd(), USCF_BLITZ_FILE);
  const quickPath = path.resolve(process.cwd(), USCF_QUICK_FILE);
  
  assertFileExists(blitzPath, "USCF blitz ratings file not found");
  assertFileExists(quickPath, "USCF quick ratings file not found");

  db!.exec('BEGIN TRANSACTION');
  db!.exec('DELETE FROM uscf');
  db!.exec('COMMIT');

  await streamUSCFFileIntoDb(blitzPath, "blitz");
  await streamUSCFFileIntoDb(quickPath, "quick");
}

async function streamUSCFFileIntoDb(filePath: string, type: "blitz" | "quick") {
  const reader = readline.createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  const upsert = db!.prepare(`
    INSERT INTO uscf (
      id, name, state, expiration, 
      rating_value, rating_raw, 
      quick_rating_value, quick_rating_raw, 
      blitz_rating_value, blitz_rating_raw,
      search_vector, normalized_full_name, normalized_last_first
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = COALESCE(excluded.name, uscf.name),
      state = COALESCE(excluded.state, uscf.state),
      expiration = COALESCE(excluded.expiration, uscf.expiration),
      rating_value = CASE WHEN ? = 'blitz' THEN excluded.rating_value ELSE uscf.rating_value END,
      rating_raw = CASE WHEN ? = 'blitz' THEN excluded.rating_raw ELSE uscf.rating_raw END,
      blitz_rating_value = CASE WHEN ? = 'blitz' THEN excluded.blitz_rating_value ELSE uscf.blitz_rating_value END,
      blitz_rating_raw = CASE WHEN ? = 'blitz' THEN excluded.blitz_rating_raw ELSE uscf.blitz_rating_raw END,
      quick_rating_value = CASE WHEN ? = 'quick' THEN excluded.quick_rating_value ELSE uscf.quick_rating_value END,
      quick_rating_raw = CASE WHEN ? = 'quick' THEN excluded.quick_rating_raw ELSE uscf.quick_rating_raw END,
      search_vector = excluded.search_vector,
      normalized_full_name = excluded.normalized_full_name,
      normalized_last_first = excluded.normalized_last_first
  `);

  db!.exec('BEGIN TRANSACTION');
  let count = 0;
  for await (const rawLine of reader) {
    const line = rawLine.replace(/\r/g, "");
    if (!line.trim()) continue;
    const record = parseUSCFLine(line);
    if (!record) continue;

    const normalizedFullName = normalizeForSearch(toFirstLast(record.name));
    const normalizedLastFirst = normalizeForSearch(record.name.replace(",", " "));
    const tokenSet = new Set<string>();
    addTokens(tokenSet, normalizedFullName);
    addTokens(tokenSet, normalizedLastFirst);
    addTokens(tokenSet, record.id);
    if (record.state) addTokens(tokenSet, record.state);

    const searchVector = Array.from(tokenSet).join(" ");
    
    const ratingValue = record.rating?.value || null;
    const ratingRaw = record.rating?.raw || null;
    const blitzValue = type === "blitz" ? (record.extraRating?.value || ratingValue) : null;
    const blitzRaw = type === "blitz" ? (record.extraRating?.raw || ratingRaw) : null;
    const quickValue = type === "quick" ? (record.extraRating?.value || ratingValue) : null;
    const quickRaw = type === "quick" ? (record.extraRating?.raw || ratingRaw) : null;

    upsert.run(
      record.id, record.name, record.state || null, record.expiration || null,
      ratingValue, ratingRaw,
      quickValue, quickRaw,
      blitzValue, blitzRaw,
      searchVector, normalizedFullName, normalizedLastFirst,
      type, type, type, type, type, type
    );

    count++;
    if (count % 5000 === 0) {
      db!.exec('COMMIT');
      db!.exec('BEGIN TRANSACTION');
      log(`Processed ${count} USCF ${type} records...`, "ratings");
    }
  }
  db!.exec('COMMIT');
}

function log(message: string, context: string = "system") {
  console.log(`${new Date().toLocaleTimeString()} [${context}] ${message}`);
}

async function buildFideIndex() {
  assertFileExists(FIDE_FILE, "FIDE player list file not found");
  
  db!.exec('BEGIN TRANSACTION');
  db!.exec('DELETE FROM fide');
  const insert = db!.prepare(`
    INSERT INTO fide (
      id, name, federation, sex, title, 
      rating_value, rating_raw, 
      rapid_rating_value, rapid_rating_raw, 
      blitz_rating_value, blitz_rating_raw, 
      birth_year, search_vector, normalized_full_name, normalized_last_first
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

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

    const normalizedFullName = normalizeForSearch(toNameFirstLast(parsed.name));
    const normalizedLastFirst = normalizeForSearch(parsed.name.replace(",", " "));
    const tokenSet = new Set<string>();
    addTokens(tokenSet, normalizedFullName);
    addTokens(tokenSet, normalizedLastFirst);
    addTokens(tokenSet, parsed.id);
    if (parsed.federation) addTokens(tokenSet, parsed.federation);
    if (parsed.title) addTokens(tokenSet, parsed.title);

    const searchVector = Array.from(tokenSet).join(" ");

    insert.run(
      parsed.id, parsed.name, parsed.federation || null, parsed.sex || null, parsed.title || null,
      parsed.rating?.value || null, parsed.rating?.raw || null,
      parsed.rapidRating?.value || null, parsed.rapidRating?.raw || null,
      parsed.blitzRating?.value || null, parsed.blitzRating?.raw || null,
      parsed.birthYear || null, searchVector, normalizedFullName, normalizedLastFirst
    );
  }
  db!.exec('COMMIT');
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

type SearchInput = string | LocalSearchParams;

export async function searchUSCF(input: SearchInput, limit = 25): Promise<LocalRatingResult[]> {
  await preloadRatingData();
  const { query, tokens } = resolveSearchInput(input);
  if (!hasSufficientInput(query) || !tokens.length) return [];
  
  let sql = 'SELECT * FROM uscf WHERE 1=1';
  const params: any[] = [];
  for (const token of tokens) {
    sql += ` AND search_vector LIKE ?`;
    params.push(`%${token}%`);
  }
  sql += ' LIMIT 200';
  
  const stmt = db!.prepare(sql);
  const rows = stmt.all(...params) as any[];
  
  const queryNormalized = normalizeForSearch(query);
  const matches = rows.map(row => ({
    entry: row,
    score: computeScore(row, tokens, queryNormalized)
  }));
  
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.normalized_full_name.localeCompare(b.entry.normalized_full_name);
  });
  
  return matches.slice(0, limit).map((match) => {
    const entry = match.entry;
    return {
      id: entry.id,
      name: entry.name,
      rating: entry.rating_value ? { value: entry.rating_value, raw: entry.rating_raw } : undefined,
      quickRating: entry.quick_rating_value ? { value: entry.quick_rating_value, raw: entry.quick_rating_raw } : undefined,
      blitzRating: entry.blitz_rating_value ? { value: entry.blitz_rating_value, raw: entry.blitz_rating_raw } : undefined,
      location: entry.state,
      metadata: entry.expiration ? { expiration: entry.expiration } : undefined,
    };
  });
}

export async function searchFide(input: SearchInput, limit = 25): Promise<LocalRatingResult[]> {
  await preloadRatingData();
  const { query, tokens } = resolveSearchInput(input);
  if (!hasSufficientInput(query) || !tokens.length) return [];
  
  let sql = 'SELECT * FROM fide WHERE 1=1';
  const params: any[] = [];
  for (const token of tokens) {
    sql += ` AND search_vector LIKE ?`;
    params.push(`%${token}%`);
  }
  sql += ' LIMIT 200';
  
  const stmt = db!.prepare(sql);
  const rows = stmt.all(...params) as any[];
  
  const queryNormalized = normalizeForSearch(query);
  const matches = rows.map(row => ({
    entry: row,
    score: computeScore(row, tokens, queryNormalized)
  }));
  
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.normalized_full_name.localeCompare(b.entry.normalized_full_name);
  });
  
  return matches.slice(0, limit).map((match) => {
    const entry = match.entry;
    return {
      id: entry.id,
      name: entry.name,
      rating: entry.rating_value ? { value: entry.rating_value, raw: entry.rating_raw } : undefined,
      rapidRating: entry.rapid_rating_value ? { value: entry.rapid_rating_value, raw: entry.rapid_rating_raw } : undefined,
      blitzRating: entry.blitz_rating_value ? { value: entry.blitz_rating_value, raw: entry.blitz_rating_raw } : undefined,
      federation: entry.federation,
      title: entry.title,
      sex: entry.sex,
      birthYear: entry.birth_year,
    };
  });
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
  entry: { normalized_full_name: string; normalized_last_first: string; id: string },
  tokens: string[],
  fullQuery: string,
): number {
  let score = 0;
  if (fullQuery && entry.normalized_full_name.startsWith(fullQuery)) score += 6;
  if (fullQuery && entry.normalized_last_first.startsWith(fullQuery)) score += 4;

  for (const token of tokens) {
    if (!token) continue;
    if (entry.normalized_full_name.startsWith(token)) score += 3;
    else if (entry.normalized_full_name.includes(` ${token}`)) score += 2;
    if (entry.normalized_last_first.startsWith(token)) score += 3;
    else if (entry.normalized_last_first.includes(` ${token}`)) score += 1;
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
