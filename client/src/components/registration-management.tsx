import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { UserCheck, UserX, Clock, CheckCircle, XCircle, Phone, Mail, Timer, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { PlayerRegistration } from "@shared/schema";

interface RegistrationManagementProps {
  tournamentId: number;
}

export default function RegistrationManagement({ tournamentId }: RegistrationManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: registrations = [], isLoading, error } = useQuery<PlayerRegistration[]>({
    queryKey: [`/api/tournaments/${tournamentId}/registrations`],
    retry: false,
  });

  const updateRegistrationMutation = useMutation({
    mutationFn: async ({ registrationId, status }: { registrationId: number; status: string }) => {
      return apiRequest(`/api/tournaments/${tournamentId}/registrations/${registrationId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: (_, { status }) => {
      toast({
        title: "Registration Updated",
        description: `Registration has been ${status}.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tournaments', tournamentId, 'registrations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tournaments', tournamentId, 'players'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Pending
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

  const handleApprove = (registrationId: number) => {
    updateRegistrationMutation.mutate({ registrationId, status: "approved" });
  };

  const handleDecline = (registrationId: number) => {
    updateRegistrationMutation.mutate({ registrationId, status: "declined" });
  };

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Player Registrations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-600">Unable to load registrations.</p>
            <p className="text-sm text-gray-500 mt-2">This feature requires tournament director permissions.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Player Registrations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const pendingRegistrations = Array.isArray(registrations) ? registrations.filter((reg: PlayerRegistration) => reg.status === "pending") : [];
  const processedRegistrations = Array.isArray(registrations) ? registrations.filter((reg: PlayerRegistration) => reg.status !== "pending") : [];

  return (
    <div className="space-y-6">
      {/* Pending Registrations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Pending Registrations ({pendingRegistrations.length})
          </CardTitle>
          <CardDescription>
            Review and approve/decline player registrations for your tournament.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingRegistrations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <UserCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No pending registrations.</p>
              <p className="text-sm">New registrations will appear here for approval.</p>
            </div>
          ) : (
            <ScrollArea className="h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player Details</TableHead>
                    <TableHead>Contact Info</TableHead>
                    <TableHead>Tournament Info</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRegistrations.map((registration: PlayerRegistration) => (
                    <TableRow key={registration.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">
                            {registration.playerName || "No name provided"}
                          </div>
                          {registration.uscfRating && (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Star className="h-3 w-3" />
                              USCF: {registration.uscfRating}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {registration.phoneNumber && (
                            <div className="flex items-center gap-1 text-sm">
                              <Phone className="h-3 w-3" />
                              {registration.phoneNumber}
                            </div>
                          )}
                          {registration.email && (
                            <div className="flex items-center gap-1 text-sm">
                              <Mail className="h-3 w-3" />
                              {registration.email}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {registration.arrivalTime && (
                            <div className="flex items-center gap-1 text-sm">
                              <Timer className="h-3 w-3" />
                              {registration.arrivalTime}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground">
                            Registered: {registration.createdAt ? new Date(registration.createdAt).toLocaleDateString() : 'N/A'}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="default">
                                <UserCheck className="h-3 w-3 mr-1" />
                                Approve
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Approve Registration</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will approve the registration and add the player to your tournament. 
                                  They will be included in pairings when the tournament starts.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleApprove(registration.id)}>
                                  Approve Player
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="destructive">
                                <UserX className="h-3 w-3 mr-1" />
                                Decline
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Decline Registration</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will decline the registration. The player will not be added to your tournament.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction 
                                  onClick={() => handleDecline(registration.id)}
                                  className="bg-red-600 hover:bg-red-700"
                                >
                                  Decline Registration
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Processed Registrations */}
      {processedRegistrations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Processed Registrations ({processedRegistrations.length})</CardTitle>
            <CardDescription>
              Previously approved or declined registrations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player Details</TableHead>
                    <TableHead>Contact Info</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processedRegistrations.map((registration: PlayerRegistration) => (
                    <TableRow key={registration.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">
                            {registration.playerName || "No name provided"}
                          </div>
                          {registration.uscfRating && (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Star className="h-3 w-3" />
                              USCF: {registration.uscfRating}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {registration.phoneNumber && (
                            <div className="flex items-center gap-1 text-sm">
                              <Phone className="h-3 w-3" />
                              {registration.phoneNumber}
                            </div>
                          )}
                          {registration.email && (
                            <div className="flex items-center gap-1 text-sm">
                              <Mail className="h-3 w-3" />
                              {registration.email}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(registration.status)}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-muted-foreground">
                          {registration.updatedAt ? new Date(registration.updatedAt).toLocaleDateString() : 'N/A'}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}