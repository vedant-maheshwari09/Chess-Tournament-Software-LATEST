import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trophy, ArrowLeft, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import TournamentWizard from "@/components/tournament-wizard";
import PlayerRegistration from "@/components/player-registration";
import SwissPairings from "@/components/swiss-pairings";
import KnockoutBracket from "@/components/knockout-bracket";
import Standings from "@/components/standings";
import SwissStandings from "@/components/swiss-standings";
import RoundRobinCrosstable from "@/components/round-robin-crosstable";
import type { Tournament } from "@shared/schema";

export default function TournamentView() {
  const [match, params] = useRoute("/tournaments/:id");
  const tournamentId = params?.id ? parseInt(params.id) : null;
  const [activeTab, setActiveTab] = useState("pairings");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  
  const { data: tournament, isLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
    enabled: !!tournamentId,
  });

  // Get tournament creator information
  const { data: creator } = useQuery<{firstName: string, lastName: string}>({
    queryKey: [`/api/users/${tournament?.createdBy}`],
    enabled: !!tournament?.createdBy,
  });

  // Check if user is a tournament director and owns this tournament
  const isTournamentDirector = user?.role === 'tournament_director';
  const isOwner = isTournamentDirector && tournament && user && tournament.createdBy === user.id;

  const deleteTournamentMutation = useMutation({
    mutationFn: async () => {
      await apiRequest(`/api/tournaments/${tournamentId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      toast({
        title: "Tournament Deleted",
        description: "The tournament has been successfully deleted.",
      });
      // Invalidate multiple cache keys to ensure UI updates
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-tournaments"] });
      queryClient.removeQueries({ queryKey: [`/api/tournaments/${tournamentId}`] });
      setLocation("/");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete tournament. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleTournamentUpdated = (updatedTournament: Tournament) => {
    // Tournament has been updated, could refresh data here
  };

  const handleDeleteTournament = () => {
    deleteTournamentMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center">
                <Trophy className="h-8 w-8 text-primary mr-3" />
                <h1 className="text-xl font-bold text-gray-900">ChessTournament Pro</h1>
              </div>
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-pulse">
            <div className="h-32 bg-gray-200 rounded-lg mb-6"></div>
            <div className="h-96 bg-gray-200 rounded-lg"></div>
          </div>
        </main>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center">
                <Trophy className="h-8 w-8 text-primary mr-3" />
                <h1 className="text-xl font-bold text-gray-900">ChessTournament Pro</h1>
              </div>
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card className="text-center py-12">
            <CardContent>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Tournament not found</h3>
              <p className="text-gray-600 mb-6">The tournament you're looking for doesn't exist or has been deleted.</p>
              <Link href="/">
                <Button>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Dashboard
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Link href="/">
                <Button variant="ghost" size="sm" className="mr-4">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <Trophy className="h-8 w-8 text-primary mr-3" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">{tournament.name}</h1>
                <div className="flex items-center space-x-2">
                  <Badge variant={tournament.status === 'active' ? 'default' : 'secondary'}>
                    {tournament.status}
                  </Badge>
                  <span className="text-sm text-gray-600">
                    {tournament.format.charAt(0).toUpperCase() + tournament.format.slice(1)} Format
                  </span>
                </div>
                {creator && (
                  <p className="text-xs text-gray-500 mt-1">
                    {creator.firstName} {creator.lastName}'s tournament
                  </p>
                )}
              </div>
            </div>
            {isOwner && (
              <div className="flex items-center space-x-3">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Tournament
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Tournament</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete "{tournament.name}"? This action cannot be undone. 
                        All players, matches, and pairings will be permanently removed.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction 
                        onClick={handleDeleteTournament}
                        className="bg-red-600 hover:bg-red-700"
                        disabled={deleteTournamentMutation.isPending}
                      >
                        {deleteTournamentMutation.isPending ? "Deleting..." : "Delete Tournament"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            {isTournamentDirector ? (
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="setup">Setup</TabsTrigger>
                <TabsTrigger value="players">Players</TabsTrigger>
                <TabsTrigger value="pairings">Pairings</TabsTrigger>
                <TabsTrigger value="standings">Standings</TabsTrigger>
              </TabsList>
            ) : (
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="pairings">Pairings</TabsTrigger>
                <TabsTrigger value="standings">Standings</TabsTrigger>
              </TabsList>
            )}

            {isTournamentDirector && (
              <>
                <TabsContent value="setup">
                  <TournamentWizard 
                    tournament={tournament}
                    onTournamentCreated={handleTournamentUpdated} 
                  />
                </TabsContent>

                <TabsContent value="players">
                  <PlayerRegistration tournamentId={tournament.id} />
                </TabsContent>
              </>
            )}

            <TabsContent value="pairings">
              {tournament.format === 'knockout' ? (
                <KnockoutBracket tournamentId={tournament.id} />
              ) : (
                <SwissPairings tournamentId={tournament.id} />
              )}
            </TabsContent>

            <TabsContent value="standings">
              {tournament.format === 'roundrobin' ? (
                <RoundRobinCrosstable tournamentId={tournament.id} />
              ) : tournament.format === 'swiss' ? (
                <SwissStandings tournamentId={tournament.id} />
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Trophy className="h-5 w-5" />
                      <span>Tournament Standings</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Standings tournamentId={tournament.id} />
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}