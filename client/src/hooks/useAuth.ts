import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import type { User, LoginData, RegisterData } from "@shared/schema";

interface AuthResponse {
  user: User;
  token: string;
}

interface RegisterResponse {
  user: User;
  message?: string;
  requiresVerification?: boolean;
}

export function useAuth() {
  const queryClient = useQueryClient();

  // Get current user from token
  const { data: user, isLoading, error } = useQuery<User | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    enabled: !!localStorage.getItem("auth_token"),
    refetchOnMount: true, // Allow refetch on mount to verify session
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 5 * 60 * 1000, // Consider user data fresh for 5 minutes
  });

  useEffect(() => {
    if (error) {
      console.error("[AUTH_ERROR] Error fetching user:", error);
      // If database is unavailable or token is invalid, clear the token to stop retries
      const status = (error as any).status || (error as any).response?.status;
      const message = error.message;

      if (
        message === "DATABASE_UNAVAILABLE" || 
        ((status === 401 || message.startsWith("401")) && 
         window.location.pathname !== '/login' && 
         window.location.pathname !== '/auth')
      ) {
        console.warn("[AUTH] Clearing invalid session due to error:", message);
        localStorage.removeItem("auth_token");
        queryClient.setQueryData(["/api/auth/me"], null);
      }
    }
  }, [error, queryClient]);

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async (loginData: LoginData): Promise<AuthResponse> => {
      const response = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(loginData),
      });
      return response;
    },
    onSuccess: (data) => {
      localStorage.setItem("auth_token", data.token);
      queryClient.setQueryData(["/api/auth/me"], data.user);
      queryClient.invalidateQueries({ queryKey: ["/api"] });
    },
  });

  // Register mutation
  const registerMutation = useMutation({
    mutationFn: async (registerData: RegisterData): Promise<RegisterResponse> => {
      const response = await apiRequest("/api/auth/register", {
        method: "POST", 
        body: JSON.stringify(registerData),
      });
      return response;
    },
    onSuccess: (data) => {
      // Don't set token or current user if email verification is required
      if (!data.requiresVerification && 'token' in data) {
        localStorage.setItem("auth_token", (data as AuthResponse).token);
        queryClient.setQueryData(["/api/auth/me"], data.user);
        queryClient.invalidateQueries({ queryKey: ["/api"] });
      } else {
        // Do NOT set /api/auth/me data here, otherwise the app thinks we are logged in.
        // The user object is returned for context (e.g. to show "Sent to email@domain.com") 
        // but not for authentication state.
      }
    },
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      if (token) {
        await apiRequest("/api/auth/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
    },
    onSuccess: () => {
      localStorage.removeItem("auth_token");
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.clear();
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    loginError: loginMutation.error,
    registerError: registerMutation.error,
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
  };
}