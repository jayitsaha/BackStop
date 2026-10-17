import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import api from '../api'
import { useAuth } from './auth.jsx'

const Ctx = createContext(null)

export function CustomerProvider({ children }) {
  const { user } = useAuth()
  const [customer, setCustomer] = useState(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!user) {
      setCustomer(null)
      return null
    }
    setLoading(true)
    try {
      const data = await api.getCustomer()
      setCustomer(data || null)
      return data
    } catch {
      setCustomer(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  const apply = (res) => {
    const next = res.state || res
    setCustomer(next)
    return res
  }

  const value = {
    customer,
    loading,
    refresh,
    create: async (payload) => apply(await api.createCustomer(payload)),
    addAgent: async (agentId) => apply(await api.addAgent(agentId)),
    inject: async (testId) => apply(await api.inject(testId)),
    run: async () => {
      const res = await api.runAgent()
      apply(res)
      return res.run
    },
    claim: async (paymentId) => {
      const res = await api.customerClaim(paymentId)
      apply(res)
      return res.claim
    },
    reset: async () => {
      await api.resetCustomer()
      setCustomer(null)
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCustomer() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCustomer must be used inside CustomerProvider')
  return v
}
