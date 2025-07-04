import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trophy, ArrowLeft, Shuffle, RotateCcw, Target, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import TournamentWizard from "@/components/tournament-wizard";
import PlayerRegistration from "@/components/player-registration";
import SwissPairings from "@/components/swiss-pairings";
import KnockoutBracket from "@/components/knockout-bracket";
import Standings from "@/components/standings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Tournament } from "@shared/schema";

export default function TournamentCreation() {
  const [, setLocation] = useLocation();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [activeTab, setActiveTab] = useState("setup");
  const { user, isLoading } = useAuth();

  // Redirect non-tournament directors to player dashboard
  useEffect(() => {
    if (!isLoading && user && user.role !== 'tournament_director') {
      setLocation('/player-dashboard');
    }
  }, [user, isLoading, setLocation]);

  const handleTournamentCreated = (newTournament: Tournament) => {
    // Redirect to the dedicated tournament view page
    setLocation(`/tournaments/${newTournament.id}`);
  };

  const handleStartTournament = () => {
    if (tournament) {
      setActiveTab("pairings");
    }
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show access denied for non-tournament directors
  if (user && user.role !== 'tournament_director') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center text-red-600">
              <AlertCircle className="h-5 w-5 mr-2" />
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-600">
              Only tournament directors can create tournaments. You're currently logged in as a player.
            </p>
            <div className="flex flex-col space-y-2">
              <Button onClick={() => setLocation('/player-dashboard')} className="w-full">
                Go to Player Dashboard
              </Button>
              <Button variant="outline" onClick={() => setLocation('/auth/logout')} className="w-full">
                Log Out & Switch Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Trophy className="h-8 w-8 text-primary mr-3" />
              <h1 className="text-xl font-bold text-gray-900">ChessTournament Pro</h1>
            </div>
            <Link href="/">
              <Button variant="ghost" className="text-gray-600 hover:text-gray-900">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!tournament ? (
          <TournamentWizard onTournamentCreated={handleTournamentCreated} />
        ) : (
          <div className="space-y-8">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">{tournament.name}</h2>
                  <p className="text-gray-600 mt-1">
                    {tournament.format.charAt(0).toUpperCase() + tournament.format.slice(1)} Tournament
                    {tournament.rounds && ` - ${tournament.rounds} rounds`}
                  </p>
                </div>
                <div className="flex space-x-3">
                  <Button 
                    onClick={handleStartTournament}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Target className="h-4 w-4 mr-2" />
                    Start Tournament
                  </Button>
                  <Button variant="outline">
                    Save Draft
                  </Button>
                </div>
              </div>
            </div>

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
                  onTournamentCreated={handleTournamentCreated} 
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
        )}
      </main>
    </div>
  );
}
