import { QueryClient, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError } from './api'
import { userErrorMessage } from '@shared/userError'
import { usePrefs } from '@/store/prefs'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
      refetchOnWindowFocus: true,
    },
  },
})

type Params = Record<string, string | number | boolean | null | undefined>

/** GET with a cache key derived from the path and parameters. */
export function useApi<T = any>(path: string | null, params?: Params, options?: Partial<UseQueryOptions<T>>) {
  return useQuery<T>({
    queryKey: [path, params ?? {}],
    queryFn: () => api.get<T>(path!, params),
    enabled: Boolean(path) && (options?.enabled ?? true),
    ...options,
  } as UseQueryOptions<T>)
}

/**
 * Mutation that invalidates related caches by path prefix and reports errors
 * in a toast unless the caller handles them.
 */
export function useMutate<TBody = any, TResult = any>(fn: (body: TBody) => Promise<TResult>, opts: { invalidate?: string[]; success?: string; silentError?: boolean; onSuccess?: (r: TResult) => void } = {}) {
  const client = useQueryClient()
  return useMutation<TResult, ApiError, TBody>({
    mutationFn: fn,
    onSuccess: (result) => {
      [...new Set([...(opts.invalidate ?? []), '/operations/today'])].forEach((prefix) => client.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(prefix) }))
      if (opts.success) toast.success(opts.success)
      opts.onSuccess?.(result)
    },
    onError: (error) => {
      if (!opts.silentError) toast.error(userErrorMessage(error, usePrefs.getState().locale))
    },
  })
}

export function invalidate(...prefixes: string[]) {
  prefixes = [...new Set([...prefixes, '/operations/today'])]
  prefixes.forEach((prefix) => queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(prefix) }))
}
