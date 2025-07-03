import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Clock, Users, Eye, ArrowLeft, Medal, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import type { Tournament } from "@shared/schema";
import Standings from "@/components/standings";
import SwissPairings from "@/components/swiss-pairings";
import KnockoutBracket from "@/components/knockout-bracket";

export default function PlayerDashboard() {
  const { user } = useAuth();
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);

  const { data: tournaments = [], isLoading } = useQuery<Tournament[]>({
    queryKey: ["/api/tournaments"],
  });

  const getFormatIcon = (format: string) => {
    switch (format) {
      case 'swiss': return '🏆';
      case 'roundrobin': return '🔄';
      case 'knockout': return '⚔️';
      default: return '🎯';
    }
  };

  const getFormatName = (format: string) => {
    switch (format) {
      case 'swiss': return 'Swiss System';
      case 'roundrobin': return 'Round Robin';
      case 'knockout': return 'Knockout';
      default: return format;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'upcoming': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
      case 'completed': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading tournaments...</p>
        </div>
      </div>
    );
  }

  // If no tournament selected, show tournament list
  if (!selectedTournament) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 shadow">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Live Tournaments
                </h1>
                <p className="text-gray-600 dark:text-gray-300">
                  Welcome, {user?.username} - Find tournaments to join and spectate
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <Users className="h-4 w-4" />
                  Player Account
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => window.location.href = '/api/auth/logout'}
                >
                  Logout
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Live Tournaments</CardTitle>
                <Trophy className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tournaments.length}</div>
                <p className="text-xs text-muted-foreground">
                  Active tournaments you can view
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Events</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {tournaments.filter(t => t.status === 'active').length}
                </div>
                <p className="text-xs text-muted-foreground">
                  Currently in progress
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Upcoming</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {tournaments.filter(t => t.status === 'upcoming').length}
                </div>
                <p className="text-xs text-muted-foreground">
                  Starting soon
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Tournament List */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Available Tournaments
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Select a tournament to view live standings and pairings
              </p>
            </div>

            {tournaments.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Trophy className="h-12 w-12 text-gray-400 mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    No tournaments available
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 text-center">
                    No tournaments are currently running. Check back later for live events.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {tournaments.map((tournament) => (
                  <Card key={tournament.id} className="hover:shadow-md transition-shadow cursor-pointer">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <CardTitle className="text-lg">
                            {getFormatIcon(tournament.format)} {tournament.name}
                          </CardTitle>
                          <CardDescription>
                            {getFormatName(tournament.format)} • {tournament.rounds} rounds
                          </CardDescription>
                        </div>
                        <Badge className={getStatusColor(tournament.status)}>
                          {tournament.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          <Clock className="h-4 w-4" />
                          {tournament.status === 'active' ? 'In Progress' : 
                           tournament.status === 'upcoming' ? 'Starting Soon' : 'Completed'}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          <Users className="h-4 w-4" />
                          Tournament event
                        </div>
                        <Button 
                          className="w-full" 
                          onClick={() => setSelectedTournament(tournament)}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View Live Tournament
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Tournament Details View
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header with Back Button */}
      <div className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => setSelectedTournament(null)}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Tournaments
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {getFormatIcon(selectedTournament.format)} {selectedTournament.name}
                </h1>
                <p className="text-gray-600 dark:text-gray-300">
                  {getFormatName(selectedTournament.format)} • {selectedTournament.rounds} rounds
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Badge className={getStatusColor(selectedTournament.status)}>
                {selectedTournament.status}
              </Badge>
              <Button 
                variant="outline" 
                onClick={() => window.location.href = '/api/auth/logout'}
              >
                Logout
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Tournament Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="standings" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="standings" className="flex items-center gap-2">
              <Medal className="h-4 w-4" />
              Standings
            </TabsTrigger>
            <TabsTrigger value="pairings" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Pairings
            </TabsTrigger>
            {selectedTournament.format === 'knockout' && (
              <TabsTrigger value="bracket" className="flex items-center gap-2">
                <Trophy className="h-4 w-4" />
                Bracket
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="standings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Live Standings</CardTitle>
                <CardDescription>
                  Current tournament standings and results
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Standings tournamentId={selectedTournament.id} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pairings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Current Round Pairings</CardTitle>
                <CardDescription>
                  Live pairings and match results
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedTournament.format === 'swiss' || selectedTournament.format === 'roundrobin' ? (
                  <SwissPairings tournamentId={selectedTournament.id} />
                ) : (
                  <p className="text-gray-600 dark:text-gray-400">
                    Pairings view not available for {getFormatName(selectedTournament.format)} format
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {selectedTournament.format === 'knockout' && (
            <TabsContent value="bracket" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Tournament Bracket</CardTitle>
                  <CardDescription>
                    Knockout bracket progression
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <KnockoutBracket tournamentId={selectedTournament.id} />
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}