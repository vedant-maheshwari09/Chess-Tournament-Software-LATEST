import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Play, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Match, Player } from "@shared/schema";

interface SwissPairingsProps {
  tournamentId: number;
}

export default function SwissPairings({ tournamentId }: SwissPairingsProps) {
  const [currentRound, setCurrentRound] = useState(1);
  const { toast } = useToast();

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

  const generatePairingsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/tournaments/${tournamentId}/generate-pairings`, {
        round: currentRound,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Pairings Generated",
        description: `Round ${currentRound} pairings have been generated.`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/matches`] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to generate pairings. Please try again.",
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
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Round {currentRound} Pairings</CardTitle>
            <p className="text-sm text-gray-600 mt-1">Swiss System - Auto-generated pairings</p>
          </div>
          <div className="flex space-x-3">
            <Button
              onClick={() => generatePairingsMutation.mutate()}
              disabled={generatePairingsMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              <Play className="h-4 w-4 mr-2" />
              {generatePairingsMutation.isPending ? "Generating..." : "Start Round"}
            </Button>
            <Button
              variant="outline"
              onClick={() => generatePairingsMutation.mutate()}
              disabled={generatePairingsMutation.isPending}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerate
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
            <Button onClick={() => generatePairingsMutation.mutate()}>
              Generate Pairings
            </Button>
          </div>
        ) : (
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
        )}
      </CardContent>
    </Card>
  );
}
