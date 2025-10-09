import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useForm, FormProvider, useFormContext } from "react-hook-form";
import type { UseFormReturn } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  CreditCard,
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

const formatTime = (value: string | null | undefined) => {
  if (!value) return null;
  const [hour, minute] = value.split(":");
  if (hour === undefined || minute === undefined) return value;
  const date = new Date();
  date.setHours(Number(hour));
  date.setMinutes(Number(minute));
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
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

  const schedule = useMemo(() => config?.schedule ?? [], [config]);
  const sections = useMemo(() => {
    const registerSections = config?.registers?.playerLimit ? ["Premier", "Championship"] : undefined;
    if (registerSections?.length) return registerSections;
    return Object.values(SECTION_FALLBACKS);
  }, [config?.registers?.playerLimit]);

  const timeline = useMemo(
    () =>
      schedule
        .filter((event) => event.date || event.time)
        .map((event) => ({
          id: event.id,
          label: event.label,
          date: formatDate(event.date),
          time: formatTime(event.time),
        })),
    [schedule],
  );

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
      byePreference: "none",
      byeRounds: [],
      arrivalTime: "",
      prizeEmail: "",
      notes: "",
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (values: RegistrationFormValues) => {
      const payload = {
        playerName: `${values.firstName} ${values.lastName}`.trim(),
        uscfRating: values.uscfRating ? Number(values.uscfRating) : undefined,
        phoneNumber: values.phoneNumber,
        email: values.email,
        arrivalTime: buildArrivalNotes(values),
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

  const handleNextStep = async () => {
    const valid = await form.trigger();
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
    <div className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
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

            <Card className="shadow-md">
              <CardHeader>
                <CardTitle>Progress</CardTitle>
                <CardDescription>Follow the three steps to finish your registration.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[1, 2, 3].map((step) => (
                    <div key={step} className="flex items-center gap-3">
                      <div className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold",
                        currentStep === step && "border-indigo-500 text-indigo-600",
                        currentStep > step && "border-emerald-500 text-emerald-600",
                        currentStep < step && "border-slate-300 text-slate-400",
                      )}>
                        {currentStep > step ? <Check className="h-4 w-4" /> : step}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {step === 1 && "Player Lookup"}
                          {step === 2 && "Player Details"}
                          {step === 3 && "Review & Submit"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {step === 1 && "Find or enter your rating profile."}
                          {step === 2 && "Provide contact and arrival details."}
                          {step === 3 && "Confirm your entry and submit."}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-10 px-4 py-10 sm:px-6 lg:px-8">
        <Card>
          <CardHeader>
            <CardTitle>Schedule at a glance</CardTitle>
            <CardDescription>Review the important tournament dates.</CardDescription>
          </CardHeader>
          <CardContent>
            {timeline.length === 0 ? (
              <p className="text-sm text-slate-600">Schedule details will be shared soon.</p>
            ) : (
              <div className="space-y-4">
                {timeline.map((item) => (
                  <div key={item.id} className="grid gap-2 rounded-lg border border-slate-200 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                    <div className="text-sm font-medium text-slate-900">{item.label}</div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">{item.date}</div>
                    <div className="text-xs text-slate-500">{item.time ?? "Time TBA"}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            {currentStep === 1 && <StepOne players={players} sections={sections} />}

            {currentStep === 2 && <StepTwo config={config} />}

            {currentStep === 3 && <StepThree />}

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
                  <Button type="submit" disabled={registerMutation.isPending}>
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

function StepOne({ players, sections }: { players: Player[]; sections: string[] }) {
  const form = useFormContext<RegistrationFormValues>();
  const lookupMode = form.watch("lookupMode");

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Step 1: Player Lookup</CardTitle>
        <CardDescription>Search an existing profile or continue with manual entry.</CardDescription>
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
              description="Search by name or player ID."
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
                placeholder="Start typing a name or rating ID to pre-fill details"
                onChange={(event) => {
                  const value = event.target.value.trim().toLowerCase();
                  if (!value) return;
                  const hit = players.find((player) =>
                    `${player.firstName} ${player.lastName}`.toLowerCase().includes(value),
                  );
                  if (hit) {
                    form.setValue("firstName", hit.firstName, { shouldDirty: true });
                    form.setValue("lastName", hit.lastName, { shouldDirty: true });
                    form.setValue("uscfRating", hit.rating ? String(hit.rating) : "", { shouldDirty: true });
                  }
                }}
              />
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
            <p className="text-xs text-slate-500">
              Don&apos;t see your record? Switch to manual entry to provide all information.
            </p>
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

function StepTwo({ config }: { config: ReturnType<typeof parseTournamentConfig> | null }) {
  const form = useFormContext<RegistrationFormValues>();
  const byePreference = form.watch("byePreference");

  const byeRounds = useMemo(() => {
    const rounds = config?.details.rounds ?? 0;
    return Array.from({ length: rounds }, (_, index) => `Round ${index + 1}`);
  }, [config?.details.rounds]);

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Step 2: Player Details</CardTitle>
        <CardDescription>Provide contact, arrival, and bye preferences.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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

        <Separator />

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

function StepThree() {
  const form = useFormContext<RegistrationFormValues>();
  const values = form.getValues();

  const summary: { label: string; value?: string }[] = [
    { label: "Player name", value: `${values.firstName} ${values.lastName}`.trim() },
    { label: "USCF ID", value: values.uscfId },
    { label: "FIDE ID", value: values.fideId },
    { label: "USCF rating", value: values.uscfRating },
    { label: "Email", value: values.email },
    { label: "Phone", value: values.phoneNumber },
    { label: "Section", value: values.sectionChoice },
    { label: "Arrival", value: values.arrivalTime },
    { label: "Prize email", value: values.prizeEmail },
  ];

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Step 3: Review & Submit</CardTitle>
        <CardDescription>Double-check the information before submitting.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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

        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-700">
          <p className="flex items-center gap-2 font-medium">
            <CreditCard className="h-4 w-4" />
            Payment handled separately
          </p>
          <p className="mt-1 text-xs text-indigo-600">
            The tournament director will follow up with payment instructions once your registration is approved.
          </p>
        </div>
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

function buildArrivalNotes(values: RegistrationFormValues) {
  const segments = [
    values.arrivalTime && `Arrival: ${values.arrivalTime}`,
    values.byePreference === "yes" && values.byeRounds.length > 0
      ? `Byes: ${values.byeRounds.join(", ")}`
      : undefined,
    values.notes && `Notes: ${values.notes}`,
    values.prizeEmail && `Prize Email: ${values.prizeEmail}`,
  ].filter(Boolean);

  return segments.join(" | ").slice(0, 200);
}
