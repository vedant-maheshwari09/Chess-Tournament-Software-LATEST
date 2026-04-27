import React, { useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trophy, ArrowLeft, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import TournamentBuilder from "@/components/tournament-builder";
import type { Tournament } from "@shared/schema";


export default function TournamentCreation() {
  const [, setLocation] = useLocation();
  const { user, logout, isLoading } = useAuth();

  // Redirect non-tournament directors to player dashboard
  React.useEffect(() => {
    if (!isLoading && user && user.role !== 'tournament_director') {
      setLocation('/player-dashboard');
    }
  }, [user, isLoading, setLocation]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
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
      <div className="min-h-screen bg-transparent flex items-center justify-center">
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
              <Button variant="outline" onClick={() => logout()} className="w-full">
                Log Out & Switch Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Trophy className="h-8 w-8 text-primary mr-3" />
              <h1 className="text-xl font-bold text-gray-900">ChessSoftware</h1>
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        <TournamentBuilder
          mode="create"
          format="swiss"
          onCancel={() => setLocation("/dashboard")}
          onComplete={(newTournament: Tournament) => {
            setLocation(`/tournaments/${newTournament.id}/manage`);
          }}
        />
      </main>
    </div>
  );
}
