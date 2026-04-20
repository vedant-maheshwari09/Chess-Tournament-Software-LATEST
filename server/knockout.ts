export interface KnockoutPairing {
  round: number;
  whitePlayerId: number | null;
  blackPlayerId: number | null;
  board: number;
  isBye: boolean;
  bracketType: 'winners' | 'losers' | 'grand_final';
}

// Generate the seeding arrays for a bracket of size N
// Standard (High-Low): 1 plays N, 2 plays N-1, but structured for proper bracket progression
export function getStandardBracketSeeds(size: number): number[] {
  if (size <= 1) return [1];
  if (size === 2) return [1, 2];

  const prev = getStandardBracketSeeds(size / 2);
  const result: number[] = [];
  
  for (const seed of prev) {
    result.push(seed);
    result.push(size + 1 - seed);
  }
  
  return result;
}

// Slaughter (Top half vs Bottom half): 1 plays N/2+1, 2 plays N/2+2
export function getSlaughterBracketSeeds(size: number): number[] {
  if (size <= 1) return [1];
  if (size === 2) return [1, 2];

  const prev = getSlaughterBracketSeeds(size / 2);
  const result: number[] = [];
  const offset = size / 2;
  
  for (const seed of prev) {
    result.push(seed);
    result.push(seed + offset);
  }
  
  return result;
}

export function generateKnockoutPairings(
  players: any[], 
  seedingMethod: "rating" | "random" | "slaughter" | "manual" = "rating"
): KnockoutPairing[] {
  const pairings: KnockoutPairing[] = [];
  const numPlayers = players.length;
  
  if (numPlayers < 2) return pairings;

  // Next power of 2
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(numPlayers)));
  const totalRounds = Math.log2(bracketSize);
  
  // Choose seed generation based on method
  let seeds: number[];
  if (seedingMethod === "slaughter") {
    seeds = getSlaughterBracketSeeds(bracketSize);
  } else {
    // Default to standard high-low (rating/random/manual handle their sorting before this call)
    seeds = getStandardBracketSeeds(bracketSize);
  }

  // We assume players are passed in sorted by seed order.
  const seededPlayers = new Map<number, number>(); // seed -> playerId
  for (let i = 0; i < numPlayers; i++) {
    seededPlayers.set(i + 1, players[i].id);
  }

  // To track who advances directly
  const advancingToRound2 = new Map<number, number>(); // board in Round 2 -> playerId

  // Round 1
  const numMatchesR1 = bracketSize / 2;
  for (let i = 0; i < numMatchesR1; i++) {
    const seed1 = seeds[i * 2];
    const seed2 = seeds[i * 2 + 1];

    const player1 = seededPlayers.get(seed1) || null;
    const player2 = seededPlayers.get(seed2) || null;

    if (player1 === null && player2 === null) {
        continue;
    }

    if (player1 === null || player2 === null) {
      // Bye in Round 1
      const advancingPlayer = player1 !== null ? player1 : player2;
      pairings.push({
        round: 1,
        board: i + 1,
        whitePlayerId: advancingPlayer,
        blackPlayerId: null,
        isBye: true,
        bracketType: 'winners'
      });
      if (advancingPlayer !== null) {
          advancingToRound2.set(i + 1, advancingPlayer);
      }
    } else {
      // Regular match
      pairings.push({
        round: 1,
        board: i + 1,
        whitePlayerId: player1,
        blackPlayerId: player2,
        isBye: false,
        bracketType: 'winners'
      });
    }
  }

  // Generate future rounds
  for (let r = 2; r <= totalRounds; r++) {
    const numMatches = bracketSize / Math.pow(2, r);
    for (let i = 0; i < numMatches; i++) {
      const prevBoard1 = i * 2 + 1;
      const prevBoard2 = i * 2 + 2;

      let whitePlayerId = null;
      let blackPlayerId = null;

      // Only in Round 2 might we already know advanced players
      if (r === 2) {
        whitePlayerId = advancingToRound2.get(prevBoard1) || null;
        blackPlayerId = advancingToRound2.get(prevBoard2) || null;
      }

      pairings.push({
        round: r,
        board: i + 1,
        whitePlayerId,
        blackPlayerId,
        isBye: false,
        bracketType: 'winners'
      });
    }
  }

  return pairings;
}

export function generateDoubleEliminationPairings(
  players: any[], 
  seedingMethod: "rating" | "random" | "slaughter" | "manual" = "rating"
): KnockoutPairing[] {
  const pairings: KnockoutPairing[] = [];
  const numPlayers = players.length;
  
  if (numPlayers < 2) return pairings;

  // Next power of 2
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(numPlayers)));
  const totalWBRounds = Math.log2(bracketSize);
  
  // 1. Generate Winner's Bracket (WB)
  const wbPairings = generateKnockoutPairings(players, seedingMethod);
  pairings.push(...wbPairings.map(p => ({ ...p, bracketType: 'winners' as const })));

  // 2. Generate Loser's Bracket (LB)
  // LB structure is dynamic based on bracket size.
  // WB R1 (S/2 matches) -> Losers go to LB R1
  // LB R1: Winners of (WB R1 Loser 1 vs WB R1 Loser 2) etc.
  
  // LB Round 1
  let matchesInRound = bracketSize / 4;
  for (let i = 0; i < matchesInRound; i++) {
    pairings.push({
      round: 1,
      board: i + 1,
      whitePlayerId: null,
      blackPlayerId: null,
      isBye: false,
      bracketType: 'losers'
    });
  }

  // Future LB Rounds
  // Pattern: For each subsequent WB round (from 2 up to WB Final)
  // We add TWO LB rounds.
  // One where LB winners face WB losers.
  // One where those LB winners face each other.
  for (let wbRound = 2; wbRound <= totalWBRounds; wbRound++) {
    const lbBaseRound = 2 * (wbRound - 1); // 2, 4, 6...
    
    // LB Phase A: Winners of previous LB round face Losers from WB round 'wbRound'
    const numMatchesPhaseA = bracketSize / Math.pow(2, wbRound);
    for (let i = 0; i < numMatchesPhaseA; i++) {
        pairings.push({
            round: lbBaseRound,
            board: i + 1,
            whitePlayerId: null,
            blackPlayerId: null,
            isBye: false,
            bracketType: 'losers'
        });
    }

    // LB Phase B: Winners of Phase A face each other
    // This phase only exists if we aren't at the very end of LB
    const numMatchesPhaseB = numMatchesPhaseA / 2;
    if (numMatchesPhaseB >= 1) {
        for (let i = 0; i < numMatchesPhaseB; i++) {
            pairings.push({
                round: lbBaseRound + 1,
                board: i + 1,
                whitePlayerId: null,
                blackPlayerId: null,
                isBye: false,
                bracketType: 'losers'
            });
        }
    }
  }

  // 3. Grand Final
  // Winners Bracket Winner vs Losers Bracket Final Winner
  pairings.push({
    round: 1,
    board: 1,
    whitePlayerId: null,
    blackPlayerId: null,
    isBye: false,
    bracketType: 'grand_final'
  });

  return pairings;
}
