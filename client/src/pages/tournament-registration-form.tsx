import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useForm, FormProvider, useFormContext } from "react-hook-form";
import type { UseFormReturn } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  ChevronDown,
  Clock,
  Loader2,
  Mail,
  MapPin,
  Search,
  ShieldCheck,
  User,
} from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { parseTournamentConfig } from "@/lib/tournament-config";
import type { EntryFeeRule } from "@/lib/tournament-config";
import type { Tournament, Player, PlayerRegistration } from "@shared/schema";

const registrationSchema = z.object({
  lookupMode: z.enum(["profile", "manual"]).default("profile"),
  ratingProvider: z.enum(["uscf", "fide", "manual", "none"]).default("none"),
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  uscfId: z.string().optional(),
  fideId: z.string().optional(),
  uscfRating: z.string().optional(),
  fideRating: z.string().optional(),
  email: z.string().email("Enter a valid email"),
  phoneNumber: z.string().optional(),
  address1: z.string().optional(),
  address2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  pairingNotifications: z.enum(["email", "sms", "both", "none"]).default("email"),
  newsletter: z.boolean().default(false),
  sectionChoice: z.string().min(1, "Select a section"),
  entryFeeId: z.string().min(1, "Select an entry option"),
  processingContribution: z
    .string()
    .default("0")
    .refine((value) => {
      if (!value.trim()) return true;
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= 0 && numeric <= 500;
    }, "Enter a valid contribution between $0 and $500"),
  paymentAcknowledgement: z
    .boolean()
    .refine((value) => value, { message: "Please acknowledge the offline payment terms." }),
  byePreference: z.enum(["none", "yes"]).default("none"),
  byeRounds: z.array(z.string()).default([]),
  arrivalTime: z.string().optional(),
  prizeEmail: z.string().email().optional(),
  notes: z.string().optional(),
});

type RegistrationFormValues = z.infer<typeof registrationSchema>;

interface TournamentRegistrationFormProps {
  tournamentId: number;
}

const formatDate = (value: string | Date | null | undefined) => {
  if (!value) return "TBD";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

const statusStyles: Record<string, string> = {
  draft: "bg-amber-100 text-amber-800",
  upcoming: "bg-blue-100 text-blue-800",
  active: "bg-emerald-100 text-emerald-800",
  completed: "bg-slate-200 text-slate-700",
};

const SECTION_FALLBACKS: Record<string, string> = {
  premier: "Premier",
  championship: "Championship",
  under1800: "Under 1800",
  under1600: "Under 1600",
  under1400: "Under 1400",
  under1200: "Under 1200",
  unrated: "Unrated",
};
const NO_ENTRY_FEE_ID = "offline-entry-fee";

const COUNTRY_OPTIONS = [
  "United States",
  "Canada",
  "Mexico",
  "India",
  "United Kingdom",
  "Other",
];

export default function TournamentRegistrationFormPage({ tournamentId }: TournamentRegistrationFormProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);

  const { data: tournament, isLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const { data: players = [] } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
    enabled: Boolean(tournament),
  });

  const { data: registrations = [] } = useQuery<PlayerRegistration[]>({
    queryKey: ["/api/my-registrations"],
  });

  const existingRegistration = registrations.find((entry) => entry.tournamentId === tournamentId);
  const config = useMemo(
    () => (tournament ? parseTournamentConfig(tournament) : null),
    [tournament],
  );

  const entryFees = useMemo(() => config?.entryFees ?? [], [config]);
  const sections = useMemo(() => {
    if (entryFees.length > 0) {
      return Array.from(
        new Set(
          entryFees
            .map((fee) => fee.section)
            .filter((section): section is string => Boolean(section && section.trim())),
        ),
      );
    }
    const registerSections = config?.registers?.playerLimit ? ["Premier", "Championship"] : undefined;
    if (registerSections?.length) return registerSections;
    return Object.values(SECTION_FALLBACKS);
  }, [config?.registers?.playerLimit, entryFees]);

  const form = useForm<RegistrationFormValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      lookupMode: "profile",
      ratingProvider: "none",
      firstName: "",
      lastName: "",
      uscfId: "",
      fideId: "",
      uscfRating: "",
      fideRating: "",
      email: "",
      phoneNumber: "",
      address1: "",
      address2: "",
      city: "",
      state: "",
      postalCode: "",
      country: "United States",
      pairingNotifications: "email",
      newsletter: true,
      sectionChoice: "",
      entryFeeId: "",
      processingContribution: "0",
      paymentAcknowledgement: false,
      byePreference: "none",
      byeRounds: [],
      arrivalTime: "",
      prizeEmail: "",
      notes: "",
    },
  });
  const paymentAcknowledged = form.watch("paymentAcknowledgement");

  const registerMutation = useMutation({
    mutationFn: async (values: RegistrationFormValues) => {
      const payload = {
        playerName: `${values.firstName} ${values.lastName}`.trim(),
        uscfRating: values.uscfRating ? Number(values.uscfRating) : undefined,
        phoneNumber: values.phoneNumber,
        email: values.email,
        arrivalTime: buildArrivalNotes(values, entryFees),
      };

      return apiRequest(`/api/tournaments/${tournamentId}/register`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      toast({
        title: "Registration submitted",
        description: "Your registration request has been sent to the tournament director.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/my-registrations"] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setCurrentStep(3);
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
          <p className="mt-4 text-slate-600">Loading registration form...</p>
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
              This registration form could not be loaded. Please return to the tournament page and try again.
            </p>
            <Button className="mt-6" onClick={() => setLocation(`/tournaments/${tournamentId}`)}>
              Back to Tournament
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (existingRegistration) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="border-b bg-white">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <Button
                variant="ghost"
                className="px-0 text-slate-600"
                onClick={() => setLocation(`/tournaments/${tournamentId}`)}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Badge className={statusStyles[tournament.status] ?? "bg-slate-200 text-slate-700"}>
                {tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
              </Badge>
            </div>
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold text-slate-900">{tournament.name}</h1>
              <p className="text-slate-600">You have already submitted a registration for this event.</p>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Registration Status</CardTitle>
              <CardDescription>
                Your entry is currently marked as {existingRegistration.status}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                {existingRegistration.playerName && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500">Player Name</p>
                    <p className="font-medium text-slate-900">{existingRegistration.playerName}</p>
                  </div>
                )}
                {existingRegistration.uscfRating && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500">USCF Rating</p>
                    <p className="font-medium text-slate-900">{existingRegistration.uscfRating}</p>
                  </div>
                )}
                {existingRegistration.email && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500">Email</p>
                    <p className="font-medium text-slate-900">{existingRegistration.email}</p>
                  </div>
                )}
                {existingRegistration.phoneNumber && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500">Phone</p>
                    <p className="font-medium text-slate-900">{existingRegistration.phoneNumber}</p>
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-600">
                We&apos;ll email you once the tournament director processes your registration.
              </div>
              <Button onClick={() => setLocation(`/tournaments/${tournamentId}`)}>Return to tournament page</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const startDateText = formatDate(config.basic.startDate ?? tournament.createdAt);
  const endDateText = formatDate(config.basic.endDate ?? config.basic.startDate);
  const playerCount = players.length;
  const playerLimit = config.registers?.playerLimit ?? null;
  const totalSteps = 3;
  const progressPercentage = ((currentStep - 1) / (totalSteps - 1)) * 100;
  const stepMeta = [
    { title: "Player lookup", description: "Find your rating profile." },
    { title: "Player details", description: "Complete contact & entry info." },
    { title: "Review & submit", description: "Acknowledge payment and finish." },
  ] as const;

  const handleNextStep = async () => {
    let fields: (keyof RegistrationFormValues)[] = [];
    if (currentStep === 1) {
      fields = ["firstName", "lastName", "email", "sectionChoice"];
    } else if (currentStep === 2 && entryFees.length > 0) {
      fields = ["entryFeeId"];
    }
    const valid = await form.trigger(fields.length ? fields : undefined);
    if (!valid) return;
    setCurrentStep((prev) => Math.min(prev + 1, 3));
  };

  const handlePrevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const onSubmit = (values: RegistrationFormValues) => {
    registerMutation.mutate(values);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-white">
      <div className="border-b border-slate-200/60 bg-gradient-to-r from-white via-indigo-50/60 to-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
            <Button variant="ghost" className="px-0 text-slate-600" onClick={() => setLocation(`/tournaments/${tournamentId}`)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Tournament
            </Button>
            <div className="flex items-center gap-2">
              <Badge className={statusStyles[tournament.status] ?? "bg-slate-200 text-slate-700"}>
                {tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
              </Badge>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[2fr,1fr] lg:items-center">
            <div className="space-y-4">
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{tournament.name}</h1>
              <p className="max-w-2xl text-base text-slate-600">
                Complete the steps below to secure your spot. You can review the event details, fill out player information,
                and confirm your entry.
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
                  <User className="h-4 w-4 text-indigo-500" />
                  <span>
                    {playerCount} registered players
                    {playerLimit ? ` / ${playerLimit} limit` : ""}
                  </span>
                </div>
              </div>
            </div>

            <Card className="overflow-hidden border-0 bg-white/80 shadow-xl backdrop-blur">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold">Registration progress</CardTitle>
                <CardDescription>Follow the steps below to complete your entry.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="relative h-2 rounded-full bg-slate-200">
                  <div
                    className="absolute left-0 top-0 h-2 rounded-full bg-gradient-to-r from-indigo-500 via-indigo-500 to-emerald-500 transition-all duration-300"
                    style={{ width: `${Math.max(0, Math.min(100, progressPercentage))}%` }}
                  />
                  {[1, 2, 3].map((step) => {
                    const position = ((step - 1) / (totalSteps - 1)) * 100;
                    const stateClass =
                      currentStep === step
                        ? "bg-indigo-500"
                        : currentStep > step
                        ? "bg-emerald-500"
                        : "bg-slate-300";
                    return (
                      <div
                        key={step}
                        className={cn(
                          "absolute top-1/2 h-4 w-4 -translate-y-1/2 transform rounded-full border-2 border-white shadow-sm transition-colors",
                          stateClass,
                        )}
                        style={{ left: `${position}%`, transform: "translate(-50%, -50%)" }}
                      />
                    );
                  })}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs font-medium text-slate-600">
                  {stepMeta.map((meta, index) => {
                    const step = index + 1;
                    const colorClass =
                      currentStep === step
                        ? "text-indigo-600"
                        : currentStep > step
                        ? "text-emerald-600"
                        : "text-slate-500";
                    return (
                      <div key={meta.title} className={cn("space-y-1", colorClass)}>
                        <p className="text-[11px] uppercase tracking-wide">Step {step}</p>
                        <p className="text-sm font-semibold">{meta.title}</p>
                        <p className="text-[11px] leading-4 text-slate-500">{meta.description}</p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-12 px-4 py-12 sm:px-6 lg:px-8">
        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-10">
            {currentStep === 1 && <StepOne players={players} sections={sections} />}

            {currentStep === 2 && <StepTwo config={config} entryFees={entryFees} />}

            {currentStep === 3 && (
              <StepThree entryFees={entryFees} paymentDetails={config?.registers?.paymentDetails} />
            )}

            <div className="flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-slate-500">
                Registration powered by Chess Tournament Manager. Confirmation is sent once the director approves your entry.
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={handlePrevStep} disabled={currentStep === 1}>
                  Previous
                </Button>
                {currentStep < 3 ? (
                  <Button type="button" onClick={handleNextStep}>
                    Continue
                  </Button>
                ) : (
                  <Button type="submit" disabled={registerMutation.isPending || !paymentAcknowledged}>
                    {registerMutation.isPending ? "Submitting..." : "Submit Registration"}
                  </Button>
                )}
              </div>
            </div>
          </form>
        </FormProvider>
      </div>
    </div>
  );
}

type RatingLookupSource = "uscf" | "fide";

interface RatingLookupResult {
  source: RatingLookupSource;
  id: string;
  name: string;
  rating?: string;
  ratingDisplay?: string;
  location?: string;
  extra?: string;
  extraRatings?: Array<{
    type: "quick" | "blitz" | "rapid";
    label: string;
    value?: string;
    display?: string;
  }>;
  metadata?: Record<string, string | undefined>;
  sex?: string;
  birthYear?: string;
}

interface RatingLookupResponse {
  uscf?: RatingLookupResult[];
  fide?: RatingLookupResult[];
  errors?: Partial<Record<RatingLookupSource, string>>;
}

function StepOne({ players, sections }: { players: Player[]; sections: string[] }) {
  const form = useFormContext<RegistrationFormValues>();
  const lookupMode = form.watch("lookupMode");
  const [searchTerm, setSearchTerm] = useState("");
  const [remoteResults, setRemoteResults] = useState<RatingLookupResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (lookupMode !== "profile") {
      setRemoteResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    const term = searchTerm.trim();
    if (term.length < 3) {
      setRemoteResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    setSearchError(null);

    const timeoutId = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: term, limit: "10" });
        const response = (await apiRequest(`/api/rating-lookup?${params.toString()}`)) as RatingLookupResponse;
        if (cancelled) return;
        const combined = [...(response.uscf ?? []), ...(response.fide ?? [])];
        setRemoteResults(combined);
        const mergedErrors = response.errors
          ? Object.values(response.errors)
              .filter((value): value is string => Boolean(value && value.trim()))
              .join(" ")
          : "";
        setSearchError(mergedErrors && combined.length === 0 ? mergedErrors : null);
      } catch (error) {
        if (cancelled) return;
        setRemoteResults([]);
        setSearchError(error instanceof Error ? error.message : "Lookup failed");
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [lookupMode, searchTerm]);

  const rosterMatches = useMemo(() => {
    if (lookupMode !== "profile") return [] as Player[];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return [] as Player[];
    return players.filter((player) => `${player.firstName} ${player.lastName}`.toLowerCase().includes(term));
  }, [lookupMode, players, searchTerm]);

  const handleSelectRosterPlayer = (player: Player) => {
    form.setValue("lookupMode", "profile", { shouldDirty: true });
    form.setValue("firstName", player.firstName, { shouldDirty: true, shouldValidate: true });
    form.setValue("lastName", player.lastName, { shouldDirty: true, shouldValidate: true });
    if (player.rating) {
      form.setValue("uscfRating", String(player.rating), { shouldDirty: true });
      form.setValue("ratingProvider", "uscf", { shouldDirty: true });
    }
    setSearchTerm(`${player.firstName} ${player.lastName}`.trim());
  };

  const handleSelectLookupResult = (result: RatingLookupResult) => {
    const { firstName, lastName } = splitName(result.name);
    form.setValue("lookupMode", "profile", { shouldDirty: true });
    form.setValue("firstName", firstName, { shouldDirty: true, shouldValidate: true });
    form.setValue("lastName", lastName, { shouldDirty: true, shouldValidate: true });
    if (result.source === "uscf") {
      form.setValue("ratingProvider", "uscf", { shouldDirty: true });
      form.setValue("uscfId", result.id, { shouldDirty: true });
      form.setValue("uscfRating", result.ratingDisplay ?? result.rating ?? "", { shouldDirty: true });
      if (result.location) {
        form.setValue("state", result.location, { shouldDirty: false });
      }
    } else {
      form.setValue("ratingProvider", "fide", { shouldDirty: true });
      form.setValue("fideId", result.id, { shouldDirty: true });
      form.setValue("fideRating", result.ratingDisplay ?? result.rating ?? "", { shouldDirty: true });
      if (result.location) {
        form.setValue("country", result.location, { shouldDirty: false });
      }
    }
    setSearchTerm(result.name);
    setRemoteResults([]);
  };

  return (
    <Card className="border-0 bg-white/90 shadow-lg ring-1 ring-slate-100 backdrop-blur-sm">
      <CardHeader>
        <CardTitle>Step 1: Player Lookup</CardTitle>
        <CardDescription>Search national databases or enter your information manually.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <RadioGroup
          value={lookupMode}
          onValueChange={(value) =>
            form.setValue("lookupMode", value as RegistrationFormValues["lookupMode"], { shouldDirty: true })
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row">
            <RadioOption
              group="lookupMode"
              value="profile"
              title="Use saved profile"
              description="Search USCF and FIDE player lists."
            />
            <RadioOption
              group="lookupMode"
              value="manual"
              title="Manual entry"
              description="Enter all details yourself."
            />
          </div>
        </RadioGroup>

        {lookupMode === "profile" && (
          <div className="space-y-4">
            <Label className="text-sm font-medium text-slate-700">Search players</Label>
            <div className="relative">
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Type at least 3 characters to search USCF and FIDE"
                autoComplete="off"
                className="pl-9 pr-9"
              />
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-indigo-500" />
              )}
            </div>
            {searchTerm.trim().length < 3 ? (
              <p className="text-xs text-slate-500">Enter at least three characters to search both databases.</p>
            ) : (
              <p className="text-xs text-slate-500">
                Showing the best matches from the official USCF and FIDE player directories.
              </p>
            )}
            {searchError && <p className="text-xs text-red-500">{searchError}</p>}

            {searchTerm.trim().length >= 3 && (remoteResults.length > 0 || rosterMatches.length > 0) && (
              <div className="space-y-5">
                {remoteResults.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">USCF &amp; FIDE results</p>
                    <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                      {remoteResults.map((result) => (
                        <button
                          key={`${result.source}-${result.id}`}
                          type="button"
                          onClick={() => handleSelectLookupResult(result)}
                          className="w-full rounded-lg border border-slate-200 p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-slate-900">{result.name}</p>
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                <Badge variant="outline" className="border-slate-200 text-[11px] uppercase">
                                  {result.source.toUpperCase()}
                                </Badge>
                                {result.location && <span>{result.location}</span>}
                                {result.extra && <span>{result.extra}</span>}
                              </div>
                            </div>
                            <div className="text-right text-sm font-medium text-slate-700">
                              {result.ratingDisplay ?? result.rating ?? "Unrated"}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {rosterMatches.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Tournament roster matches</p>
                    <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                      {rosterMatches.map((player) => (
                        <button
                          key={player.id}
                          type="button"
                          onClick={() => handleSelectRosterPlayer(player)}
                          className="w-full rounded-lg border border-slate-200 p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {player.firstName} {player.lastName}
                              </p>
                              <p className="text-[11px] text-slate-500">Registered for this event</p>
                            </div>
                            {player.rating !== null && player.rating !== undefined && (
                              <span className="text-sm font-medium text-slate-700">{player.rating}</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" name="firstName" required />
          <Field label="Last name" name="lastName" required />
          <Field label="USCF ID" name="uscfId" />
          <Field label="FIDE ID" name="fideId" />
          <Field label="USCF rating" name="uscfRating" />
          <Field label="FIDE rating" name="fideRating" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" name="email" required valueAs="email" />
          <Field label="Phone number" name="phoneNumber" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-sm font-medium text-slate-700">Preferred section</Label>
            <Select
              onValueChange={(value) => form.setValue("sectionChoice", value, { shouldDirty: true })}
              value={form.watch("sectionChoice") ?? ""}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a section" />
              </SelectTrigger>
              <SelectContent>
                {sections.map((section) => (
                  <SelectItem key={section} value={section}>
                    {section}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.sectionChoice && (
              <p className="mt-1 text-xs text-red-500">{form.formState.errors.sectionChoice.message}</p>
            )}
          </div>
          <div>
            <Label className="text-sm font-medium text-slate-700">Rating provider</Label>
            <Select
              onValueChange={(value) =>
                form.setValue("ratingProvider", value as RegistrationFormValues["ratingProvider"], { shouldDirty: true })
              }
              value={form.watch("ratingProvider") ?? "none"}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select rating provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No rating</SelectItem>
                <SelectItem value="uscf">USCF</SelectItem>
                <SelectItem value="fide">FIDE</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const value = fullName?.trim() ?? "";
  if (!value) return { firstName: "", lastName: "" };
  if (value.includes(",")) {
    const [last, first] = value.split(",");
    return {
      firstName: (first ?? "").trim() || value,
      lastName: (last ?? "").trim(),
    };
  }
  const parts = value.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  const lastName = parts.pop() ?? "";
  return {
    firstName: parts.join(" "),
    lastName,
  };
}

function StepTwo({
  config,
  entryFees,
}: {
  config: ReturnType<typeof parseTournamentConfig> | null;
  entryFees: EntryFeeRule[];
}) {
  const form = useFormContext<RegistrationFormValues>();
  const byePreference = form.watch("byePreference");
  const ratingProvider = form.watch("ratingProvider");
  const uscfRatingValue = form.watch("uscfRating");
  const fideRatingValue = form.watch("fideRating");
  const selectedSection = form.watch("sectionChoice");
  const selectedEntryFeeId = form.watch("entryFeeId");

  const numericRating = useMemo(
    () => derivePlayerRating(ratingProvider, uscfRatingValue, fideRatingValue),
    [fideRatingValue, ratingProvider, uscfRatingValue],
  );

  const entryFeeOptions = useMemo(
    () => filterEntryFeesBySection(entryFees, selectedSection),
    [entryFees, selectedSection],
  );

  const recommendedEntryFee = useMemo(
    () => findRecommendedEntryFee(entryFeeOptions, numericRating),
    [entryFeeOptions, numericRating],
  );

  useEffect(() => {
    if (entryFees.length === 0) {
      if (!form.getValues("entryFeeId")) {
        form.setValue("entryFeeId", NO_ENTRY_FEE_ID, { shouldDirty: false });
      }
      return;
    }
    if (entryFeeOptions.length === 0) {
      form.setValue("entryFeeId", "", { shouldDirty: true });
      return;
    }
    const current = form.getValues("entryFeeId");
    const fallback = recommendedEntryFee ?? entryFeeOptions[0];
    if (!current || !entryFeeOptions.some((fee) => fee.id === current)) {
      form.setValue("entryFeeId", fallback.id, { shouldDirty: false });
    }
  }, [entryFeeOptions, entryFees.length, form, recommendedEntryFee]);

  const byeRounds = useMemo(() => {
    const rounds = config?.details.rounds ?? 0;
    return Array.from({ length: rounds }, (_, index) => `Round ${index + 1}`);
  }, [config?.details.rounds]);

  return (
    <Card className="border-0 bg-white/90 shadow-lg ring-1 ring-slate-100 backdrop-blur-sm">
      <CardHeader>
        <CardTitle>Step 2: Details & Preferences</CardTitle>
        <CardDescription>Provide contact information, arrival plans, and bye selections.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label className="text-sm font-medium text-slate-700">Entry fee</Label>
              <p className="text-xs text-slate-500">Choose the option that matches your section and rating.</p>
            </div>
            <Badge variant="outline" className="w-fit border-slate-300 text-slate-600">
              {numericRating !== null ? `Rating: ${numericRating}` : "Rating: Unrated"}
            </Badge>
          </div>
          {entryFees.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
              Entry fees will be confirmed by the tournament director. Continue to acknowledge payment on the next step.
            </div>
          ) : entryFeeOptions.length === 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <p>No pricing has been configured for the selected section. Please contact the director for assistance.</p>
            </div>
          ) : (
            <>
              <RadioGroup
                value={selectedEntryFeeId ?? ""}
                onValueChange={(value) => form.setValue("entryFeeId", value, { shouldDirty: true })}
                className="grid gap-3 sm:grid-cols-2"
              >
                {entryFeeOptions.map((fee) => {
                  const eligible = ratingWithinEntryFee(numericRating, fee);
                  const isRecommended = recommendedEntryFee?.id === fee.id;
                  const isSelected = selectedEntryFeeId === fee.id;
                  return (
                    <label
                      key={fee.id}
                      htmlFor={`entry-fee-${fee.id}`}
                      className={cn(
                        "relative flex cursor-pointer flex-col gap-2 rounded-lg border p-4 transition",
                        isSelected ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-indigo-300",
                      )}
                    >
                      <RadioGroupItem id={`entry-fee-${fee.id}`} value={fee.id} className="sr-only" />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">{fee.section}</span>
                        <span className="text-sm font-semibold text-slate-900">
                          {formatCurrency(fee.amount, fee.currency)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{formatEntryFeeRange(fee)}</p>
                      {fee.notes && <p className="text-xs text-slate-500">{fee.notes}</p>}
                      <div className="flex flex-wrap gap-2 pt-2">
                        {isRecommended && (
                          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Recommended</Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={cn(
                            "border text-xs",
                            eligible ? "border-emerald-200 text-emerald-600" : "border-amber-200 text-amber-600",
                          )}
                        >
                          {eligible ? "Matches rating" : "Director review required"}
                        </Badge>
                      </div>
                    </label>
                  );
                })}
              </RadioGroup>
              {form.formState.errors.entryFeeId && (
                <p className="text-xs text-red-500">{form.formState.errors.entryFeeId.message}</p>
              )}
            </>
          )}
        </div>

        <Separator />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address" name="address1" />
          <Field label="Address 2" name="address2" />
          <Field label="City" name="city" />
          <Field label="State / Province" name="state" />
          <Field label="Postal code" name="postalCode" />
          <div>
            <Label className="text-sm font-medium text-slate-700">Country</Label>
            <Select
              value={form.watch("country") ?? "United States"}
              onValueChange={(value) => form.setValue("country", value, { shouldDirty: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select country" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRY_OPTIONS.map((country) => (
                  <SelectItem key={country} value={country}>
                    {country}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-sm font-medium text-slate-700">Pairing notifications</Label>
            <Select
              value={form.watch("pairingNotifications") ?? "email"}
              onValueChange={(value) =>
                form.setValue("pairingNotifications", value as RegistrationFormValues["pairingNotifications"], {
                  shouldDirty: true,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select preference" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email only</SelectItem>
                <SelectItem value="sms">Text only</SelectItem>
                <SelectItem value="both">Email & text</SelectItem>
                <SelectItem value="none">No notifications</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-4">
            <input
              id="newsletter"
              type="checkbox"
              className="h-4 w-4 border-slate-300 text-indigo-600"
              checked={form.watch("newsletter") ?? false}
              onChange={(event) => form.setValue("newsletter", event.target.checked)}
            />
            <div>
              <Label htmlFor="newsletter" className="text-sm font-medium text-slate-700">
                Receive tournament updates
              </Label>
              <p className="text-xs text-slate-500">Opt-in to organizer newsletters and bulletins.</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expected arrival notes" name="arrivalTime" placeholder="e.g., Arriving Saturday 9AM" />
          <Field label="Prize payment email (optional)" name="prizeEmail" placeholder="PayPal or Zelle email" />
        </div>

        <div className="space-y-4">
          <Label className="text-sm font-medium text-slate-700">Bye requests</Label>
          <RadioGroup
            value={byePreference}
            onValueChange={(value) =>
              form.setValue("byePreference", value as RegistrationFormValues["byePreference"], {
                shouldDirty: true,
              })
            }
            className="grid gap-3 sm:grid-cols-2"
          >
            <RadioOption group="byePreference" value="none" title="No byes" description="I plan to play every round." />
            <RadioOption group="byePreference" value="yes" title="Request byes" description="Select rounds you cannot attend." />
          </RadioGroup>

          {byePreference === "yes" && (
            <div className="rounded-lg border border-slate-200 p-4">
              <Label className="text-sm font-medium text-slate-700">Select eligible rounds</Label>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {byeRounds.map((label) => {
                  const checked = form.watch("byeRounds")?.includes(label);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggleArrayValue(form, "byeRounds", label)}
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition",
                        checked ? "border-indigo-500 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-600",
                      )}
                    >
                      <span>{label}</span>
                      <ChevronDown className="h-4 w-4 rotate-180" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div>
          <Label className="text-sm font-medium text-slate-700">Notes to tournament director</Label>
          <Textarea
            className="mt-2"
            rows={4}
            placeholder="Share any additional information, such as companions, accessibility needs, or late arrival details."
            {...form.register("notes")}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StepThree({
  entryFees,
  paymentDetails,
}: {
  entryFees: EntryFeeRule[];
  paymentDetails?: string | null;
}) {
  const form = useFormContext<RegistrationFormValues>();
  const values = form.getValues();
  const selectedEntryFee = entryFees.find((fee) => fee.id === values.entryFeeId) ?? null;
  const contribution = parseContribution(values.processingContribution);
  const totalDue = (selectedEntryFee?.amount ?? 0) + contribution;
  const acknowledgementError = form.formState.errors.paymentAcknowledgement?.message as string | undefined;
  const contributionError = form.formState.errors.processingContribution?.message as string | undefined;

  const summary: { label: string; value?: string }[] = [
    { label: "Player name", value: `${values.firstName} ${values.lastName}`.trim() },
    { label: "Section", value: values.sectionChoice },
    {
      label: "Entry fee",
      value: selectedEntryFee
        ? `${formatCurrency(selectedEntryFee.amount, selectedEntryFee.currency)} · ${selectedEntryFee.section}`
        : entryFees.length === 0
        ? "To be confirmed offline"
        : undefined,
    },
    {
      label: "Contribution",
      value: contribution > 0 ? formatCurrency(contribution, selectedEntryFee?.currency ?? "USD") : undefined,
    },
    { label: "Email", value: values.email },
    { label: "Phone", value: values.phoneNumber },
    { label: "Arrival", value: values.arrivalTime },
    { label: "Prize email", value: values.prizeEmail },
  ];

  return (
    <Card className="border-0 bg-white/90 shadow-lg ring-1 ring-slate-100 backdrop-blur-sm">
      <CardHeader>
        <CardTitle>Step 3: Payment & Review</CardTitle>
        <CardDescription>Confirm your offline payment plan and verify contact details.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Payment summary</h3>
          <div className="mt-3 space-y-3 text-sm text-slate-600">
            <div className="flex items-center justify-between">
              <span>Entry fee</span>
              <span className="font-medium text-slate-900">
                {selectedEntryFee
                  ? formatCurrency(selectedEntryFee.amount, selectedEntryFee.currency)
                  : entryFees.length === 0
                  ? "To be confirmed"
                  : "Select an entry fee"}
              </span>
            </div>
            {selectedEntryFee && (
              <p className="text-xs text-slate-500">
                Section: {selectedEntryFee.section} · {formatEntryFeeRange(selectedEntryFee)}
              </p>
            )}
            <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
              <label htmlFor="processing-contribution" className="text-sm">
                Optional processing contribution
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{selectedEntryFee?.currency ?? "USD"}</span>
                <Input
                  id="processing-contribution"
                  type="number"
                  step="0.01"
                  min={0}
                  max={500}
                  value={values.processingContribution ?? "0"}
                  onChange={(event) =>
                    form.setValue("processingContribution", event.target.value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  className="w-28"
                />
              </div>
            </div>
            {contributionError && <p className="text-xs text-red-500">{contributionError}</p>}
            <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-semibold text-slate-900">
              <span>Total due (offline)</span>
              <span>{formatCurrency(totalDue, selectedEntryFee?.currency ?? "USD")}</span>
            </div>
          </div>
        </div>

        {paymentDetails ? (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-700">
            <p className="font-medium">Director payment instructions</p>
            <p className="mt-1 whitespace-pre-line text-xs leading-5 text-indigo-600">{paymentDetails}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            The tournament director will follow up with offline payment instructions once your registration is reviewed.
          </div>
        )}

        <div className="space-y-2 rounded-lg border border-slate-200 p-4">
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 border-slate-300 text-indigo-600"
              checked={form.watch("paymentAcknowledgement") ?? false}
              onChange={(event) =>
                form.setValue("paymentAcknowledgement", event.target.checked, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            />
            <span>
              I understand that payment is handled outside of this form and will complete it promptly once the tournament director
              follows up.
            </span>
          </label>
          {acknowledgementError && <p className="text-xs text-red-500">{acknowledgementError}</p>}
        </div>

        <Separator />

        <div className="grid gap-4 sm:grid-cols-2">
          {summary
            .filter((item) => item.value)
            .map((item) => (
              <div key={item.label} className="rounded-lg border border-slate-200 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">{item.label}</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{item.value}</p>
              </div>
            ))}
        </div>

        {values.notes && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="text-xs uppercase tracking-wide text-slate-500">Notes</p>
            <p className="mt-1 leading-6">{values.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RadioOption({
  value,
  title,
  description,
  group,
}: {
  value: string;
  title: string;
  description: string;
  group: keyof RegistrationFormValues;
}) {
  const form = useFormContext<RegistrationFormValues>();
  const current = form.watch(group) as string | undefined;
  return (
    <label
      className={cn(
        "flex flex-1 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4 transition hover:border-indigo-300",
        current === value && "border-indigo-500 bg-indigo-50",
      )}
    >
      <RadioGroupItem value={value} />
      <div>
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
    </label>
  );
}

function Field({
  label,
  name,
  required,
  placeholder,
  valueAs,
}: {
  label: string;
  name: keyof RegistrationFormValues;
  required?: boolean;
  placeholder?: string;
  valueAs?: "email";
}) {
  const form = useFormContext<RegistrationFormValues>();
  const error = form.formState.errors[name];
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </Label>
      <Input
        placeholder={placeholder}
        type={valueAs === "email" ? "email" : "text"}
        {...form.register(name)}
      />
      {error && <p className="text-xs text-red-500">{error.message as string}</p>}
    </div>
  );
}

function toggleArrayValue(
  form: UseFormReturn<RegistrationFormValues>,
  name: keyof RegistrationFormValues,
  value: string,
) {
  const current = (form.getValues(name as any) as string[]) ?? [];
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  form.setValue(name as any, next, { shouldDirty: true });
}

function buildArrivalNotes(values: RegistrationFormValues, entryFees: EntryFeeRule[]) {
  const selectedEntryFee = entryFees.find((fee) => fee.id === values.entryFeeId) ?? null;
  const contribution = parseContribution(values.processingContribution);
  const segments = [
    values.arrivalTime && `Arr:${truncate(values.arrivalTime, 15)}`,
    selectedEntryFee && `Fee:${truncate(selectedEntryFee.section, 10)} ${Math.round(selectedEntryFee.amount)}`,
    contribution > 0 && `Add:${contribution.toFixed(2)}`,
    values.byePreference === "yes" && values.byeRounds.length > 0
      ? `Byes:${values.byeRounds.join("/")}`
      : undefined,
    values.prizeEmail && `Prize:${truncate(values.prizeEmail, 12)}`,
    values.notes && `Notes:${truncate(values.notes, 18)}`,
  ].filter(Boolean);

  return segments.join(" | ").slice(0, 90);
}

function derivePlayerRating(
  provider: RegistrationFormValues["ratingProvider"] | undefined,
  uscfRatingValue: string | undefined,
  fideRatingValue: string | undefined,
): number | null {
  const parsedUscf = Number.parseInt(uscfRatingValue ?? "", 10);
  const parsedFide = Number.parseInt(fideRatingValue ?? "", 10);

  if (provider === "uscf" || provider === "manual") {
    return Number.isFinite(parsedUscf) ? parsedUscf : null;
  }
  if (provider === "fide") {
    return Number.isFinite(parsedFide) ? parsedFide : null;
  }
  if (Number.isFinite(parsedUscf)) return parsedUscf;
  if (Number.isFinite(parsedFide)) return parsedFide;
  return null;
}

function filterEntryFeesBySection(entryFees: EntryFeeRule[], section: string | undefined) {
  if (!section) return [];
  const normalized = section.trim().toLowerCase();
  return entryFees.filter((fee) => fee.section?.trim().toLowerCase() === normalized);
}

function findRecommendedEntryFee(options: EntryFeeRule[], rating: number | null): EntryFeeRule | undefined {
  if (options.length === 0) return undefined;
  if (rating === null) return options[0];
  return options.find((fee) => ratingWithinEntryFee(rating, fee)) ?? options[0];
}

function ratingWithinEntryFee(rating: number | null, fee: EntryFeeRule): boolean {
  if (rating === null) return false;
  if (fee.ratingMin !== null && rating < fee.ratingMin) return false;
  if (fee.ratingMax !== null && rating > fee.ratingMax) return false;
  return true;
}

function formatEntryFeeRange(fee: EntryFeeRule): string {
  const { ratingMin, ratingMax } = fee;
  if (ratingMin !== null && ratingMax !== null) {
    return `Rating ${ratingMin}–${ratingMax}`;
  }
  if (ratingMin !== null) {
    return `Rating ${ratingMin}+`;
  }
  if (ratingMax !== null) {
    return `Rating ≤${ratingMax}`;
  }
  return "All ratings";
}

function formatCurrency(amount: number, currency: string) {
  const safeCurrency = currency && currency.length === 3 ? currency : "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function parseContribution(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0;
  }
  if (typeof value === "string") {
    if (!value.trim()) return 0;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric * 100) / 100) : 0;
  }
  return 0;
}

function truncate(value: string, length: number): string {
  if (!value) return "";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}
