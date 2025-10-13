import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Play, RefreshCw, Crown as Chess, RotateCcw, Printer, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Match, Player, Pairing, Tournament } from "@shared/schema";
import { parseTournamentConfig } from "@/lib/tournament-config";
import type { SectionDefinition } from "@shared/tournament-config";
import { HEAD_TO_HEAD_RESULT_OPTIONS, BYE_RESULT_OPTIONS, getPointsForResult } from "@shared/match-results";

interface TournamentPairingsProps {
  tournamentId: number;
  showExportControls?: boolean;
}

export default function SwissPairings({ tournamentId, showExportControls = true }: TournamentPairingsProps) {
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

  const tournamentConfig = useMemo(() => (tournament ? parseTournamentConfig(tournament) : null), [tournament]);
  const sections = useMemo<SectionDefinition[]>(() => {
    if (!tournamentConfig) return [];
    return (tournamentConfig.sections ?? []).filter((section) => section.name.trim().length > 0);
  }, [tournamentConfig]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>("__all__");
  const selectedSectionLabel = useMemo(() => {
    if (selectedSectionId === "__all__") return "All Sections";
    return sections.find((section) => section.id === selectedSectionId)?.name ?? "All Sections";
  }, [sections, selectedSectionId]);

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

  useEffect(() => {
    setSelectedSectionId((prev) => {
      if (prev === "__all__") return prev;
      return sections.some((section) => section.id === prev) ? prev : sections[0]?.id ?? "__all__";
    });
  }, [sections]);

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

  const playerSectionMap = useMemo(() => {
    const map = new Map<number, SectionDefinition>();
    if (!players) return map;
    const sectionsByName = new Map<string, SectionDefinition>();
    sections.forEach((section) => {
      sectionsByName.set(section.name.trim().toLowerCase(), section);
    });
    players.forEach((player) => {
      let assigned: SectionDefinition | undefined;
      if (player.sectionId) {
        assigned = sections.find((section) => section.id === player.sectionId);
      }
      if (!assigned && player.sectionName) {
        assigned = sectionsByName.get(player.sectionName.trim().toLowerCase());
      }
      if (!assigned) {
        const rating = typeof player.rating === "number" ? player.rating : Number(player.rating);
        if (!Number.isNaN(rating)) {
          assigned = sections.find((section) => {
            const minOk = section.ratingMin === null || rating >= section.ratingMin;
            const maxOk = section.ratingMax === null || rating <= section.ratingMax;
            return minOk && maxOk;
          });
        }
      }
      if (!assigned && sections.length) {
        assigned = sections[0];
      }
      if (assigned) {
        map.set(player.id, assigned);
      }
    });
    return map;
  }, [players, sections]);

  const matchSectionFilter = useCallback(
    (match: Match, targetSectionId: string) => {
      if (targetSectionId === "__all__") return true;
      const whiteSectionId = match.whitePlayerId ? playerSectionMap.get(match.whitePlayerId)?.id : undefined;
      const blackSectionId = match.blackPlayerId ? playerSectionMap.get(match.blackPlayerId)?.id : undefined;
      if (!whiteSectionId && !blackSectionId) return false;
      return whiteSectionId === targetSectionId || blackSectionId === targetSectionId;
    },
    [playerSectionMap],
  );

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

  const filteredMatches = useMemo(() => {
    if (!matches) return [] as Match[];
    if (selectedSectionId === "__all__") return [...matches];
    return matches.filter((match) => matchSectionFilter(match, selectedSectionId));
  }, [matches, matchSectionFilter, selectedSectionId]);

  const roundRobinGroups = useMemo(() => {
    if (!matches || tournament?.format !== 'roundrobin') return [] as Array<{ round: number; matches: Match[] }>;
    const grouped = new Map<number, Match[]>();
    matches.forEach((match) => {
      if (!matchSectionFilter(match, selectedSectionId)) return;
      const list = grouped.get(match.round) ?? [];
      list.push(match);
      grouped.set(match.round, list);
    });
    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([round, items]) => ({
        round,
        matches: [...items].sort((a, b) => (a.board || 0) - (b.board || 0)),
      }));
  }, [matches, matchSectionFilter, selectedSectionId, tournament?.format]);

  const swissMatches = useMemo(() => {
    if (tournament?.format !== 'swiss') return [] as Match[];
    return [...filteredMatches].sort((a, b) => (a.board || 0) - (b.board || 0));
  }, [filteredMatches, tournament?.format]);

  const filteredByes = useMemo(() => {
    if (!pairings) return [] as Pairing[];
    const byes = pairings.filter((pairing) => pairing.isBye);
    if (selectedSectionId === "__all__") return byes;
    return byes.filter((pairing) => playerSectionMap.get(pairing.playerId)?.id === selectedSectionId);
  }, [pairings, playerSectionMap, selectedSectionId]);

  const pairingGroups = useMemo(() => {
    if (tournament?.format === 'roundrobin') {
      return roundRobinGroups;
    }
    if (tournament?.format === 'swiss') {
      return swissMatches.length ? [{ round: currentRound, matches: swissMatches }] : [];
    }
    return [] as Array<{ round: number; matches: Match[] }>;
  }, [currentRound, roundRobinGroups, swissMatches, tournament?.format]);

  const hasPrintableMatches = pairingGroups.some((group) => group.matches.length > 0);
  const hasDisplayData = hasPrintableMatches || (tournament?.format === 'swiss' && filteredByes.length > 0);

  const matchesForStatus = useMemo(() => {
    if (tournament?.format === 'roundrobin') {
      return roundRobinGroups.find((group) => group.round === currentRound)?.matches ?? [];
    }
    if (tournament?.format === 'swiss') {
      return swissMatches;
    }
    return filteredMatches;
  }, [currentRound, filteredMatches, roundRobinGroups, swissMatches, tournament?.format]);

  const maxRoundFromMatches = useMemo(() => {
    if (!allMatches || allMatches.length === 0) return 0;
    return Math.max(...allMatches.map((match) => match.round));
  }, [allMatches]);
  const plannedRounds = tournament?.rounds ?? 0;
  const totalRounds = Math.max(maxRoundFromMatches, plannedRounds, 1);
  const roundNumbers = useMemo(() => Array.from({ length: totalRounds }, (_, index) => index + 1), [totalRounds]);

  useEffect(() => {
    setCurrentRound((prev) => {
      if (prev < 1) return 1;
      if (prev > totalRounds) return totalRounds;
      return prev;
    });
  }, [totalRounds]);

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

  const getPlayerName = useCallback(
    (playerId: number | null) => {
      if (!playerId || !players) return "BYE";
      const player = players.find((p) => p.id === playerId);
      if (!player) return "Unknown";

      const fullName = `${player.firstName} ${player.lastName}`;
      if (player.isActiveTd) {
        return `${fullName} (substitute player)`;
      }
      return fullName;
    },
    [players],
  );

  const getPlayerRating = useCallback(
    (playerId: number | null) => {
      if (!playerId || !players) return 0;
      const player = players.find((p) => p.id === playerId);
      return player?.rating || 0;
    },
    [players],
  );

  const getPlayerPoints = useCallback(
    (playerId: number | null, beforeRound: number = 999) => {
      if (!playerId || !allMatches) return 0;

      let points = 0;

      for (const match of allMatches) {
        if ((match.whitePlayerId === playerId || match.blackPlayerId === playerId) && match.round < beforeRound) {
          const color = match.whitePlayerId === playerId ? 'white' : 'black';
          points += getPointsForResult(match.result, color);
        }
      }

      if (allTournamentPairings) {
        for (const pairing of allTournamentPairings) {
          if (
            pairing.playerId === playerId &&
            pairing.isBye &&
            pairing.round < beforeRound
          ) {
            const byePoints = pairing.points === 1 ? 0.5 : pairing.points === 2 ? 1 : 0;
            points += byePoints;
          }
        }
      }

      return points;
    },
    [allMatches, allTournamentPairings],
  );

  const handlePrintPairings = useCallback(() => {
    if (!hasPrintableMatches || typeof window === "undefined") return;
    const headingSuffix = selectedSectionId === "__all__" ? "" : ` – ${selectedSectionLabel}`;
    const title = `${tournament?.name ?? "Tournament"} Pairings${headingSuffix}`;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(
      `<html><head><title>${title}</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#0f172a;}h1{font-size:24px;margin-bottom:16px;}h2{font-size:18px;margin:24px 0 12px;}table{width:100%;border-collapse:collapse;margin-bottom:24px;}th,td{border:1px solid #cbd5f5;padding:8px;text-align:left;font-size:14px;}th{background:#f1f5f9;text-transform:uppercase;letter-spacing:0.05em;font-size:12px;color:#475569;}</style></head><body>`,
    );
    printWindow.document.write(`<h1>${title}</h1>`);

    pairingGroups.forEach(({ round, matches }) => {
      if (!matches.length) return;
      printWindow.document.write(
        `<h2>Round ${round}</h2><table><thead><tr><th>Board</th><th>White</th><th>Black</th><th>Result</th></tr></thead><tbody>`,
      );
      matches.forEach((match) => {
        const whiteName = getPlayerName(match.whitePlayerId);
        const blackName = match.blackPlayerId ? getPlayerName(match.blackPlayerId) : "Bye";
        const result = match.result ?? "";
        printWindow.document.write(
          `<tr><td>${match.board ?? ""}</td><td>${whiteName}</td><td>${blackName}</td><td>${result}</td></tr>`,
        );
      });
      printWindow.document.write(`</tbody></table>`);
    });

    if (tournament?.format === 'swiss' && filteredByes.length > 0) {
      printWindow.document.write(
        `<h2>Byes</h2><table><thead><tr><th>Player</th><th>Points</th><th>Type</th></tr></thead><tbody>`,
      );
      filteredByes.forEach((bye) => {
        const playerName = getPlayerName(bye.playerId);
        const points = bye.points === 1 ? "0.5" : bye.points === 2 ? "1" : "0";
        const type = bye.byeType === 'half_point' ? '½ Point Bye' : bye.byeType === 'zero_point' ? '0 Point Bye' : '1 Point Bye';
        printWindow.document.write(`<tr><td>${playerName}</td><td>${points}</td><td>${type}</td></tr>`);
      });
      printWindow.document.write(`</tbody></table>`);
    }

    printWindow.document.write(`</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }, [filteredByes, getPlayerName, hasPrintableMatches, pairingGroups, selectedSectionId, selectedSectionLabel, tournament?.name]);

  const handleDownloadPairings = useCallback(() => {
    if (!hasPrintableMatches || typeof window === "undefined") return;
    const rows: string[][] = [["Round", "Board", "White", "Black", "Result"]];

    pairingGroups.forEach(({ round, matches }) => {
      matches.forEach((match) => {
        rows.push([
          String(round),
          match.board ? String(match.board) : "",
          getPlayerName(match.whitePlayerId),
          match.blackPlayerId ? getPlayerName(match.blackPlayerId) : "Bye",
          match.result ?? "",
        ]);
      });
    });

    if (tournament?.format === 'swiss' && filteredByes.length > 0) {
      filteredByes.forEach((bye) => {
        rows.push([
          String(currentRound),
          "",
          getPlayerName(bye.playerId),
          "Bye",
          bye.byeType ?? "Bye",
        ]);
      });
    }

    const csv = rows
      .map((row) =>
        row
          .map((value) => {
            const safe = value.replace(/"/g, '""');
            return `"${safe}"`;
          })
          .join(","),
      )
      .join("\r\n");

    const sectionSlug = selectedSectionId === "__all__"
      ? "all-sections"
      : selectedSectionLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "section";
    const baseName = (tournament?.name ?? "tournament").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "event";
    const roundLabel = tournament?.format === 'swiss' ? `round-${currentRound}` : "all-rounds";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}-pairings-${roundLabel}-${sectionSlug}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [currentRound, filteredByes, getPlayerName, hasPrintableMatches, pairingGroups, selectedSectionId, selectedSectionLabel, tournament?.format, tournament?.name]);

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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Chess className="h-5 w-5" />
              Round {currentRound} Pairings
            </CardTitle>
            <p className="mt-1 text-sm text-gray-600">
              {tournament?.format === 'roundrobin' ? 'Round Robin - Complete Schedule' : 'Swiss System - USCF Tournament Rules'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            {sections.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant={selectedSectionId === "__all__" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedSectionId("__all__")}
                >
                  All Sections
                </Button>
                {sections.map((section) => (
                  <Button
                    key={section.id}
                    variant={selectedSectionId === section.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedSectionId(section.id)}
                  >
                    {section.name}
                  </Button>
                ))}
              </div>
            )}
            {roundNumbers.length > 0 && (
              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap justify-end gap-2">
                  {roundNumbers.map((round) => {
                    const isCurrent = round === currentRound;
                    const isCompleted = round < currentRound;
                    const buttonClasses = `h-9 w-9 rounded-md border ${
                      isCurrent
                        ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                        : isCompleted
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`;
                    return (
                      <Button
                        key={`round-${round}`}
                        variant="outline"
                        size="icon"
                        className={buttonClasses}
                        onClick={() => setCurrentRound(round)}
                      >
                        {round}
                      </Button>
                    );
                  })}
                </div>
                <span className="text-xs text-muted-foreground">
                  Round {currentRound} of {roundNumbers[roundNumbers.length - 1]}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
          <div className="flex items-center gap-2">
            {matchesForStatus.length > 0 ? (
              <>
                <div
                  className={`h-3 w-3 rounded-full ${
                    matchesForStatus.every((m) => m.result && m.result !== 'Pending')
                      ? 'bg-green-500'
                      : matchesForStatus.some((m) => m.result && m.result !== 'Pending')
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                />
                <span className="text-sm font-medium">
                  {matchesForStatus.filter((m) => m.result && m.result !== 'Pending').length} / {matchesForStatus.length} complete
                </span>
              </>
            ) : (
              <span className="text-sm text-gray-500">No pairings generated yet</span>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {showExportControls ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrintPairings}
                  disabled={!hasPrintableMatches}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadPairings}
                  disabled={!hasPrintableMatches}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </>
            ) : null}
            {isOwner && (
              <>
                {tournament?.format === "roundrobin" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={generatePairingsMutation.isPending}
                        className="border-purple-600 text-purple-600 hover:bg-purple-50"
                        size="sm"
                      >
                        <RefreshCw className="mr-1 h-4 w-4" />
                        {generatePairingsMutation.isPending ? "Regenerating..." : "Regenerate Schedule"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Regenerate Complete Round Robin Schedule?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will delete and recreate all pairings for all rounds in the round-robin tournament. Existing match results will be lost.
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

                {tournament?.format === "swiss" && (
                  <>
                    {tournament?.rounds && currentRound >= tournament.rounds ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            disabled={generatePairingsMutation.isPending}
                            className="bg-green-600 hover:bg-green-700"
                            size="sm"
                          >
                            <Play className="mr-1 h-4 w-4" />
                            {generatePairingsMutation.isPending ? "Generating..." : `Generate Round ${currentRound + 1}`}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Generate Round {currentRound + 1}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will extend the tournament beyond the planned {tournament.rounds} rounds. Confirm all Round {currentRound} results first.
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
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            disabled={generatePairingsMutation.isPending}
                            className="bg-green-600 hover:bg-green-700"
                            size="sm"
                          >
                            <Play className="mr-1 h-4 w-4" />
                            {generatePairingsMutation.isPending ? "Generating..." : "Generate Next Round"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Generate Round {currentRound + 1}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will create pairings for the next round. Ensure Round {currentRound} results are complete first.
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

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={finishTournamentMutation.isPending}
                      className="border-blue-600 text-blue-600 hover:bg-blue-50"
                      size="sm"
                    >
                      <Chess className="mr-1 h-4 w-4" />
                      {finishTournamentMutation.isPending ? "Finishing..." : "Finish Tournament"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Finish Tournament Early?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Completing now will finalize standings through Round {currentRound}. This action cannot be undone.
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

                {(tournament?.format === "swiss" || tournament?.format === "roundrobin") && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={generatePairingsMutation.isPending}
                        size="sm"
                      >
                        <RefreshCw className="mr-1 h-4 w-4" />
                        Repair
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Repair Round {currentRound} Pairings?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will delete and recreate all pairings for Round {currentRound}. Any existing results will be cleared.
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

                {lastSwapState && (
                  <Button
                    variant="outline"
                    disabled={undoSwapMutation.isPending}
                    onClick={() => undoSwapMutation.mutate()}
                    size="sm"
                    className="border-orange-600 text-orange-600 hover:bg-orange-50"
                  >
                    <RotateCcw className="mr-1 h-4 w-4" />
                    {undoSwapMutation.isPending ? "Undoing..." : "Undo Swap"}
                  </Button>
                )}

                {false && (allMatches?.length || 0) > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={regenerateFutureRoundsMutation.isPending}
                        className="border-red-300 text-red-600 hover:bg-red-50"
                        size="sm"
                      >
                        <RefreshCw className="mr-1 h-4 w-4" />
                        {regenerateFutureRoundsMutation.isPending ? "Regenerating..." : `Regenerate Round ${currentRound + 1}+`}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Regenerate Rounds {currentRound + 1}+?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will rebuild future rounds based on results through Round {currentRound}. Existing future results will be lost.
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
              </>
            )}
          </div>
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
        ) : !hasDisplayData ? (
          <div className="py-8 text-center">
            <p className="mb-4 text-gray-500">No pairings available for this selection yet.</p>
            {isOwner && (
              <Button onClick={() => generatePairingsMutation.mutate({ regenerate: false })}>
                Generate Pairings
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {tournament?.format === 'roundrobin' ? (
              roundRobinGroups.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-gray-500">No pairings generated yet</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {roundRobinGroups.map(({ round, matches: roundMatches }) => (
                    <div key={round} className="rounded-lg border p-4">
                      <h3 className="mb-4 flex items-center gap-3 text-lg font-semibold">
                        <span>Round {round}</span>
                        {(() => {
                          const isCurrent = round === currentRound;
                          const isCompleted = round < currentRound;
                          const badgeClass = isCurrent
                            ? "bg-amber-50 text-amber-800 border border-amber-200"
                            : isCompleted
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-slate-100 text-slate-600 border border-transparent";
                          return (
                            <Badge variant="outline" className={badgeClass}>
                              {isCurrent ? "In Progress" : isCompleted ? "Completed" : "Upcoming"}
                            </Badge>
                          );
                        })()}
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Board</th>
                              <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">White</th>
                              <th className="px-4 py-2 text-center text-xs font-medium uppercase text-gray-500">vs</th>
                              <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Black</th>
                              <th className="px-4 py-2 text-center text-xs font-medium uppercase text-gray-500">Result</th>
                              <th className="px-4 py-2 text-center text-xs font-medium uppercase text-gray-500">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 bg-white">
                            {roundMatches.map((match) => (
                              <tr key={match.id}>
                                <td className="whitespace-nowrap px-4 py-3">
                                  <div className="text-sm font-medium text-gray-900">{match.board}</div>
                                </td>
                                <td className="whitespace-nowrap px-4 py-3">
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
                                <td className="whitespace-nowrap px-4 py-3 text-center">
                                  <span className="text-gray-400">vs</span>
                                </td>
                                <td className="whitespace-nowrap px-4 py-3">
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
                                <td className="whitespace-nowrap px-4 py-3 text-center">
                                  <Select
                                    value={match.result || "Pending"}
                                    onValueChange={(value) => handleResultChange(match.id, value)}
                                  >
                                    <SelectTrigger className="w-24">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="Pending">Pending</SelectItem>
                                      {(match.blackPlayerId ? HEAD_TO_HEAD_RESULT_OPTIONS : BYE_RESULT_OPTIONS).map(
                                        (option) => (
                                          <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                          </SelectItem>
                                        ),
                                      )}
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-center">{getStatusBadge(match.status)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              // Swiss - Show current round only
              <div className="space-y-6">
                <div className="overflow-x-auto">
                  {swissMatches.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No pairings for this section in Round {currentRound}.
                    </div>
                  ) : (
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                            Board
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                            White
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                            vs
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                            Black
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                            Result
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {swissMatches.map((match) => (
                          <tr key={match.id}>
                            <td className="whitespace-nowrap px-6 py-4">
                              <div className="text-sm font-medium text-gray-900">{match.board}</div>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4">
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
                            <td className="whitespace-nowrap px-6 py-4 text-center">
                              <span className="text-gray-400">vs</span>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4">
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
                            <td className="whitespace-nowrap px-6 py-4 text-center">
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
                                    {(match.blackPlayerId ? HEAD_TO_HEAD_RESULT_OPTIONS : BYE_RESULT_OPTIONS).map(
                                      (option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                          {option.label}
                                        </SelectItem>
                                      ),
                                    )}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span className="text-sm font-medium">{match.result || "Pending"}</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-center">{getStatusBadge(match.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Byes Section */}
                {filteredByes.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-yellow-800 mb-2">Byes This Round</h4>
                    <div className="space-y-1">
                      {filteredByes.map((byePairing: any) => (
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
