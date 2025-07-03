// Round Robin tournament pairing algorithm
// Generates complete schedule for all rounds using round-robin rotation

export interface RoundRobinPairing {
  round: number;
  whitePlayerId: number | null;
  blackPlayerId: number | null;
  board: number;
  isBye: boolean;
}

export function generateRoundRobinSchedule(players: any[]): RoundRobinPairing[] {
  const pairings: RoundRobinPairing[] = [];
  const playerIds = players.map(p => p.id);
  const numPlayers = playerIds.length;
  
  if (numPlayers < 2) {
    return pairings;
  }
  
  // For odd number of players, add null (bye) player
  const playersWithBye = numPlayers % 2 === 1 ? [...playerIds, null] : [...playerIds];
  const totalPlayers = playersWithBye.length;
  const numRounds = totalPlayers - 1;
  
  // Round-robin algorithm using rotation method
  for (let round = 1; round <= numRounds; round++) {
    const roundPairings: RoundRobinPairing[] = [];
    
    // Create pairings for this round
    for (let i = 0; i < totalPlayers / 2; i++) {
      const player1Index = i;
      const player2Index = totalPlayers - 1 - i;
      
      const player1 = playersWithBye[player1Index];
      const player2 = playersWithBye[player2Index];
      
      // Skip if one of the players is null (bye)
      if (player1 === null || player2 === null) {
        // One player gets a bye this round
        const activePlayer = player1 !== null ? player1 : player2;
        if (activePlayer !== null) {
          roundPairings.push({
            round,
            whitePlayerId: activePlayer,
            blackPlayerId: null,
            board: 0,
            isBye: true
          });
        }
        continue;
      }
      
      // Determine colors - alternate based on round and board
      const whiteFirst = (round + i) % 2 === 0;
      const whitePlayer = whiteFirst ? player1 : player2;
      const blackPlayer = whiteFirst ? player2 : player1;
      
      roundPairings.push({
        round,
        whitePlayerId: whitePlayer,
        blackPlayerId: blackPlayer,
        board: i + 1,
        isBye: false
      });
    }
    
    // Add round pairings to main array
    pairings.push(...roundPairings);
    
    // Rotate players for next round (keep first player fixed, rotate others)
    if (round < numRounds) {
      const firstPlayer = playersWithBye[0];
      const lastPlayer = playersWithBye[playersWithBye.length - 1];
      
      // Rotate: move last player to position 1, shift others right
      for (let i = playersWithBye.length - 1; i > 1; i--) {
        playersWithBye[i] = playersWithBye[i - 1];
      }
      playersWithBye[1] = lastPlayer;
    }
  }
  
  return pairings;
}

export function validateRoundRobinSchedule(pairings: RoundRobinPairing[], playerIds: number[]): boolean {
  const playerPairs = new Set<string>();
  
  for (const pairing of pairings) {
    if (pairing.isBye) continue;
    
    const player1 = pairing.whitePlayerId!;
    const player2 = pairing.blackPlayerId!;
    
    // Create a consistent pair identifier
    const pairKey = [player1, player2].sort((a, b) => a - b).join('-');
    
    if (playerPairs.has(pairKey)) {
      console.error(`Duplicate pairing found: ${pairKey}`);
      return false;
    }
    
    playerPairs.add(pairKey);
  }
  
  return true;
}