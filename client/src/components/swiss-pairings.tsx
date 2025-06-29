import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Play, RefreshCw, Crown as Chess, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Match, Player } from "@shared/schema";

interface SwissPairingsProps {
  tournamentId: number;
}

export default function SwissPairings({ tournamentId }: SwissPairingsProps) {
  const [currentRound, setCurrentRound] = useState(1);
  const { toast } = useToast();

  // Get all matches to determine the current round
  const { data: allMatches } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
    queryFn: async () => {
      const response = await fetch(`/api/tournaments/${tournamentId}/matches`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch all matches");
      return response.json();
    },
  });

  // Update current round based on latest matches
  useEffect(() => {
    if (allMatches && allMatches.length > 0) {
      const latestRound = Math.max(...allMatches.map(match => match.round));
      setCurrentRound(latestRound);
    }
  }, [allMatches]);

  const { data: matches, isLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`, { round: currentRound }],
    queryFn: async () => {
      const response = await fetch(`/api/tournaments/${tournamentId}/matches?round=${currentRound}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch matches");
      return response.json();
    },
  });

  const { data: players } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  // Get pairings to check for byes
  const { data: pairings } = useQuery({
    queryKey: [`/api/tournaments/${tournamentId}/pairings`, { round: currentRound }],
    queryFn: async () => {
      const response = await fetch(`/api/tournaments/${tournamentId}/pairings?round=${currentRound}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch pairings");
      return response.json();
    },
  });

  const generatePairingsMutation = useMutation({
    mutationFn: async ({ regenerate = false }: { regenerate?: boolean } = {}) => {
      const response = await apiRequest("POST", `/api/tournaments/${tournamentId}/generate-pairings`, {
        regenerate,
        targetRound: regenerate ? currentRound : undefined,
      });
      return response.json();
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Success",
        description: variables?.regenerate 
          ? `Round ${currentRound} has been regenerated` 
          : `Round ${currentRound + 1} pairings generated`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
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

  const updateMatchMutation = useMutation({
    mutationFn: async ({ matchId, result }: { matchId: number; result: string }) => {
      const response = await apiRequest("PUT", `/api/matches/${matchId}`, {
        result,
        status: result === "Pending" ? "pending" : "completed",
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update match result.",
        variant: "destructive",
      });
    },
  });

  const getPlayerName = (playerId: number | null) => {
    if (!playerId || !players) return "BYE";
    const player = players.find(p => p.id === playerId);
    return player ? `${player.firstName} ${player.lastName}` : "Unknown";
  };

  const getPlayerRating = (playerId: number | null) => {
    if (!playerId || !players) return 0;
    const player = players.find(p => p.id === playerId);
    return player?.rating || 0;
  };

  const handleResultChange = (matchId: number, result: string) => {
    updateMatchMutation.mutate({ matchId, result });
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
            <p className="text-sm text-gray-600 mt-1">Swiss System - USCF Tournament Rules</p>
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
                Round {currentRound} of {Math.max(...allMatches.map(m => m.round))}
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
          
          <div className="flex space-x-3">
            <Button
              onClick={() => generatePairingsMutation.mutate({ regenerate: false })}
              disabled={generatePairingsMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              <Play className="h-4 w-4 mr-2" />
              {generatePairingsMutation.isPending ? "Generating..." : "Generate Next Round"}
            </Button>
            <Button
              variant="outline"
              onClick={() => generatePairingsMutation.mutate({ regenerate: true })}
              disabled={generatePairingsMutation.isPending}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerate Round {currentRound}
            </Button>
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
        ) : !matches || matches.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No pairings generated yet</p>
            <Button onClick={() => generatePairingsMutation.mutate({ regenerate: false })}>
              Generate Pairings
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Matches Table */}
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
                  {matches.map((match) => (
                    <tr key={match.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{match.board}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="text-sm font-medium text-gray-900">
                            {getPlayerName(match.whitePlayerId)}
                          </div>
                          <div className="text-xs text-gray-500 ml-2">
                            ({getPlayerRating(match.whitePlayerId)})
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className="text-gray-400">vs</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="text-sm font-medium text-gray-900">
                            {getPlayerName(match.blackPlayerId)}
                          </div>
                          <div className="text-xs text-gray-500 ml-2">
                            ({getPlayerRating(match.blackPlayerId)})
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <Select
                          value={match.result || "Pending"}
                          onValueChange={(value) => handleResultChange(match.id, value)}
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Pending">Pending</SelectItem>
                            <SelectItem value="1-0">1-0</SelectItem>
                            <SelectItem value="0-1">0-1</SelectItem>
                            <SelectItem value="1/2-1/2">½-½</SelectItem>
                          </SelectContent>
                        </Select>
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
                        {getPlayerName(byePairing.playerId)} ({getPlayerRating(byePairing.playerId)})
                      </span>
                      <Badge variant="outline" className="text-yellow-700 border-yellow-300">
                        {byePairing.byeType === 'half_point' ? '½ Point Bye' : '1 Point Bye'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
