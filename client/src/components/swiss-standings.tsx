import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import type { Player, Match, Pairing, Tournament } from "@shared/schema";
import { parseTournamentConfig } from "@/lib/tournament-config";
import type { SectionDefinition } from "@shared/tournament-config";
import { getPointsForResult, normalizeMatchResult } from "@shared/match-results";

interface SwissStandingsProps {
  tournamentId: number;
  showExportControls?: boolean;
}

interface PlayerRoundResult {
  opponent: Player | null;
  opponentPosition: number;
  result:
    | 'W'
    | 'L'
    | 'D'
    | 'bye'
    | 'withdrawn'
    | 'forfeit-win'
    | 'forfeit-loss'
    | 'unplayed'
    | 'double-forfeit';
  color: 'white' | 'black' | null;
  points: number;
}

interface SwissPlayerStanding {
  player: Player;
  position: number;
  totalPoints: number;
  roundResults: PlayerRoundResult[];
  isWithdrawn: boolean;
}

function interpretPlayerResult(
  result: string | null | undefined,
  isWhite: boolean,
): { outcome: PlayerRoundResult["result"]; points: number } {
  const normalized = normalizeMatchResult(result);
  const color = isWhite ? "white" : "black";
  const points = getPointsForResult(result, color);

  if (!normalized) {
    return { outcome: "unplayed", points: 0 };
  }
  if (normalized === "1-bye") {
    return { outcome: "bye", points };
  }
  if (normalized === "1-0") {
    return { outcome: isWhite ? "W" : "L", points };
  }
  if (normalized === "0-1") {
    return { outcome: isWhite ? "L" : "W", points };
  }
  if (normalized === "1/2-1/2") {
    return { outcome: "D", points };
  }
  if (normalized === "1F-0F") {
    return { outcome: isWhite ? "forfeit-win" : "forfeit-loss", points };
  }
  if (normalized === "0F-1F") {
    return { outcome: isWhite ? "forfeit-loss" : "forfeit-win", points };
  }
  if (normalized === "1F-1F" || normalized === "0F-0F") {
    return { outcome: "double-forfeit", points };
  }
  return { outcome: "unplayed", points };
}



export default function SwissStandings({ tournamentId, showExportControls = true }: SwissStandingsProps) {
  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const { data: players, isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const { data: matches, isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });

  const { data: pairings, isLoading: pairingsLoading } = useQuery<Pairing[]>({
    queryKey: [`/api/tournaments/${tournamentId}/pairings`],
  });

  const [selectedSectionId, setSelectedSectionId] = useState<string>("__all__");

  const tournamentConfig = useMemo(() => (tournament ? parseTournamentConfig(tournament) : null), [tournament]);

  const sections = useMemo<SectionDefinition[]>(() => {
    if (!tournamentConfig) return [];
    return (tournamentConfig.sections ?? []).filter((section) => section.name.trim().length > 0);
  }, [tournamentConfig]);

  useEffect(() => {
    setSelectedSectionId((prev) => {
      if (prev === "__all__") return prev;
      return sections.some((section) => section.id === prev) ? prev : sections[0]?.id ?? "__all__";
    });
  }, [sections]);

  const playerSectionMap = useMemo(() => {
    const map = new Map<number, SectionDefinition>();
    if (!players) return map;
    const nameMap = new Map<string, SectionDefinition>();
    sections.forEach((section) => {
      nameMap.set(section.name.trim().toLowerCase(), section);
    });

    players.forEach((player) => {
      let resolved: SectionDefinition | undefined;
      if (player.sectionId) {
        resolved = sections.find((section) => section.id === player.sectionId);
      }
      if (!resolved && player.sectionName) {
        resolved = nameMap.get(player.sectionName.trim().toLowerCase());
      }
      if (!resolved && sections.length) {
        resolved = sections[0];
      }
      if (resolved) {
        map.set(player.id, resolved);
      }
    });

    return map;
  }, [players, sections]);

  const filteredPlayers = useMemo(() => {
    if (!players) return [] as Player[];
    if (selectedSectionId === "__all__") return players;
    return players.filter((player) => playerSectionMap.get(player.id)?.id === selectedSectionId);
  }, [players, playerSectionMap, selectedSectionId]);

  const filteredMatches = useMemo(() => {
    if (!matches) return [] as Match[];
    if (selectedSectionId === "__all__") return matches;
    return matches.filter((match) => {
      const whiteSection = match.whitePlayerId ? playerSectionMap.get(match.whitePlayerId)?.id : undefined;
      const blackSection = match.blackPlayerId ? playerSectionMap.get(match.blackPlayerId)?.id : undefined;
      if (match.whitePlayerId && match.blackPlayerId) {
        return whiteSection === selectedSectionId && blackSection === selectedSectionId;
      }
      return whiteSection === selectedSectionId || blackSection === selectedSectionId;
    });
  }, [matches, playerSectionMap, selectedSectionId]);

  const filteredPairings = useMemo(() => {
    if (!pairings) return [] as Pairing[];
    if (selectedSectionId === "__all__") return pairings;
    return pairings.filter((pairing) => playerSectionMap.get(pairing.playerId)?.id === selectedSectionId);
  }, [pairings, playerSectionMap, selectedSectionId]);

  const selectedSectionLabel = useMemo(() => {
    if (selectedSectionId === "__all__") return "All Sections";
    return sections.find((section) => section.id === selectedSectionId)?.name ?? "All Sections";
  }, [sections, selectedSectionId]);

  const playerById = useMemo(() => {
    const map = new Map<number, Player>();
    if (players) {
      players.forEach((player) => map.set(player.id, player));
    }
    return map;
  }, [players]);
  const calculateSwissStandings = useCallback(
    (sourcePlayers: Player[], sourceMatches: Match[], sourcePairings: Pairing[]): SwissPlayerStanding[] => {
      if (!tournament) return [];

      const players = sourcePlayers;
      const matches = sourceMatches;
      const pairings = sourcePairings;

      // Calculate current round from existing matches
      const currentRound = matches.length > 0 ? Math.max(...matches.map((m) => m.round)) : 0;
      // Use the actual highest round number instead of planned rounds to show extended tournaments
      const totalRounds = Math.max(currentRound, tournament.rounds || 5);

      // USCF Tiebreaker calculation functions (local scope)
      const calculateModifiedMedian = (playerId: number): number => {
        const opponentScores = getOpponentScores(playerId);
        if (opponentScores.length <= 2) return opponentScores.reduce((sum, score) => sum + score, 0);

        const sortedScores = [...opponentScores].sort((a, b) => b - a);
        const middleScores = sortedScores.slice(1, -1);
        return middleScores.reduce((sum, score) => sum + score, 0) / middleScores.length;
      }

      const calculateSolkoff = (playerId: number): number => {
        const opponentScores = getOpponentScores(playerId);
        return opponentScores.reduce((sum, score) => sum + score, 0);
      }

      const calculateCumulative = (playerId: number): number => {
        let cumulative = 0;
        let runningTotal = 0;

        const playerMatches = matches
          .filter((m) => m.whitePlayerId === playerId || m.blackPlayerId === playerId)
          .sort((a, b) => a.round - b.round);

        playerMatches.forEach((match) => {
          const normalized = normalizeMatchResult(match.result);
          if (!normalized) {
            return;
          }
          const isWhite = match.whitePlayerId === playerId;
          const points = getPointsForResult(match.result, isWhite ? "white" : "black");
          runningTotal += points;
          cumulative += runningTotal;
        });

        return cumulative;
      }

      const getOpponentScores = (playerId: number): number[] => {
        const opponentIds = new Set<number>();

        matches.forEach((match) => {
          if (match.whitePlayerId === playerId && match.blackPlayerId) {
            opponentIds.add(match.blackPlayerId);
          } else if (match.blackPlayerId === playerId && match.whitePlayerId) {
            opponentIds.add(match.whitePlayerId);
          }
        });

        return Array.from(opponentIds).map((opponentId) => {
          let totalPoints = 0;

          matches.forEach((match) => {
            if (match.whitePlayerId === opponentId || match.blackPlayerId === opponentId) {
              const normalized = normalizeMatchResult(match.result);
              if (!normalized) {
                return;
              }
              const isWhite = match.whitePlayerId === opponentId;
              totalPoints += getPointsForResult(match.result, isWhite ? "white" : "black");
            }
          });

          return totalPoints;
        });
      };

      // First pass: Calculate basic points and rankings
      const basicStandings = players.map((player) => {
        const playerMatches = matches.filter(
          (match) => match.whitePlayerId === player.id || match.blackPlayerId === player.id
        );

        // Get bye pairings for this player
        const playerByes = pairings.filter(
          (pairing) =>
            pairing.playerId === player.id && pairing.isBye && pairing.points !== null && pairing.round <= currentRound,
        );

        let totalPoints = 0;

        // Add points from matches
        playerMatches.forEach((match) => {
          const normalized = normalizeMatchResult(match.result);
          if (!normalized) return;
          const isWhite = match.whitePlayerId === player.id;
          totalPoints += getPointsForResult(match.result, isWhite ? "white" : "black");
        });

        // Add points from byes
        playerByes.forEach((bye) => {
          const byePoints = bye.points === 1 ? 0.5 : bye.points === 2 ? 1 : 0;
          totalPoints += byePoints;
        });

        return {
          player,
          totalPoints,
          isWithdrawn: false, // Simplified for now
        };
      });

      // Calculate tiebreakers for each player if using USCF system
      const standingsWithTiebreakers = tournament?.tiebreakOrder === "uscf"
        ? basicStandings.map((standing) => ({
            ...standing,
            modifiedMedian: calculateModifiedMedian(standing.player.id),
            solkoff: calculateSolkoff(standing.player.id),
            cumulative: calculateCumulative(standing.player.id),
          }))
        : basicStandings;

      // Sort by points first, then by tiebreaker system
      standingsWithTiebreakers.sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;

        if (tournament?.tiebreakOrder === "uscf") {
          // USCF tiebreaker order: Modified Median → Solkoff → Cumulative
          const aWithTiebreaks = a as any;
          const bWithTiebreaks = b as any;

          if (bWithTiebreaks.modifiedMedian !== aWithTiebreaks.modifiedMedian) {
            return bWithTiebreaks.modifiedMedian - aWithTiebreaks.modifiedMedian;
          }
          if (bWithTiebreaks.solkoff !== aWithTiebreaks.solkoff) {
            return bWithTiebreaks.solkoff - aWithTiebreaks.solkoff;
          }
          if (bWithTiebreaks.cumulative !== aWithTiebreaks.cumulative) {
            return bWithTiebreaks.cumulative - aWithTiebreaks.cumulative;
          }
        }

        // Final tiebreaker: rating
        const isFide = tournamentConfig?.details.primaryRatingSystem === 'fide';
        const ratingA = (isFide ? (a.player.fideRating ?? a.player.rating) : (a.player.uscfRating ?? a.player.rating)) || 0;
        const ratingB = (isFide ? (b.player.fideRating ?? b.player.rating) : (b.player.uscfRating ?? b.player.rating)) || 0;
        return ratingB - ratingA;
      });

      // Assign positions
      const standingsWithPositions = standingsWithTiebreakers.map((standing, index) => ({
        ...standing,
        position: index + 1,
      }));

      // Second pass: Calculate detailed round results
      const detailedStandings: SwissPlayerStanding[] = standingsWithPositions.map((standing) => {
        const roundResults: PlayerRoundResult[] = [];

        for (let round = 1; round <= totalRounds; round++) {
          if (round > currentRound) {
            // Future rounds - show empty
            roundResults.push({
              opponent: null,
              opponentPosition: 0,
              result: "withdrawn",
              color: null,
              points: 0,
            });
            continue;
          }

          // Check for bye first
          const byeThisRound = pairings.find(
            (pairing) => pairing.playerId === standing.player.id && pairing.isBye && pairing.round === round,
          );

          if (byeThisRound) {
            const byePoints = byeThisRound.points === 1 ? 0.5 : byeThisRound.points === 2 ? 1 : 0;
            roundResults.push({
              opponent: null,
              opponentPosition: 0,
              result: "bye",
              color: null,
              points: byePoints,
            });
            continue;
          }

          // Check for withdrawal - simplified without withdrawnRound field
          if (standing.isWithdrawn) {
            roundResults.push({
              opponent: null,
              opponentPosition: 0,
              result: "withdrawn",
              color: null,
              points: 0,
            });
            continue;
          }

          // Find match for this round
          const matchThisRound = matches.find(
            (match) =>
              match.round === round &&
              (match.whitePlayerId === standing.player.id || match.blackPlayerId === standing.player.id),
          );

          // Check if player has any pairing (match or bye) for this round
          const pairingThisRound = pairings.find(
            (pairing) => pairing.playerId === standing.player.id && pairing.round === round,
          );

          if (!matchThisRound && !pairingThisRound) {
            // No match or pairing found - player joined late (unplayed round)
            const pointsBeforeRound = roundResults.reduce((sum, result) => sum + result.points, 0);

            roundResults.push({
              opponent: null,
              opponentPosition: 0,
              result: "unplayed",
              color: null,
              points: pointsBeforeRound,
            });
            continue;
          }

          if (!matchThisRound) {
            // No match found but has pairing - might be withdrawn or other issue
            roundResults.push({
              opponent: null,
              opponentPosition: 0,
              result: "withdrawn",
              color: null,
              points: 0,
            });
            continue;
          }

          const isWhite = matchThisRound.whitePlayerId === standing.player.id;
          const opponentId = isWhite ? matchThisRound.blackPlayerId : matchThisRound.whitePlayerId;
          const opponent = opponentId ? playerById.get(opponentId) ?? null : null;
          const opponentStanding = standingsWithPositions.find((s) => s.player.id === opponentId);
          const opponentPosition = opponentStanding?.position || 0;
          const interpretation = interpretPlayerResult(matchThisRound.result, isWhite);

          roundResults.push({
            opponent,
            opponentPosition,
            result: interpretation.outcome,
            color: isWhite ? "white" : "black",
            points: interpretation.points,
          });
        }

        return {
          player: standing.player,
          position: standing.position,
          totalPoints: standing.totalPoints,
          roundResults,
          isWithdrawn: standing.isWithdrawn,
        };
      });

      return detailedStandings;
    },
    [playerById, tournament],
  );

  const standings = useMemo(
    () => calculateSwissStandings(filteredPlayers, filteredMatches, filteredPairings),
    [calculateSwissStandings, filteredPlayers, filteredMatches, filteredPairings],
  );
  const currentRound = filteredMatches.length > 0 ? Math.max(...filteredMatches.map((m) => m.round)) : 0;
  const totalRounds = Math.max(currentRound, tournament?.rounds || 5);

  const downloadStandings = useCallback(() => {
    const baseHeaders = ['Rank', 'Name', 'Rating', 'Points'];
    const tiebreakHeaders = tournament?.tiebreakOrder === 'uscf' ? ['Modified Median', 'Solkoff', 'Cumulative'] : [];
    const roundHeaders = Array.from({ length: totalRounds }, (_, i) => `Round ${i + 1}`);
    const headers = [...baseHeaders, ...tiebreakHeaders, ...roundHeaders];

    const rows = standings.map((standing) => {
      const baseData = [
        standing.position,
        `${standing.player.firstName} ${standing.player.lastName}`,
        (tournamentConfig?.details.primaryRatingSystem === 'fide' 
          ? (standing.player.fideRating ?? standing.player.rating) 
          : (standing.player.uscfRating ?? standing.player.rating)) || 'Unrated',
        formatPoints(standing),
      ];

      const tiebreakData = tournament?.tiebreakOrder === 'uscf'
        ? [
            (standing as any).modifiedMedian?.toFixed(2) || '0.00',
            (standing as any).solkoff?.toFixed(2) || '0.00',
            (standing as any).cumulative?.toFixed(2) || '0.00',
          ]
        : [];

      const roundData = standing.roundResults.map((result, index) => formatRoundResult(result, index + 1));

      return [...baseData, ...tiebreakData, ...roundData];
    });

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    const sectionSlug = selectedSectionId === "__all__"
      ? "all-sections"
      : selectedSectionLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "section";
    const baseName = (tournament?.name ?? 'tournament').toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || 'event';

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseName}-standings-${sectionSlug}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [formatPoints, selectedSectionId, selectedSectionLabel, standings, tournament?.name, tournament?.tiebreakOrder, totalRounds]);

  const handlePrintStandings = useCallback(() => {
    if (standings.length === 0 || typeof window === 'undefined') return;
    const headingSuffix = selectedSectionId === '__all__' ? '' : ` – ${selectedSectionLabel}`;
    const title = `${tournament?.name ?? 'Tournament'} Swiss Standings${headingSuffix}`;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const styles = `body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#0f172a;}h1{font-size:24px;margin-bottom:16px;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #cbd5f5;padding:8px;font-size:13px;text-align:center;}th{text-transform:uppercase;font-size:11px;background:#f1f5f9;color:#475569;letter-spacing:0.05em;}td:first-child,th:first-child{text-align:left;}`;
    printWindow.document.write(`<html><head><title>${title}</title><style>${styles}</style></head><body>`);
    printWindow.document.write(`<h1>${title}</h1>`);
    printWindow.document.write('<table><thead><tr><th>Rank</th><th>Player</th>');
    for (let round = 1; round <= totalRounds; round++) {
      printWindow.document.write(`<th>Rd ${round}</th>`);
    }
    printWindow.document.write('</tr></thead><tbody>');

    standings.forEach((standing) => {
      const isFide = tournamentConfig?.details.primaryRatingSystem === 'fide';
      const playerRating = isFide ? (standing.player.fideRating ?? standing.player.rating) : (standing.player.uscfRating ?? standing.player.rating);
      const ratingDisplay = playerRating != null ? ` (${playerRating})` : '';
      printWindow.document.write(`<tr><td>${standing.position}</td><td style="text-align:left;">${playerName}${ratingDisplay}</td>`);

      standing.roundResults.forEach((result, index) => {
        const display = formatRoundResultDisplay(result);
        const cumulative = standing.roundResults
          .slice(0, index + 1)
          .reduce((sum, entry) => sum + entry.points, 0);
        const cumulativeText = index < currentRound ? cumulative.toString() : '';
        const cellContent = cumulativeText
          ? `${display}<div style="font-size:11px;color:#475569;margin-top:2px;">${cumulativeText}</div>`
          : display;
        printWindow.document.write(`<td>${cellContent}</td>`);
      });

      printWindow.document.write('</tr>');
    });

    printWindow.document.write('</tbody></table></body></html>');
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }, [currentRound, formatRoundResultDisplay, selectedSectionId, selectedSectionLabel, standings, totalRounds, tournament?.name]);

  if (tournamentLoading || playersLoading || matchesLoading || pairingsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Swiss Tournament Standings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!tournament || !players || !matches || !pairings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Swiss Tournament Standings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-500">No tournament data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  function formatRoundResult(result: PlayerRoundResult, round: number): string {
    if (result.result === 'bye') {
      return 'bye';
    }
    
    if (result.result === 'unplayed') {
      return `U${result.points}`;
    }
    
    if (result.result === 'withdrawn') {
      return round <= currentRound ? '---' : '';
    }

    if (!result.opponent) {
      return '---';
    }

    const colorPrefix = result.color === 'white' ? 'W' : 'B';
    const opponentPos = result.opponentPosition;

    if (result.result === 'forfeit-win') {
      return `X${opponentPos}`;
    }
    
    if (result.result === 'forfeit-loss') {
      return `F${opponentPos}`;
    }

    if (result.result === 'double-forfeit') {
      return `FF${opponentPos}`;
    }

    return `${colorPrefix}${opponentPos}`;
  }

  function formatRoundResultDisplay(result: PlayerRoundResult): string {
    if (result.result === 'bye') {
      return 'bye';
    }
    
    if (result.result === 'unplayed') {
      return `U${result.points}`;
    }
    
    if (result.result === 'withdrawn') {
      return '---';
    }

    if (!result.opponent) {
      return '---';
    }

    const colorPrefix = result.color === 'white' ? 'W' : 'B';
    
    // Show "TD" instead of position number if opponent is the houseplayer
    const opponentDisplayText = result.opponent?.isActiveTd ? 'TD' : result.opponentPosition;

    if (result.result === 'forfeit-win') {
      return `X${opponentDisplayText}`;
    }
    
    if (result.result === 'forfeit-loss') {
      return `F${opponentDisplayText}`;
    }

    if (result.result === 'double-forfeit') {
      return `FF${opponentDisplayText}`;
    }

    return `${colorPrefix}${result.result}${opponentDisplayText}`;
  }

  function formatPoints(standing: SwissPlayerStanding): string {
    if (standing.isWithdrawn) {
      return `U${standing.totalPoints}`;
    }
    return standing.totalPoints.toString();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>Swiss Tournament Standings</CardTitle>
            <p className="mt-1 text-sm text-gray-600">Detailed round-by-round results and current rankings</p>
            {selectedSectionId !== "__all__" && (
              <p className="text-xs text-muted-foreground">Showing Section: {selectedSectionLabel}</p>
            )}
            {tournament?.tiebreakOrder === "uscf" && (
              <p className="mt-1 text-xs text-gray-400">MM: Modified Median | SK: Solkoff | CU: Cumulative</p>
            )}
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
            {showExportControls ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  onClick={handlePrintStandings}
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                  disabled={standings.length === 0}
                >
                  <Printer className="h-4 w-4" />
                  Print
                </Button>
                <Button
                  onClick={downloadStandings}
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                  disabled={standings.length === 0}
                >
                  <Download className="h-4 w-4" />
                  Download CSV
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {standings.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No standings available yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    #
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name/Rating/ID
                  </th>
                  {Array.from({ length: totalRounds }, (_, i) => (
                    <th key={i} className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Rd {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {standings.map((standing) => (
                  <tr key={standing.player.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {standing.position}
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {standing.player.firstName} {standing.player.lastName}
                        {standing.player.isActiveTd && (
                          <span className="text-xs text-gray-500 font-normal"> (substitute player)</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {tournamentConfig?.details.primaryRatingSystem === 'fide' 
                          ? (standing.player.fideRating ?? standing.player.rating) 
                          : (standing.player.uscfRating ?? standing.player.rating)}{" "}
                        {standing.player.federation}
                      </div>
                      {tournament?.tiebreakOrder === 'uscf' && (standing as any).modifiedMedian !== undefined && (
                        <div className="text-xs text-gray-400 mt-1">
                          MM: {(standing as any).modifiedMedian?.toFixed(1)} | 
                          SK: {(standing as any).solkoff?.toFixed(1)} | 
                          CU: {(standing as any).cumulative?.toFixed(1)}
                        </div>
                      )}
                    </td>
                    {standing.roundResults.map((result, roundIndex) => {
                      // Calculate cumulative points up to this round
                      const cumulativePoints = standing.roundResults
                        .slice(0, roundIndex + 1)
                        .reduce((sum, r) => sum + r.points, 0);
                      
                      return (
                        <td key={roundIndex} className="px-2 py-3 whitespace-nowrap text-center">
                          <div className="text-xs text-gray-900">
                            {formatRoundResultDisplay(result)}
                          </div>
                          <div className="text-xs font-medium text-gray-700">
                            {roundIndex < currentRound ? cumulativePoints : ''}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}