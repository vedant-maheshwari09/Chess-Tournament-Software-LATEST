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
import { LogOut, Trash2, ArrowLeft, SlidersHorizontal, User2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber ?? "");
  const [carrier, setCarrier] = useState(user?.carrier ?? "");
  const [notifyEmail, setNotifyEmail] = useState<boolean>(user?.notifyEmail ?? true);
  const [notifySms, setNotifySms] = useState<boolean>(user?.notifySms ?? false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    setPhoneNumber(user?.phoneNumber ?? "");
    setCarrier(user?.carrier ?? "");
    setNotifyEmail(user?.notifyEmail ?? true);
    setNotifySms(user?.notifySms ?? false);
  }, [user]);

  const carrierOptions = useMemo(
    () => [
      { value: "att", label: "AT&T" },
      { value: "verizon", label: "Verizon" },
      { value: "tmobile", label: "T-Mobile" },
      { value: "sprint", label: "Sprint" },
      { value: "googlefi", label: "Google Fi" },
      { value: "uscellular", label: "US Cellular" },
      { value: "other", label: "Other" },
    ],
    [],
  );

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
        carrier: carrier || null,
        notifyEmail,
        notifySms,
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
        <Button variant="ghost" className="flex items-center gap-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4" />
          Back
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
              <CardTitle>Preferences</CardTitle>
              <p className="text-sm text-muted-foreground">
                Choose how you want to receive tournament announcements.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Mobile number</Label>
                <Input
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  placeholder="5551234567"
                />
              </div>
              <div className="space-y-2">
                <Label>Carrier</Label>
                <Select value={carrier || undefined} onValueChange={setCarrier}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select carrier" />
                  </SelectTrigger>
                  <SelectContent>
                    {carrierOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Separator />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label className="text-sm font-medium">Email updates</Label>
                  <p className="text-xs text-muted-foreground">Round pairings, standings, and announcements.</p>
                </div>
                <Switch checked={notifyEmail} onCheckedChange={setNotifyEmail} />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label className="text-sm font-medium">SMS updates</Label>
                  <p className="text-xs text-muted-foreground">Sent via carrier email gateways.</p>
                </div>
                <Switch checked={notifySms} onCheckedChange={setNotifySms} />
              </div>
            </div>
            <Button
              onClick={() => updatePreferencesMutation.mutate()}
              className="w-full md:w-auto"
              disabled={updatePreferencesMutation.isPending}
            >
              {updatePreferencesMutation.isPending ? "Saving..." : "Save preferences"}
            </Button>
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
