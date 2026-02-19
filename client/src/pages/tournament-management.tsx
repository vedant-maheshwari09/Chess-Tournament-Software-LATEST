import React, { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Users, Trophy, Calendar, Play, Plus, Undo, FileText, Settings as SettingsIcon, CalendarClock } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import SwissPairings from "@/components/swiss-pairings";
import Standings from "@/components/standings";
import SwissStandings from "@/components/swiss-standings";
import RoundRobinCrosstable from "@/components/round-robin-crosstable";
import KnockoutBracket from "@/components/knockout-bracket";
import TournamentBuilder from "@/components/tournament-builder";
import type { Tournament, Player, PlayerRegistration } from "@shared/schema";
import PlayerManager from "@/components/player-manager";
import RegistrationManagement from "@/components/registration-management";
import TournamentPagePanel from "@/components/tournament-page-panel";
import { parseTournamentConfig } from "@/lib/tournament-config";

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
  // Fetch registrations for notification bubble
  const { data: registrations = [] } = useQuery<PlayerRegistration[]>({
    queryKey: [`/api/tournaments/${tournamentId}/registrations`],
    enabled: !!isOwner, // Only fetch for the owner
  });

  const pendingRegistrationCount = useMemo(() => {
    return registrations.filter(r => r.status === 'pending').length;
  }, [registrations]);

  const { data: players = [] } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const [activeRoundSection, setActiveRoundSection] = useState("all");
  const tournamentConfig = useMemo(() => tournament ? parseTournamentConfig(tournament) : null, [tournament]);
  const sections = useMemo(() => tournamentConfig?.sections ?? [], [tournamentConfig]);


  const selectTab = (value: string) => {
    setActiveTab(value);
  };

  const [upcomingDialogOpen, setUpcomingDialogOpen] = useState(false);
  const [upcomingMode, setUpcomingMode] = useState<"manual" | "auto">("manual");

  // Start tournament mutation
  const startTournamentMutation = useMutation({
    mutationFn: async (options?: { force?: boolean }) => {
      const body = options?.force ? JSON.stringify({ force: true }) : undefined;
      await apiRequest(`/api/tournaments/${tournamentId}/start`, {
        method: "POST",
        body,
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
    onError: (error: unknown) => {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to start tournament. Please try again.",
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

  const setUpcomingMutation = useMutation({
    mutationFn: async (mode: "manual" | "auto") => {
      await apiRequest(`/api/tournaments/${tournamentId}/upcoming`, {
        method: "POST",
        body: JSON.stringify({ autoStartMode: mode }),
      });
    },
    onSuccess: (_data, mode) => {
      toast({
        title: "Tournament Updated",
        description:
          mode === "auto"
            ? "Tournament marked as upcoming. It will go live automatically on the start date."
            : "Tournament marked as upcoming. Start it manually when you're ready.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Unable to mark tournament as upcoming. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setUpcomingDialogOpen(false);
      setUpcomingMode("manual");
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

  const isStartStatus = tournament && ["draft", "upcoming"].includes(tournament.status);

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
            <div className="flex flex-wrap items-center justify-end gap-3">
              {tournament.status === 'active' && (
                <Button
                  variant="outline"
                  className="text-orange-600 border-orange-200 hover:bg-orange-50"
                >
                  <Undo className="h-4 w-4 mr-2" />
                  Undo Last Action
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
              {isStartStatus && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      disabled={startTournamentMutation.isPending}
                      className="bg-green-600 hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {startTournamentMutation.isPending ? "Starting..." : "Start Tournament"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Start this tournament?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {players.length === 0
                          ? "This tournament currently has no registered players. You can still start it now."
                          : `This tournament has ${players.length} player${players.length === 1 ? "" : "s"}. Are you sure you want to start round 1?`}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => startTournamentMutation.mutate({ force: players.length < 2 })}>
                        Confirm Start
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {isOwner && tournament.status === "draft" && (
                <AlertDialog
                  open={upcomingDialogOpen}
                  onOpenChange={(open) => {
                    setUpcomingDialogOpen(open);
                    if (!open) {
                      setUpcomingMode("manual");
                    }
                  }}
                >
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      onClick={() => setUpcomingDialogOpen(true)}
                      disabled={setUpcomingMutation.isPending || startTournamentMutation.isPending}
                      className="flex items-center"
                    >
                      <CalendarClock className="h-4 w-4 mr-2" />
                      {setUpcomingMutation.isPending ? "Setting..." : "Set Upcoming Tournament"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Mark as upcoming?</AlertDialogTitle>
                    </AlertDialogHeader>
                    <div className="space-y-4 py-2">
                      <RadioGroup
                        value={upcomingMode}
                        onValueChange={(value) => setUpcomingMode(value as "manual" | "auto")}
                        className="grid gap-3"
                      >
                        <div className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition hover:border-indigo-300">
                          <RadioGroupItem id="upcoming-manual" value="manual" className="mt-1" />
                          <div>
                            <Label htmlFor="upcoming-manual" className="font-medium">
                              Start Tournament Manually
                            </Label>
                            <p className="text-sm text-slate-500">You will move it live yourself when you're ready.</p>
                          </div>
                        </div>
                        <div className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition hover:border-indigo-300">
                          <RadioGroupItem id="upcoming-auto" value="auto" className="mt-1" />
                          <div>
                            <Label htmlFor="upcoming-auto" className="font-medium">
                              Auto Set Tournament Live
                            </Label>
                            <p className="text-sm text-slate-500">We will automatically start it on the scheduled start date.</p>
                          </div>
                        </div>
                      </RadioGroup>
                      <p className="text-sm text-slate-600">Are you sure you want to mark this tournament as upcoming?</p>
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => setUpcomingMutation.mutate(upcomingMode)}
                        disabled={setUpcomingMutation.isPending}
                      >
                        Confirm
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {isOwner && (
                <Button
                  variant="outline"
                  onClick={() => setLocation(`/tournaments/${tournamentId}/actions`)}
                >
                  <SettingsIcon className="h-4 w-4 mr-2" />
                  Settings
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
            <Trophy className="h-5 w-5 -translate-y-[4px]" />
            <span className="capitalize -translate-y-[2px]">Dashboard</span>
          </TabsTrigger>
          <TabsTrigger
            value="tournamentPage"
            className="flex h-full w-full items-center justify-center gap-2 px-6 py-4 text-center text-sm font-medium text-slate-600 transition data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900 data-[state=active]:shadow-none"
          >
            <FileText className="h-5 w-5 -translate-y-[4px]" />
            <span className="capitalize -translate-y-[2px]">Tournament Page</span>
          </TabsTrigger>
          <TabsTrigger
            value="players"
            className="flex h-full w-full items-center justify-center gap-2 px-6 py-4 text-center text-sm font-medium text-slate-600 transition data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900 data-[state=active]:shadow-none"
          >
            <Users className="h-5 w-5 -translate-y-[4px]" />
            <span className="capitalize -translate-y-[2px]">Players</span>
          </TabsTrigger>
          <TabsTrigger
            value="registrations"
            className="flex h-full w-full items-center justify-center gap-2 px-6 py-4 text-center text-sm font-medium text-slate-600 transition data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900 data-[state=active]:shadow-none"
          >
            <Users className="h-5 w-5 -translate-y-[4px]" />
            <span className="capitalize -translate-y-[2px]">Registrations</span>
            {pendingRegistrationCount > 0 && (
              <Badge className="ml-2">{pendingRegistrationCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="rounds"
            className="flex h-full w-full items-center justify-center gap-2 px-6 py-4 text-center text-sm font-medium text-slate-600 transition data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900 data-[state=active]:shadow-none"
          >
            <Calendar className="h-5 w-5 -translate-y-[4px]" />
            <span className="capitalize -translate-y-[2px]">Rounds</span>
          </TabsTrigger>
          <TabsTrigger
            value="standings"
            className="flex h-full w-full items-center justify-center gap-2 px-6 py-4 text-center text-sm font-medium text-slate-600 transition data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900 data-[state=active]:shadow-none"
          >
            <Trophy className="h-5 w-5 -translate-y-[4px]" />
            <span className="capitalize -translate-y-[2px]">Standings</span>
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

        <TabsContent value="registrations" className="mt-6">
          <RegistrationManagement tournamentId={tournamentId} />
        </TabsContent>


        <TabsContent value="rounds" className="mt-6 space-y-6">
          <Tabs value={activeRoundSection} onValueChange={setActiveRoundSection}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              {sections.map(section => (
                <TabsTrigger key={section.id} value={section.id}>
                  {section.name}
                </TabsTrigger>
              ))}
            </TabsList>
            <Card className="mt-4">
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
                    <SwissPairings tournamentId={tournamentId} activeSection={activeRoundSection} />
                  </div>
                ) : (
                  <div className="py-8 text-center">
                    <Calendar className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                    <p className="text-gray-600">Pairings will be available once the tournament starts.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </Tabs>

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

      </Tabs>
    </div>
    </div>
  );
}