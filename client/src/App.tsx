import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import TournamentCreation from "@/pages/tournament-creation";
import TournamentView from "@/pages/tournament-view";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/tournaments" component={Dashboard} />
      <Route path="/players" component={Dashboard} />
      <Route path="/settings" component={Dashboard} />
      <Route path="/tournaments/new" component={TournamentCreation} />
      <Route path="/tournaments/:id" component={TournamentView} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
