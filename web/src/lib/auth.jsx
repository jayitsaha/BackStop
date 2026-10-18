import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import api from '../api'

const Ctx = createContext(null)
const TOKEN = 'backstop.token'
const REFRESH = 'backstop.refresh'
const EMAIL = 'backstop.email'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const email = localStorage.getItem(EMAIL)
    return localStorage.getItem(TOKEN) && email ? { email } : null
  })
  const [ready, setReady] = useState(false)

  // validate the stored token on load
  useEffect(() => {
    const t = localStorage.getItem(TOKEN)
    if (!t) {
      setReady(true)
      return
    }
    api
      .me()
      .then((u) => setUser({ email: u.email, uid: u.uid }))
      .catch(() => {
        localStorage.removeItem(TOKEN)
        localStorage.removeItem(EMAIL)
        setUser(null)
      })
      .finally(() => setReady(true))
  }, [])

  const persist = (res) => {
    localStorage.setItem(TOKEN, res.id_token)
    if (res.refresh_token) localStorage.setItem(REFRESH, res.refresh_token)
    localStorage.setItem(EMAIL, res.email)
    setUser({ email: res.email, uid: res.uid })
    return res
  }

  const login = useCallback(async (email, password) => persist(await api.login(email, password)), [])
  const signup = useCallback(async (email, password) => persist(await api.signup(email, password)), [])
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN)
    localStorage.removeItem(REFRESH)
    localStorage.removeItem(EMAIL)
    setUser(null)
  }, [])

  return <Ctx.Provider value={{ user, ready, login, signup, logout }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used within AuthProvider')
  return v
}
