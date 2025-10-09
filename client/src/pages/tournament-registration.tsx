import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { parseTournamentConfig } from "@/lib/tournament-config";
import type { Tournament, Player, PlayerRegistration as PlayerRegistrationType } from "@shared/schema";

interface TournamentRegistrationPageProps {
  tournamentId: number;
}

const formatDate = (value: string | Date | null | undefined) => {
  if (!value) return "TBD";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
};

const formatTime = (value: string | null | undefined) => {
  if (!value) return null;
  const [hour, minute] = value.split(":");
  if (hour === undefined || minute === undefined) return value;
  const date = new Date();
  date.setHours(Number(hour));
  date.setMinutes(Number(minute));
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

const statusStyles: Record<string, string> = {
  draft: "bg-amber-100 text-amber-800",
  upcoming: "bg-blue-100 text-blue-800",
  active: "bg-emerald-100 text-emerald-800",
  completed: "bg-slate-200 text-slate-700",
};

export default function TournamentRegistrationPage({ tournamentId }: TournamentRegistrationPageProps) {
  const [, setLocation] = useLocation();

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const { data: players = [] } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
    enabled: Boolean(tournament),
  });

  const { data: registrations = [] } = useQuery<PlayerRegistrationType[]>({
    queryKey: ["/api/my-registrations"],
  });

  const existingRegistration = registrations.find((entry) => entry.tournamentId === tournamentId);

  const config = useMemo(() => (tournament ? parseTournamentConfig(tournament) : null), [tournament]);
  const schedule = useMemo(() => config?.schedule ?? [], [config]);
  const contacts = useMemo(() => config?.contacts ?? [], [config]);
  const registerPolicy = config?.registers;

  if (tournamentLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
          <p className="mt-4 text-slate-600">Loading registration page...</p>
        </div>
      </div>
    );
  }

  if (!tournament || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md">
          <CardContent className="pt-8 pb-10 text-center">
            <ShieldCheck className="mx-auto mb-4 h-12 w-12 text-slate-400" />
            <h2 className="text-lg font-semibold text-slate-900">Tournament unavailable</h2>
            <p className="mt-2 text-sm text-slate-600">
              This registration page could not be loaded. Please return to the dashboard and try again.
            </p>
            <Button className="mt-6" onClick={() => setLocation("/")}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const startDateText = formatDate(config.basic.startDate ?? tournament.createdAt);
  const endDateText = formatDate(config.basic.endDate ?? config.basic.startDate);
  const statusBadge = statusStyles[tournament.status] ?? "bg-slate-200 text-slate-700";
  const playerCount = players.length;
  const playerLimit = registerPolicy?.playerLimit ?? null;

  const timeline = schedule
    .filter((event) => event.date || event.time)
    .map((event) => ({
      id: event.id,
      label: event.label,
      date: formatDate(event.date),
      time: formatTime(event.time),
    }));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
            <Button variant="ghost" className="px-0 text-slate-600" onClick={() => setLocation("/dashboard")}> 
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
            <div className="flex items-center gap-2">
              <Badge className={statusBadge}>
                {tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
              </Badge>
              {existingRegistration && (
                <Badge variant="outline" className="border-emerald-400 text-emerald-600">
                  Registered
                </Badge>
              )}
            </div>
          </div>
          <div className="grid gap-8 lg:grid-cols-[2fr,1fr] lg:items-center">
            <div className="space-y-4">
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{tournament.name}</h1>
              <p className="max-w-2xl text-base text-slate-600">
                {config.basic.description || "Join us for a competitive event featuring multiple sections, precise scheduling, and smooth tournament operations."}
              </p>
              <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-indigo-500" />
                  <span>
                    {startDateText}
                    {endDateText && endDateText !== "TBD" && ` · ${endDateText}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-indigo-500" />
                  <span>{config.basic.city || tournament.location || "Venue TBA"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-indigo-500" />
                  <span>{config.details.timeControl?.toUpperCase()} · {config.details.rounds} rounds</span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-indigo-500" />
                  <span>
                    {playerCount} registered players
                    {playerLimit ? ` / ${playerLimit} limit` : ""}
                  </span>
                </div>
              </div>
            </div>
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle>Secure your spot</CardTitle>
                <CardDescription>Complete your entry in just a few steps.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-slate-600">
                  {!existingRegistration ? (
                    <p>
                      Reserve your place in the tournament roster. You can update arrival info or withdraw later from your dashboard.
                    </p>
                  ) : (
                    <p>Your registration is on file. Need to adjust details? Submit a new form and contact the director.</p>
                  )}
                </div>
                <Button
                  onClick={() => setLocation(`/tournaments/${tournamentId}/register/form`)}
                  className="w-full"
                  size="lg"
                >
                  {existingRegistration ? "View Registration" : "Register Now"}
                </Button>
                <div className="text-xs text-slate-500">
                  Registration powered by Chess Tournament Manager. Confirmation arrives via email once the director approves your entry.
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-10 px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Event Overview</CardTitle>
              <CardDescription>Key facts about this tournament</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>Format</span>
                <span className="font-medium text-slate-900 capitalize">{tournament.format}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span>Pairing System</span>
                <span className="font-medium text-slate-900">{config.details.pairingSystem}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span>Federation</span>
                <span className="font-medium text-slate-900">{config.basic.federation || "USCF"}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span>Tiebreaks</span>
                <span className="font-medium text-slate-900">{config.details.tiebreakSystem}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Registration Policies</CardTitle>
              <CardDescription>Understand the requirements before you register</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <ul className="space-y-2">
                <li>• Online sign-ups {registerPolicy?.allowSignup ? "are open" : "are currently disabled"}.</li>
                <li>• Email confirmations sent to {registerPolicy?.notifyPairingsEmail ? "registered players" : "directors only"}.</li>
                <li>
                  • Player limit: {playerLimit ? `${playerLimit} spots available` : "no cap listed"}.
                </li>
                <li>• Bye requests allowed up to {registerPolicy?.byeLimit ?? "the maximum permitted"} rounds.</li>
                {registerPolicy?.paymentDetails && <li>• Payment details: {registerPolicy.paymentDetails}</li>}
                {registerPolicy?.earlyBirdDetails && <li>• Early bird info: {registerPolicy.earlyBirdDetails}</li>}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contact the Organizers</CardTitle>
              <CardDescription>Get assistance before the event begins</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600">
              {(tournament.directorPhone || tournament.directorEmail) ? (
                <>
                  {tournament.directorPhone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-indigo-500" />
                      <span>{tournament.directorPhone}</span>
                    </div>
                  )}
                  {tournament.directorEmail && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-indigo-500" />
                      <span>{tournament.directorEmail}</span>
                    </div>
                  )}
                </>
              ) : (
                <p>No contact information has been published yet. Please check back soon.</p>
              )}

              {contacts.length > 0 && (
                <div className="space-y-2">
                  <Separator />
                  <p className="text-xs uppercase tracking-wide text-slate-500">Event staff</p>
                  <ul className="space-y-1">
                    {contacts.map((contact) => (
                      <li key={contact.id} className="flex flex-col">
                        <span className="font-medium text-slate-900">{contact.name}</span>
                        <span className="text-xs text-slate-500">{contact.role}</span>
                        <span className="text-xs text-slate-500">
                          {[contact.phone, contact.email].filter(Boolean).join(" · ") || "Contact details forthcoming"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Important Dates & Schedule</CardTitle>
            <CardDescription>
              Review the timeline to plan travel and ensure you arrive before your first round pairings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {timeline.length === 0 ? (
              <p className="text-sm text-slate-600">Schedule details will be published soon. Check your email for updates.</p>
            ) : (
              <div className="space-y-5">
                {timeline.map((item, index) => (
                  <div key={item.id ?? index} className="grid gap-2 rounded-lg border border-slate-200 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                    <div className="text-sm font-medium text-slate-900">{item.label}</div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      {item.date}
                    </div>
                    <div className="text-xs text-slate-500">
                      {item.time ?? "Time TBA"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How to register</CardTitle>
            <CardDescription>Use the form button above to start the full registration flow.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <p>
              The registration experience has moved to a dedicated page. Follow the prompts to search your player record,
              provide contact details, and confirm your entry.
            </p>
            <p>
              Already registered players can review their status from the tournament dashboard. Contact the director if you need
              to update critical information after submission.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
