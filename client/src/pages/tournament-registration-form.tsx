import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, Link, useSearch } from "wouter";
import { useForm, FormProvider, useFormContext } from "react-hook-form";
import type { UseFormReturn } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  CreditCard,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Plus,
  Save,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  Trophy,
  User,
  Users,
  Wallet,
  X,
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
import {
  parseTournamentConfig,
  resolveEntryFeeBounds,
  type EntryFeeRule,
  type PaymentSettings,
  type OfflinePaymentMethod,
  type SectionDefinition,
} from "@/lib/tournament-config";
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
  address1: z.string().optional(),
  address2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  pairingNotifications: z.enum(["email", "none"]).default("email"),
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

const DEFAULT_FORM_VALUES: RegistrationFormValues = {
  lookupMode: "profile",
  ratingProvider: "none",
  firstName: "",
  lastName: "",
  uscfId: "",
  fideId: "",
  uscfRating: "",
  fideRating: "",
  email: "",
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
  notes: "",
  paymentIntentId: undefined,
  paymentStatus: "unpaid",
  paymentReceiptUrl: undefined,
  paymentMethod: undefined,
  currency: undefined,
  amountDue: undefined,
  amountPaid: undefined,
};

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
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

const statusStyles: Record<string, string> = {
  draft: "bg-blue-100/80 text-blue-800 border border-blue-200/50",
  upcoming: "bg-blue-50/80 text-blue-700 border border-blue-200/50",
  active: "bg-emerald-50 text-emerald-700 border border-emerald-200/50",
  completed: "bg-slate-100 text-slate-600 border border-slate-200/50",
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

// --- registration types ---
interface PlayerDraft {
  id: string;
  values: RegistrationFormValues;
}

// --- localStorage draft helpers ---
interface RegistrationDraft {
  formValues: Partial<RegistrationFormValues>;
  playerDrafts: PlayerDraft[];
  currentStep: number;
  editingDraftId: string | null;
}

const DRAFT_KEY_PREFIX = "reg-draft";
function getDraftKey(tournamentId: number) {
  return `${DRAFT_KEY_PREFIX}-${tournamentId}`;
}
function loadDraft(tournamentId: number): RegistrationDraft | null {
  try {
    const raw = localStorage.getItem(getDraftKey(tournamentId));
    if (!raw) return null;
    return JSON.parse(raw) as RegistrationDraft;
  } catch {
    return null;
  }
}
function saveDraft(tournamentId: number, draft: RegistrationDraft) {
  try {
    localStorage.setItem(getDraftKey(tournamentId), JSON.stringify(draft));
  } catch {
    // quota exceeded – silently ignore
  }
}
function clearDraft(tournamentId: number) {
  try {
    localStorage.removeItem(getDraftKey(tournamentId));
  } catch {
    // ignore
  }
}

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

// Standardized debug logging utility to prevent truncated console output
const DEBUG_LOG = (title: string, data?: any, level: 'info' | 'warn' | 'error' = 'info') => {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[REG_FLOW][${timestamp}] ${title}`;
  
  if (data !== undefined && typeof data === 'object' && data !== null) {
    // If it's an object, we log it descriptive first, then stringified for copy-pasting
    console.groupCollapsed(prefix);
    console[level]("Full Data Object:", data);
    console[level]("STRINGIFIED (Copy-paste friendly):");
    console.log(JSON.stringify(data, null, 2));
    console.groupEnd();
  } else if (data !== undefined) {
    console[`${level}`](`${prefix}:`, data);
  } else {
    console[`${level}`](prefix);
  }
};

export default function TournamentRegistrationFormPage({ tournamentId }: TournamentRegistrationFormProps) {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftSavedFlash, setDraftSavedFlash] = useState(false);
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

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

  const config = useMemo(
    () => (tournament ? parseTournamentConfig(tournament) : null),
    [tournament],
  );
  const multiPlayerAllowed = Boolean(config?.registers?.allowMultiPlayerSignup);
  const existingRegistrations = registrations.filter(
    (entry) => entry.tournamentId === tournamentId && entry.status !== "cancelled" && entry.status !== "declined"
  );
  const existingRegistration = existingRegistrations[0] ?? null;

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

  const [playerDrafts, setPlayerDrafts] = useState<PlayerDraft[]>([]);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const lastSavedStateRef = useRef<string | null>(null);
  const allDraftValues: RegistrationFormValues[] = playerDrafts.map((entry) => entry.values);
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

  const groupPaymentTotals = useMemo(() => {
    if (!multiPlayerAllowed || playerDrafts.length === 0) {
      return paymentTotals;
    }

    return playerDrafts.reduce((acc, entry) => {
      const values = entry.values;
      const entryFee = entryFees.find(f => f.id === values.entryFeeId) ?? null;
      const contribution = parseContribution(values.processingContribution);
      const totals = computePaymentTotals(entryFee, contribution, paymentSettings);

      return {
        subtotal: acc.subtotal + totals.subtotal,
        feeAmount: acc.feeAmount + totals.feeAmount,
        total: acc.total + totals.total,
        currency: totals.currency
      };
    }, {
      subtotal: 0,
      feeAmount: 0,
      total: 0,
      currency: paymentTotals.currency
    });
  }, [playerDrafts, entryFees, paymentSettings, paymentTotals, multiPlayerAllowed]);

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

  useEffect(() => {
    // CRITICAL for group registrations: If we have multiple registrations, load them into playerDrafts
    if (existingRegistrations.length > 0 && !draftRestored && playerDrafts.length === 0 && !editingDraftId) {
      DEBUG_LOG("Restoring multiple existing registrations into draft roster", existingRegistrations);
      const drafts: PlayerDraft[] = existingRegistrations.map((reg: any, idx) => {
        const names = (reg.playerName || "").split(" ");
        const firstName = names[0] || "";
        const lastName = names.slice(1).join(" ") || "";
        
        const vals: RegistrationFormValues = {
          ...DEFAULT_FORM_VALUES,
          lookupMode: "manual",
          firstName,
          lastName,
          email: reg.email || "",

          address1: reg.address1 || "",
          address2: reg.address2 || "",
          city: reg.city || "",
          state: reg.state || "",
          postalCode: reg.postalCode || "",
          country: reg.country || "United States",
          sectionChoice: reg.sectionChoice || "",
          entryFeeId: reg.entryFeeId || "",
          processingContribution: (reg.processingContribution || 0).toString(),
          notes: reg.notes || "",
          arrivalTime: reg.arrivalTime || "",
          ratingProvider: (reg as any).ratingProvider || (reg.fideRating ? "fide" : (reg.uscfRating ? "uscf" : "manual")),
          uscfRating: reg.uscfRating?.toString() || "",
          fideRating: reg.fideRating?.toString() || "",
          uscfId: reg.uscfId || "",
          fideId: reg.fideId || "",
          paymentStatus: (reg.paymentStatus as any) || "unpaid",
          pairingNotifications: (reg.pairingNotifications as any) || "email",
          newsletter: Boolean(reg.newsletter),
          byePreference: (reg.byePreference as any) || "none",
          byeRounds: Array.isArray(reg.byeRounds) ? reg.byeRounds : [],
        };
        
        return {
          id: reg.id?.toString() || `existing-${idx}`,
          values: vals
        };
      });

      // Split: first one to form, rest to drafts
      if (drafts.length > 0) {
        const [first, ...rest] = drafts;
        DEBUG_LOG("Split existing registrations: Applying first to form, others to roster", { first, restCount: rest.length });
        form.reset(first.values);
        setPlayerDrafts(rest);
        setDraftRestored(true);
      }
    }
  }, [existingRegistrations, draftRestored, playerDrafts.length, editingDraftId, form, setPlayerDrafts]);

  // --- Restore draft from localStorage on initial mount ---
  useEffect(() => {
    if (draftRestored) return;
    const draft = loadDraft(tournamentId);
    if (draft) {
      DEBUG_LOG("Draft found in localStorage, attempting restoration", draft);
      const { formValues, playerDrafts: savedRoster, currentStep: savedStep, editingDraftId: savedEditingId } = draft;

      // Check if user has entered something or has players in roster
      if (formValues.firstName || formValues.lastName || formValues.email || savedRoster.length > 0) {
        // Merge saved values into form defaults
        const current = form.getValues();
        form.reset({ ...current, ...formValues }, { keepDefaultValues: false });

        // Restore step, roster, and editing state
        if (savedRoster.length > 0) setPlayerDrafts(savedRoster);
        if (savedStep) setCurrentStep(savedStep);
        if (savedEditingId) setEditingDraftId(savedEditingId);

        setDraftRestored(true);
        DEBUG_LOG("Draft restored successfully", { formValues, savedRoster, savedStep, savedEditingId });
        toast({ title: "Draft restored", description: "Your previously saved progress has been loaded." });
      } else {
        DEBUG_LOG("Draft found but was essentially empty, skipping restoration");
        setDraftRestored(true);
      }
    } else {
      DEBUG_LOG("No draft found in localStorage for this tournament");
      setDraftRestored(true);
    }
  }, [draftRestored, existingRegistration, form, toast, tournamentId]);

  // --- Auto-save form to localStorage on changes (debounced) ---
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entireFormState = form.watch(); // Watch everything

  useEffect(() => {
    const values = form.getValues();
    const hasMeaningfulData = values.firstName || values.lastName || values.email || playerDrafts.length > 0;

    if (!hasMeaningfulData) return;

    // Create a fingerprint of the current state to check if anything actually changed
    const currentStateFingerprint = JSON.stringify({
      formValues: values,
      playerDrafts,
      currentStep,
      editingDraftId
    });

    // If matches last saved, don't trigger timer
    if (currentStateFingerprint === lastSavedStateRef.current) {
      return;
    }

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = setTimeout(() => {
      // Show "Saving..." only when we are actually performing the save
      setIsAutosaving(true);

      // Brief delay to ensure the "Saving..." state is visible if the save is near-instant
      setTimeout(() => {
        DEBUG_LOG("Auto-saving draft to localStorage...", { values, playerDrafts, currentStep });
        saveDraft(tournamentId, {
          formValues: values,
          playerDrafts,
          currentStep,
          editingDraftId
        });

        lastSavedStateRef.current = currentStateFingerprint;
        setIsAutosaving(false);
        setLastSavedAt(new Date());
      }, 400);
    }, 2000); // 2-second debounce typical of modern web apps

    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [
    entireFormState,
    tournamentId,
    playerDrafts,
    currentStep,
    editingDraftId
  ]);

  // --- Manual Save Draft handler ---
  const handleSaveDraft = useCallback(() => {
    const values = form.getValues();
    const draft = {
      formValues: values,
      playerDrafts,
      currentStep,
      editingDraftId
    };
    DEBUG_LOG("Manually saving draft...", draft);
    saveDraft(tournamentId, draft);
    lastSavedStateRef.current = JSON.stringify(draft);
    setDraftSavedFlash(true);
    setLastSavedAt(new Date());
    toast({ title: "Draft saved", description: "Your progress has been saved. You can return later to finish." });
    setTimeout(() => setDraftSavedFlash(false), 2000);
  }, [form, tournamentId, toast, playerDrafts, currentStep, editingDraftId]);

  const registerMutation = useMutation({
    mutationFn: async (values: RegistrationFormValues) => {
      const payload = {
        playerName: `${values.firstName} ${values.lastName}`.trim(),
        uscfRating: (values.uscfRating !== undefined && values.uscfRating !== null && values.uscfRating !== "") ? Number(values.uscfRating) : null,
        fideRating: (values.fideRating !== undefined && values.fideRating !== null && values.fideRating !== "") ? Number(values.fideRating) : null,
        ratingProvider: values.ratingProvider === "none" ? null : (values.ratingProvider || null),
        uscfId: values.uscfId || null,
        fideId: values.fideId || null,
        sectionChoice: values.sectionChoice,
        email: values.email,
        address1: values.address1,
        address2: values.address2,
        city: values.city,
        state: values.state,
        postalCode: values.postalCode,
        country: values.country,
        pairingNotifications: values.pairingNotifications,
        newsletter: values.newsletter,
        entryFeeId: values.entryFeeId,
        processingContribution: parseContribution(values.processingContribution),
        byePreference: values.byePreference,
        byeRounds: values.byeRounds,
        arrivalTime: values.arrivalTime,
        notes: values.notes,
        paymentIntentId: values.paymentIntentId,
        paymentStatus: values.paymentStatus,
        paymentReceiptUrl: values.paymentReceiptUrl,
        paymentMethod: values.paymentMethod,
        currency: values.currency,
        amountDue: typeof values.amountDue === "number" ? values.amountDue : undefined,
        amountPaid: typeof values.amountPaid === "number" ? values.amountPaid : undefined,
      };

      DEBUG_LOG("Submitting single registration mutation payload", payload);

      const data = await apiRequest(`/api/tournaments/${tournamentId}/register`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      DEBUG_LOG("Single registration mutation response", data);
      return data;
    },
    onSuccess: (data) => {
      clearDraft(tournamentId);
      toast({
        title: "Registration submitted",
        description: "Your registration request has been sent to the tournament director.",
      });
      
      // Optimistically insert our newly created 'pending' registration to prevent UI reverting to an outdated cached 'approved' state
      queryClient.setQueryData<PlayerRegistration[]>(["/api/my-registrations"], (old) => {
        if (!old) return [data];
        return [...old.filter(r => r.tournamentId !== tournamentId), data];
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
    mutationFn: async (body: {
      entryFeeId?: string;
      contribution: number;
      receiptEmail?: string;
      playerName?: string;
      items?: Array<{ entryFeeId?: string; contribution: number; playerName?: string }>;
    }) => {
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

      const items = allDraftValues.map(d => {
        const id = d.entryFeeId && d.entryFeeId !== NO_ENTRY_FEE_ID ? d.entryFeeId : "offline";
        const c = parseContribution(d.processingContribution);
        const name = `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim().toLowerCase();
        return `${id}|${c.toFixed(2)}|${name}`;
      });

      const currentEntryFeeIdRaw = form.getValues("entryFeeId");
      const normalizedEntryFeeId = currentEntryFeeIdRaw && currentEntryFeeIdRaw !== NO_ENTRY_FEE_ID ? currentEntryFeeIdRaw : "offline";
      const currentContribution = parseContribution(form.getValues("processingContribution"));
      const currentName = `${form.getValues("firstName") ?? ""} ${form.getValues("lastName") ?? ""}`.trim().toLowerCase();

      items.push(`${normalizedEntryFeeId}|${currentContribution.toFixed(2)}|${currentName}`);

      const email = (form.getValues("email") ?? "").trim().toLowerCase();
      paymentIntentRequestKeyRef.current = `${items.join(";")}|${email}`;
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

    const currentEntryFeeIdRaw = form.getValues("entryFeeId");
    const normalizedEntryFeeId = currentEntryFeeIdRaw && currentEntryFeeIdRaw !== NO_ENTRY_FEE_ID ? currentEntryFeeIdRaw : undefined;

    if (!normalizedEntryFeeId && requiresPayment && allDraftValues.length === 0) {
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

    const itemsPayload = allDraftValues.map(draft => {
      const eFee = draft.entryFeeId && draft.entryFeeId !== NO_ENTRY_FEE_ID ? draft.entryFeeId : undefined;
      const c = parseContribution(draft.processingContribution);
      const name = `${draft.firstName ?? ""} ${draft.lastName ?? ""}`.trim();
      return { entryFeeId: eFee, contribution: c, playerName: name };
    });

    itemsPayload.push({
      entryFeeId: normalizedEntryFeeId,
      contribution,
      playerName,
    });

    const itemsKey = itemsPayload.map(i => `${i.entryFeeId ?? "offline"}|${i.contribution.toFixed(2)}|${i.playerName.toLowerCase()}`).join(";");
    const requestKey = `${itemsKey}|${receiptEmail.toLowerCase()}`;

    if (paymentIntentRequestKeyRef.current === requestKey && clientSecret) {
      return;
    }

    paymentIntentRequestKeyRef.current = requestKey;
    try {
      await createPaymentIntent.mutateAsync({
        contribution: 0,
        receiptEmail: receiptEmail || undefined,
        items: itemsPayload,
      });
    } catch {
      paymentIntentRequestKeyRef.current = null;
    }
  }, [canProcessOnline, createPaymentIntent, form, clientSecret, requiresPayment, toast, allDraftValues]);

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

  const groupRegisterMutation = useMutation({
    mutationFn: async (players: RegistrationFormValues[]) => {
      const payloadArray = players.map(values => ({
        playerName: `${values.firstName} ${values.lastName}`.trim(),
        uscfRating: (values.uscfRating !== undefined && values.uscfRating !== null && values.uscfRating !== "") ? Number(values.uscfRating) : null,
        fideRating: (values.fideRating !== undefined && values.fideRating !== null && values.fideRating !== "") ? Number(values.fideRating) : null,
        ratingProvider: values.ratingProvider === "none" ? null : (values.ratingProvider || null),
        uscfId: values.uscfId || null,
        fideId: values.fideId || null,
        sectionChoice: values.sectionChoice,
        email: values.email,
        address1: values.address1,
        address2: values.address2,
        city: values.city,
        state: values.state,
        postalCode: values.postalCode,
        country: values.country,
        pairingNotifications: values.pairingNotifications,
        newsletter: values.newsletter,
        entryFeeId: values.entryFeeId,
        processingContribution: parseContribution(values.processingContribution),
        byePreference: values.byePreference,
        byeRounds: values.byeRounds,
        arrivalTime: values.arrivalTime,
        notes: values.notes,
        paymentIntentId: values.paymentIntentId,
        paymentStatus: values.paymentStatus,
        paymentReceiptUrl: values.paymentReceiptUrl,
        paymentMethod: values.paymentMethod,
        currency: values.currency,
        amountDue: typeof values.amountDue === "number" ? values.amountDue : undefined,
        amountPaid: typeof values.amountPaid === "number" ? values.amountPaid : undefined,
      }));

      DEBUG_LOG("Submitting batch registration mutation payload", payloadArray);

      const data = await apiRequest(`/api/tournaments/${tournamentId}/register-batch`, {
        method: "POST",
        body: JSON.stringify(payloadArray),
      });
      DEBUG_LOG("Batch registration mutation response", data);
      return data;
    },
    onSuccess: (data) => {
      clearDraft(tournamentId);
      toast({
        title: "Registrations submitted",
        description: "Your registration requests have been sent to the tournament director.",
      });

      // Optimistically insert our newly created 'pending' registrations
      queryClient.setQueryData<PlayerRegistration[]>(["/api/my-registrations"], (old) => {
        if (!old) return data;
        return [...old.filter(r => r.tournamentId !== tournamentId), ...data];
      });

      queryClient.invalidateQueries({ queryKey: ["/api/my-registrations"] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setPlayerDrafts([]);
      setEditingDraftId(null);
      paymentSubmitRef.current = null;
      setClientSecret(null);
      paymentIntentRequestKeyRef.current = null;
      
      // Navigate to remove 'edit=true' so the success screen (Pending) shows correctly
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
      
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

  const handleFinalSubmit = useCallback(async () => {
    DEBUG_LOG("Final submit triggered", { 
      currentStep, 
      multiPlayerAllowed, 
      rosterSize: playerDrafts.length,
      currentForm: form.getValues() 
    });

    const valid = await form.trigger(undefined, { shouldFocus: true });
    if (!valid) {
      DEBUG_LOG("Final submit blocked: UI validation failed", form.formState.errors, 'warn');
      return;
    }

    if (paymentSubmitRef.current) {
      DEBUG_LOG("Entering payment processing flow...");
      const proceed = await paymentSubmitRef.current();
      if (!proceed) {
        DEBUG_LOG("Payment flow interrupted or failed", null, 'warn');
        return;
      }
      DEBUG_LOG("Payment verification successful or skipped (offline/zero cost)");
    }

    const values = form.getValues();
    
    // In multi-player mode, if there's a roster, we MUST include the current form's values (if filled)
    // as the final entry in the batch, unless it's already in the roster (editing case).
    if (multiPlayerAllowed && (playerDrafts.length > 0 || editingDraftId)) {
      DEBUG_LOG("Processing multi-player batch submission");
      
      // Payment fields from the final step should propagate to all entries if they are tied to a shared intent
      const paymentOverride = {
        paymentIntentId: values.paymentIntentId,
        paymentStatus: values.paymentStatus,
        paymentReceiptUrl: values.paymentReceiptUrl,
        paymentMethod: values.paymentMethod,
        currency: values.currency,
        amountDue: values.amountDue,
        amountPaid: values.amountPaid,
      };

      // Construct the list of ALL players the user intends to register
      let list: RegistrationFormValues[] = [];
      
      if (editingDraftId) {
        // We are editing a specific player from the roster
        list = playerDrafts.map((entry) => 
          entry.id === editingDraftId 
            ? { ...values, ...paymentOverride } 
            : { ...entry.values, ...paymentOverride }
        );
      } else {
        // We have a roster, AND the current form likely contains the final player
        const rosterValues = playerDrafts.map(e => e.values);
        list = [...rosterValues, values].map(v => ({ ...v, ...paymentOverride }));
      }

      DEBUG_LOG("Prepared batch list for submission", list);
      groupRegisterMutation.mutate(list);
      return;
    }

    DEBUG_LOG("Processing single-player registration submission", values);
    registerMutation.mutate(values);
  }, [editingDraftId, form, groupRegisterMutation, multiPlayerAllowed, playerDrafts, registerMutation, currentStep]);

  const paymentIntentErrorMessage = createPaymentIntent.error
    ? createPaymentIntent.error instanceof Error
      ? createPaymentIntent.error.message
      : "Unable to prepare payment session"
    : null;

  const submitButtonLabel = registerMutation.isPending || groupRegisterMutation.isPending
    ? "Submitting..."
    : isPaymentBusy
      ? "Processing payment..."
      : requiresPayment
        ? "Pay & submit"
        : "Submit registration";

  const disableSubmitButton =
    registerMutation.isPending ||
    groupRegisterMutation.isPending ||
    isPaymentBusy ||
    (requiresPayment && canProcessOnline && (!clientSecret || createPaymentIntent.isPending || !isPaymentElementReady));

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f6f3]">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-gray-200 border-t-blue-600"></div>
          <p className="mt-4 text-sm text-gray-500">Loading registration form...</p>
        </div>
      </div>
    );
  }

  if (!tournament || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f6f3] px-4">
        <div className="w-full max-w-md">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="p-8 text-center">
              <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-900">Tournament unavailable</h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">
                This registration form could not be loaded. This might happen if the tournament has been archived, paused, or deleted.
              </p>
              <Button
                className="mt-6 w-full"
                onClick={() => setLocation(`/tournaments/${tournamentId}`)}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Tournament Page
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const searchParams = new URLSearchParams(searchString);
  const isEditing = searchParams.get("edit") === "true";

  if (existingRegistration && !isEditing) {
    return (
      <div className="min-h-screen bg-[#f7f6f3]">
        <div className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-5 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
                onClick={() => setLocation(`/tournaments/${tournamentId}`)}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to tournament
              </Button>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-gray-900">{tournament.name}</h1>
          </div>
        </div>

        <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            {existingRegistration.status === 'approved' ? (
              <div className="flex items-center gap-3 border-b border-gray-100 bg-emerald-50 px-6 py-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Registration Accepted</h2>
                  <p className="text-xs text-gray-500">You are fully registered for this tournament.</p>
                </div>
              </div>
            ) : existingRegistration.status === 'declined' ? (
              <div className="flex items-center gap-3 border-b border-gray-100 bg-red-50 px-6 py-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
                  <X className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Registration Declined</h2>
                  <p className="text-xs text-gray-500">Your registration for this tournament was declined.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 border-b border-gray-100 bg-blue-50 px-6 py-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                  <Clock className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Registration Pending</h2>
                  <p className="text-xs text-gray-500">Your entry is being reviewed by the tournament director.</p>
                </div>
              </div>
            )}
            <div className="p-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                {existingRegistration.playerName && (
                  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Player Name</p>
                    <p className="mt-1 font-medium text-slate-900">{existingRegistration.playerName}</p>
                  </div>
                )}
                {existingRegistration.uscfRating && (
                  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">USCF Rating</p>
                    <p className="mt-1 font-medium text-slate-900">{existingRegistration.uscfRating}</p>
                  </div>
                )}
                {existingRegistration.email && (
                  <div className="col-span-2 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Email</p>
                    <p className="mt-1 font-medium text-slate-900">{existingRegistration.email}</p>
                  </div>
                )}
              </div>
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                We&apos;ll notify you once the tournament director processes your registration.
              </div>
              <Button className="mt-6 w-full" onClick={() => setLocation(`/tournaments/${tournamentId}`)}>Return to tournament page</Button>
            </div>
          </div>
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
      const sectionEntryFees = filterEntryFeesBySection(entryFees, selectedSection, sections);
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
      DEBUG_LOG("Step navigation blocked: validation failed", form.formState.errors, 'warn');
      if (fields.includes("entryFeeId")) {
        toast({
          title: "Select an entry fee",
          description: "Pick the entry option that matches your section before continuing.",
          variant: "destructive",
        });
      }
      return;
    }

    DEBUG_LOG(`Advancing from Step ${currentStep} to ${currentStep + 1}`);

    // When moving to the final review step, finalize the current player into the drafts list
    if (currentStep === 2) {
      const currentValues = form.getValues();
      const hasData = Boolean(currentValues.firstName?.trim() || currentValues.lastName?.trim());

      if (hasData) {
        if (editingDraftId) {
          DEBUG_LOG(`Finalizing edit for player: ${currentValues.firstName} ${currentValues.lastName}`);
          setPlayerDrafts((prev) =>
            prev.map((entry) => (entry.id === editingDraftId ? { ...entry, values: currentValues } : entry)),
          );
        } else {
          // Save new player as draft and set as 'currently active' draft
          const draftId =
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          
          DEBUG_LOG(`Saving current form to roster as new draft entry (ID: ${draftId})`);
          setPlayerDrafts((prev) => [...prev, { id: draftId, values: currentValues }]);
          setEditingDraftId(draftId);
        }
      }
    }

    setCurrentStep((prev) => Math.min(prev + 1, 3));
  };

  const handlePrevStep = () => {
    DEBUG_LOG(`Moving back from Step ${currentStep} to ${currentStep - 1}`);
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };


  const handleAddAnotherPlayer = async () => {
    // Only return if we truly can't allow more players
    if (!multiPlayerAllowed && playerDrafts.length === 0 && !existingRegistrations.length) {
      return;
    }

    let fields: (keyof RegistrationFormValues)[] = [];
    // Validate key fields from steps 1 and 2 for the current player
    fields = ["firstName", "lastName", "email", "sectionChoice"];

    if (entryFees.length > 0) {
      const selectedSection = form.getValues("sectionChoice");
      const sectionEntryFees = filterEntryFeesBySection(entryFees, selectedSection, sections);
      const selectedEntryFeeId = form.getValues("entryFeeId");

      if (sectionEntryFees.length === 0) {
        if (!selectedEntryFeeId) {
          form.setValue("entryFeeId", NO_ENTRY_FEE_ID, { shouldDirty: false, shouldValidate: false });
        }
      } else {
        fields = [...fields, "entryFeeId"];
      }
    }

    let valid = true;
    if (fields.length > 0) {
      // If we are on Step 3 and the current form is already empty,
      // we don't need to validate or save the current state - just go back to Step 1
      const currentValues = form.getValues();
      const isEmpty = !currentValues.firstName?.trim() && !currentValues.lastName?.trim();
      
      if (currentStep === 3 && isEmpty) {
        DEBUG_LOG("Add Player clicked on Step 3 with empty form. Skipping validation and returning to Step 1.");
        setCurrentStep(1);
        setEditingDraftId(null);
        return;
      }

      valid = await form.trigger(fields, { shouldFocus: true });
    }

    if (!valid) {
      DEBUG_LOG("Add another player blocked: validation failed", form.formState.errors, 'warn');
      if (fields.includes("entryFeeId")) {
        toast({
          title: "Select an entry fee",
          description: "Pick the entry option that matches your section before adding another player.",
          variant: "destructive",
        });
      }
      return;
    }

    const currentValues = form.getValues();
    DEBUG_LOG(`Saving ${currentValues.firstName} to roster and resetting for next entry`);

    if (editingDraftId) {
      setPlayerDrafts((prev) =>
        prev.map((entry) => (entry.id === editingDraftId ? { ...entry, values: currentValues } : entry)),
      );
      setEditingDraftId(null);
    } else {
      const draftId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      DEBUG_LOG(`Creating new draft entry for roster (ID: ${draftId})`);
      setPlayerDrafts((prev) => [...prev, { id: draftId, values: currentValues }]);
    }

    // Reset for the next player - clean reset to prevent leakage
    DEBUG_LOG("Resetting form for next group member...");
    form.reset({
      // IMPORTANT: Force manual mode for subsequent players to stop profile autofill "ghosting"
      lookupMode: "manual",
      ratingProvider: "none",
      firstName: "",
      lastName: "",
      uscfId: "",
      fideId: "",
      uscfRating: "",
      fideRating: "",
      // Keep main contact email if it exists as a group default, but clear the rest
      email: currentValues.email,

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
      notes: "",
      paymentIntentId: undefined,
      paymentStatus: "unpaid",
      paymentReceiptUrl: undefined,
      paymentMethod: undefined,
      currency: undefined,
      amountDue: undefined,
      amountPaid: undefined,
    });
    setCurrentStep(1);
  };

  const handleEditDraft = (draftId: string) => {
    const draft = playerDrafts.find((entry) => entry.id === draftId);
    if (!draft) return;

    // Before switching, save the current in-progress player so they aren't lost.
    const currentValues = form.getValues();
    const hasCurrentData = Boolean(
      currentValues.firstName?.trim() || currentValues.lastName?.trim()
    );

    if (editingDraftId) {
      // We were already editing a draft — update it with the current form state
      setPlayerDrafts((prev) =>
        prev.map((entry) =>
          entry.id === editingDraftId ? { ...entry, values: currentValues } : entry,
        ),
      );
    } else if (hasCurrentData) {
      // There's an unsaved in-progress player — save them as a new draft
      const newDraftId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPlayerDrafts((prev) => [...prev, { id: newDraftId, values: currentValues }]);
    }

    setEditingDraftId(draftId);
    form.reset(draft.values);
    setCurrentStep(1);
  };

  const handleRemoveDraft = async (draftId: string) => {
    DEBUG_LOG(`Checking if draft ${draftId} needs permanent deletion from database`);
    
    // Check if this is a real database registration (numeric ID)
    const numericId = parseInt(draftId, 10);
    const isRealRegistration = !isNaN(numericId);

    if (isRealRegistration) {
      DEBUG_LOG(`Initiating backend deletion for registration ID: ${numericId}`);
      try {
        const response = await apiRequest(`/api/registrations/${numericId}`, { method: "DELETE" });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to remove registration");
        }
        toast({
          title: "Registration removed",
          description: "The player has been permanently removed from the tournament.",
        });
        
        // Refresh the registrations query so existingRegistrations list remains accurate
        queryClient.invalidateQueries({ queryKey: ["/api/my-registrations"] });
      } catch (error: any) {
        console.error("Failed to delete registration:", error);
        toast({
          title: "Deletion failed",
          description: error.message,
          variant: "destructive",
        });
        return; // Don't remove from local state if backend deletion failed
      }
    }

    if (editingDraftId === draftId) {
      setEditingDraftId(null);
      // If we were editing the draft we just removed, clear the form too
      form.reset({
        ...form.getValues(),
        firstName: "",
        lastName: "",
        uscfId: "",
        uscfRating: "",
        sectionChoice: "",
      });
    }
    
    const updatedDrafts = playerDrafts.filter((entry) => entry.id !== draftId);
    setPlayerDrafts(updatedDrafts);

    // CRITICAL: Force immediate localStorage sync after removal to prevent "ghost" restores
    try {
      saveDraft(tournamentId, {
        formValues: form.getValues(),
        playerDrafts: updatedDrafts,
        currentStep,
        editingDraftId: editingDraftId === draftId ? null : editingDraftId,
      });
      DEBUG_LOG("LocalStorage synced successfully after draft removal");
    } catch (saveError) {
      console.error("Failed to sync localStorage after removal:", saveError);
    }
  };
  const currentPlayerLabel =
    `${form.getValues("firstName") ?? ""} ${form.getValues("lastName") ?? ""}`.trim() || "Current player";
  const currentPlayerSection = form.getValues("sectionChoice") || "Not selected";

  const getInitials = (firstName: string, lastName: string) => {
    return `${(firstName || "")[0] ?? ""}${(lastName || "")[0] ?? ""}`.toUpperCase();
  };

  return (
    <div className="min-h-screen bg-[#f7f6f3]">
      {/* ===== Main Content ===== */}
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {/* ===== Compact Header Section ===== */}
          <div className="border-b border-gray-100 px-6 py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link href={`/tournaments/${tournamentId}`}>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-blue-300 hover:text-blue-600 active:scale-95"
                    title="Back to tournament"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                </Link>
                <h1 className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">{tournament.name}</h1>
              </div>
              <div className="flex items-center gap-3">
                <Badge
                  className={cn(
                    "border px-2 py-0.5 text-[11px] font-medium capitalize",
                    tournament.status === "active"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : tournament.status === "upcoming"
                        ? "bg-blue-50 text-blue-700 border-blue-200"
                        : "bg-gray-100 text-gray-600 border-gray-200",
                  )}
                  variant="outline"
                >
                  {tournament.status}
                </Badge>

                {/* Premium Autosave Indicator */}
                {(isAutosaving || lastSavedAt) && (
                  <div className={cn(
                    "flex items-center gap-1.5 transition-all duration-500",
                    isAutosaving ? "opacity-100 translate-y-0" : "opacity-40 -translate-y-0"
                  )}>
                    {isAutosaving ? (
                      <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                    ) : (
                      <div className="flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500/10">
                        <Check className="h-2 w-2 text-emerald-600" />
                      </div>
                    )}
                    <span className="text-[11px] font-medium text-gray-400">
                      {isAutosaving ? "Saving..." : `Saved at ${lastSavedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-gray-500">
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {startDateText}{endDateText && endDateText !== "TBD" && ` – ${endDateText}`}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {config.basic.city || tournament.location || "Venue TBA"}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {config.details.timeControl?.toUpperCase()} · {config.details.rounds} rounds
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {playerCount}{playerLimit ? ` / ${playerLimit}` : ""} players
              </span>
            </div>

            {/* Step progress indicator */}
            <div className="mt-5 flex items-center gap-0">
              {stepMeta.map((meta, index) => {
                const step = index + 1;
                const isDone = currentStep > step;
                const isActive = currentStep === step;
                return (
                  <div key={meta.title} className="flex items-center">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300",
                          isDone
                            ? "bg-blue-600 text-white shadow-sm"
                            : isActive
                              ? "border-[1.5px] border-blue-600 text-blue-600 bg-blue-50 ring-2 ring-blue-100"
                              : "border-[1.5px] border-gray-200 text-gray-400 bg-white",
                        )}
                      >
                        {isDone ? <Check className="h-3.5 w-3.5" /> : step}
                      </div>
                      <span className={cn(
                        "hidden text-[13px] font-medium sm:block",
                        isDone ? "text-blue-600" : isActive ? "text-gray-900" : "text-gray-400"
                      )}>{meta.title}</span>
                    </div>
                    {index < stepMeta.length - 1 && (
                      <div
                        className={cn(
                          "mx-3 h-px w-10 transition-all duration-500",
                          currentStep > step ? "bg-blue-600" : "bg-gray-200",
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ===== Form Content Area ===== */}
          <div className="p-6 sm:p-8 lg:p-10">
            <FormProvider {...form}>
              <form onSubmit={(event) => event.preventDefault()} className="space-y-6">

                {/* ===== Multi-player roster panel (Hidden in Step 3 to avoid double summary) ===== */}
                {multiPlayerAllowed && currentStep < 3 && (playerDrafts.length > 0 || editingDraftId) && (
                  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white border border-gray-200 shadow-sm">
                        <Users className="h-5 w-5 text-gray-600" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold leading-tight text-gray-900">Group Registration</h3>
                        <p className="text-sm text-gray-500">
                          {playerDrafts.length} player{playerDrafts.length !== 1 ? "s" : ""} saved
                        </p>
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {playerDrafts.map((entry, idx) => {
                        const values = entry.values;
                        const name = `${values.firstName} ${values.lastName}`.trim() || "Unnamed player";
                        const initials = getInitials(values.firstName ?? "", values.lastName ?? "");
                        const isEditing = editingDraftId === entry.id;

                        return (
                          <div
                            key={entry.id}
                            className={cn(
                              "flex items-center gap-3 px-5 py-3.5 transition",
                              isEditing && "bg-blue-50/60",
                            )}
                          >
                            <div
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                                isEditing
                                  ? "bg-blue-50 text-blue-700 border border-blue-200"
                                  : "bg-gray-50 text-gray-500 border border-gray-100",
                              )}
                            >
                              {idx + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-medium text-gray-900">{name}</p>
                                {isEditing && (
                                  <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-600">Editing</span>
                                )}
                              </div>
                              <p className="truncate text-xs text-slate-500">
                                {values.sectionChoice || "Section TBD"}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleEditDraft(entry.id)}
                                disabled={isEditing}
                                className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-gray-400 transition hover:bg-gray-50 hover:text-gray-600 disabled:opacity-40"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveDraft(entry.id)}
                                className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-gray-400 transition hover:bg-red-50 hover:text-red-500"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* Current in-progress info bar (not in Step 3) */}
                      {!editingDraftId && currentStep < 3 && (
                        <div className="flex items-center gap-3 bg-gray-50 border-t border-dashed border-gray-200 px-6 py-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-gray-300 bg-white text-xs font-medium text-gray-400">
                            {playerDrafts.length + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium text-gray-700">{currentPlayerLabel}</p>
                              <span className="rounded bg-gray-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-700">
                                In progress
                              </span>
                            </div>
                            <p className="text-xs text-gray-500">Step {currentStep}: Filling details</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ===== Step Content ===== */}
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  {currentStep === 1 && <StepOne config={config} players={players} sections={sections} entryFees={entryFees} />}
                  {currentStep === 2 && (
                    <StepTwo
                      config={config}
                      entryFees={entryFees}
                      paymentSettings={paymentSettings ?? null}
                      sections={sections}
                    />
                  )}
                  {currentStep === 3 && (() => {
                    const displayDrafts = (() => {
                      const currentVals = form.getValues();
                      if (!multiPlayerAllowed) {
                        return [{ id: 'single', values: currentVals }];
                      }
                      
                      // In multi-player mode:
                      // 1. Start with the roster
                      let list = [...playerDrafts];
                      
                      if (editingDraftId) {
                        // 2a. If editing, replace that entry with current form values
                        list = list.map(d => d.id === editingDraftId ? { ...d, values: currentVals } : d);
                      } else {
                        // 2b. If not editing, the current form has been filled but not added to roster yet
                        // Check if it has enough data to be considered a 'final' entry
                        if (currentVals.firstName || currentVals.lastName) {
                          list.push({ id: 'current-form', values: currentVals });
                        }
                      }
                      
                      return list.length > 0 ? list : [{ id: 'placeholder', values: currentVals }];
                    })();
                    const displayValues = displayDrafts.map(e => e.values);
                    
                    return (
                    <>
                      {displayValues.length > 0 && (
                        <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                          <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white border border-gray-200 shadow-sm">
                              <CreditCard className="h-5 w-5 text-gray-600" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-base font-semibold leading-tight text-gray-900">Registration Summary</h3>
                              <p className="text-sm text-gray-500">
                                {displayDrafts.length} player{displayDrafts.length !== 1 ? "s" : ""} included
                              </p>
                            </div>
                            {((multiPlayerAllowed || (existingRegistrations && existingRegistrations.length > 0)) && 
                              displayValues.length < (config?.registers?.playerLimit ?? 10)) && (
                              <button
                                type="button"
                                id="add-player-button-summary"
                                onClick={handleAddAnotherPlayer}
                                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50 active:scale-95"
                              >
                                <Plus className="h-3 w-3" />
                                Add Player
                              </button>
                            )}
                          </div>

                          <div className="divide-y divide-slate-100">
                            {displayDrafts.map((entry, index) => {
                              const values = entry.values;
                              const name = `${values.firstName} ${values.lastName}`.trim() || `Player ${index + 1}`;
                              const entryFee = entryFees.find((fee) => fee.id === values.entryFeeId) ?? null;
                              const contribution = parseContribution(values.processingContribution);
                              const totals = computePaymentTotals(entryFee, contribution, paymentSettings);
                              const isDraft = entry.id !== 'edit-draft';

                              return (
                                <div key={entry.id} className="flex items-center justify-between px-6 py-4 transition hover:bg-slate-50/50">
                                  <div className="flex min-w-0 flex-1 items-center gap-4">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700 shadow-sm ring-1 ring-blue-100/50">
                                      {getInitials(values.firstName ?? "", values.lastName ?? "") || (index + 1)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
                                        <span className={cn(
                                          "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                          (registerMutation.isSuccess || groupRegisterMutation.isSuccess)
                                            ? "bg-amber-100 text-amber-700 border border-amber-200"
                                            : "bg-blue-100 text-blue-700 border border-blue-200"
                                        )}>
                                          {(registerMutation.isSuccess || groupRegisterMutation.isSuccess) ? "Pending Approval" : "Ready to Submit"}
                                        </span>
                                      </div>
                                      <p className="flex items-center gap-2 truncate text-xs text-slate-500">
                                        <span className="font-medium text-slate-700">{entryFee?.section || values.sectionChoice || "Section TBA"}</span>
                                        <span className="text-slate-300">|</span>
                                        <span>
                                          {(() => {
                                            const rating = derivePlayerRating(values.ratingProvider, values.uscfRating, values.fideRating, config.details.primaryRatingSystem);
                                            const label = values.ratingProvider === 'fide' ? 'FIDE' : values.ratingProvider === 'uscf' ? 'USCF' : (config.details.primaryRatingSystem === 'fide' ? 'FIDE' : 'USCF');
                                            return rating ? `${label} ${rating}` : "Unrated";
                                          })()}
                                        </span>
                                      </p>
                                    </div>
                                  </div>
                                  <div className="ml-4 flex items-center gap-4">
                                    <div className="text-right">
                                      <span className="block text-sm font-bold text-blue-700">
                                        {formatCurrency(totals.total, totals.currency)}
                                      </span>
                                      {totals.feeAmount > 0 && (
                                        <span className="text-[10px] text-slate-400">Incl. {formatCurrency(totals.feeAmount, totals.currency)} fee</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 border-l border-slate-100 pl-4">
                                      <button
                                        type="button"
                                        onClick={() => isDraft ? handleEditDraft(entry.id) : setCurrentStep(1)}
                                        className="rounded p-1.5 text-slate-400 transition hover:bg-white hover:text-blue-600 hover:shadow-sm"
                                        title="Edit player"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      {isDraft && (
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveDraft(entry.id)}
                                          className="rounded p-1.5 text-slate-400 transition hover:bg-white hover:text-red-600 hover:shadow-sm"
                                          title="Remove player"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4">
                            <span className="text-sm font-medium text-gray-900">Combined registration total</span>
                            <span className="text-lg font-bold text-blue-700">
                              {formatCurrency(
                                displayDrafts.reduce((sum, entry) => {
                                  const fee = entryFees.find((f) => f.id === entry.values.entryFeeId) ?? null;
                                  const contribution = parseContribution(entry.values.processingContribution);
                                  const totals = computePaymentTotals(fee, contribution, paymentSettings);
                                  return sum + totals.total;
                                }, 0),
                                groupPaymentTotals.currency
                              )}
                            </span>
                          </div>
                        </div>
                      )}


                      {canProcessOnline && clientSecret && stripePromise ? (
                        <Elements key={clientSecret} stripe={stripePromise} options={{ clientSecret }}>
                          <StepThree
                            paymentDetails={config?.registers?.paymentDetails}
                            paymentSettings={paymentSettings ?? null}
                            paymentTotals={groupPaymentTotals}
                            playerDrafts={playerDrafts}
                            onEditDraft={handleEditDraft}
                            onRemoveDraft={handleRemoveDraft}
                            selectedEntryFee={selectedEntryFee}
                            sections={sections}
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
                            retryPaymentIntent={ensurePaymentIntent}
                          />
                        </Elements>
                      ) : (
                        <StepThree
                          paymentDetails={config?.registers?.paymentDetails}
                          paymentSettings={paymentSettings ?? null}
                          paymentTotals={groupPaymentTotals}
                          playerDrafts={playerDrafts}
                          onEditDraft={handleEditDraft}
                          onRemoveDraft={handleRemoveDraft}
                          selectedEntryFee={selectedEntryFee}
                          sections={sections}
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
                          retryPaymentIntent={ensurePaymentIntent}
                        />
                      )}
                    </>
                    );
                  })()}
                </div>

                {/* ===== Navigation Footer ===== */}
                <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-4 px-5 py-4">
                    <div className="hidden text-xs text-gray-500 sm:block">
                      <div className="flex items-center gap-3">
                        <span>
                          <span className="font-medium text-gray-700">Step {currentStep}</span> of {totalSteps} · {stepMeta[currentStep - 1]?.title}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-1 items-center justify-end gap-3 sm:flex-initial">
                      {currentStep > 1 && currentStep < 3 && (
                        <button
                          type="button"
                          onClick={handlePrevStep}
                          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 active:scale-95"
                        >
                          <ArrowLeft className="h-4 w-4" />
                          Back
                        </button>
                      )}

                      {/* Removed redundant Add Another Player button from footer */}

                      {!existingRegistration && currentStep < 3 && (
                        <button
                          type="button"
                          onClick={handleSaveDraft}
                          className={cn(
                            "inline-flex h-9 items-center gap-1.5 rounded-md border px-4 text-sm font-medium shadow-sm transition active:scale-95",
                            draftSavedFlash
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                          )}
                        >
                          <Save className="h-3.5 w-3.5" />
                          {draftSavedFlash ? "Saved!" : "Save Draft"}
                        </button>
                      )}

                      {currentStep < 3 ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleNextStep}
                            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-gray-900 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 active:scale-[0.98]"
                          >
                            Continue
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={disableSubmitButton || !paymentAcknowledged}
                          onClick={handleFinalSubmit}
                          className={cn(
                            "inline-flex h-9 items-center gap-1.5 rounded-md px-5 text-sm font-medium text-white shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
                            requiresPayment
                              ? "bg-gray-900 hover:bg-gray-800"
                              : "bg-gray-900 hover:bg-gray-800",
                          )}
                        >
                          {registerMutation.isPending || groupRegisterMutation.isPending ? (
                            <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</>
                          ) : isPaymentBusy ? (
                            <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
                          ) : requiresPayment ? (
                            <><Shield className="h-4 w-4" /> Pay & Submit</>
                          ) : (
                            <><Check className="h-4 w-4" /> Submit Registration</>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-3 text-center text-xs text-gray-500">
                    Registration powered by Kingside · Confirmation sent after director review
                  </div>
                </div>
              </form>
            </FormProvider>
          </div>
        </div>
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
  config,
  players,
  sections,
  entryFees,
}: {
  config: ReturnType<typeof parseTournamentConfig> | null;
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
    () => derivePlayerRating(ratingProvider, uscfRatingValue, fideRatingValue, config?.details.primaryRatingSystem),
    [ratingProvider, uscfRatingValue, fideRatingValue, config?.details.primaryRatingSystem],
  );

  const sectionDetails = useMemo(
    () =>
      sections.map((section) => {
        const options = filterEntryFeesBySection(entryFees, section.name, sections);
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
      const primarySystem = config?.details.primaryRatingSystem || "uscf";
      if (primarySystem === "fide") {
        form.setValue("fideRating", String(player.rating), { shouldDirty: true });
        form.setValue("ratingProvider", "fide", { shouldDirty: true });
      } else {
        form.setValue("uscfRating", String(player.rating), { shouldDirty: true });
        form.setValue("ratingProvider", "uscf", { shouldDirty: true });
      }
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
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white border border-gray-200 shadow-sm">
          <Search className="h-5 w-5 text-gray-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight text-gray-900">Player Lookup</h2>
          <p className="text-sm text-gray-500">Step 1 of 3: Identity & Verification</p>
        </div>
      </div>

      <div className="space-y-8 p-6 sm:p-8">
        <RadioGroup
          value={lookupMode}
          onValueChange={(value) => {
            const newMode = value as RegistrationFormValues["lookupMode"];
            form.setValue("lookupMode", newMode, { shouldDirty: true });

            // If switching to manual, ensure fields are cleared so search results don't ghost
            if (newMode === "manual") {
              form.setValue("firstName", "", { shouldDirty: true });
              form.setValue("lastName", "", { shouldDirty: true });
              setSearchTerm("");
            }
          }}
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
                placeholder="Type name or ID (Min 3 chars)..."
                autoComplete="off"
                className="h-11 pl-10 pr-10 focus-visible:ring-blue-500/30"
              />
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>

            {isSearching ? (
              <div className="my-2 flex flex-col items-center justify-center gap-3 py-8 rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
                <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                <span className="text-sm font-medium text-slate-500">Searching USCF & FIDE databases...</span>
              </div>
            ) : (
              <>
                {searchTerm.trim().length < 3 ? (
                  <p className="text-xs text-slate-500">Enter at least three characters to search both databases.</p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Showing the best matches from the official USCF and FIDE player directories.
                  </p>
                )}
                {searchError && <p className="text-xs text-red-500">{searchError}</p>}
              </>
            )}

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
                          className="group w-full rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:bg-gray-50"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 font-medium text-gray-500 transition group-hover:text-gray-900">
                                {result.source === 'uscf' ? 'US' : 'FI'}
                              </div>
                              <div className="space-y-0.5">
                                <p className="text-sm font-semibold text-gray-900">{result.name}</p>
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                                  <span className="font-medium text-gray-600">{result.source.toUpperCase()} · #{result.id}</span>
                                  {result.location && <span className="text-gray-300">|</span>}
                                  {result.location && <span>{result.location}</span>}
                                </div>
                              </div>
                            </div>
                            <div className="bg-gray-900 text-white rounded px-2.5 py-1 text-xs font-medium">
                              {result.ratingDisplay ?? result.rating ?? "No Rating"}
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
                          className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:bg-gray-50"
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

        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Player identity</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="First name" name="firstName" required />
            <Field label="Last name" name="lastName" required />
            <Field label="USCF ID" name="uscfId" />
            <Field label="FIDE ID" name="fideId" />
            {config?.details.primaryRatingSystem === "fide" ? (
              <>
                <Field label="FIDE rating (Primary)" name="fideRating" />
                <Field label="USCF rating" name="uscfRating" />
              </>
            ) : (
              <>
                <Field label="USCF rating (Primary)" name="uscfRating" />
                <Field label="FIDE rating" name="fideRating" />
              </>
            )}
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Contact information</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Email" name="email" required valueAs="email" />

          </div>
        </div>

        <div className="space-y-3 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Section &amp; rating</p>
          <div className="grid gap-5 sm:grid-cols-2">
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
                              {" · "}
                              {config?.details.primaryRatingSystem === "fide" ? "FIDE" : "USCF"} Rating:{" "}
                              {section.ratingMin ?? "Unrated"} – {section.ratingMax ?? "Open"}
                            </span>
                          )}
                          {showEligibilityWarning && numericRating !== null && (
                            <span className="text-[11px] text-blue-600">
                              Not eligible with {config?.details.primaryRatingSystem === "fide" ? "FIDE" : "USCF"} rating {numericRating}.
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
        </div>
      </div>
    </div>
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
    () => derivePlayerRating(ratingProvider, uscfRatingValue, fideRatingValue, config?.details.primaryRatingSystem),
    [fideRatingValue, ratingProvider, uscfRatingValue, config?.details.primaryRatingSystem],
  );

  const sectionDetails = useMemo(
    () =>
      sections.map((section) => {
        const options = filterEntryFeesBySection(entryFees, section.name, sections);
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

  const selectedSectionOption = useMemo(() => {
    if (!selectedSection) return undefined;
    const normalized = selectedSection.trim().toLowerCase();
    return sections.find((section) => section.name.trim().toLowerCase() === normalized);
  }, [selectedSection, sections]);

  const entryFeeOptions = useMemo(
    () => filterEntryFeesBySection(entryFees, selectedSection, sections),
    [entryFees, selectedSection, sections],
  );
  const contributionAllowed = paymentSettings?.allowProcessingContribution !== false;
  useEffect(() => {
    if (!contributionAllowed) {
      form.setValue("processingContribution", "0", { shouldDirty: false, shouldValidate: true });
    }
  }, [contributionAllowed, form]);

  const recommendedEntryFee = useMemo(
    () => findRecommendedEntryFee(entryFeeOptions, numericRating, sections, selectedSectionOption),
    [entryFeeOptions, numericRating, sections, selectedSectionOption],
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
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white border border-gray-200 shadow-sm">
          <Trophy className="h-5 w-5 text-gray-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight text-gray-900">Tournament Options</h2>
          <p className="text-sm text-gray-500">Step 2 of 3: Section & Preferences</p>
        </div>
      </div>

      <div className="space-y-8 p-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label className="text-sm font-bold text-slate-900 tracking-tight">Entry fee type</Label>
              <p className="text-xs font-medium text-slate-500">Pick the pricing tier for your section.</p>
            </div>
            <Badge variant="outline" className="w-fit border-blue-200 bg-blue-50/70 text-blue-800 font-bold px-3 py-1">
              {numericRating !== null ? `Live Rating: ${numericRating}` : "Status: Unrated"}
            </Badge>
          </div>
          {entryFees.length === 0 ? (
            <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-700">
              Entry fees will be confirmed by the tournament director. Continue to acknowledge payment on the next step.
            </div>
          ) : entryFeeOptions.length === 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
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
                  const eligible = ratingWithinEntryFee(numericRating, fee, sections, selectedSectionOption);
                  const isRecommended = recommendedEntryFee?.id === fee.id;
                  const isSelected = selectedEntryFeeId === fee.id;
                  const effectiveAfterLabel = fee.effectiveAfter
                    ? `Effective after ${formatDate(fee.effectiveAfter)}`
                    : "Effective immediately";
                  return (
                    <label
                      key={fee.id}
                      htmlFor={`entry-fee-${fee.id}`}
                      className={cn(
                        "relative flex cursor-pointer flex-col gap-2 rounded-xl border p-5 transition-all shadow-sm ring-1 ring-inset ring-transparent",
                        isSelected
                          ? "border-blue-400 bg-blue-50/80 ring-blue-400/20 shadow-md"
                          : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/30",
                      )}
                    >
                      <RadioGroupItem id={`entry-fee-${fee.id}`} value={fee.id} className="sr-only" />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">{fee.section}</span>
                        <span className="text-sm font-semibold text-slate-900">
                          {formatCurrency(fee.amount, fee.currency)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{formatEntryFeeRange(fee, sections, selectedSectionOption)}</p>
                      <p className="text-[11px] text-slate-400">{effectiveAfterLabel}</p>
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
                              : "border-blue-200 bg-blue-50/70 text-blue-700",
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
                <SelectItem value="none">No notifications</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start gap-4 rounded-xl border border-slate-200 bg-slate-50/50 p-5 transition-all group hover:bg-white hover:shadow-md hover:border-blue-200">
            <input
              id="newsletter"
              type="checkbox"
              className="mt-1 h-4 w-4 rounded-md border-slate-300 text-blue-600 focus:ring-blue-500"
              checked={form.watch("newsletter") ?? false}
              onChange={(event) => form.setValue("newsletter", event.target.checked)}
            />
            <div className="space-y-1">
              <Label htmlFor="newsletter" className="text-sm font-bold text-slate-900 cursor-pointer">
                Receive Tournament Bulletins
              </Label>
              <p className="text-xs leading-relaxed text-slate-500">
                Register for the official newsletter to receive pairing alerts, result updates, and future event invitations.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expected arrival notes" name="arrivalTime" placeholder="e.g., Arriving Saturday 9AM" />
        </div>

        {(config?.format !== "arena" && config?.format !== "knockout") && (
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
                          "flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-medium transition-all shadow-sm",
                          checked
                            ? "border-blue-400 bg-blue-500 text-white shadow-blue-200"
                            : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50",
                        )}
                      >
                        <span>{label}</span>
                        {checked && <Check className="h-4 w-4" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <Label className="text-sm font-medium text-slate-700">Notes to tournament director</Label>
          <Textarea
            className="mt-2"
            rows={4}
            placeholder="Share any additional information, such as companions, accessibility needs, or late arrival details."
            {...form.register("notes")}
          />
        </div>
      </div>
    </div>
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
  sections: SectionOption[];
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
  retryPaymentIntent: () => void;
  playerDrafts?: Array<{ id: string; values: Partial<RegistrationFormValues> }>;
  onEditDraft?: (id: string) => void;
  onRemoveDraft?: (id: string) => void;
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
  sections,
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
  retryPaymentIntent,
  playerDrafts = [],
  onEditDraft,
  onRemoveDraft,
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
  const sectionChoiceOption = useMemo(() => {
    if (!sectionChoice) return undefined;
    const normalized = sectionChoice.trim().toLowerCase();
    return sections.find((section) => section.name.trim().toLowerCase() === normalized);
  }, [sectionChoice, sections]);
  const email = form.watch("email");

  const arrivalTime = form.watch("arrivalTime");
  const notes = form.watch("notes");

  const offlineMethods = paymentSettings?.acceptedOfflineMethods ?? [];
  const offlineAllowed = offlineMethods.length > 0;
  const showPaymentToggle = canAcceptOnlinePayment && offlineAllowed && requiresPayment;
  const [activePaymentMode, setActivePaymentMode] = useState<"online" | "offline">(
    canAcceptOnlinePayment ? "online" : "offline"
  );
  const offlineInstructions = paymentSettings?.offlineInstructions;
  const offlineInfoBlocks = ((offlineAllowed || !requiresPayment) ? [offlineInstructions, paymentDetails] : []) as Array<
    string | null | undefined
  >;
  const isOfflineEntry = entryFeeId === NO_ENTRY_FEE_ID || !selectedEntryFee;

  const statusStyles: Record<PaymentStatusKey, string> = {
    unpaid: "bg-slate-100 text-slate-700",
    processing: "bg-blue-100 text-blue-700",
    paid: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
    refunded: "bg-slate-100 text-slate-600 border border-slate-200",
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

  // Individual player summary grid removed to avoid double section/summary
  // We rely on the Registration Summary list rendered by the parent for roster details.
  const summary: any[] = [];

  useEffect(() => {
    if (!canAcceptOnlinePayment) {
      onPaymentElementReady(true);
    }
  }, [canAcceptOnlinePayment, onPaymentElementReady]);

  const handlePaymentConfirmation = useCallback(async () => {
    if (!requiresPayment) {
      return true;
    }
    if (activePaymentMode === "offline" || !canAcceptOnlinePayment) {
      form.setValue("paymentStatus", "unpaid", { shouldDirty: true, shouldValidate: true });
      form.setValue("paymentMethod", "offline", { shouldDirty: true, shouldValidate: true });
      form.setValue("amountDue", paymentTotals.total, { shouldDirty: false });
      form.setValue("currency", paymentTotals.currency, { shouldDirty: false });
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
          ? `${window.location.origin}/tournaments/${tournamentId}/register?payment=complete`
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

    tournamentId,
  ]);

  useEffect(() => {
    registerPaymentHandler(handlePaymentConfirmation);
    return () => registerPaymentHandler(null);
  }, [registerPaymentHandler, handlePaymentConfirmation]);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white border border-gray-200 shadow-sm">
          <Wallet className="h-5 w-5 text-gray-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight text-gray-900">Payment &amp; Review</h2>
          <p className="text-sm text-gray-500">
            Step 3 of 3: {requiresPayment ? "Complete registration with secure checkout" : "Confirm and submit your registration"}
          </p>
        </div>
      </div>

      <div className="space-y-6 p-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Payment summary</h3>
            <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", statusStyles[paymentStatus])}>
              {statusLabels[paymentStatus]}
            </span>
          </div>
          <div className="mt-3 space-y-3 text-sm text-slate-600">
            <div className="flex items-center justify-between font-medium">
              <span>{playerDrafts.length > 1 ? `Subtotal (${playerDrafts.length} players)` : "Entry fee"}</span>
              <span className="text-blue-700">
                {formatCurrency(paymentTotals.subtotal, paymentTotals.currency)}
              </span>
            </div>
            {playerDrafts.length <= 1 && selectedEntryFee && (
              <p className="text-xs text-slate-500">
                Section: {selectedEntryFee.section}
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
            <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-semibold text-blue-700">
              <span>Total due</span>
              <span>{formatCurrency(paymentTotals.total, paymentTotals.currency)}</span>
            </div>
            {paymentMethod && <p className="text-xs text-slate-500">Payment method: {paymentMethod.toUpperCase()}</p>}
          </div>
        </div>

        {showPaymentToggle && (
          <div className="flex bg-gray-100/80 p-1.5 rounded-lg">
            <button
              type="button"
              onClick={() => setActivePaymentMode("online")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all",
                activePaymentMode === "online"
                  ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                  : "text-gray-600 hover:text-gray-900",
              )}
            >
              <CreditCard className="h-4 w-4" />
              Pay Online
            </button>
            <button
              type="button"
              onClick={() => setActivePaymentMode("offline")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all",
                activePaymentMode === "offline"
                  ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                  : "text-gray-600 hover:text-gray-900",
              )}
            >
              <Wallet className="h-4 w-4" />
              Pay Later (Offline)
            </button>
          </div>
        )}

        {(activePaymentMode === "online" || !offlineAllowed) && (
          <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Payment method</h3>
              {requiresPayment && <Badge variant="outline">Required</Badge>}
            </div>
            {canAcceptOnlinePayment ? (
              <div className="space-y-3">
                {paymentIntentLoading ? (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Preparing secure checkout...
                  </div>
                ) : (
                  <div className="rounded-lg border border-blue-200 bg-white p-4">
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
                {paymentIntentError ? (
                  <>
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-600">
                      <AlertCircle className="mt-0.5 h-4 w-4" />
                      <span>{paymentIntentError}</span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={retryPaymentIntent}
                      disabled={paymentIntentLoading}
                    >
                      Retry payment setup
                    </Button>
                  </>
                ) : requiresPayment ? (
                  <p className="font-medium text-slate-700">
                    Stripe checkout is unavailable right now. Please contact the tournament director to arrange payment.
                  </p>
                ) : (
                  <p>Online checkout is disabled. Follow the offline instructions below to complete payment.</p>
                )}
              </div>
            )}
          </div>
        )}

        {(activePaymentMode === "offline" || !canAcceptOnlinePayment) && (
          <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Offline payment options</h3>
              {!canAcceptOnlinePayment && <Badge variant="secondary">Alternative</Badge>}
            </div>
            {offlineAllowed ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {offlineMethods.map((method) => (
                    <span key={method} className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                      {OFFLINE_METHOD_LABELS[method] ?? method}
                    </span>
                  ))}
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs leading-5 text-amber-800">
                  <div className="flex items-center gap-2 mb-1.5 font-bold uppercase tracking-tight">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Important: PENDING REGISTRATION
                  </div>
                  If choosing an offline method, your registration will remain in a <strong>Pending</strong> status and isn't guaranteed until payment is finalized with the director.
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-red-200 bg-red-50 p-3 text-xs text-red-600 font-medium">
                Offline payments are strictly disabled. Online checkout is required to secure your spot.
              </div>
            )}
            {offlineInfoBlocks
              .filter((block): block is string => Boolean(block && block.trim()))
              .map((block, index) => (
                <div
                  key={`${index}-${block.slice(0, 12)}`}
                  className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-xs leading-5 text-blue-700"
                >
                  {block}
                </div>
              ))}
          </div>
        )}

        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
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
              className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500"
            />
            <span>{acknowledgementLabel}</span>
          </label>
          {acknowledgementError && <p className="text-xs text-red-500">{acknowledgementError}</p>}
        </div>


      </div>
    </div>
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
        "flex flex-1 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4 transition hover:border-blue-300",
        current === value && "border-blue-500 bg-blue-50",
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
    <div className="group space-y-2">
      <Label className="text-sm font-medium text-slate-700 transition-colors group-focus-within:text-blue-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </Label>
      <Input
        placeholder={placeholder}
        type={valueAs === "email" ? "email" : "text"}
        {...form.register(name)}
        className="focus:border-blue-400 focus:ring-blue-200"
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
    values.notes && `Notes:${truncate(values.notes, 18)}`,
  ].filter(Boolean);

  return segments.join(" | ").slice(0, 90);
}

function derivePlayerRating(
  provider: RegistrationFormValues["ratingProvider"] | undefined,
  uscfRatingValue: string | undefined,
  fideRatingValue: string | undefined,
  primarySystem: "uscf" | "fide" = "uscf",
): number | null {
  const parsedUscf = Number.parseInt(uscfRatingValue ?? "", 10);
  const parsedFide = Number.parseInt(fideRatingValue ?? "", 10);

  if (provider === "uscf" || provider === "manual") {
    return Number.isFinite(parsedUscf) ? parsedUscf : null;
  }
  if (provider === "fide") {
    return Number.isFinite(parsedFide) ? parsedFide : null;
  }
  
  // Fallback when provider is "none" or undefined
  if (primarySystem === "fide") {
    if (Number.isFinite(parsedFide)) return parsedFide;
    if (Number.isFinite(parsedUscf)) return parsedUscf;
  } else {
    // Default to USCF
    if (Number.isFinite(parsedUscf)) return parsedUscf;
    if (Number.isFinite(parsedFide)) return parsedFide;
  }
  return null;
}

function filterEntryFeesBySection(
  entryFees: EntryFeeRule[],
  sectionName: string | undefined,
  sections: SectionOption[],
): EntryFeeRule[] {
  if (!sectionName) return [];
  const normalized = sectionName.trim().toLowerCase();
  const targetSection = sections.find((section) => section.name.trim().toLowerCase() === normalized);
  const relevantFees = entryFees.filter((fee) => {
    if (fee.sectionId) {
      const linked = sections.find((section) => section.id === fee.sectionId);
      if (linked && linked.name.trim().toLowerCase() === normalized) {
        return true;
      }
    }
    return (fee.section ?? "").trim().toLowerCase() === normalized;
  });

  if (relevantFees.length === 0) {
    return [];
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();

  const groups = new Map<string, EntryFeeRule[]>();
  relevantFees.forEach((fee) => {
    const linkedSection = findSectionForFee(fee, sections) ?? targetSection;
    const bounds = resolveEntryFeeBounds(fee, linkedSection);
    const key = `${bounds.ratingMin ?? "null"}|${bounds.ratingMax ?? "null"}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(fee);
    } else {
      groups.set(key, [fee]);
    }
  });

  const resolved: EntryFeeRule[] = [];
  groups.forEach((feesInGroup) => {
    const activeNow = feesInGroup
      .filter((fee) => effectiveDateTimestamp(fee.effectiveAfter) <= todayTs)
      .sort((a, b) => effectiveDateTimestamp(b.effectiveAfter) - effectiveDateTimestamp(a.effectiveAfter));
    if (activeNow.length > 0) {
      resolved.push(activeNow[0]);
      return;
    }
    const upcoming = feesInGroup
      .slice()
      .sort((a, b) => effectiveDateTimestamp(a.effectiveAfter) - effectiveDateTimestamp(b.effectiveAfter));
    if (upcoming.length > 0) {
      resolved.push(upcoming[0]);
    }
  });

  resolved.sort((a, b) => compareEntryFeeRange(a, b, sections, targetSection));
  return resolved;
}

function effectiveDateTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return Number.NEGATIVE_INFINITY;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed.getTime();
}

function compareEntryFeeRange(
  a: EntryFeeRule,
  b: EntryFeeRule,
  sections: SectionOption[],
  fallback: SectionOption | undefined,
): number {
  const aSection = findSectionForFee(a, sections) ?? fallback;
  const bSection = findSectionForFee(b, sections) ?? fallback;
  const aBounds = resolveEntryFeeBounds(a, aSection);
  const bBounds = resolveEntryFeeBounds(b, bSection);
  const minCompare = compareNullableNumbers(aBounds.ratingMin, bBounds.ratingMin);
  if (minCompare !== 0) return minCompare;
  const maxCompare = compareNullableNumbers(aBounds.ratingMax, bBounds.ratingMax);
  if (maxCompare !== 0) return maxCompare;
  return a.amount - b.amount;
}

function compareNullableNumbers(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a - b;
}

function findRecommendedEntryFee(
  options: EntryFeeRule[],
  rating: number | null,
  sections: SectionOption[],
  section: SectionOption | undefined,
): EntryFeeRule | undefined {
  if (options.length === 0) return undefined;
  if (rating === null) return options[0];
  return options.find((fee) => ratingWithinEntryFee(rating, fee, sections, section)) ?? options[0];
}

function ratingWithinEntryFee(
  rating: number | null,
  fee: EntryFeeRule,
  sections: SectionOption[],
  fallback: SectionOption | undefined,
): boolean {
  if (rating === null) return false;
  const linkedSection = findSectionForFee(fee, sections) ?? fallback;
  const bounds = resolveEntryFeeBounds(fee, linkedSection);
  if (bounds.ratingMin !== null && rating < bounds.ratingMin) return false;
  if (bounds.ratingMax !== null && rating > bounds.ratingMax) return false;
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

function formatEntryFeeRange(
  fee: EntryFeeRule,
  sections: SectionOption[],
  fallback?: SectionOption,
): string {
  const linkedSection = findSectionForFee(fee, sections) ?? fallback;
  const { ratingMin, ratingMax } = resolveEntryFeeBounds(fee, linkedSection);
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

function findSectionForFee(fee: EntryFeeRule, sections: SectionOption[]): SectionOption | undefined {
  if (fee.sectionId) {
    const byId = sections.find((section) => section.id === fee.sectionId);
    if (byId) {
      return byId;
    }
  }
  const normalized = (fee.section ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  return sections.find((section) => section.name.trim().toLowerCase() === normalized);
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
