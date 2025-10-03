import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Tournament, PlayerRegistration } from "@shared/schema";

const registrationSchema = z.object({
  playerName: z.string().optional(),
  uscfRating: z.number().min(100).max(3000).optional(),
  phoneNumber: z.string().optional(),
  email: z.string().email().optional(),
  arrivalTime: z.string().optional(),
});

interface PlayerRegistrationProps {
  tournament: Tournament;
  existingRegistration?: PlayerRegistration;
}

export default function PlayerRegistration({ tournament, existingRegistration }: PlayerRegistrationProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<z.infer<typeof registrationSchema>>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      playerName: "",
      uscfRating: undefined,
      phoneNumber: "",
      email: "",
      arrivalTime: "",
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (values: z.infer<typeof registrationSchema>) => {
      return apiRequest(`/api/tournaments/${tournament.id}/register`, {
        method: "POST",
        body: JSON.stringify(values),
      });
    },
    onSuccess: () => {
      toast({
        title: "Registration Submitted",
        description: "Your tournament registration has been submitted for approval.",
      });
      setIsDialogOpen(false);
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/my-registrations"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Registration Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: z.infer<typeof registrationSchema>) => {
    registerMutation.mutate(values);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Pending Approval
          </Badge>
        );
      case "approved":
        return (
          <Badge variant="default" className="flex items-center gap-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            <CheckCircle className="h-3 w-3" />
            Approved
          </Badge>
        );
      case "declined":
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            Declined
          </Badge>
        );
      default:
        return null;
    }
  };

  // Show existing registration status
  if (existingRegistration) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Registration Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Status:</span>
              {getStatusBadge(existingRegistration.status)}
            </div>
            
            {existingRegistration.playerName && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Player Name:</span>
                <span className="text-sm">{existingRegistration.playerName}</span>
              </div>
            )}
            
            {existingRegistration.uscfRating && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">USCF Rating:</span>
                <span className="text-sm">{existingRegistration.uscfRating}</span>
              </div>
            )}
            
            {existingRegistration.phoneNumber && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Phone:</span>
                <span className="text-sm">{existingRegistration.phoneNumber}</span>
              </div>
            )}
            
            {existingRegistration.email && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Email:</span>
                <span className="text-sm">{existingRegistration.email}</span>
              </div>
            )}
            
            {existingRegistration.arrivalTime && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Arrival Time:</span>
                <span className="text-sm">{existingRegistration.arrivalTime}</span>
              </div>
            )}
            
            <div className="text-xs text-muted-foreground">
              Registered on {existingRegistration.createdAt ? new Date(existingRegistration.createdAt).toLocaleDateString() : "Unknown"}
            </div>
            
            {existingRegistration.status === "pending" && (
              <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                <div className="text-sm text-yellow-800 dark:text-yellow-200">
                  Your registration is waiting for tournament director approval.
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button className="w-full">
          <UserPlus className="h-4 w-4 mr-2" />
          Register for Tournament
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Register for {tournament.name}</DialogTitle>
          <DialogDescription>
            Fill out the form below to register for this tournament. All fields are optional.
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="playerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Player Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter your preferred name" {...field} />
                  </FormControl>
                  <FormDescription>
                    Leave blank to use your account name
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="uscfRating"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>USCF Rating</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="1200"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                    />
                  </FormControl>
                  <FormDescription>
                    Your current USCF rating (optional)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phoneNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone Number</FormLabel>
                  <FormControl>
                    <Input placeholder="(555) 123-4567" {...field} />
                  </FormControl>
                  <FormDescription>
                    For tournament updates and emergencies
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="your@email.com" {...field} />
                  </FormControl>
                  <FormDescription>
                    Leave blank to use your account email
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="arrivalTime"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Expected Arrival Time</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., 9:00 AM, Running 15 minutes late" {...field} />
                  </FormControl>
                  <FormDescription>
                    Let the TD know if you're running late
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={registerMutation.isPending}>
                {registerMutation.isPending ? "Submitting..." : "Submit Registration"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}