// Simple Swiss Pairing Algorithm - Priority #1: No Repeat Pairings

function generateSimpleSwissPairings(playerStats, matches) {
  console.log('=== SIMPLE SWISS: NO REPEAT PAIRINGS FIRST ===');
  
  const pairings = [];
  let boardNumber = 1;
  
  // Sort all players by points (highest first), then by rating
  const allPlayers = [...playerStats].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return (b.player.rating || 0) - (a.player.rating || 0);
  });
  
  const unpaired = [...allPlayers];
  
  // Simple greedy approach: For each player, find the first opponent they haven't played
  while (unpaired.length > 1) {
    const player1 = unpaired.shift();
    let bestOpponent = null;
    let bestOpponentIndex = -1;
    
    console.log(`Finding opponent for ${player1.player.firstName} (${player1.points}pts)`);
    
    // Search for first opponent they haven't played
    for (let i = 0; i < unpaired.length; i++) {
      const candidate = unpaired[i];
      
      // Check if they've played before
      const hasPlayed = havePlayed(player1.player.id, candidate.player.id, matches);
      console.log(`  vs ${candidate.player.firstName} (${candidate.points}pts): hasPlayed=${hasPlayed}`);
      
      if (!hasPlayed) {
        bestOpponent = candidate;
        bestOpponentIndex = i;
        console.log(`  ✓ PAIRED: ${player1.player.firstName} vs ${candidate.player.firstName}`);
        break;
      }
    }
    
    if (bestOpponent) {
      // Remove opponent from list
      unpaired.splice(bestOpponentIndex, 1);
      
      // Simple color assignment (can be improved later)
      const whitePlayer = Math.random() > 0.5 ? player1.player : bestOpponent.player;
      const blackPlayer = whitePlayer === player1.player ? bestOpponent.player : player1.player;
      
      pairings.push({
        whitePlayerId: whitePlayer.id,
        blackPlayerId: blackPlayer.id,
        board: boardNumber++,
        isBye: false,
      });
    } else {
      console.log(`  No new opponent for ${player1.player.firstName} - giving bye`);
      pairings.push({
        whitePlayerId: player1.player.id,
        blackPlayerId: null,
        board: 0,
        isBye: true,
        byeType: 'half_point',
      });
    }
  }
  
  // Handle final player with bye if needed
  if (unpaired.length === 1) {
    const finalPlayer = unpaired[0];
    console.log(`Final bye: ${finalPlayer.player.firstName}`);
    pairings.push({
      whitePlayerId: finalPlayer.player.id,
      blackPlayerId: null,
      board: 0,
      isBye: true,
      byeType: 'half_point',
    });
  }
  
  console.log('=== SIMPLE SWISS COMPLETE ===');
  return pairings;
}

// This would replace the complex logic in the main generateSwissPairings function