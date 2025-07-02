import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import AuthForm from "@/components/auth-form";
import TournamentDirectorDashboard from "@/pages/tournament-director-dashboard";
import PlayerDashboard from "@/pages/player-dashboard";
import TournamentCreation from "@/pages/tournament-creation";
import TournamentView from "@/pages/tournament-view";
import TournamentManagement from "@/pages/tournament-management";
import NotFound from "@/pages/not-found";

function AuthenticatedApp() {
  const { user, logout, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthForm />;
  }

  return (
    <div className="min-h-screen">
      {/* Global Navigation Bar */}
      <div className="fixed top-0 right-0 z-50 p-4">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => logout()}
          className="flex items-center gap-2 bg-white dark:bg-gray-800 shadow-lg"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>

      {/* Role-based Routing */}
      <Switch>
        {(user as any)?.role === 'tournament_director' ? (
          <>
            <Route path="/" component={TournamentDirectorDashboard} />
            <Route path="/dashboard" component={TournamentDirectorDashboard} />
            <Route path="/tournaments/new" component={TournamentCreation} />
            <Route path="/tournaments/:id/manage">
              {(params) => <TournamentManagement tournamentId={parseInt(params.id)} />}
            </Route>
            <Route path="/tournaments/:id" component={TournamentView} />
          </>
        ) : (
          <>
            <Route path="/" component={PlayerDashboard} />
            <Route path="/dashboard" component={PlayerDashboard} />
            <Route path="/tournaments/:id/view" component={TournamentView} />
          </>
        )}
      </Switch>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthenticatedApp />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
