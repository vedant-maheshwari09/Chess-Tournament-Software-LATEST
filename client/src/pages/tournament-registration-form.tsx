import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
import type { EntryFeeRule, PaymentSettings, OfflinePaymentMethod, SectionDefinition } from "@/lib/tournament-config";
import type { Tournament, Player, PlayerRegistration } from "@shared/schema";
import { loadStripe } from "@stripe/stripe-js";
import type { Stripe, StripeElements } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const PAYMENT_STATUS_VALUES = ["unpaid", "processing", "paid", "failed", "refunded"] as const;

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
  paymentIntentId: z.string().optional(),
  paymentStatus: z.enum(PAYMENT_STATUS_VALUES).optional(),
  paymentReceiptUrl: z.string().url().optional(),
  paymentMethod: z.string().optional(),
  currency: z.string().optional(),
  amountDue: z.number().optional(),
  amountPaid: z.number().optional(),
});

type RegistrationFormValues = z.infer<typeof registrationSchema>;

interface PaymentsConfigResponse {
  payments: PaymentSettings;
  publishableKey: string | null;
  onlineConfigured: boolean;
}

interface PaymentIntentResponse {
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
  subtotal: number;
  feeAmount: number;
  currency: string;
}

interface PaymentTotals {
  subtotal: number;
  feeAmount: number;
  total: number;
  currency: string;
}

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

type SectionOption = Pick<SectionDefinition, "name" | "ratingMin" | "ratingMax"> & {
  id: string;
};

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

  const { data: paymentsConfigResponse } = useQuery<PaymentsConfigResponse>({
    queryKey: [`/api/tournaments/${tournamentId}/payments/config`],
    enabled: Boolean(tournament),
  });

  const existingRegistration = registrations.find((entry) => entry.tournamentId === tournamentId);
  const config = useMemo(
    () => (tournament ? parseTournamentConfig(tournament) : null),
    [tournament],
  );

  const entryFees = useMemo(() => config?.entryFees ?? [], [config]);
  const sections = useMemo<SectionOption[]>(() => {
    const map = new Map<string, SectionOption>();
    const ensureId = (name: string, id?: string | null) => {
      const key = name.trim().toLowerCase();
      if (!key) return `section-${Math.random().toString(36).slice(2, 8)}`;
      return id?.trim() || `section-${key}`;
    };
    const upsert = (
      name: string | null | undefined,
      ratingMin: number | null | undefined,
      ratingMax: number | null | undefined,
      id?: string | null,
    ) => {
      if (!name || !name.trim()) return;
      const key = name.trim().toLowerCase();
      const normalizedMin = typeof ratingMin === "number" && Number.isFinite(ratingMin) ? ratingMin : null;
      const normalizedMax = typeof ratingMax === "number" && Number.isFinite(ratingMax) ? ratingMax : null;
      const existing = map.get(key);
      map.set(key, {
        id: existing?.id ?? ensureId(name, id),
        name: existing?.name ?? name.trim(),
        ratingMin: existing?.ratingMin ?? normalizedMin,
        ratingMax: existing?.ratingMax ?? normalizedMax,
      });
    };

    if (config?.sections?.length) {
      for (const section of config.sections) {
        upsert(section.name, section.ratingMin, section.ratingMax, section.id);
      }
    }

    if (entryFees.length > 0) {
      for (const fee of entryFees) {
        upsert(fee.section, fee.ratingMin, fee.ratingMax, fee.sectionId);
      }
    }

    if (map.size === 0) {
      const fallback = config?.registers?.playerLimit ? ["Premier", "Championship"] : Object.values(SECTION_FALLBACKS);
      fallback.forEach((name) => upsert(name, null, null));
    }

    return Array.from(map.values());
  }, [config?.sections, config?.registers?.playerLimit, entryFees]);
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
      paymentIntentId: undefined,
      paymentStatus: "unpaid",
      paymentReceiptUrl: undefined,
      paymentMethod: undefined,
      currency: undefined,
      amountDue: undefined,
      amountPaid: undefined,
    },
  });
  const paymentSubmitRef = useRef<(() => Promise<boolean>) | null>(null);
  const paymentIntentRequestKeyRef = useRef<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isPaymentBusy, setIsPaymentBusy] = useState(false);
  const [isPaymentElementReady, setIsPaymentElementReady] = useState(false);
  const stripePromise = useMemo(() => {
    if (!paymentsConfigResponse?.publishableKey) {
      return null;
    }
    return loadStripe(paymentsConfigResponse.publishableKey);
  }, [paymentsConfigResponse?.publishableKey]);
  const paymentSettings = paymentsConfigResponse?.payments ?? config?.payments ?? null;
  const canProcessOnline = Boolean(paymentSettings?.onlineEnabled && paymentsConfigResponse?.onlineConfigured && stripePromise);
  const offlineMethodsConfigured = paymentSettings?.acceptedOfflineMethods ?? [];
  const offlineAllowed = offlineMethodsConfigured.length > 0;
  const requiresPayment = Boolean(
    canProcessOnline && (paymentSettings?.requirePaymentOnRegistration || !offlineAllowed),
  );

  const [watchEntryFeeId, watchContribution, watchFirstName, watchLastName, watchEmail] = form.watch([
    "entryFeeId",
    "processingContribution",
    "firstName",
    "lastName",
    "email",
  ]);

  const selectedEntryFeeId = (watchEntryFeeId as string) ?? "";
  const selectedEntryFee = useMemo(
    () => entryFees.find((fee) => fee.id === selectedEntryFeeId) ?? null,
    [entryFees, selectedEntryFeeId],
  );
  const processingContributionValue = useMemo(() => parseContribution(watchContribution), [watchContribution]);
  const paymentTotals = useMemo(
    () => computePaymentTotals(selectedEntryFee, processingContributionValue, paymentSettings),
    [selectedEntryFee, processingContributionValue, paymentSettings],
  );

  useEffect(() => {
    if (!canProcessOnline) {
      setClientSecret(null);
      paymentIntentRequestKeyRef.current = null;
      form.setValue("paymentIntentId", undefined, { shouldDirty: false });
      form.setValue("paymentStatus", "unpaid", { shouldDirty: false });
      form.setValue("currency", paymentTotals.currency, { shouldDirty: false });
      form.setValue("amountDue", paymentTotals.total, { shouldDirty: false });
      setIsPaymentElementReady(true);
    }
  }, [canProcessOnline, form, paymentTotals.currency, paymentTotals.total]);

  useEffect(() => {
    if (currentStep !== 3) {
      setIsPaymentElementReady(false);
    }
  }, [currentStep]);

  const registerMutation = useMutation({
    mutationFn: async (values: RegistrationFormValues) => {
      const payload = {
        playerName: `${values.firstName} ${values.lastName}`.trim(),
        uscfRating: values.uscfRating ? Number(values.uscfRating) : undefined,
        phoneNumber: values.phoneNumber,
        email: values.email,
        arrivalTime: buildArrivalNotes(values, entryFees),
        entryFeeId: values.entryFeeId,
        processingContribution: parseContribution(values.processingContribution),
        paymentIntentId: values.paymentIntentId,
        paymentStatus: values.paymentStatus,
        paymentReceiptUrl: values.paymentReceiptUrl,
        paymentMethod: values.paymentMethod,
        currency: values.currency,
        amountDue: typeof values.amountDue === "number" ? values.amountDue : undefined,
        amountPaid: typeof values.amountPaid === "number" ? values.amountPaid : undefined,
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
      paymentSubmitRef.current = null;
      setClientSecret(null);
      paymentIntentRequestKeyRef.current = null;
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createPaymentIntent = useMutation({
    mutationFn: async (body: { entryFeeId?: string; contribution: number; receiptEmail?: string; playerName?: string }) => {
      const response = await apiRequest(`/api/tournaments/${tournamentId}/payments/intent`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return response as PaymentIntentResponse;
    },
    onSuccess: (data) => {
      setClientSecret(data.clientSecret);
      form.setValue("paymentIntentId", data.paymentIntentId, { shouldDirty: false });
      form.setValue("currency", data.currency, { shouldDirty: false });
      form.setValue("amountDue", data.amount, { shouldDirty: false });
      form.setValue("amountPaid", 0, { shouldDirty: false });
      form.setValue("paymentStatus", "unpaid", { shouldDirty: false });
      setIsPaymentElementReady(false);
      const entryFeeId = form.getValues("entryFeeId");
      const contribution = parseContribution(form.getValues("processingContribution"));
      const email = (form.getValues("email") ?? "").trim().toLowerCase();
      const playerName = `${form.getValues("firstName") ?? ""} ${form.getValues("lastName") ?? ""}`
        .trim()
        .toLowerCase();
      const normalizedEntryFeeKey = entryFeeId && entryFeeId !== NO_ENTRY_FEE_ID ? entryFeeId : "offline";
      paymentIntentRequestKeyRef.current = `${normalizedEntryFeeKey}|${contribution.toFixed(2)}|${email}|${playerName}`;
    },
    onError: (error: Error) => {
      paymentIntentRequestKeyRef.current = null;
      toast({
        title: "Payment setup failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const ensurePaymentIntent = useCallback(async () => {
    if (!canProcessOnline || createPaymentIntent.isPending) {
      return;
    }

    const entryFeeIdRaw = form.getValues("entryFeeId");
    const normalizedEntryFeeId = entryFeeIdRaw && entryFeeIdRaw !== NO_ENTRY_FEE_ID ? entryFeeIdRaw : undefined;

    if (!normalizedEntryFeeId && requiresPayment) {
      paymentIntentRequestKeyRef.current = null;
      toast({
        title: "Confirm entry fee",
        description: "Select the entry option for your section before continuing to payment.",
        variant: "destructive",
      });
      return;
    }

    const contribution = parseContribution(form.getValues("processingContribution"));
    const receiptEmail = (form.getValues("email") ?? "").trim();
    const playerName = `${form.getValues("firstName") ?? ""} ${form.getValues("lastName") ?? ""}`.trim();

    const requestKey = `${normalizedEntryFeeId ?? "offline"}|${contribution.toFixed(2)}|${receiptEmail.toLowerCase()}|${playerName.toLowerCase()}`;

    if (paymentIntentRequestKeyRef.current === requestKey && clientSecret) {
      return;
    }

    paymentIntentRequestKeyRef.current = requestKey;
    try {
      await createPaymentIntent.mutateAsync({
        entryFeeId: normalizedEntryFeeId,
        contribution,
        receiptEmail: receiptEmail || undefined,
        playerName: playerName || undefined,
      });
    } catch {
      paymentIntentRequestKeyRef.current = null;
    }
  }, [canProcessOnline, createPaymentIntent, form, clientSecret, requiresPayment, toast]);

  useEffect(() => {
    if (currentStep !== 3) {
      return;
    }
    if (!canProcessOnline) {
      setIsPaymentElementReady(true);
      return;
    }
    ensurePaymentIntent();
  }, [
    currentStep,
    canProcessOnline,
    ensurePaymentIntent,
    watchEntryFeeId,
    watchContribution,
    watchFirstName,
    watchLastName,
    watchEmail,
  ]);

  const paymentAcknowledged = form.watch("paymentAcknowledgement");

  const setPaymentSubmitHandler = useCallback((fn: (() => Promise<boolean>) | null) => {
    paymentSubmitRef.current = fn;
  }, []);

  const handleFinalSubmit = useCallback(async () => {
    const valid = await form.trigger(undefined, { shouldFocus: true });
    if (!valid) {
      return;
    }
    if (paymentSubmitRef.current) {
      const proceed = await paymentSubmitRef.current();
      if (!proceed) {
        return;
      }
    }
    const values = form.getValues();
    registerMutation.mutate(values);
  }, [form, registerMutation]);

  const paymentIntentErrorMessage = createPaymentIntent.error
    ? createPaymentIntent.error instanceof Error
      ? createPaymentIntent.error.message
      : "Unable to prepare payment session"
    : null;

  const submitButtonLabel = registerMutation.isPending
    ? "Submitting..."
    : isPaymentBusy
    ? "Processing payment..."
    : requiresPayment
    ? "Pay & submit"
    : "Submit registration";

  const disableSubmitButton =
    registerMutation.isPending ||
    isPaymentBusy ||
    (requiresPayment && canProcessOnline && (!clientSecret || createPaymentIntent.isPending || !isPaymentElementReady));

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
      const selectedSection = form.getValues("sectionChoice");
      const sectionEntryFees = filterEntryFeesBySection(entryFees, selectedSection);
      const selectedEntryFeeId = form.getValues("entryFeeId");

      if (sectionEntryFees.length === 0) {
        if (!selectedEntryFeeId) {
          form.setValue("entryFeeId", NO_ENTRY_FEE_ID, { shouldDirty: false, shouldValidate: false });
        }
      } else {
        fields = ["entryFeeId"];
      }
    }

    let valid = true;
    if (fields.length > 0) {
      valid = await form.trigger(fields, { shouldFocus: true });
    }

    if (!valid) {
      if (fields.includes("entryFeeId")) {
        toast({
          title: "Select an entry fee",
          description: "Pick the entry option that matches your section before continuing.",
          variant: "destructive",
        });
      }
      return;
    }
    setCurrentStep((prev) => Math.min(prev + 1, 3));
  };

  const handlePrevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
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

            <Card className="overflow-hidden border-0 bg-white/80 shadow-xl ring-1 ring-indigo-100/70 backdrop-blur">
              <CardHeader className="border-b border-indigo-100/70 bg-gradient-to-r from-indigo-50/80 to-white pb-4">
                <CardTitle className="text-lg font-semibold">Registration progress</CardTitle>
                <CardDescription>Follow the steps below to complete your entry.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 bg-white/70 p-6">
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
          <form onSubmit={(event) => event.preventDefault()} className="space-y-10">
            {currentStep === 1 && <StepOne players={players} sections={sections} entryFees={entryFees} />}

            {currentStep === 2 && (
              <StepTwo
                config={config}
                entryFees={entryFees}
                paymentSettings={paymentSettings ?? null}
                sections={sections}
              />
            )}

            {currentStep === 3 && (
              canProcessOnline && clientSecret && stripePromise ? (
                <Elements key={clientSecret} stripe={stripePromise} options={{ clientSecret }}>
                  <StepThree
                    paymentDetails={config?.registers?.paymentDetails}
                    paymentSettings={paymentSettings ?? null}
                    paymentTotals={paymentTotals}
                    selectedEntryFee={selectedEntryFee}
                    requiresPayment={requiresPayment}
                    onlineConfigured={Boolean(canProcessOnline)}
                    clientSecret={clientSecret}
                    registerPaymentHandler={setPaymentSubmitHandler}
                    setPaymentBusy={setIsPaymentBusy}
                    onPaymentElementReady={setIsPaymentElementReady}
                    paymentIntentLoading={createPaymentIntent.isPending}
                    paymentIntentError={paymentIntentErrorMessage}
                    canAcceptOnlinePayment={true}
                    tournamentId={tournamentId}
                  />
                </Elements>
              ) : (
                <StepThree
                  paymentDetails={config?.registers?.paymentDetails}
                  paymentSettings={paymentSettings ?? null}
                  paymentTotals={paymentTotals}
                  selectedEntryFee={selectedEntryFee}
                  requiresPayment={requiresPayment}
                  onlineConfigured={Boolean(canProcessOnline)}
                  clientSecret={clientSecret}
                  registerPaymentHandler={setPaymentSubmitHandler}
                  setPaymentBusy={setIsPaymentBusy}
                  onPaymentElementReady={setIsPaymentElementReady}
                  paymentIntentLoading={createPaymentIntent.isPending}
                  paymentIntentError={paymentIntentErrorMessage}
                  canAcceptOnlinePayment={false}
                  tournamentId={tournamentId}
                />
              )
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
                  <Button
                    type="button"
                    disabled={disableSubmitButton || !paymentAcknowledged}
                    onClick={handleFinalSubmit}
                  >
                    {submitButtonLabel}
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

function StepOne({
  players,
  sections,
  entryFees,
}: {
  players: Player[];
  sections: SectionOption[];
  entryFees: EntryFeeRule[];
}) {
  const form = useFormContext<RegistrationFormValues>();
  const lookupMode = form.watch("lookupMode");
  const ratingProvider = form.watch("ratingProvider");
  const uscfRatingValue = form.watch("uscfRating");
  const fideRatingValue = form.watch("fideRating");
  const [searchTerm, setSearchTerm] = useState("");
  const [remoteResults, setRemoteResults] = useState<RatingLookupResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const numericRating = useMemo(
    () => derivePlayerRating(ratingProvider, uscfRatingValue, fideRatingValue),
    [ratingProvider, uscfRatingValue, fideRatingValue],
  );

  const sectionDetails = useMemo(
    () =>
      sections.map((section) => {
        const options = filterEntryFeesBySection(entryFees, section.name);
        const primaryFee = options[0] ?? null;
        const label = primaryFee
          ? `${section.name} (${formatCurrency(primaryFee.amount, primaryFee.currency)})`
          : `${section.name} (TBD)`;
        return {
          ...section,
          entryFee: primaryFee,
          label,
        };
      }),
    [sections, entryFees],
  );

  useEffect(() => {
    if (sectionDetails.length === 0) return;
    const current = form.getValues("sectionChoice");
    if (current && sectionDetails.some((section) => section.name === current)) {
      return;
    }
    const fallback =
      numericRating !== null
        ? sectionDetails.find((section) => ratingWithinSectionRange(numericRating, section))
        : sectionDetails[0];
    if (fallback) {
      form.setValue("sectionChoice", fallback.name, { shouldDirty: false, shouldValidate: true });
    }
  }, [sectionDetails, form, numericRating]);

  useEffect(() => {
    if (numericRating === null) return;
    const current = form.getValues("sectionChoice");
    if (!current) return;
    const active = sectionDetails.find((section) => section.name === current);
    if (active && !ratingWithinSectionRange(numericRating, active)) {
      const fallback = sectionDetails.find((section) => ratingWithinSectionRange(numericRating, section));
      form.setValue("sectionChoice", fallback ? fallback.name : "", { shouldDirty: true, shouldValidate: true });
    }
  }, [numericRating, sectionDetails, form]);

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
    <Card className="border-0 bg-white/90 shadow-xl ring-1 ring-indigo-100/70 backdrop-blur">
      <CardHeader className="border-b border-indigo-100/70 bg-gradient-to-r from-indigo-50/80 to-white">
        <CardTitle>Step 1: Player Lookup</CardTitle>
        <CardDescription>Search national databases or enter your information manually.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 bg-white/60 p-6">
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
                          className="w-full rounded-lg border border-indigo-100/80 bg-indigo-50/70 p-3 text-left shadow-sm transition hover:border-indigo-300 hover:bg-indigo-100/80"
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
                          className="w-full rounded-lg border border-indigo-100/80 bg-emerald-50/70 p-3 text-left shadow-sm transition hover:border-emerald-300 hover:bg-emerald-100/80"
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
                {sectionDetails.length === 0 ? (
                  <SelectItem value="" disabled>
                    Sections will be announced soon
                  </SelectItem>
                ) : (
                  sectionDetails.map((section) => {
                    const eligible = ratingWithinSectionRange(numericRating, section);
                    const showEligibilityWarning = numericRating !== null && !eligible;
                    return (
                      <SelectItem
                        key={section.id}
                        value={section.name}
                        disabled={showEligibilityWarning}
                        className={cn(
                          "flex flex-col items-start gap-1",
                          showEligibilityWarning && "opacity-45 text-slate-400",
                        )}
                      >
                        <span className="font-medium text-slate-900">{section.label}</span>
                        {(section.ratingMin !== null || section.ratingMax !== null) && (
                          <span className="text-xs text-slate-500">
                            Rating {section.ratingMin ?? "Unrated"} – {section.ratingMax ?? "Open"}
                          </span>
                        )}
                        {showEligibilityWarning && numericRating !== null && (
                          <span className="text-[11px] text-amber-600">
                            Not eligible with rating {numericRating}.
                          </span>
                        )}
                      </SelectItem>
                    );
                  })
                )}
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
  paymentSettings,
  sections,
}: {
  config: ReturnType<typeof parseTournamentConfig> | null;
  entryFees: EntryFeeRule[];
  paymentSettings: PaymentSettings | null;
  sections: SectionOption[];
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

  const sectionDetails = useMemo(
    () =>
      sections.map((section) => {
        const options = filterEntryFeesBySection(entryFees, section.name);
        const primaryFee = options[0] ?? null;
        const label = primaryFee
          ? `${section.name} (${formatCurrency(primaryFee.amount, primaryFee.currency)})`
          : `${section.name} (TBD)`;
        return {
          ...section,
          entryFee: primaryFee,
          label,
        };
      }),
    [sections, entryFees],
  );

  useEffect(() => {
    if (sectionDetails.length === 0) return;
    const current = form.getValues("sectionChoice");
    if (current && sectionDetails.some((section) => section.name === current)) {
      return;
    }
    const fallback =
      numericRating !== null
        ? sectionDetails.find((section) => ratingWithinSectionRange(numericRating, section))
        : sectionDetails[0];
    if (fallback) {
      form.setValue("sectionChoice", fallback.name, { shouldDirty: false, shouldValidate: true });
    }
  }, [sectionDetails, form, numericRating]);

  useEffect(() => {
    if (numericRating === null) return;
    if (!selectedSection) return;
    const current = sectionDetails.find((section) => section.name === selectedSection);
    if (current && !ratingWithinSectionRange(numericRating, current)) {
      const fallback = sectionDetails.find((section) => ratingWithinSectionRange(numericRating, section));
      form.setValue("sectionChoice", fallback ? fallback.name : "", { shouldDirty: true, shouldValidate: true });
    }
  }, [numericRating, selectedSection, sectionDetails, form]);

  const entryFeeOptions = useMemo(
    () => filterEntryFeesBySection(entryFees, selectedSection),
    [entryFees, selectedSection],
  );
  const contributionAllowed = paymentSettings?.allowProcessingContribution !== false;
  useEffect(() => {
    if (!contributionAllowed) {
      form.setValue("processingContribution", "0", { shouldDirty: false, shouldValidate: true });
    }
  }, [contributionAllowed, form]);

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
      form.setValue("entryFeeId", NO_ENTRY_FEE_ID, { shouldDirty: false });
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
    <Card className="border-0 bg-white/90 shadow-xl ring-1 ring-indigo-100/70 backdrop-blur">
      <CardHeader className="border-b border-indigo-100/70 bg-gradient-to-r from-indigo-50/80 to-white">
        <CardTitle>Step 2: Details & Preferences</CardTitle>
        <CardDescription>Provide contact information, arrival plans, and bye selections.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8 bg-white/60 p-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label className="text-sm font-medium text-slate-700">Entry fee</Label>
              <p className="text-xs text-slate-500">Choose the option that matches your section and rating.</p>
            </div>
            <Badge variant="outline" className="w-fit border-indigo-200 bg-indigo-50/70 text-indigo-700">
              {numericRating !== null ? `Rating: ${numericRating}` : "Rating: Unrated"}
            </Badge>
          </div>
          {entryFees.length === 0 ? (
            <div className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50/70 p-4 text-sm text-indigo-700">
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
                        isSelected
                          ? "border-indigo-500 bg-indigo-100/80 shadow-md"
                          : "border-indigo-100/70 bg-white/80 hover:border-indigo-300 hover:bg-indigo-50/60",
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
                          <Badge className="border-emerald-200 bg-emerald-50/80 text-emerald-700">Recommended</Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={cn(
                            "border text-xs",
                            eligible
                              ? "border-emerald-200 bg-emerald-50/70 text-emerald-700"
                              : "border-amber-200 bg-amber-50/70 text-amber-700",
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
                        checked
                          ? "border-indigo-500 bg-indigo-100/80 text-indigo-700 shadow-sm"
                          : "border-slate-200 bg-white/70 text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/60",
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

const OFFLINE_METHOD_LABELS: Record<OfflinePaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  venmo: "Venmo",
  zelle: "Zelle",
  paypal: "PayPal",
  other: "Other",
};

type PaymentStatusKey = "unpaid" | "processing" | "paid" | "failed" | "refunded";

interface StepThreeProps {
  paymentDetails?: string | null;
  paymentSettings: PaymentSettings | null;
  paymentTotals: PaymentTotals;
  selectedEntryFee: EntryFeeRule | null;
  requiresPayment: boolean;
  onlineConfigured: boolean;
  clientSecret: string | null;
  registerPaymentHandler: (fn: (() => Promise<boolean>) | null) => void;
  setPaymentBusy: (busy: boolean) => void;
  onPaymentElementReady: (ready: boolean) => void;
  paymentIntentLoading: boolean;
  paymentIntentError: string | null;
  canAcceptOnlinePayment: boolean;
  tournamentId: number;
}

function StepThree(props: StepThreeProps) {
  if (props.canAcceptOnlinePayment) {
    return <StepThreeStripe {...props} />;
  }
  return <StepThreeContent {...props} stripe={null} elements={null} />;
}

function StepThreeStripe(props: StepThreeProps) {
  const stripe = useStripe();
  const elements = useElements();
  return <StepThreeContent {...props} stripe={stripe} elements={elements} />;
}

interface StepThreeContentProps extends StepThreeProps {
  stripe: Stripe | null;
  elements: StripeElements | null;
}

function StepThreeContent({
  paymentDetails,
  paymentSettings,
  paymentTotals,
  selectedEntryFee,
  requiresPayment,
  onlineConfigured,
  clientSecret,
  registerPaymentHandler,
  setPaymentBusy,
  onPaymentElementReady,
  paymentIntentLoading,
  paymentIntentError,
  canAcceptOnlinePayment,
  tournamentId,
  stripe,
  elements,
}: StepThreeContentProps) {
  const form = useFormContext<RegistrationFormValues>();
  const { toast } = useToast();

  const contributionAllowed = paymentSettings?.allowProcessingContribution !== false;
  const entryFeeId = form.watch("entryFeeId");
  const processingContributionRaw = form.watch("processingContribution");
  const processingContribution = contributionAllowed ? parseContribution(processingContributionRaw) : 0;
  const paymentStatus = (form.watch("paymentStatus") ?? "unpaid") as PaymentStatusKey;
  const acknowledgementChecked = form.watch("paymentAcknowledgement");
  const paymentMethod = form.watch("paymentMethod") ?? undefined;
  const acknowledgementError = form.formState.errors.paymentAcknowledgement?.message as string | undefined;
  const contributionError = form.formState.errors.processingContribution?.message as string | undefined;

  const firstName = form.watch("firstName");
  const lastName = form.watch("lastName");
  const sectionChoice = form.watch("sectionChoice");
  const email = form.watch("email");
  const phoneNumber = form.watch("phoneNumber");
  const arrivalTime = form.watch("arrivalTime");
  const prizeEmail = form.watch("prizeEmail");
  const notes = form.watch("notes");

  const offlineMethods = paymentSettings?.acceptedOfflineMethods ?? [];
  const offlineAllowed = offlineMethods.length > 0;
  const offlineInstructions = paymentSettings?.offlineInstructions;
  const offlineInfoBlocks = ((offlineAllowed || !requiresPayment) ? [offlineInstructions, paymentDetails] : []) as Array<
    string | null | undefined
  >;
  const isOfflineEntry = entryFeeId === NO_ENTRY_FEE_ID || !selectedEntryFee;

  const statusStyles: Record<PaymentStatusKey, string> = {
    unpaid: "bg-slate-100 text-slate-700",
    processing: "bg-amber-100 text-amber-700",
    paid: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
    refunded: "bg-blue-100 text-blue-700",
  };

  const statusLabels: Record<PaymentStatusKey, string> = {
    unpaid: "Unpaid",
    processing: "Processing",
    paid: "Paid",
    failed: "Failed",
    refunded: "Refunded",
  };

  const acknowledgementLabel = requiresPayment
    ? "I authorize the tournament to charge the payment method above and confirm these details are accurate."
    : "I will complete payment using the offline instructions provided by the tournament director.";

  const summary: { label: string; value?: string }[] = [
    { label: "Player name", value: `${firstName ?? ""} ${lastName ?? ""}`.trim() || undefined },
    { label: "Section", value: sectionChoice },
    {
      label: "Entry fee",
      value: selectedEntryFee
        ? `${formatCurrency(selectedEntryFee.amount, selectedEntryFee.currency)} · ${selectedEntryFee.section}`
        : isOfflineEntry
        ? "To be confirmed offline"
        : undefined,
    },
    {
      label: "Contribution",
      value:
        contributionAllowed && processingContribution > 0
          ? formatCurrency(processingContribution, selectedEntryFee?.currency ?? paymentTotals.currency)
          : undefined,
    },
    { label: "Email", value: email },
    { label: "Phone", value: phoneNumber },
    { label: "Arrival", value: arrivalTime },
    { label: "Prize email", value: prizeEmail },
  ];

  useEffect(() => {
    if (!canAcceptOnlinePayment) {
      onPaymentElementReady(true);
    }
  }, [canAcceptOnlinePayment, onPaymentElementReady]);

  const handlePaymentConfirmation = useCallback(async () => {
    if (!canAcceptOnlinePayment || !requiresPayment) {
      return true;
    }
    if (!stripe || !elements) {
      toast({
        title: "Payment unavailable",
        description: "Stripe Checkout is still loading. Please wait a moment and try again.",
        variant: "destructive",
      });
      return false;
    }

    setPaymentBusy(true);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        toast({
          title: "Payment details incomplete",
          description: submitError.message ?? "Fill out the payment form before continuing.",
          variant: "destructive",
        });
        return false;
      }

      const trimmedName = `${firstName ?? ""} ${lastName ?? ""}`.trim() || undefined;
      const returnUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/tournaments/${tournamentId}/register/form?payment=complete`
          : undefined;

      const result = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: {
          return_url: returnUrl,
          payment_method_data: {
            billing_details: {
              name: trimmedName,
              email: email || undefined,
              phone: phoneNumber || undefined,
            },
          },
        },
      });

      if (result.error) {
        form.setValue("paymentStatus", "failed", { shouldDirty: true });
        toast({
          title: "Payment failed",
          description: result.error.message ?? "Your payment method was declined. Please try again.",
          variant: "destructive",
        });
        return false;
      }

      const intent = result.paymentIntent;
      if (!intent) {
        toast({
          title: "Payment failed",
          description: "Stripe did not return a payment status. Please try again.",
          variant: "destructive",
        });
        return false;
      }

      const mappedStatus = mapStripeStatus(intent.status);
      form.setValue("paymentStatus", mappedStatus, { shouldDirty: false });
      form.setValue("paymentIntentId", intent.id, { shouldDirty: false });
      const amountReceivedCents =
        typeof (intent as any).amount_received === "number"
          ? (intent as any).amount_received
          : typeof (intent as any).amountReceived === "number"
          ? (intent as any).amountReceived
          : 0;
      const amountCents =
        typeof intent.amount === "number"
          ? intent.amount
          : typeof (intent as any).amount === "number"
          ? (intent as any).amount
          : Math.round(paymentTotals.total * 100);
      form.setValue("amountPaid", Number((amountReceivedCents / 100).toFixed(2)), { shouldDirty: false });
      form.setValue("amountDue", Number((amountCents / 100).toFixed(2)), { shouldDirty: false });
      form.setValue(
        "currency",
        intent.currency ? intent.currency.toUpperCase() : paymentTotals.currency,
        { shouldDirty: false },
      );
      form.setValue(
        "paymentMethod",
        intent.payment_method_types?.[0] ?? form.getValues("paymentMethod") ?? undefined,
        { shouldDirty: false },
      );
      const receiptUrl =
        (intent as any)?.charges?.data?.[0]?.receipt_url ??
        (intent as any)?.latest_charge?.receipt_url ??
        undefined;
      form.setValue("paymentReceiptUrl", receiptUrl, { shouldDirty: false });

      if (mappedStatus !== "paid") {
        toast({
          title: "Payment processing",
          description: "Stripe is still processing this transaction. Please wait a moment and submit again.",
          variant: "destructive",
        });
        return false;
      }

      form.setValue("paymentAcknowledgement", true, { shouldDirty: true, shouldValidate: true });
      toast({
        title: "Payment confirmed",
        description: "Your payment was processed successfully.",
      });
      return true;
    } catch (error) {
      toast({
        title: "Payment failed",
        description: error instanceof Error ? error.message : "Unable to confirm the payment.",
        variant: "destructive",
      });
      return false;
    } finally {
      setPaymentBusy(false);
    }
  }, [
    canAcceptOnlinePayment,
    requiresPayment,
    stripe,
    elements,
    toast,
    setPaymentBusy,
    form,
    paymentTotals.total,
    paymentTotals.currency,
    firstName,
    lastName,
    email,
    phoneNumber,
    tournamentId,
  ]);

  useEffect(() => {
    if (!paymentSettings?.onlineEnabled || !requiresPayment || !onlineConfigured || !canAcceptOnlinePayment) {
      registerPaymentHandler(async () => true);
      return () => registerPaymentHandler(null);
    }

    registerPaymentHandler(handlePaymentConfirmation);
    return () => registerPaymentHandler(null);
  }, [
    registerPaymentHandler,
    handlePaymentConfirmation,
    paymentSettings?.onlineEnabled,
    requiresPayment,
    onlineConfigured,
    canAcceptOnlinePayment,
  ]);

  return (
    <Card className="border-0 bg-white/90 shadow-xl ring-1 ring-indigo-100/70 backdrop-blur">
      <CardHeader className="border-b border-indigo-100/70 bg-gradient-to-r from-indigo-50/80 to-white">
        <CardTitle>Step 3: Payment & Review</CardTitle>
        <CardDescription>
          {requiresPayment
            ? "Secure checkout is required to complete your registration."
            : "Review your details and confirm how you will complete payment."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 bg-white/60 p-6">
        <div className="rounded-xl border border-indigo-100/70 bg-white/80 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Payment summary</h3>
            <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", statusStyles[paymentStatus])}>
              {statusLabels[paymentStatus]}
            </span>
          </div>
          <div className="mt-3 space-y-3 text-sm text-slate-600">
            <div className="flex items-center justify-between">
              <span>Entry fee</span>
              <span className="font-medium text-indigo-700">
                {selectedEntryFee
                  ? formatCurrency(selectedEntryFee.amount, selectedEntryFee.currency)
                  : isOfflineEntry
                  ? "To be confirmed"
                  : "Select an entry fee"}
              </span>
            </div>
            {selectedEntryFee && (
              <p className="text-xs text-slate-500">
                Section: {selectedEntryFee.section} · {formatEntryFeeRange(selectedEntryFee)}
              </p>
            )}
            {contributionAllowed ? (
              <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
                <label htmlFor="processing-contribution" className="text-sm">
                  Optional processing contribution
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{selectedEntryFee?.currency ?? paymentTotals.currency}</span>
                  <Input
                    id="processing-contribution"
                    type="number"
                    step="0.01"
                    min={0}
                    max={500}
                    value={processingContributionRaw ?? "0"}
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
            ) : (
              <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3 text-xs text-slate-500">
                <span>Processing contributions</span>
                <span>Disabled by director</span>
              </div>
            )}
            {contributionError && <p className="text-xs text-red-500">{contributionError}</p>}
            {paymentTotals.feeAmount > 0 && (
              <div className="flex items-center justify-between border-t border-dashed border-slate-200 pt-3">
                <span>Processing fee</span>
                <span>{formatCurrency(paymentTotals.feeAmount, paymentTotals.currency)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-semibold text-indigo-700">
              <span>Total due</span>
              <span>{formatCurrency(paymentTotals.total, paymentTotals.currency)}</span>
            </div>
            {paymentMethod && <p className="text-xs text-slate-500">Payment method: {paymentMethod.toUpperCase()}</p>}
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-indigo-100/70 bg-white/80 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Payment method</h3>
            {requiresPayment && <Badge variant="outline">Required</Badge>}
          </div>
          {canAcceptOnlinePayment ? (
            <div className="space-y-3">
              {paymentIntentLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-200 bg-indigo-50/60 p-4 text-sm text-indigo-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Preparing secure checkout...
                </div>
              ) : (
                <div className="rounded-lg border border-indigo-200 bg-white p-4">
                  <PaymentElement
                    options={{ layout: "tabs" }}
                    onReady={() => onPaymentElementReady(!requiresPayment)}
                    onChange={(event) => onPaymentElementReady(!requiresPayment || Boolean(event.complete))}
                  />
                </div>
              )}
              {paymentIntentError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">
                  <AlertCircle className="mt-0.5 h-4 w-4" />
                  <span>{paymentIntentError}</span>
                </div>
              )}
              <p className="text-xs text-slate-500">
                Payments are securely processed by Stripe. Your receipt will be sent to {email || "your email"} when the payment succeeds.
              </p>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 text-xs text-slate-600">
              {requiresPayment ? (
                <p className="font-medium text-slate-700">
                  Stripe checkout is unavailable right now. Please contact the tournament director to arrange payment.
                </p>
              ) : (
                <p>Online checkout is disabled. Follow the offline instructions below to complete payment.</p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-indigo-100/70 bg-white/80 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Offline payment options</h3>
          {offlineAllowed ? (
            <div className="flex flex-wrap gap-2">
              {offlineMethods.map((method) => (
                <span key={method} className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                  {OFFLINE_METHOD_LABELS[method] ?? method}
                </span>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-red-200 bg-red-50 p-3 text-xs text-red-600">
              Offline payments are disabled for this tournament. Players must pay online to finalize registration.
            </div>
          )}
          {offlineInfoBlocks
            .filter((block): block is string => Boolean(block && block.trim()))
            .map((block, index) => (
              <div
                key={`${index}-${block.slice(0, 12)}`}
                className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-3 text-xs leading-5 text-indigo-700"
              >
                {block}
              </div>
            ))}
        </div>

        <div className="space-y-2 rounded-lg border border-indigo-100/70 bg-indigo-50/60 p-4">
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(acknowledgementChecked)}
              onChange={(event) =>
                form.setValue("paymentAcknowledgement", event.target.checked, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-500"
            />
            <span>{acknowledgementLabel}</span>
          </label>
          {acknowledgementError && <p className="text-xs text-red-500">{acknowledgementError}</p>}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white/80 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Review your information</h3>
          <div className="mt-3 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
            {summary
              .filter((item) => Boolean(item.value))
              .map((item) => (
                <div key={item.label}>
                  <p className="text-xs uppercase tracking-wide text-slate-400">{item.label}</p>
                  <p className="font-medium text-slate-800">{item.value}</p>
                </div>
              ))}
          </div>
          {notes && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-700">
              <p className="text-xs uppercase tracking-wide text-slate-500">Notes</p>
              <p className="mt-1 leading-6">{notes}</p>
            </div>
          )}
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

function ratingWithinSectionRange(
  rating: number | null,
  section: { ratingMin: number | null; ratingMax: number | null },
): boolean {
  if (rating === null) return true;
  if (section.ratingMin !== null && rating < section.ratingMin) return false;
  if (section.ratingMax !== null && rating > section.ratingMax) return false;
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

function computePaymentTotals(
  entryFee: EntryFeeRule | null,
  contribution: number,
  paymentSettings: PaymentSettings | null,
): PaymentTotals {
  const allowContribution = paymentSettings?.allowProcessingContribution !== false;
  const baseContribution = allowContribution ? contribution : 0;
  const baseAmount = entryFee?.amount ?? 0;
  const currency = (entryFee?.currency ?? paymentSettings?.defaultCurrency ?? "USD").toUpperCase();
  const subtotal = Number((baseAmount + baseContribution).toFixed(2));
  const percent = typeof paymentSettings?.processingFeePercent === "number" ? paymentSettings.processingFeePercent : 0;
  const feeRate = Math.max(0, Math.min(10, percent));
  const feeAmount = Number(((subtotal * feeRate) / 100).toFixed(2));
  const total = Number((subtotal + feeAmount).toFixed(2));

  return {
    subtotal,
    feeAmount,
    total,
    currency,
  };
}

function mapStripeStatus(status: string | null | undefined): PaymentStatusKey {
  switch (status) {
    case "succeeded":
      return "paid";
    case "processing":
    case "requires_capture":
    case "requires_action":
    case "requires_confirmation":
      return "processing";
    case "canceled":
      return "failed";
    case "requires_payment_method":
      return "unpaid";
    case "requires_customer_action":
      return "processing";
    case "refunded":
      return "refunded";
    default:
      return "processing";
  }
}

function truncate(value: string, length: number): string {
  if (!value) return "";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}
