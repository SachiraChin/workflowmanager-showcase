/**
 * ApiClientContext - Provides API client implementation to components.
 *
 * This context enables dependency injection of the API client, allowing
 * different implementations for production vs editor preview mode.
 *
 * Production (webui):
 * - Uses the default `api` singleton that calls real endpoints
 *
 * Editor preview:
 * - Uses a virtual API client that calls virtual endpoints with virtualDb
 *
 * Components should use `useApiClient()` hook instead of importing `api`
 * directly.
 */

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { ApiClientInterface } from "./api-types";
import { api } from "./api";

// =============================================================================
// Context
// =============================================================================

/**
 * Context for API client injection.
 * Default value is the production api singleton.
 */
const ApiClientContext = createContext<ApiClientInterface>(
  api as ApiClientInterface
);

// =============================================================================
// Provider
// =============================================================================

interface ApiClientProviderProps {
  children: ReactNode;
  client: ApiClientInterface;
}

/**
 * Provider for custom API client implementation.
 *
 * Usage in editor:
 * ```tsx
 * <ApiClientProvider client={virtualApiClient}>
 *   <InteractionHost ... />
 * </ApiClientProvider>
 * ```
 */
export function ApiClientProvider({ children, client }: ApiClientProviderProps) {
  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  );
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to get the API client from context.
 *
 * Returns the default API client (production singleton) if not within a
 * provider. Components should use this instead of importing `api` directly.
 */
export function useApiClient(): ApiClientInterface {
  return useContext(ApiClientContext);
}
