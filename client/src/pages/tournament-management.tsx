import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Users, Trophy, Calendar, Play, Plus, Undo } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import PlayerRegistration from "@/components/player-registration";
import SwissPairings from "@/components/swiss-pairings";
import Standings from "@/components/standings";
import SwissStandings from "@/components/swiss-standings";
import RoundRobinCrosstable from "@/components/round-robin-crosstable";
import KnockoutBracket from "@/components/knockout-bracket";
import type { Tournament, Player } from "@shared/schema";

interface TournamentManagementProps {
  tournamentId: number;
}

export default function TournamentManagement({ tournamentId }: TournamentManagementProps) {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("info");
  const { toast } = useToast();
  const { user } = useAuth();

  // Fetch tournament details
  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  // Check if user owns this tournament
  const isOwner = user?.role === 'tournament_director' && tournament && user && tournament.createdBy === user.id;

  // Redirect non-owners to tournament view
  useEffect(() => {
    if (tournament && user && !isOwner) {
      setLocation(`/tournaments/${tournamentId}`);
    }
  }, [tournament, user, isOwner, tournamentId, setLocation]);

  // Fetch players
  const { data: players = [], isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  // Start tournament mutation
  const startTournamentMutation = useMutation({
    mutationFn: async () => {
      await apiRequest(`/api/tournaments/${tournamentId}/start`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({
        title: "Tournament Started",
        description: "Round 1 pairings have been generated!",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setActiveTab("pairings");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to start tournament. Ensure you have at least 2 players.",
        variant: "destructive",
      });
    },
  });

  // Generate next round mutation
  const nextRoundMutation = useMutation({
    mutationFn: async () => {
      await apiRequest(`/api/tournaments/${tournamentId}/next-round`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({
        title: "Next Round Generated",
        description: `Round ${(tournament?.currentRound || 0) + 1} pairings are ready!`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setActiveTab("pairings");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to generate next round. Ensure all current round matches are completed.",
        variant: "destructive",
      });
    },
  });

  if (tournamentLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading tournament...</p>
        </div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="pt-6 text-center">
            <Trophy className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Tournament Not Found</h3>
            <p className="text-gray-600 mb-4">The tournament you're looking for doesn't exist.</p>
            <Button onClick={() => setLocation("/")}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canStartTournament = tournament.status === 'draft' && players.length >= 2;
  const canGenerateNextRound = tournament.status === 'active' && (tournament.currentRound || 0) > 0;

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Tournament Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{tournament.name}</h1>
            <div className="flex items-center space-x-4 mt-2">
              <Badge variant={tournament.status === 'active' ? 'default' : tournament.status === 'completed' ? 'secondary' : 'outline'}>
                {tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
              </Badge>
              <span className="text-gray-600">{tournament.format.toUpperCase()}</span>
              {tournament.rounds && (
                <span className="text-gray-600">{tournament.rounds} rounds</span>
              )}
              <span className="text-gray-600">{players.length} players</span>
            </div>
          </div>
          <div className="flex space-x-3">
            {canStartTournament && (
              <Button
                onClick={() => startTournamentMutation.mutate()}
                disabled={startTournamentMutation.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                <Play className="h-4 w-4 mr-2" />
                {startTournamentMutation.isPending ? "Starting..." : "Start Tournament"}
              </Button>
            )}
            {canGenerateNextRound && (
              <Button
                onClick={() => nextRoundMutation.mutate()}
                disabled={nextRoundMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                {nextRoundMutation.isPending ? "Generating..." : "Generate Next Round"}
              </Button>
            )}
            {tournament.status === 'active' && (
              <Button
                variant="outline"
                className="text-orange-600 border-orange-200 hover:bg-orange-50"
              >
                <Undo className="h-4 w-4 mr-2" />
                Undo Last Action
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setLocation("/dashboard")}
            >
              Back to Dashboard
            </Button>
          </div>
        </div>
      </div>

      {/* Tournament Management Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="info" className="flex items-center space-x-2">
            <Trophy className="h-4 w-4" />
            <span>Tournament Info</span>
          </TabsTrigger>
          <TabsTrigger value="players" className="flex items-center space-x-2">
            <Users className="h-4 w-4" />
            <span>Players ({players.length})</span>
          </TabsTrigger>
          <TabsTrigger value="pairings" className="flex items-center space-x-2">
            <Calendar className="h-4 w-4" />
            <span>Pairings</span>
          </TabsTrigger>
          <TabsTrigger value="standings" className="flex items-center space-x-2">
            <Trophy className="h-4 w-4" />
            <span>Standings</span>
          </TabsTrigger>
          {tournament.format === 'knockout' && (
            <TabsTrigger value="bracket" className="flex items-center space-x-2">
              <Trophy className="h-4 w-4" />
              <span>Bracket</span>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="info" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Trophy className="h-5 w-5" />
                <span>Tournament Information</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <h4 className="font-medium text-gray-900">Tournament Name</h4>
                  <p className="text-gray-600">{tournament.name}</p>
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium text-gray-900">Format</h4>
                  <p className="text-gray-600 capitalize">{tournament.format}</p>
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium text-gray-900">Status</h4>
                  <Badge variant={tournament.status === 'active' ? 'default' : tournament.status === 'completed' ? 'secondary' : 'outline'}>
                    {tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
                  </Badge>
                </div>
                {tournament.rounds && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-gray-900">Total Rounds</h4>
                    <p className="text-gray-600">{tournament.rounds}</p>
                  </div>
                )}
                <div className="space-y-2">
                  <h4 className="font-medium text-gray-900">Current Round</h4>
                  <p className="text-gray-600">{tournament.currentRound || 0}</p>
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium text-gray-900">Players</h4>
                  <p className="text-gray-600">{players.length} registered</p>
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium text-gray-900">Created</h4>
                  <p className="text-gray-600">
                    {tournament.createdAt ? new Date(tournament.createdAt).toLocaleDateString() : 'Unknown'}
                  </p>
                </div>
                {tournament.format === 'roundrobin' && tournament.isDoubleRoundRobin && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-gray-900">Round Robin Type</h4>
                    <p className="text-gray-600">Double Round Robin</p>
                  </div>
                )}
                
                {/* Tournament Details */}
                {(tournament.location || tournament.directorPhone || tournament.directorEmail) && (
                  <>
                    <div className="col-span-full">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-2">
                        Tournament Details
                      </h3>
                    </div>
                    
                    {tournament.location && (
                      <div className="space-y-2">
                        <h4 className="font-medium text-gray-900">Location</h4>
                        <p className="text-gray-600">{tournament.location}</p>
                      </div>
                    )}
                    
                    {tournament.directorPhone && (
                      <div className="space-y-2">
                        <h4 className="font-medium text-gray-900">Director Phone</h4>
                        <p className="text-gray-600">{tournament.directorPhone}</p>
                      </div>
                    )}
                    
                    {tournament.directorEmail && (
                      <div className="space-y-2">
                        <h4 className="font-medium text-gray-900">Director Email</h4>
                        <p className="text-gray-600">{tournament.directorEmail}</p>
                      </div>
                    )}
                  </>
                )}
                
                {/* Round Schedule */}
                {tournament.roundTimings && (tournament.roundTimings as any).length > 0 && (
                  <>
                    <div className="col-span-full">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-2">
                        Round Schedule
                      </h3>
                    </div>
                    
                    <div className="col-span-full">
                      <div className="space-y-2">
                        {(tournament.roundTimings as any).map((timing: any, index: number) => {
                          const hasSchedule = timing.date || timing.time;
                          if (!hasSchedule) return null;
                          
                          return (
                            <div key={index} className="flex items-center justify-between py-2 border-b border-gray-100">
                              <span className="font-medium">Round {timing.round}</span>
                              <div className="text-gray-600">
                                {timing.date && (
                                  <span className="mr-3">
                                    {new Date(timing.date).toLocaleDateString()}
                                  </span>
                                )}
                                {timing.time && (
                                  <span>
                                    {timing.time}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
              
              {tournament.status === 'draft' && (
                <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="font-medium text-blue-900 mb-2">Getting Started</h4>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800">
                    <li>Add players in the Players tab</li>
                    <li>Review player information and bye requests</li>
                    <li>Click "Start Tournament" to begin round 1</li>
                  </ol>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="players" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Users className="h-5 w-5" />
                <span>Player Management</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PlayerRegistration tournamentId={tournamentId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pairings" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Calendar className="h-5 w-5" />
                <span>Tournament Pairings</span>
                {(tournament.currentRound || 0) > 0 && (
                  <Badge>Round {tournament.currentRound || 0}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tournament.format === 'swiss' || tournament.format === 'roundrobin' ? (
                <SwissPairings tournamentId={tournamentId} />
              ) : (
                <div className="text-center py-8">
                  <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">Pairings will be available once the tournament starts.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="standings" className="mt-6">
          {tournament.format === 'roundrobin' ? (
            <RoundRobinCrosstable tournamentId={tournamentId} />
          ) : tournament.format === 'swiss' ? (
            <SwissStandings tournamentId={tournamentId} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Trophy className="h-5 w-5" />
                  <span>Tournament Standings</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Standings tournamentId={tournamentId} />
              </CardContent>
            </Card>
          )}
        </TabsContent>



        {tournament.format === 'knockout' && (
          <TabsContent value="bracket" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Trophy className="h-5 w-5" />
                  <span>Tournament Bracket</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <KnockoutBracket tournamentId={tournamentId} />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}