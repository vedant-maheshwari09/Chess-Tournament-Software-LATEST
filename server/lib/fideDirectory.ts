import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { Player } from "@shared/schema";
import { makeNameKey, normalizeWhitespace, resolveFederationCode, tokenizeName } from "./fideUtils";
import type { FideDirectoryEntry } from "@shared/fide-types";

const FIDE_DIRECTORY_PATH = path.resolve(process.cwd(), "players_list-fide-oct-2025.txt");

function parseFideLine(line: string): FideDirectoryEntry | null {
  if (!line || line.length < 20) return null;
  const id = line.slice(0, 12).trim();
  if (!id || !/^[0-9]+$/.test(id)) return null;

  const rawName = normalizeWhitespace(line.slice(12, 73));
  if (!rawName) return null;

  const federation = line.slice(73, 77).trim().toUpperCase();
  const sex = line.slice(77, 81).trim().toUpperCase() || undefined;
  const title = line.slice(81, 85).trim().toUpperCase() || undefined;

  const ratingValue = Number.parseInt(line.slice(93, 98).trim(), 10);
  const rating = Number.isFinite(ratingValue) && ratingValue > 0 ? ratingValue : null;

  const birthRaw = line.slice(139, 149).trim();
  const birthDate = birthRaw ? birthRaw : undefined;

  return {
    fideId: id,
    name: rawName,
    federation,
    sex,
    title,
    rating,
    birthDate,
  };
}

interface KeyIndex {
  targets: Map<string, Set<number>>;
  keysByPlayer: Map<number, string[]>;
}

function buildKeyIndex(players: Player[]): KeyIndex {
  const targets = new Map<string, Set<number>>();
  const keysByPlayer = new Map<number, string[]>();

  players.forEach((player) => {
    const firstTokens = tokenizeName(player.firstName);
    const lastTokens = tokenizeName(player.lastName);
    const combinedTokens = [...firstTokens, ...lastTokens];
    const reverseTokens = [...lastTokens, ...firstTokens];
    const fedCode = resolveFederationCode(player.federation) || "";

    const candidateKeys: string[] = [];

    if (combinedTokens.length) {
      if (fedCode) {
        candidateKeys.push(makeNameKey(combinedTokens, fedCode));
      }
      candidateKeys.push(makeNameKey(combinedTokens, ""));
    }

    if (reverseTokens.length) {
      if (fedCode) {
        candidateKeys.push(makeNameKey(reverseTokens, fedCode));
      }
      candidateKeys.push(makeNameKey(reverseTokens, ""));
    }

    const uniqueKeys = Array.from(new Set(candidateKeys));
    keysByPlayer.set(player.id, uniqueKeys);

    uniqueKeys.forEach((key) => {
      if (!targets.has(key)) {
        targets.set(key, new Set<number>());
      }
      targets.get(key)!.add(player.id);
    });
  });

  return { targets, keysByPlayer };
}

function removePlayerFromTargets(playerId: number, index: KeyIndex) {
  const keys = index.keysByPlayer.get(playerId) ?? [];
  keys.forEach((key) => {
    const set = index.targets.get(key);
    if (!set) return;
    set.delete(playerId);
    if (set.size === 0) {
      index.targets.delete(key);
    }
  });
}

export async function lookupFideProfiles(players: Player[]): Promise<Map<number, FideDirectoryEntry>> {
  const results = new Map<number, FideDirectoryEntry>();
  if (!players.length) return results;
  if (!fs.existsSync(FIDE_DIRECTORY_PATH)) {
    return results;
  }

  const index = buildKeyIndex(players);
  if (index.targets.size === 0) {
    return results;
  }

  const stream = fs.createReadStream(FIDE_DIRECTORY_PATH, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line || line.startsWith("ID Number")) {
      continue;
    }

    const entry = parseFideLine(line);
    if (!entry) continue;

    const tokens = tokenizeName(entry.name);
    if (!tokens.length) continue;

    const federation = entry.federation || "";
    const keysToCheck = new Set<string>([
      makeNameKey(tokens, federation),
      makeNameKey(tokens, ""),
      makeNameKey([...tokens].reverse(), federation),
      makeNameKey([...tokens].reverse(), ""),
    ]);

    let matchedAny = false;

    keysToCheck.forEach((key) => {
      const matchSet = index.targets.get(key);
      if (!matchSet) return;
      matchSet.forEach((playerId) => {
        if (!results.has(playerId)) {
          results.set(playerId, entry);
        }
      });
      matchSet.forEach((playerId) => removePlayerFromTargets(playerId, index));
      matchedAny = matchedAny || matchSet.size > 0;
    });

    if (matchedAny && results.size === players.length) {
      break;
    }

    if (index.targets.size === 0) {
      break;
    }
  }

  rl.close();
  stream.close();

  return results;
}

export async function searchFideDirectory(
  nameQuery: string,
  limit = 10,
): Promise<FideDirectoryEntry[]> {
  const results: FideDirectoryEntry[] = [];
  if (!nameQuery || nameQuery.length < 2) return results;
  if (!fs.existsSync(FIDE_DIRECTORY_PATH)) {
    return results;
  }

  const query = nameQuery.toLowerCase();
  const stream = fs.createReadStream(FIDE_DIRECTORY_PATH, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (results.length >= limit) {
      break;
    }
    if (!line || line.startsWith("ID Number")) {
      continue;
    }
    const entry = parseFideLine(line);
    if (!entry) continue;

    if (entry.name.toLowerCase().includes(query)) {
      results.push(entry);
    }
  }

  rl.close();
  stream.close();

  return results;
}
