import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { User, LoginData, RegisterData } from "@shared/schema";

interface AuthResponse {
  user: User;
  token: string;
}

export function useAuth() {
  const queryClient = useQueryClient();

  // Get current user from token
  const { data: user, isLoading, error } = useQuery<User>({
    queryKey: ["/api/auth/me"],
    retry: false,
    enabled: !!localStorage.getItem("auth_token"),
    // Don't treat 503 (database unavailable) as an error
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0, // Don't cache the result to prevent stale data
    staleTime: Infinity, // Once we get a result, don't refetch
    // If we get a database unavailable error, disable the query
    throwOnError: false,
    onError: (err) => {
      // If database is unavailable, clear the token to stop retries
      if (err instanceof Error && err.message === "DATABASE_UNAVAILABLE") {
        localStorage.removeItem("auth_token");
        queryClient.setQueryData(["/api/auth/me"], null);
      }
    },
  });

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
    mutationFn: async (registerData: RegisterData): Promise<AuthResponse> => {
      const response = await apiRequest("/api/auth/register", {
        method: "POST", 
        body: JSON.stringify(registerData),
      });
      return response;
    },
    onSuccess: (data) => {
      localStorage.setItem("auth_token", data.token);
      queryClient.setQueryData(["/api/auth/me"], data.user);
      queryClient.invalidateQueries({ queryKey: ["/api"] });
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