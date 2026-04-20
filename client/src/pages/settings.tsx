import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { LogOut, Trash2, ArrowLeft, SlidersHorizontal, User2, Mail, Smartphone, Bell, Trophy, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { requestFirebaseToken } from "@/lib/firebase";


export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber ?? "");
  const [notifyEmail, setNotifyEmail] = useState<boolean>(user?.notifyEmail ?? true);
  const [notifyPairings, setNotifyPairings] = useState<boolean>(user?.notifyPairings ?? true);
  const [notifyRegistration, setNotifyRegistration] = useState<boolean>(user?.notifyRegistration ?? true);
  const [notifyTournamentStatus, setNotifyTournamentStatus] = useState<boolean>(user?.notifyTournamentStatus ?? true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    setPhoneNumber(user?.phoneNumber ?? "");
    setNotifyEmail(user?.notifyEmail ?? true);
    setNotifyPairings(user?.notifyPairings ?? true);
    setNotifyRegistration(user?.notifyRegistration ?? true);
    setNotifyTournamentStatus(user?.notifyTournamentStatus ?? true);
  }, [user]);


  const logoutMutation = useMutation({
    mutationFn: async () => {
      await logout();
    },
    onSuccess: () => {
      toast({ title: "Signed out" });
      setLocation("/");
    },
    onError: (error: any) => {
      toast({
        title: "Logout failed",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("/api/auth/account", { method: "DELETE" });
    },
    onSuccess: async () => {
      await logout();
      toast({ title: "Account deleted" });
      setLocation("/");
    },
    onError: (error: any) => {
      toast({
        title: "Delete account failed",
        description: error?.message ?? "Unable to remove account.",
        variant: "destructive",
      });
    },
  });

  const updatePreferencesMutation = useMutation({
    mutationFn: async () => {
      const body = {
        phoneNumber: phoneNumber || null,
        notifyEmail,
        notifyPairings,
        notifyRegistration,
        notifyTournamentStatus,
      };
      return apiRequest("/api/auth/preferences", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (updatedUser: any) => {
      toast({ title: "Preferences saved" });
      queryClient.setQueryData(["/api/auth/me"], updatedUser);
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error?.message ?? "Unable to save preferences.",
        variant: "destructive",
      });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
    },
    onSuccess: () => {
      toast({ title: "Password updated" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error: any) => {
      toast({
        title: "Change failed",
        description: error?.message ?? "Unable to update password.",
        variant: "destructive",
      });
    },
  });

  const registerPushTokenMutation = useMutation({
    mutationFn: async (fcmToken: string) => {
      return apiRequest("/api/users/fcm-token", {
        method: "POST",
        body: JSON.stringify({ fcmToken }),
      });
    },
    onSuccess: () => {
      toast({ 
        title: "Push notifications enabled",
        description: "You will now receive real-time alerts on this device."
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to enable push",
        description: error?.message ?? "Please try again later.",
        variant: "destructive",
      });
    },
  });

  const handleEnablePush = async () => {
    if (registerPushTokenMutation.isPending) return;

    try {
      const token = await requestFirebaseToken();
      if (token) {
        registerPushTokenMutation.mutate(token);
      } else {
        toast({
          title: "Setup incomplete",
          description: "Your browser reported that notifications are not supported or setup failed. Please check if you are in an Incognito window.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      console.error("Error requesting push token:", err);
      
      let errorMessage = "An unexpected error occurred while setting up push notifications.";
      
      if (err?.message?.includes('messaging/permission-blocked')) {
        errorMessage = "Notifications are blocked. Please click the lock icon in your address bar and set Notifications to 'Allow'.";
      } else if (err?.message?.includes('messaging/invalid-vapid-key')) {
        errorMessage = "A configuration error occurred (Invalid VAPID Key). Please contact the administrator.";
      } else if (err?.message) {
        errorMessage = err.message;
      }

      toast({
        title: "Push Setup Failed",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleChangePassword = () => {
    if (changePasswordMutation.isPending) return;

    if (!currentPassword || !newPassword) {
      toast({
        title: "Missing information",
        description: "Enter both your current and new password.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Confirm password must match the new password.",
        variant: "destructive",
      });
      return;
    }

    changePasswordMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10">
      <div className="max-w-4xl mx-auto px-4 space-y-6">


        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground mb-2"
          onClick={() => setLocation("/")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Button>

        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Manage your account details, preferences, and security options.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <User2 className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Profile</CardTitle>
              <p className="text-sm text-muted-foreground">Your basic account information.</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="font-medium">Username</span>
              <span>{user?.username}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Name</span>
              <span>{user ? `${user.firstName} ${user.lastName}` : ""}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Email</span>
              <span>{user?.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Role</span>
              <span>{user?.role}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <SlidersHorizontal className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Notifications</CardTitle>
              <p className="text-sm text-muted-foreground">
                Control how and when you want to be notified.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">How should we reach you?</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/5">
                  <div className="flex flex-row items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-full">
                      <Mail className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <Label className="text-sm font-bold">Email Alerts</Label>
                      <p className="text-xs text-muted-foreground">Pairings, official receipts, and results.</p>
                    </div>
                  </div>
                  <Switch checked={notifyEmail} onCheckedChange={setNotifyEmail} />
                </div>
                
                <div className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/5">
                  <div className="flex flex-row items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-full">
                      <Smartphone className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <Label className="text-sm font-bold">Push Notifications</Label>
                      <p className="text-xs text-muted-foreground">Real-time alerts on this device.</p>
                    </div>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8 text-xs"
                    onClick={handleEnablePush}
                    disabled={registerPushTokenMutation.isPending || !!user?.fcmToken}
                  >
                    {registerPushTokenMutation.isPending ? "Connecting..." : user?.fcmToken ? "Enabled" : "Enable"}
                  </Button>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">What do you want to hear about?</h3>
              <div className="grid gap-4 md:grid-cols-1">
                <div className="flex items-center justify-between p-2">
                  <div className="flex flex-row items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg">
                      <Users className="h-4 w-4 text-blue-500" />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Registrations & Status</Label>
                      <p className="text-xs text-muted-foreground">Get notified when you register or when a director approves your entry.</p>
                    </div>
                  </div>
                  <Switch checked={notifyRegistration} onCheckedChange={setNotifyRegistration} />
                </div>

                <div className="flex items-center justify-between p-2">
                  <div className="flex flex-row items-center gap-3">
                    <div className="p-2 bg-orange-500/10 rounded-lg">
                      <Trophy className="h-4 w-4 text-orange-500" />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Match Pairings & Round Results</Label>
                      <p className="text-xs text-muted-foreground">Get notified immediately when your next match is ready.</p>
                    </div>
                  </div>
                  <Switch checked={notifyPairings} onCheckedChange={setNotifyPairings} />
                </div>

                <div className="flex items-center justify-between p-2">
                  <div className="flex flex-row items-center gap-3">
                    <div className="p-2 bg-purple-500/10 rounded-lg">
                      <Bell className="h-4 w-4 text-purple-500" />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Tournament Announcements</Label>
                      <p className="text-xs text-muted-foreground">General updates, start times, and important organizer messages.</p>
                    </div>
                  </div>
                  <Switch checked={notifyTournamentStatus} onCheckedChange={setNotifyTournamentStatus} />
                </div>
              </div>
            </div>

            <div className="pt-4 space-y-4">
              <Separator />
              <div className="space-y-2">
                <Label className="text-sm font-medium">Mobile number (Internal)</Label>
                <div className="flex gap-2">
                  <Input
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(event.target.value)}
                    placeholder="Enter your mobile number for director contact"
                    className="max-w-md"
                  />
                  <Button
                    onClick={() => updatePreferencesMutation.mutate()}
                    disabled={updatePreferencesMutation.isPending}
                  >
                    {updatePreferencesMutation.isPending ? "Saving..." : "Save Preferences"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Only visible to tournament directors for urgent contact.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <p className="text-sm text-muted-foreground">
              Update your credentials to keep your account secure.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="Enter current password"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="Enter new password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Re-enter new password"
                />
              </div>
            </div>
            <Button
              onClick={handleChangePassword}
              className="w-full md:w-auto"
              disabled={changePasswordMutation.isPending}
            >
              {changePasswordMutation.isPending ? "Updating..." : "Update password"}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-red-200 dark:border-red-900">
          <CardHeader className="flex flex-row items-center gap-3">
            <Trash2 className="h-5 w-5 text-red-600" />
            <div>
              <CardTitle>Danger zone</CardTitle>
              <p className="text-sm text-muted-foreground">
                Log out or delete your account permanently.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="outline"
              className="flex items-center gap-2"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
            >
              <LogOut className="h-4 w-4" />
              {logoutMutation.isPending ? "Signing out..." : "Log out"}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="flex items-center gap-2">
                  <Trash2 className="h-4 w-4" />
                  Delete account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes all tournaments, players, and sessions associated with your account. This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteAccountMutation.mutate()}
                    disabled={deleteAccountMutation.isPending}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {deleteAccountMutation.isPending ? "Deleting..." : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
