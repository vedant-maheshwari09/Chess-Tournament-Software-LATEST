import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  forgotUsernameSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  type LoginData,
  type RegisterData,
  type ForgotPasswordData,
  type ForgotUsernameData,
  type ResetPasswordData,
  type VerifyEmailData,
  type ResendVerificationData
} from "@shared/schema";

import { z } from "zod";
import { useLocation } from "wouter";

// Extended schema for client-side validation only
const clientResetPasswordSchema = resetPasswordSchema.extend({
  confirmPassword: z.string().min(6),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type ClientResetPasswordData = z.infer<typeof clientResetPasswordSchema>;

type AuthMode = 'login' | 'register' | 'forgot-password' | 'forgot-username' | 'reset-password' | 'verify-email';

export default function AuthForm() {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [pendingUserEmail, setPendingUserEmail] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [, setLocation] = useLocation();

  // Real-time validation states
  const [usernameCheck, setUsernameCheck] = useState<{
    checking: boolean;
    available: boolean | null;
    message: string;
  }>({ checking: false, available: null, message: '' });

  const [emailCheck, setEmailCheck] = useState<{
    checking: boolean;
    available: boolean | null;
    message: string;
  }>({ checking: false, available: null, message: '' });

  const { login, register, isLoggingIn, isRegistering } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const loginForm = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const registerForm = useForm<RegisterData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      firstName: "",
      lastName: "",
      role: "player",
    },
    mode: "onChange",
  });



  // Debounced username validation
  const checkUsernameAvailability = useCallback(async (username: string) => {
    if (!username || username.length < 3) {
      setUsernameCheck({ checking: false, available: null, message: '' });
      return;
    }

    setUsernameCheck({ checking: true, available: null, message: 'Checking availability...' });

    try {
      const res = await fetch(`/api/auth/check-username/${encodeURIComponent(username)}`);

      if (res.status === 503) {
        // Database unavailable - show helpful message but don't block registration
        setUsernameCheck({
          checking: false,
          available: null, // null means we can't determine, but don't block
          message: 'Unable to verify availability right now. You can still register.'
        });
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setUsernameCheck({
        checking: false,
        available: data.available,
        message: data.message
      });
    } catch (error) {
      // Only show error if it's not a 503 (which we handle above)
      setUsernameCheck({
        checking: false,
        available: null, // Don't block on network errors
        message: 'Unable to check username availability. You can still try to register.'
      });
    }
  }, []);

  // Debounced email validation
  const checkEmailAvailability = useCallback(async (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      setEmailCheck({ checking: false, available: null, message: '' });
      return;
    }

    setEmailCheck({ checking: true, available: null, message: 'Checking availability...' });

    try {
      const res = await fetch(`/api/auth/check-email/${encodeURIComponent(email)}`);

      if (res.status === 503) {
        // Database unavailable - show helpful message but don't block registration
        setEmailCheck({
          checking: false,
          available: null, // null means we can't determine, but don't block
          message: 'Unable to verify availability right now. You can still register.'
        });
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setEmailCheck({
        checking: false,
        available: data.available,
        message: data.message
      });
    } catch (error) {
      // Only show error if it's not a 503 (which we handle above)
      setEmailCheck({
        checking: false,
        available: null, // Don't block on network errors
        message: 'Unable to check email availability. You can still try to register.'
      });
    }
  }, []);

  // Debounce effect for username
  useEffect(() => {
    const username = registerForm.watch("username");
    const timeoutId = setTimeout(() => {
      checkUsernameAvailability(username);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [registerForm.watch("username"), checkUsernameAvailability]);

  // Debounce effect for email
  useEffect(() => {
    const email = registerForm.watch("email");
    const timeoutId = setTimeout(() => {
      checkEmailAvailability(email);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [registerForm.watch("email"), checkEmailAvailability]);

  const forgotPasswordForm = useForm<ForgotPasswordData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const forgotUsernameForm = useForm<ForgotUsernameData>({
    resolver: zodResolver(forgotUsernameSchema),
    defaultValues: { email: "" },
  });

  const resetPasswordForm = useForm<ClientResetPasswordData>({
    resolver: zodResolver(clientResetPasswordSchema),
    defaultValues: { email: "", code: "", newPassword: "", confirmPassword: "" },
  });

  const verifyEmailForm = useForm<VerifyEmailData>({
    resolver: zodResolver(verifyEmailSchema),
    defaultValues: { code: "", email: "" },
  });

  // Update email field when pendingUserEmail changes
  useEffect(() => {
    if (pendingUserEmail && authMode === 'verify-email') {
      verifyEmailForm.setValue('email', pendingUserEmail);
    }
  }, [pendingUserEmail, authMode, verifyEmailForm]);

  // Mutations
  const forgotPasswordMutation = useMutation({
    mutationFn: async (data: ForgotPasswordData) => {
      return apiRequest("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data) => {
      toast({ title: "Reset code sent", description: data.message });
      setResetEmail(forgotPasswordForm.getValues('email'));
      setAuthMode('reset-password');
      resetPasswordForm.setValue('email', forgotPasswordForm.getValues('email'));
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send reset code",
        variant: "destructive",
      });
    },
  });

  const forgotUsernameMutation = useMutation({
    mutationFn: async (data: ForgotUsernameData) => {
      return apiRequest("/api/auth/forgot-username", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data) => {
      toast({ title: "Username sent", description: data.message });
      if (data.username) {
        toast({ title: "Your username", description: `Username: ${data.username}` });
        setAuthMode('login');
        loginForm.setValue('username', data.username);
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send username",
        variant: "destructive",
      });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (data: ClientResetPasswordData) => {
      // Remove confirmPassword before sending to API
      const { confirmPassword, ...apiData } = data;
      return apiRequest("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify(apiData),
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Password reset successfully. You can now log in with your new password.",
      });
      setAuthMode('login');
      resetPasswordForm.reset();
      setResetEmail('');
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to reset password",
        variant: "destructive",
      });
    },
  });

  const handleLogin = async (data: LoginData) => {
    try {
      await login(data);
      toast({ title: "Welcome back!", description: "You have successfully logged in." });
      setLocation("/");
    } catch (error) {
      toast({
        title: "Login failed",
        description: error instanceof Error ? error.message : "Invalid credentials",
        variant: "destructive",
      });
    }
  };

  const handleRegister = async (data: RegisterData) => {
    try {

      const response = await register(data);
      if (response.requiresVerification) {
        setPendingUserEmail(data.email);
        setAuthMode('verify-email');
        toast({
          title: "Account created!",
          description: "Please check your email for a verification code."
        });
      } else {
        toast({ title: "Welcome to ChessTournament Pro!", description: "Your account has been created successfully." });
      }
    } catch (error) {
      console.error("Registration error:", error);
      toast({
        title: "Registration failed",
        description: error instanceof Error ? error.message : "Failed to create account",
        variant: "destructive",
      });
    }
  };

  const verifyEmailMutation = useMutation({
    mutationFn: async (data: VerifyEmailData) => {
      const token = localStorage.getItem("auth_token");
      const payload = { ...data, email: data.email || pendingUserEmail };
      return apiRequest("/api/auth/verify-email", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (data) => {
      if (data.token) {
        localStorage.setItem("auth_token", data.token);
        // Invalidate queries to refetch user data, which will trigger redirect
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        setLocation("/");
      } else {
        // Fallback if no token (shouldn't happen with updated API)
        setAuthMode('login');
        verifyEmailForm.reset();
      }
      toast({
        title: "Email verified!",
        description: "Your email has been verified successfully."
      });
    },
    onError: (error) => {
      toast({
        title: "Verification failed",
        description: error instanceof Error ? error.message : "Invalid verification code",
        variant: "destructive",
      });
    },
  });

  const resendVerificationMutation = useMutation({
    mutationFn: async (data?: ResendVerificationData) => {
      const token = localStorage.getItem("auth_token");
      return apiRequest("/api/auth/resend-verification", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(data || { email: pendingUserEmail }),
      });
    },
    onSuccess: (data) => {
      toast({ title: "Code sent", description: data.message || "Verification code sent to your email" });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to resend verification code",
        variant: "destructive",
      });
    },
  });

  const getTitle = () => {
    switch (authMode) {
      case 'login': return 'Sign in to your account';
      case 'register': return 'Create your account';
      case 'forgot-password': return 'Reset your password';
      case 'forgot-username': return 'Recover your username';
      case 'reset-password': return 'Set new password';
      case 'verify-email': return 'Verify your email';
    }
  };

  const renderForm = () => {
    switch (authMode) {
      case 'login':
        return (
          <Form {...loginForm}>
            <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
              <FormField
                control={loginForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter your username" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={loginForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showLoginPassword ? "text" : "password"}
                          placeholder="Enter your password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowLoginPassword(!showLoginPassword)}
                        >
                          {showLoginPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isLoggingIn}>
                {isLoggingIn ? "Signing in..." : "Sign In"}
              </Button>
              <Button 
                type="button" 
                variant="outline" 
                className="w-full mt-2 border-dashed border-primary/50" 
                onClick={async () => {
                  try {
                    const res = await apiRequest("/api/auth/bypass", { method: "POST" });
                    if (res.token) {
                      localStorage.setItem("auth_token", res.token);
                      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
                      setLocation("/");
                      toast({ title: "Bypass Successful", description: `Logged in as ${res.user.username}` });
                    }
                  } catch (err) {
                    toast({ title: "Bypass Failed", description: "Bypass user might not exist", variant: "destructive" });
                  }
                }}
              >
                Developer Bypass (mommies)
              </Button>
              <div className="flex justify-between text-sm">
                <Button variant="link" size="sm" onClick={() => setAuthMode('forgot-username')}>
                  Forgot username?
                </Button>
                <Button variant="link" size="sm" onClick={() => setAuthMode('forgot-password')}>
                  Forgot password?
                </Button>
              </div>
            </form>
          </Form>
        );

      case 'register':
        return (
          <Form {...registerForm}>
            <form onSubmit={registerForm.handleSubmit(handleRegister, (errors) => {
              console.log("Form validation errors:", errors);
              toast({
                title: "Form validation failed",
                description: "Please check all required fields",
                variant: "destructive",
              });
            })} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={registerForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input placeholder="John" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={registerForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Username
                </label>
                <div className="relative">
                  <Input
                    id="username"
                    placeholder="Enter your username"
                    value={registerForm.watch("username")}
                    onChange={(e) => {

                      registerForm.setValue("username", e.target.value, { shouldValidate: true });
                    }}
                    className={`pr-10 ${usernameCheck.available === true ? 'border-green-500 focus:ring-green-500' :
                        usernameCheck.available === false ? 'border-red-500 focus:ring-red-500' : ''
                      }`}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    {usernameCheck.checking ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : usernameCheck.available === true ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : usernameCheck.available === false ? (
                      <X className="h-4 w-4 text-red-500" />
                    ) : null}
                  </div>
                </div>
                {usernameCheck.message && (
                  <p className={`text-sm font-medium ${usernameCheck.available === true ? 'text-green-600' : 'text-red-600'
                    }`}>
                    {usernameCheck.message}
                  </p>
                )}
                {registerForm.formState.errors.username && (
                  <p className="text-sm font-medium text-destructive">
                    {registerForm.formState.errors.username.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Email
                </label>
                <div className="relative">
                  <Input
                    id="email"
                    type="email"
                    placeholder="john@example.com"
                    value={registerForm.watch("email")}
                    onChange={(e) => {
                      registerForm.setValue("email", e.target.value, { shouldValidate: true });
                    }}
                    className={`pr-10 ${emailCheck.available === true ? 'border-green-500 focus:ring-green-500' :
                        emailCheck.available === false ? 'border-red-500 focus:ring-red-500' : ''
                      }`}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    {emailCheck.checking ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : emailCheck.available === true ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : emailCheck.available === false ? (
                      <X className="h-4 w-4 text-red-500" />
                    ) : null}
                  </div>
                </div>
                {emailCheck.message && (
                  <p className={`text-sm font-medium ${emailCheck.available === true ? 'text-green-600' : 'text-red-600'
                    }`}>
                    {emailCheck.message}
                  </p>
                )}
                {registerForm.formState.errors.email && (
                  <p className="text-sm font-medium text-destructive">
                    {registerForm.formState.errors.email.message}
                  </p>
                )}
              </div>
              <FormField
                control={registerForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showRegisterPassword ? "text" : "password"}
                          placeholder="Create a password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                        >
                          {showRegisterPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={registerForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select your role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="player">Player</SelectItem>
                        <SelectItem value="tournament_director">Tournament Director</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isRegistering}>
                {isRegistering ? "Creating account..." : "Create Account"}
              </Button>
            </form>
          </Form>
        );

      case 'forgot-password':
        return (
          <Form {...forgotPasswordForm} key="forgot-password">
            <form onSubmit={forgotPasswordForm.handleSubmit((data) => forgotPasswordMutation.mutate(data))} className="space-y-4">
              <FormField
                control={forgotPasswordForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="Enter your email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={forgotPasswordMutation.isPending}>
                {forgotPasswordMutation.isPending ? "Sending..." : "Send Reset Code"}
              </Button>
            </form>
          </Form>
        );

      case 'forgot-username':
        return (
          <Form {...forgotUsernameForm} key="forgot-username">
            <form onSubmit={forgotUsernameForm.handleSubmit((data) => forgotUsernameMutation.mutate(data))} className="space-y-4">
              <FormField
                control={forgotUsernameForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="Enter your email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={forgotUsernameMutation.isPending}>
                {forgotUsernameMutation.isPending ? "Sending..." : "Send Username"}
              </Button>
            </form>
          </Form>
        );

      case 'reset-password':
        return (
          <Form {...resetPasswordForm}>
            <form onSubmit={resetPasswordForm.handleSubmit((data) => resetPasswordMutation.mutate(data))} className="space-y-4">
              <FormField
                control={resetPasswordForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="Enter your email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={resetPasswordForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reset Code</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter 6-digit code" maxLength={6} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={resetPasswordForm.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showResetPassword ? "text" : "password"}
                          placeholder="Enter new password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowResetPassword(!showResetPassword)}
                        >
                          {showResetPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={resetPasswordForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="Confirm new password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={resetPasswordMutation.isPending}>
                {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
              </Button>
            </form>
          </Form>
        );

      case 'verify-email':
        return (
          <Form {...verifyEmailForm}>
            <form onSubmit={verifyEmailForm.handleSubmit((data) => verifyEmailMutation.mutate(data))} className="space-y-4">
              <div className="text-sm text-muted-foreground text-center mb-4">
                A verification code has been sent to {pendingUserEmail || 'your email'}. Please enter the 6-digit code below.
              </div>
              {!pendingUserEmail && (
                <FormField
                  control={verifyEmailForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="Enter your email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={verifyEmailForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Verification Code</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter 6-digit code" maxLength={6} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={verifyEmailMutation.isPending}>
                {verifyEmailMutation.isPending ? "Verifying..." : "Verify Email"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={resendVerificationMutation.isPending}
                onClick={() => resendVerificationMutation.mutate(pendingUserEmail ? { email: pendingUserEmail } : undefined)}
              >
                {resendVerificationMutation.isPending ? "Sending..." : "Resend Code"}
              </Button>
            </form>
          </Form>
        );
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xl">♛</span>
            </div>
          </div>
          <CardTitle className="text-2xl text-center">ChessTournament Pro</CardTitle>
          <CardDescription className="text-center">{getTitle()}</CardDescription>
        </CardHeader>
        <CardContent>
          {renderForm()}

          <div className="mt-4 text-center">
            {authMode === 'login' && (
              <Button variant="ghost" onClick={() => setAuthMode('register')} className="text-sm">
                Don't have an account? Sign up
              </Button>
            )}
            {authMode === 'register' && (
              <Button variant="ghost" onClick={() => setAuthMode('login')} className="text-sm">
                Already have an account? Sign in
              </Button>
            )}
            {(authMode === 'forgot-password' || authMode === 'forgot-username' || authMode === 'reset-password') && (
              <Button variant="ghost" onClick={() => setAuthMode('login')} className="text-sm">
                Back to sign in
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
