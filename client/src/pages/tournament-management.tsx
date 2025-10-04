import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Users, Trophy, Calendar, Play, Plus, Undo, UserCircle2, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import RegistrationManagement from "@/components/registration-management";
import SwissPairings from "@/components/swiss-pairings";
import Standings from "@/components/standings";
import SwissStandings from "@/components/swiss-standings";
import RoundRobinCrosstable from "@/components/round-robin-crosstable";
import KnockoutBracket from "@/components/knockout-bracket";
import TournamentBuilder from "@/components/tournament-builder";
import type { Tournament, Player } from "@shared/schema";
import PlayerManager from "@/components/player-manager";
import TournamentContactManager from "@/components/tournament-contact-manager";
import TournamentPagePanel from "@/components/tournament-page-panel";

interface TournamentManagementProps {
  tournamentId: number;
}

export default function TournamentManagement({ tournamentId }: TournamentManagementProps) {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("dashboard");
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

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
  const { data: players = [] } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });



  const selectTab = (value: string) => {
    setActiveTab(value);
  };

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
      selectTab("rounds");
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
      selectTab("rounds");
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
    console.log("Rendering loading state");
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

  const canStartTournament = tournament?.status === 'draft' && players.length >= 2;

  const canGenerateNextRound = tournament?.status === 'active' && (tournament?.currentRound || 0) > 0;

  const handleTabChange = (value: string) => {
    selectTab(value);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Tournament Header */}
      <Card className="overflow-hidden shadow-sm">
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{tournament?.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-600">
                <Badge variant={tournament?.status === 'active' ? 'default' : tournament?.status === 'completed' ? 'secondary' : 'outline'}>
                  {tournament?.status.charAt(0).toUpperCase() + tournament?.status.slice(1)}
                </Badge>
                <span>{tournament?.format.toUpperCase()}</span>
                {tournament?.rounds && <span>{tournament.rounds} rounds</span>}
                <span>{players.length} players</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
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
        </CardContent>
      </Card>

      {/* Tournament Management Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full grid-cols-6 items-stretch gap-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-0">
          <TabsTrigger
            value="dashboard"
            className="flex h-full w-full items-center justify-center gap-2 px-6 py-4 text-center text-sm font-medium text-slate-600 transition data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900 data-[state=active]:shadow-none"
          >
            <Trophy className="h-5 w-5 -translate-y-[2px]" />
            <span className="capitalize -translate-y-[4px]">Dashboard</span>
          </TabsTrigger>
          <TabsTrigger
            value="tournamentPage"
            className="flex h-full w-full items-center justify-center gap-2 px-6 py-4 text-center text-sm font-medium text-slate-600 transition data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900 data-[state=active]:shadow-none"
          >
            <FileText className="h-5 w-5 -translate-y-[2px]" />
            <span className="capitalize -translate-y-[4px]">Tournament Page</span>
          </TabsTrigger>
          <TabsTrigger
            value="players"
            className="flex h-full w-full items-center justify-center gap-2 px-6 py-4 text-center text-sm font-medium text-slate-600 transition data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900 data-[state=active]:shadow-none"
          >
            <Users className="h-5 w-5 -translate-y-[2px]" />
            <span className="capitalize -translate-y-[4px]">Players</span>
          </TabsTrigger>
          <TabsTrigger
            value="rounds"
            className="flex h-full w-full items-center justify-center gap-2 px-6 py-4 text-center text-sm font-medium text-slate-600 transition data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900 data-[state=active]:shadow-none"
          >
            <Calendar className="h-5 w-5 -translate-y-[2px]" />
            <span className="capitalize -translate-y-[4px]">Rounds</span>
          </TabsTrigger>
          <TabsTrigger
            value="standings"
            className="flex h-full w-full items-center justify-center gap-2 px-6 py-4 text-center text-sm font-medium text-slate-600 transition data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900 data-[state=active]:shadow-none"
          >
            <Trophy className="h-5 w-5 -translate-y-[2px]" />
            <span className="capitalize -translate-y-[4px]">Standings</span>
          </TabsTrigger>
          <TabsTrigger
            value="contact"
            className="flex h-full w-full items-center justify-center gap-2 px-6 py-4 text-center text-sm font-medium text-slate-600 transition data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900 data-[state=active]:shadow-none"
          >
            <UserCircle2 className="h-5 w-5 -translate-y-[2px]" />
            <span className="capitalize -translate-y-[4px]">Contact</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-6 space-y-8">
          <TournamentBuilder
            mode="edit"
            format={tournament.format}
            tournament={tournament}
            onComplete={() => {
              queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
            }}
          />
        </TabsContent>

        <TabsContent value="tournamentPage" className="mt-6">
          <TournamentPagePanel
            tournament={tournament}
            onUpdated={() => {
              queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
            }}
          />
        </TabsContent>

        <TabsContent value="players" className="mt-6">
          <PlayerManager tournament={tournament} tournamentId={tournamentId} />
        </TabsContent>


        <TabsContent value="rounds" className="mt-6 space-y-6">
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
            <CardContent className="space-y-4">
              {tournament.format === 'swiss' || tournament.format === 'roundrobin' ? (
                <div className="overflow-x-auto">
                  <SwissPairings tournamentId={tournamentId} />
                </div>
              ) : (
                <div className="py-8 text-center">
                  <Calendar className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                  <p className="text-gray-600">Pairings will be available once the tournament starts.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {tournament.format === 'knockout' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Trophy className="h-5 w-5" />
                  <span>Bracket</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <KnockoutBracket tournamentId={tournamentId} />
              </CardContent>
            </Card>
          )}
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
                <div className="overflow-x-auto">
                  <Standings tournamentId={tournamentId} />
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="contact" className="mt-6 space-y-8">
          <TournamentContactManager
            tournament={tournament}
            onUpdated={() => {
              queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
            }}
          />
          <RegistrationManagement tournamentId={tournamentId} />
        </TabsContent>
      </Tabs>
    </div>
    </div>
  );
}