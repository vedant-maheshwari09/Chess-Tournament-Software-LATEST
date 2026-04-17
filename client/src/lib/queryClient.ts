import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    const error = new Error(`${res.status}: ${text}`);
    (error as any).status = res.status;
    (error as any).response = { status: res.status }; // For compatibility with existing code
    throw error;
  }
}

export async function apiRequest(
  url: string,
  options: RequestInit = {}
): Promise<any> {
  const token = localStorage.getItem("auth_token");
  
  const headers: Record<string, string> = {
    ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string>),
  };
  
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    if (res.status === 401) {
      localStorage.removeItem("auth_token");
      window.location.href = '/login';
      throw new Error("Session expired. Please log in again.");
    }

    await throwIfResNotOk(res);
    
    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      if (typeof res.json !== 'function') {
        console.error("[API_ERROR] res.json is not a function! res object:", res);
        throw new Error("INTERNAL_FETCH_ERROR: res.json is not a function");
      }
      return await res.json();
    }
    return res;
  } catch (err) {
    console.error(`[API_ERROR] Failed during apiRequest to ${url}:`, err);
    throw err;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {};
    
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(queryKey[0] as string, {
      headers,
      credentials: "include",
    });

    // Handle 503 (Service Unavailable) - database connection issues
    if (res.status === 503) {
      // Return a special value that indicates database unavailable
      // This prevents the query from retrying
      throw new Error("DATABASE_UNAVAILABLE");
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
