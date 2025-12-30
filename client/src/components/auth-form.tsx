import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
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
  type LoginData, 
  type RegisterData,
  type ForgotPasswordData,
  type ForgotUsernameData,
  type ResetPasswordData
} from "@shared/schema";

type AuthMode = 'login' | 'register' | 'forgot-password' | 'forgot-username' | 'reset-password';

export default function AuthForm() {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [resetToken, setResetToken] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  
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

  // Debug: Watch form values
  console.log("Register form values:", registerForm.watch());

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

  const resetPasswordForm = useForm<ResetPasswordData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token: "", newPassword: "" },
  });

  // Mutations
  const forgotPasswordMutation = useMutation({
    mutationFn: async (data: ForgotPasswordData) => {
      return apiRequest("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data) => {
      toast({ title: "Reset link sent", description: data.message });
      if (data.resetToken) {
        setResetToken(data.resetToken);
        setAuthMode('reset-password');
        resetPasswordForm.setValue('token', data.resetToken);
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send reset link",
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
    mutationFn: async (data: ResetPasswordData) => {
      return apiRequest("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Password reset successfully. You can now log in with your new password.",
      });
      setAuthMode('login');
      resetPasswordForm.reset();
      setResetToken('');
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
      console.log("Registration data:", data);
      await register(data);
      toast({ title: "Welcome to ChessTournament Pro!", description: "Your account has been created successfully." });
    } catch (error) {
      console.error("Registration error:", error);
      toast({
        title: "Registration failed",
        description: error instanceof Error ? error.message : "Failed to create account",
        variant: "destructive",
      });
    }
  };

  const getTitle = () => {
    switch (authMode) {
      case 'login': return 'Sign in to your account';
      case 'register': return 'Create your account';
      case 'forgot-password': return 'Reset your password';
      case 'forgot-username': return 'Recover your username';
      case 'reset-password': return 'Set new password';
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
                      console.log("Username input change:", e.target.value);
                      registerForm.setValue("username", e.target.value, { shouldValidate: true });
                    }}
                    className={`pr-10 ${
                      usernameCheck.available === true ? 'border-green-500 focus:ring-green-500' :
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
                  <p className={`text-sm font-medium ${
                    usernameCheck.available === true ? 'text-green-600' : 'text-red-600'
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
                    className={`pr-10 ${
                      emailCheck.available === true ? 'border-green-500 focus:ring-green-500' :
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
                  <p className={`text-sm font-medium ${
                    emailCheck.available === true ? 'text-green-600' : 'text-red-600'
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
          <Form {...forgotPasswordForm}>
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
                {forgotPasswordMutation.isPending ? "Sending..." : "Send Reset Link"}
              </Button>
            </form>
          </Form>
        );

      case 'forgot-username':
        return (
          <Form {...forgotUsernameForm}>
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
                name="token"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reset Token</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter reset token" {...field} />
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
              <Button type="submit" className="w-full" disabled={resetPasswordMutation.isPending}>
                {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
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