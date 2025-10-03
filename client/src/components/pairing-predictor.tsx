import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calculator, Play, RotateCcw, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Tournament, Player, Match } from "@shared/schema";

interface PairingPredictorProps {
  tournamentId: number;
  tournament: Tournament;
}

type MatchResult = "unplayed" | "white-win" | "black-win" | "draw";

interface PredictedPairing {
  board: number;
  whitePlayerId: number | null;
  blackPlayerId: number | null;
  isBye?: boolean;
}

export default function PairingPredictor({ tournamentId, tournament }: PairingPredictorProps) {
  const [predictedResults, setPredictedResults] = useState<Record<number, MatchResult>>({});
  const [predictedPairings, setPredictedPairings] = useState<PredictedPairing[]>([]);
  const [showPredictedPairings, setShowPredictedPairings] = useState(false);
  const { toast } = useToast();

  // Fetch current round pairings
  const { data: matches = [] } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });

  // Fetch players
  const { data: players = [] } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const currentRound = tournament.currentRound || 0;
  const currentRoundMatches = matches.filter(match => match.round === currentRound);

  const getPlayerName = (playerId: number | null) => {
    if (!playerId) return "BYE";
    const player = players.find(p => p.id === playerId);
    if (!player) return "Unknown";
    return `${player.firstName} ${player.lastName}`;
  };

  const handleResultChange = (matchId: number, result: MatchResult) => {
    setPredictedResults(prev => ({
      ...prev,
      [matchId]: result
    }));
  };

  const handlePredict = () => {
    const completedResults = Object.keys(predictedResults).filter(
      matchId => predictedResults[parseInt(matchId, 10)] && predictedResults[parseInt(matchId, 10)] !== "unplayed"
    );

    if (completedResults.length === 0) {
      toast({
        title: "No Results",
        description: "Please set at least one match result to generate predictions",
        variant: "destructive",
      });
      return;
    }

    // Create mock predicted pairings for next round
    const nextRound = currentRound + 1;
    const mockPairings: PredictedPairing[] = [];
    
    // Simple mock prediction logic - in reality this would call the server
    for (let i = 0; i < Math.floor(players.length / 2); i++) {
      mockPairings.push({
        board: i + 1,
        whitePlayerId: players[i * 2]?.id ?? null,
        blackPlayerId: players[i * 2 + 1]?.id ?? null,
        isBye: false,
      });
    }

    setPredictedPairings(mockPairings);
    setShowPredictedPairings(true);
    
    toast({
      title: "Prediction Generated",
      description: `Generated predicted pairings for Round ${nextRound}`,
    });
  };

  const handleReset = () => {
    setPredictedResults({});
    setShowPredictedPairings(false);
    setPredictedPairings([]);
  };

  if (tournament.format !== 'swiss') {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <Calculator className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Pairing Predictor</h3>
          <p className="text-gray-600">
            Pairing prediction is only available for Swiss tournaments.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (tournament.status !== 'active' || currentRound === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <Calculator className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Pairing Predictor</h3>
          <p className="text-gray-600">
            Pairing prediction is available when the tournament is active and has started.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Calculator className="h-5 w-5" />
            <span>Pairing Predictor - Round {currentRound}</span>
          </CardTitle>
          <p className="text-sm text-gray-600">
            Set hypothetical results for current round matches and predict the next round pairings
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {currentRoundMatches.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No pairings available for current round</p>
              </div>
            ) : (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <div className="flex items-start space-x-2">
                    <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-medium text-blue-800">Prediction Tool</h4>
                      <p className="text-sm text-blue-700">
                        This is a simulation tool. Set hypothetical match results to see predicted pairings for the next round.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4">
                  {currentRoundMatches.map((match) => (
                    <div key={match.id} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <Badge variant="outline">Board {match.board ?? "?"}</Badge>
                          <div className="text-sm">
                            <span className="font-medium">{getPlayerName(match.whitePlayerId)}</span>
                            <span className="text-gray-500 mx-2">vs</span>
                            <span className="font-medium">{getPlayerName(match.blackPlayerId)}</span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="text-sm text-gray-500">Hypothetical Result:</span>
                          <Select
                            value={predictedResults[match.id] ?? "unplayed"}
                            onValueChange={(value: MatchResult) => handleResultChange(match.id, value)}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unplayed">Unplayed</SelectItem>
                              <SelectItem value="white-win">1-0</SelectItem>
                              <SelectItem value="draw">½-½</SelectItem>
                              <SelectItem value="black-win">0-1</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center space-x-3 pt-4 border-t">
                  <Button
                    onClick={handlePredict}
                    className="flex items-center space-x-2"
                  >
                    <Play className="h-4 w-4" />
                    <span>Predict Next Round</span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    className="flex items-center space-x-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    <span>Reset</span>
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {showPredictedPairings && predictedPairings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Predicted Pairings - Round {currentRound + 1}</CardTitle>
            <p className="text-sm text-gray-600">
              These are predicted pairings based on your hypothetical results
            </p>
          </CardHeader>
          <CardContent>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <div className="flex items-start space-x-2">
                <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-yellow-800">Simulation Only</h4>
                  <p className="text-sm text-yellow-700">
                    These are predicted pairings for demonstration purposes only. Actual pairings are generated by the tournament director.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="grid gap-3">
              {predictedPairings.map((pairing, index) => (
                <div key={index} className="border rounded-lg p-4 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <Badge variant="secondary">Board {pairing.board}</Badge>
                      <div className="text-sm">
                        <span className="font-medium">{getPlayerName(pairing.whitePlayerId)}</span>
                        <span className="text-gray-500 mx-2">vs</span>
                        <span className="font-medium">{getPlayerName(pairing.blackPlayerId)}</span>
                      </div>
                    </div>
                    {pairing.isBye && (
                      <Badge variant="outline">Bye</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}