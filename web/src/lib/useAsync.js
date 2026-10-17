import { useEffect, useState, useCallback } from 'react'

// Minimal data hook with loading/error state and manual refetch.
export function useAsync(fn, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const run = useCallback(() => {
    let alive = true
    setLoading(true)
    Promise.resolve(fn())
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false))
    return () => (alive = false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => run(), [run])
  return { data, loading, error, refetch: run, setData }
}
