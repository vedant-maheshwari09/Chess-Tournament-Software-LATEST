import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trophy, ArrowLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TournamentWizard from "@/components/tournament-wizard";
import PlayerRegistration from "@/components/player-registration";
import SwissPairings from "@/components/swiss-pairings";
import KnockoutBracket from "@/components/knockout-bracket";
import Standings from "@/components/standings";
import type { Tournament } from "@shared/schema";

export default function TournamentView() {
  const [match, params] = useRoute("/tournaments/:id");
  const tournamentId = params?.id ? parseInt(params.id) : null;
  const [activeTab, setActiveTab] = useState("players");

  const { data: tournament, isLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
    enabled: !!tournamentId,
  });

  const handleTournamentUpdated = (updatedTournament: Tournament) => {
    // Tournament has been updated, could refresh data here
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
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="setup">Setup</TabsTrigger>
              <TabsTrigger value="players">Players</TabsTrigger>
              <TabsTrigger value="pairings">Pairings</TabsTrigger>
              <TabsTrigger value="standings">Standings</TabsTrigger>
            </TabsList>

            <TabsContent value="setup">
              <TournamentWizard 
                tournament={tournament}
                onTournamentCreated={handleTournamentUpdated} 
              />
            </TabsContent>

            <TabsContent value="players">
              <PlayerRegistration tournamentId={tournament.id} />
            </TabsContent>

            <TabsContent value="pairings">
              {tournament.format === 'knockout' ? (
                <KnockoutBracket tournamentId={tournament.id} />
              ) : (
                <SwissPairings tournamentId={tournament.id} />
              )}
            </TabsContent>

            <TabsContent value="standings">
              <Standings tournamentId={tournament.id} />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}