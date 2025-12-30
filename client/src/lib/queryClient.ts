import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
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

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  
  if (res.headers.get("content-type")?.includes("application/json")) {
    return res.json();
  }
  return res;
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
