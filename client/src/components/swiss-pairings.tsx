import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Play, RefreshCw, Crown as Chess, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Match, Player, Pairing, Tournament } from "@shared/schema";

interface TournamentPairingsProps {
  tournamentId: number;
}

export default function SwissPairings({ tournamentId }: TournamentPairingsProps) {
  const [currentRound, setCurrentRound] = useState(1);
  const [pendingResultChange, setPendingResultChange] = useState<{matchId: number, result: string, isPastRound: boolean} | null>(null);
  const [selectedPlayers, setSelectedPlayers] = useState<{
    playerId: number;
    matchId: number;
    color: 'white' | 'black';
    playerName: string;
  }[]>([]);
  const [lastSwapState, setLastSwapState] = useState<{
    match1: { id: number; whitePlayerId: number | null; blackPlayerId: number | null };
    match2: { id: number; whitePlayerId: number | null; blackPlayerId: number | null };
    timestamp: number;
  } | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Get tournament data for planned rounds
  const { data: tournament } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  // Check if user is a tournament director and owns this tournament
  const isTournamentDirector = user?.role === 'tournament_director';
  const isOwner = isTournamentDirector && tournament && user && tournament.createdBy === user.id;
  
  // Debug log
  console.log('Drag debug:', { 
    isOwner, 
    isTournamentDirector, 
    tournamentCreatedBy: tournament?.createdBy, 
    userId: user?.id,
    userRole: user?.role 
  });

  // Get all matches to determine the current round
  const { data: allMatches } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });

  // Update current round based on latest matches
  useEffect(() => {
    if (allMatches && allMatches.length > 0) {
      const latestRound = Math.max(...allMatches.map(match => match.round));
      setCurrentRound(latestRound);
    }
  }, [allMatches]);

  // Auto-expire lastSwapState after 30 seconds
  useEffect(() => {
    if (lastSwapState) {
      const timer = setTimeout(() => {
        setLastSwapState(null);
      }, 30000); // 30 seconds
      
      return () => clearTimeout(timer);
    }
  }, [lastSwapState]);

  // For Round Robin, show all matches, for Swiss show current round
  const { data: matches, isLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`, { round: tournament?.format === 'roundrobin' ? undefined : currentRound }],
    queryFn: async () => {
      if (tournament?.format === 'roundrobin') {
        return await apiRequest(`/api/tournaments/${tournamentId}/matches`);
      } else {
        return await apiRequest(`/api/tournaments/${tournamentId}/matches?round=${currentRound}`);
      }
    },
  });

  const { data: players } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  // Get pairings to check for byes (current round)
  const { data: pairings } = useQuery<Pairing[]>({
    queryKey: [`/api/tournaments/${tournamentId}/pairings`, { round: currentRound }],
    queryFn: async () => {
      return await apiRequest(`/api/tournaments/${tournamentId}/pairings?round=${currentRound}`);
    },
  });

  // Get all pairings for point calculation  
  const { data: allTournamentPairings } = useQuery<Pairing[]>({
    queryKey: [`/api/tournaments/${tournamentId}/pairings`],
  });

  const generatePairingsMutation = useMutation({
    mutationFn: async ({ regenerate = false }: { regenerate?: boolean } = {}) => {
      return await apiRequest(`/api/tournaments/${tournamentId}/generate-pairings`, {
        method: "POST",
        body: JSON.stringify({
          regenerate,
          targetRound: regenerate ? currentRound : undefined,
        }),
      });
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Success",
        description: variables?.regenerate 
          ? `Round ${currentRound} pairings have been repaired` 
          : `Round ${currentRound + 1} pairings generated successfully`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      // Update current round if generating next round
      if (!variables?.regenerate) {
        setCurrentRound(prev => prev + 1);
      }
    },
    onError: (error: any) => {
      const errorMessage = error?.error || "Failed to generate pairings. Please try again.";
      toast({
        title: "Cannot Generate Pairings",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const finishTournamentMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/tournaments/${tournamentId}/finish`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({
        title: "Tournament Completed",
        description: "Tournament has been finished. Final standings are now available.",
      });
      // Invalidate both the tournament details and the tournament list for the dashboard
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-tournaments"] });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || "Failed to finish tournament.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const updateMatchMutation = useMutation({
    mutationFn: async ({ matchId, result }: { matchId: number; result: string }) => {
      return await apiRequest(`/api/matches/${matchId}`, {
        method: "PUT",
        body: JSON.stringify({
          result,
          status: result === "Pending" ? "pending" : "completed",
        }),
      });
    },
    onSuccess: (updatedMatch, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      
      toast({
        title: "Result Updated",
        description: "Match result has been saved. Use 'Repair' to regenerate future rounds if needed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update match result.",
        variant: "destructive",
      });
    },
  });

  const swapPlayersMutation = useMutation({
    mutationFn: async ({ match1Id, match2Id, player1Id, player2Id, color1, color2 }: { 
      match1Id: number; 
      match2Id: number; 
      player1Id: number | null; 
      player2Id: number | null; 
      color1: 'white' | 'black'; 
      color2: 'white' | 'black'; 
    }) => {
      // Store the current state before swapping
      const currentMatches = matches || [];
      const match1 = currentMatches.find((m: Match) => m.id === match1Id);
      const match2 = currentMatches.find((m: Match) => m.id === match2Id);
      
      if (match1 && match2) {
        setLastSwapState({
          match1: { id: match1.id, whitePlayerId: match1.whitePlayerId, blackPlayerId: match1.blackPlayerId },
          match2: { id: match2.id, whitePlayerId: match2.whitePlayerId, blackPlayerId: match2.blackPlayerId },
          timestamp: Date.now()
        });
      }
      
      return await apiRequest(`/api/tournaments/${tournamentId}/swap-players`, {
        method: "POST",
        body: JSON.stringify({ match1Id, match2Id, player1Id, player2Id, color1, color2 }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      setSelectedPlayers([]);
      toast({
        title: "Players swapped",
        description: "The pairing has been updated successfully. You can undo this swap within 30 seconds.",
      });
    },
    onError: (error) => {
      setSelectedPlayers([]);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const undoSwapMutation = useMutation({
    mutationFn: async () => {
      if (!lastSwapState) return;
      
      // Restore the original pairing configuration
      await apiRequest(`/api/tournaments/${tournamentId}/swap-players`, {
        method: "POST",
        body: JSON.stringify({ 
          match1Id: lastSwapState.match1.id,
          match2Id: lastSwapState.match2.id,
          player1Id: lastSwapState.match1.whitePlayerId,
          player2Id: lastSwapState.match2.whitePlayerId,
          color1: 'white',
          color2: 'white'
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      setLastSwapState(null);
      toast({
        title: "Swap undone",
        description: "The previous pairing swap has been undone.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to undo the swap.",
        variant: "destructive",
      });
    },
  });

  // New mutation for regenerating future rounds after fixing results
  const regenerateFutureRoundsMutation = useMutation({
    mutationFn: async (options: { fromRound?: number } = {}) => {
      const fromRound = options.fromRound || currentRound + 1;
      return await apiRequest(`/api/tournaments/${tournamentId}/regenerate-future-rounds`, {
        method: "POST",
        body: JSON.stringify({
          fromRound
        }),
      });
    },
    onSuccess: (data) => {
      console.log('Regeneration response:', data);
      const message = data.roundsAffected > 0 
        ? `Regenerated ${data.roundsAffected} rounds. ${data.matchesCreated} matches and ${data.pairingsCreated} pairings created.`
        : data.message || "No rounds were regenerated.";
      
      toast({
        title: data.roundsAffected > 0 ? "Success" : "No Action Needed",
        description: message,
        variant: data.roundsAffected > 0 ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
    },
    onError: (error: any) => {
      const errorMessage = error?.error || "Failed to regenerate future rounds.";
      toast({
        title: "Regeneration Failed",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const getPlayerName = (playerId: number | null) => {
    if (!playerId || !players) return "BYE";
    const player = players.find(p => p.id === playerId);
    if (!player) return "Unknown";
    
    const fullName = `${player.firstName} ${player.lastName}`;
    // Add substitute player note for houseplayers
    if (player.isActiveTd) {
      return `${fullName} (substitute player)`;
    }
    return fullName;
  };

  const getPlayerRating = (playerId: number | null) => {
    if (!playerId || !players) return 0;
    const player = players.find(p => p.id === playerId);
    return player?.rating || 0;
  }

  const getPlayerPoints = (playerId: number | null, beforeRound: number = 999) => {
    if (!playerId || !allMatches) return 0;
    
    let points = 0;
    
    // Calculate points from completed matches BEFORE the specified round
    for (const match of allMatches) {
      if ((match.whitePlayerId === playerId || match.blackPlayerId === playerId) && 
          match.round < beforeRound) {
        if (match.result && match.result !== 'Pending') {
          if (match.result === '1/2-1/2') {
            // Draw - both players get 0.5 points
            points += 0.5;
          } else if (
            (match.result === '1-0' && match.whitePlayerId === playerId) ||
            (match.result === '0-1' && match.blackPlayerId === playerId) ||
            (match.result === '1F-0F' && match.whitePlayerId === playerId) ||
            (match.result === '0F-1F' && match.blackPlayerId === playerId)
          ) {
            // Win - player gets 1 point (including forfeit wins)
            points += 1;
          }
          // Loss - player gets 0 points (no need to add anything)
        }
      }
    }
    
    // Add points from bye pairings BEFORE the specified round (convert from integer mapping)
    if (allTournamentPairings) {
      for (const pairing of allTournamentPairings) {
        if (pairing.playerId === playerId && 
            pairing.isBye && 
            pairing.round < beforeRound) {
          // Convert from integer mapping: 0=0pts, 1=0.5pts, 2=1pt
          const byePoints = pairing.points === 1 ? 0.5 : pairing.points === 2 ? 1 : 0;
          points += byePoints;
        }
      }
    }
    
    return points;
  };

  const handleResultChange = (matchId: number, result: string) => {
    console.log(`Attempting to change match ${matchId} result to: ${result}`);
    
    // Check if this is a past round (not the latest round)
    const maxRound = allMatches ? Math.max(...allMatches.map(m => m.round)) : currentRound;
    const isPastRound = currentRound < maxRound;
    
    if (isPastRound) {
      // Show confirmation dialog for past round edits
      setPendingResultChange({ matchId, result, isPastRound: true });
    } else {
      // Direct update for current/latest round
      updateMatchMutation.mutate({ matchId, result });
    }
  };

  // Player selection handlers
  const handlePlayerClick = (playerId: number, matchId: number, color: 'white' | 'black', playerName: string) => {
    if (!isOwner || !playerId) return;
    
    const playerInfo = { playerId, matchId, color, playerName };
    
    // Check if this player is already selected
    const existingIndex = selectedPlayers.findIndex(p => 
      p.playerId === playerId && p.matchId === matchId && p.color === color
    );
    
    if (existingIndex >= 0) {
      // Deselect the player
      setSelectedPlayers(prev => prev.filter((_, i) => i !== existingIndex));
      return;
    }
    
    if (selectedPlayers.length === 0) {
      // First player selection
      setSelectedPlayers([playerInfo]);
    } else if (selectedPlayers.length === 1) {
      // Second player selection - execute swap
      const firstPlayer = selectedPlayers[0];
      
      // Don't swap with self
      if (firstPlayer.playerId === playerId && firstPlayer.matchId === matchId && firstPlayer.color === color) {
        return;
      }
      
      // Execute the swap
      swapPlayersMutation.mutate({
        match1Id: firstPlayer.matchId,
        match2Id: matchId,
        player1Id: firstPlayer.playerId,
        player2Id: playerId,
        color1: firstPlayer.color,
        color2: color,
      });
      
      // Clear selections
      setSelectedPlayers([]);
    } else {
      // Reset to just this player if somehow more than 2 are selected
      setSelectedPlayers([playerInfo]);
    }
  };

  const confirmResultChange = () => {
    if (pendingResultChange) {
      updateMatchMutation.mutate({ 
        matchId: pendingResultChange.matchId, 
        result: pendingResultChange.result 
      });
      setPendingResultChange(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-100 text-green-800">Completed</Badge>;
      case 'in_progress':
        return <Badge variant="default" className="bg-yellow-100 text-yellow-800">In Progress</Badge>;
      default:
        return <Badge variant="secondary">Pending</Badge>;
    }
  };

  // Clickable player box component for selection-based swapping
  const PlayerBox = ({ 
    playerId, 
    playerName, 
    rating, 
    points, 
    matchId, 
    color, 
    round 
  }: { 
    playerId: number | null; 
    playerName: string; 
    rating: number; 
    points: number; 
    matchId: number; 
    color: 'white' | 'black'; 
    round: number;
  }) => {
    const isSelected = selectedPlayers.some(p => 
      p.playerId === playerId && p.matchId === matchId && p.color === color
    );

    return (
      <div
        onClick={() => {
          if (playerId && isOwner) {
            handlePlayerClick(playerId, matchId, color, playerName);
          }
        }}
        className={`
          inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition-all
          ${isOwner && playerId ? 'cursor-pointer hover:shadow-lg hover:border-blue-400' : 'cursor-default'}
          ${isSelected ? 'bg-blue-100 border-blue-500 shadow-lg' : 'bg-gray-50 border-gray-200'}
          ${playerId ? 'text-gray-900' : 'text-gray-500 italic'}
        `}
      >
        <div className="flex flex-col">
          <span className="text-sm font-medium">
            {playerName} {points !== undefined ? `[${points}]` : ''}
          </span>
          <span className="text-xs text-gray-500">
            {playerId ? `(${rating})` : ''}
          </span>
        </div>
        {isSelected && (
          <div className="w-2 h-2 bg-blue-500 rounded-full ml-1"></div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="space-y-6">
        {/* Header Row */}
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Chess className="h-5 w-5" />
              Round {currentRound} Pairings
            </CardTitle>
            <p className="text-sm text-gray-600 mt-1">
              {tournament?.format === 'roundrobin' ? 'Round Robin - Complete Schedule' : 'Swiss System - USCF Tournament Rules'}
            </p>
          </div>
          
          {/* Round Navigation */}
          {allMatches && allMatches.length > 0 && (
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentRound(Math.max(1, currentRound - 1))}
                disabled={currentRound <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="text-sm font-medium px-3 py-1 bg-gray-100 rounded">
                Round {currentRound} of {tournament?.format === 'roundrobin' 
                  ? Math.max(...allMatches.map(m => m.round)) 
                  : (tournament?.rounds || Math.max(...allMatches.map(m => m.round)))}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const maxRound = Math.max(...allMatches.map(m => m.round));
                  setCurrentRound(Math.min(maxRound, currentRound + 1));
                }}
                disabled={currentRound >= Math.max(...allMatches.map(m => m.round))}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="flex items-center space-x-2">
            {/* Match Status Indicator */}
            {matches && matches.length > 0 ? (
              <>
                <div className={`w-3 h-3 rounded-full ${
                  matches.every(m => m.result && m.result !== 'Pending') 
                    ? 'bg-green-500' 
                    : matches.some(m => m.result && m.result !== 'Pending')
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
                }`} />
                <span className="text-sm font-medium">
                  {matches.filter(m => m.result && m.result !== 'Pending').length} / {matches.length} complete
                </span>
              </>
            ) : (
              <span className="text-sm text-gray-500">No pairings generated yet</span>
            )}
          </div>
          
          {isOwner && (
            <div className="flex flex-wrap gap-2">
              {/* Regenerate Complete Schedule Button - Round Robin only */}
              {tournament?.format === 'roundrobin' && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={generatePairingsMutation.isPending}
                    className="border-purple-600 text-purple-600 hover:bg-purple-50"
                    size="sm"
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    {generatePairingsMutation.isPending ? "Regenerating..." : "Regenerate Schedule"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate Complete Round Robin Schedule?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will delete and recreate all pairings for ALL rounds in the Round Robin tournament. 
                      Any existing match results will be lost. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => generatePairingsMutation.mutate({ regenerate: true })}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      Regenerate All Rounds
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {/* Generate Next Round Button - only show for Swiss tournaments */}
            {tournament?.format === 'swiss' && (
              <>
                {tournament && tournament.rounds && currentRound >= tournament.rounds ? (
                  /* Tournament has reached planned rounds - show as extension */
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        disabled={generatePairingsMutation.isPending}
                        className="bg-green-600 hover:bg-green-700"
                        size="sm"
                      >
                        <Play className="h-4 w-4 mr-1" />
                        {generatePairingsMutation.isPending ? "Generating..." : `Generate Round ${currentRound + 1}`}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Generate Round {currentRound + 1}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will extend the tournament beyond the planned {tournament.rounds} rounds. Make sure all results from Round {currentRound} have been entered first.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => generatePairingsMutation.mutate({ regenerate: false })}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          Generate Round {currentRound + 1}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  /* Normal next round generation - Swiss only */
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        disabled={generatePairingsMutation.isPending}
                        className="bg-green-600 hover:bg-green-700"
                        size="sm"
                      >
                        <Play className="h-4 w-4 mr-1" />
                        {generatePairingsMutation.isPending ? "Generating..." : "Generate Next Round"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Generate Round {currentRound + 1}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will create pairings for Round {currentRound + 1}. Make sure all results from Round {currentRound} have been entered first.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => generatePairingsMutation.mutate({ regenerate: false })}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          Generate Round {currentRound + 1}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </>
            )}

            {/* Finish Tournament Button - always available for tournament directors */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  disabled={finishTournamentMutation.isPending}
                  className="border-blue-600 text-blue-600 hover:bg-blue-50"
                  size="sm"
                >
                  <Chess className="h-4 w-4 mr-1" />
                  {finishTournamentMutation.isPending ? "Finishing..." : "Finish Tournament"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Finish Tournament Early?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will complete the tournament with the current standings as final results. 
                    The tournament will end at Round {currentRound} instead of the planned {tournament?.rounds || 'full'} rounds. 
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => finishTournamentMutation.mutate()}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Finish Tournament
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Repair Round with Confirmation - Swiss and Round Robin */}
            {(tournament?.format === 'swiss' || tournament?.format === 'roundrobin') && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={generatePairingsMutation.isPending}
                    size="sm"
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Repair
                  </Button>
                </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Repair Round {currentRound} Pairings?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will delete and recreate all pairings for Round {currentRound}. Any existing match results will be lost. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => generatePairingsMutation.mutate({ regenerate: true })}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Repair Round {currentRound}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
              </AlertDialog>
            )}

            {/* Undo Last Swap Button */}
            {lastSwapState && (
              <Button
                variant="outline"
                disabled={undoSwapMutation.isPending}
                onClick={() => undoSwapMutation.mutate()}
                size="sm"
                className="border-orange-600 text-orange-600 hover:bg-orange-50"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                {undoSwapMutation.isPending ? "Undoing..." : "Undo Swap"}
              </Button>
            )}

            {/* Regenerate Future Rounds - HIDDEN: available on every round if future rounds exist */}
            {false && (allMatches?.length || 0) > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={regenerateFutureRoundsMutation.isPending}
                    className="border-red-300 text-red-600 hover:bg-red-50"
                    size="sm"
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    {regenerateFutureRoundsMutation.isPending ? "Regenerating..." : `Regenerate Round ${currentRound + 1}+`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate Rounds {currentRound + 1}+?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will regenerate all rounds from Round {currentRound + 1} onwards based on current results through Round {currentRound}. 
                      Any existing future round results will be lost. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => regenerateFutureRoundsMutation.mutate({ fromRound: currentRound + 1 })}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Regenerate Round {currentRound + 1}+
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-16 bg-gray-200 rounded-lg"></div>
              </div>
            ))}
          </div>
        ) : !matches || matches.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No pairings generated yet</p>
            {isOwner && (
              <Button onClick={() => generatePairingsMutation.mutate({ regenerate: false })}>
                Generate Pairings
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {tournament?.format === 'roundrobin' ? (
              // Round Robin - Show all rounds with matches organized by round
              (() => {
                const roundGroups = matches.reduce((acc, match) => {
                  if (!acc[match.round]) acc[match.round] = [];
                  acc[match.round].push(match);
                  return acc;
                }, {} as Record<number, typeof matches>);
                
                const sortedRounds = Object.keys(roundGroups).map(Number).sort((a, b) => a - b);
                
                return (
                  <div className="space-y-8">
                    {sortedRounds.map(round => (
                      <div key={round} className="border rounded-lg p-4">
                        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                          <span>Round {round}</span>
                          <Badge variant={round === currentRound ? "default" : "secondary"}>
                            {round === currentRound ? "Current" : round < currentRound ? "Completed" : "Upcoming"}
                          </Badge>
                        </h3>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Board</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">White</th>
                                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">vs</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Black</th>
                                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Result</th>
                                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {roundGroups[round].sort((a, b) => (a.board || 0) - (b.board || 0)).map((match) => (
                                <tr key={match.id}>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <div className="text-sm font-medium text-gray-900">{match.board}</div>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <PlayerBox
                                      playerId={match.whitePlayerId}
                                      playerName={getPlayerName(match.whitePlayerId)}
                                      rating={getPlayerRating(match.whitePlayerId)}
                                      points={getPlayerPoints(match.whitePlayerId, round)}
                                      matchId={match.id}
                                      color="white"
                                      round={round}
                                    />
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-center">
                                    <span className="text-gray-400">vs</span>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <PlayerBox
                                      playerId={match.blackPlayerId}
                                      playerName={match.blackPlayerId ? getPlayerName(match.blackPlayerId) : "See T.D."}
                                      rating={match.blackPlayerId ? getPlayerRating(match.blackPlayerId) : 0}
                                      points={match.blackPlayerId ? getPlayerPoints(match.blackPlayerId, round) : 0}
                                      matchId={match.id}
                                      color="black"
                                      round={round}
                                    />
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-center">
                                    <Select
                                      value={match.result || "Pending"}
                                      onValueChange={(value) => handleResultChange(match.id, value)}
                                    >
                                      <SelectTrigger className="w-24">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="Pending">Pending</SelectItem>
                                        {match.blackPlayerId ? (
                                          <>
                                            <SelectItem value="1-0">1-0</SelectItem>
                                            <SelectItem value="0-1">0-1</SelectItem>
                                            <SelectItem value="1/2-1/2">½-½</SelectItem>
                                            <SelectItem value="1F-0F">1F-0F</SelectItem>
                                            <SelectItem value="0F-1F">0F-1F</SelectItem>
                                          </>
                                        ) : (
                                          <>
                                            <SelectItem value="1-0">1-0 (Win)</SelectItem>
                                            <SelectItem value="0-1">0-1 (Loss)</SelectItem>
                                            <SelectItem value="1/2-1/2">½-½ (Draw)</SelectItem>
                                            <SelectItem value="1-bye">1-point bye</SelectItem>
                                          </>
                                        )}
                                      </SelectContent>
                                    </Select>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-center">
                                    {getStatusBadge(match.status)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()
            ) : (
              // Swiss - Show current round only
              <div className="space-y-6">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Board
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          White
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          vs
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Black
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Result
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {matches.sort((a, b) => (a.board || 0) - (b.board || 0)).map((match) => (
                        <tr key={match.id}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{match.board}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <PlayerBox
                              playerId={match.whitePlayerId}
                              playerName={getPlayerName(match.whitePlayerId)}
                              rating={getPlayerRating(match.whitePlayerId)}
                              points={getPlayerPoints(match.whitePlayerId, match.round)}
                              matchId={match.id}
                              color="white"
                              round={match.round}
                            />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <span className="text-gray-400">vs</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <PlayerBox
                              playerId={match.blackPlayerId}
                              playerName={match.blackPlayerId ? getPlayerName(match.blackPlayerId) : "See T.D."}
                              rating={match.blackPlayerId ? getPlayerRating(match.blackPlayerId) : 0}
                              points={match.blackPlayerId ? getPlayerPoints(match.blackPlayerId, match.round) : 0}
                              matchId={match.id}
                              color="black"
                              round={match.round}
                            />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            {isTournamentDirector ? (
                              <Select
                                value={match.result || "Pending"}
                                onValueChange={(value) => handleResultChange(match.id, value)}
                              >
                                <SelectTrigger className="w-24">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Pending">Pending</SelectItem>
                                  {match.blackPlayerId ? (
                                    <>
                                      <SelectItem value="1-0">1-0</SelectItem>
                                      <SelectItem value="0-1">0-1</SelectItem>
                                      <SelectItem value="1/2-1/2">½-½</SelectItem>
                                      <SelectItem value="1F-0F">1F-0F</SelectItem>
                                      <SelectItem value="0F-1F">0F-1F</SelectItem>
                                    </>
                                  ) : (
                                    <>
                                      <SelectItem value="1-0">1-0 (Win)</SelectItem>
                                      <SelectItem value="0-1">0-1 (Loss)</SelectItem>
                                      <SelectItem value="1/2-1/2">½-½ (Draw)</SelectItem>
                                      <SelectItem value="1-bye">1-point bye</SelectItem>
                                    </>
                                  )}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-sm font-medium">
                                {match.result || "Pending"}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            {getStatusBadge(match.status)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Byes Section */}
                {pairings && pairings.filter((p: any) => p.isBye).length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-yellow-800 mb-2">Byes This Round</h4>
                    <div className="space-y-1">
                      {pairings.filter((p: any) => p.isBye).map((byePairing: any) => (
                        <div key={byePairing.id} className="flex items-center justify-between text-sm">
                          <span className="text-yellow-700">
                            {getPlayerName(byePairing.playerId)} [{getPlayerPoints(byePairing.playerId, currentRound)}] ({getPlayerRating(byePairing.playerId)})
                          </span>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-yellow-700 border-yellow-300">
                              {byePairing.byeType === 'half_point' ? '½ Point Bye' : 
                               byePairing.byeType === 'zero_point' ? '0 Point Bye' : '1 Point Bye'}
                            </Badge>
                            {byePairing.isRequested && (
                              <Badge variant="secondary" className="text-xs">
                                Requested
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Confirmation Dialog for Past Round Edits */}
      {pendingResultChange && (
        <AlertDialog open={!!pendingResultChange} onOpenChange={() => setPendingResultChange(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Edit Previous Round Result?</AlertDialogTitle>
              <AlertDialogDescription>
                You are editing a result from Round {currentRound}, which is a previous round. 
                This will change historical data and may affect future rounds. 
                Are you sure you want to proceed?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingResultChange(null)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmResultChange}
                className="bg-orange-600 hover:bg-orange-700"
              >
                Yes, Edit Previous Round
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}
