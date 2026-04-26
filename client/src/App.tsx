import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import AuthForm from "@/components/auth-form";
import TournamentDirectorDashboard from "@/pages/tournament-director-dashboard";
import PlayerDashboard from "@/pages/player-dashboard";
import TournamentCreation from "@/pages/tournament-creation";

import TournamentManagement from "@/pages/tournament-management";
import TournamentView from "@/pages/tournament-view";
import NotFound from "@/pages/not-found";
import SettingsPage from "@/pages/settings";
import AddPlayerPage from "@/pages/add-player";
import TournamentSettingsPage from "@/pages/tournament-settings";
import TournamentActionsPage from "@/pages/tournament-actions";
import TournamentRegistrationFormPage from "@/pages/tournament-registration-form";
import TournamentPaymentSetupPage from "@/pages/tournament-payment-setup";
import TournamentReportsPage from "@/pages/tournament-reports";

import LandingPage from "@/pages/landing-page";

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();

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
    return (
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/login" component={AuthForm} />
        <Route path="/register" component={AuthForm} />
        <Route>
          <AuthForm />
        </Route>
      </Switch>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Role-based Routing */}
      <Switch>
        <Route path="/login">
          <Redirect to="/" />
        </Route>
        <Route path="/register">
          <Redirect to="/" />
        </Route>
        <Route path="/settings" component={SettingsPage} />
        {(user as any)?.role === 'tournament_director' ? (
          <>
            <Route path="/" component={TournamentDirectorDashboard} />
            <Route path="/dashboard" component={TournamentDirectorDashboard} />
            <Route path="/dashboard/:tab" component={TournamentDirectorDashboard} />
            <Route path="/tournaments/new" component={TournamentCreation} />
            <Route path="/tournaments/:id/manage">
              {(params) => <TournamentManagement tournamentId={parseInt(params.id)} />}
            </Route>
            <Route path="/tournaments/:id/settings">
              {(params) => <TournamentActionsPage tournamentId={parseInt(params.id)} />}
            </Route>
            <Route path="/tournaments/:id/reports/uscf">
              {(params) => <TournamentReportsPage tournamentId={parseInt(params.id)} type="uscf" />}
            </Route>
            <Route path="/tournaments/:id/reports/fide">
              {(params) => <TournamentReportsPage tournamentId={parseInt(params.id)} type="fide" />}
            </Route>
            <Route path="/tournaments/:id/players/new">
              {(params) => <AddPlayerPage tournamentId={parseInt(params.id)} />}
            </Route>
            <Route path="/tournaments/:id/players/:playerId">
              {(params) => (
                <AddPlayerPage
                  tournamentId={parseInt(params.id)}
                  playerId={parseInt(params.playerId)}
                />
              )}
            </Route>
            <Route path="/tournaments/:id/register">
              {(params) => <TournamentRegistrationFormPage tournamentId={parseInt(params.id)} />}
            </Route>
            <Route path="/tournaments/:id/payments/setup">
              {(params) => <TournamentPaymentSetupPage tournamentId={parseInt(params.id)} />}
            </Route>
            <Route path="/tournaments/:id/:tab">
              {(params) => <TournamentView tournamentId={parseInt(params.id)} />}
            </Route>
            <Route path="/tournaments/:id">
              {(params) => <TournamentView tournamentId={parseInt(params.id)} />}
            </Route>
          </>
        ) : (
          <>
            <Route path="/" component={PlayerDashboard} />
            <Route path="/dashboard" component={PlayerDashboard} />
            <Route path="/dashboard/:tab" component={PlayerDashboard} />
            <Route path="/tournaments/:id/register">
              {(params) => <TournamentRegistrationFormPage tournamentId={parseInt(params.id)} />}
            </Route>
            <Route path="/tournaments/:id/:tab">
              {(params) => <TournamentView tournamentId={parseInt(params.id)} />}
            </Route>
            <Route path="/tournaments/:id">
              {(params) => <TournamentView tournamentId={parseInt(params.id)} />}
            </Route>
          </>
        )}
        <Route component={NotFound} />
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
