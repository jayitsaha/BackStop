import axios from 'axios'

const base = import.meta.env.VITE_API_BASE || '/api'
const http = axios.create({ baseURL: base, timeout: 120000 })

// Attach the Firebase idToken (stored at login) to every request.
http.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('backstop.token')
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

export const api = {
  // public
  health: () => http.get('/health').then((r) => r.data),
  terms: () => http.get('/terms').then((r) => r.data),
  mandate: () => http.get('/mandate').then((r) => r.data),
  tests: () => http.get('/tests').then((r) => r.data),
  bankDemo: () => http.get('/bank/demo').then((r) => r.data),
  models: () => http.get('/models').then((r) => r.data),
  listings: () => http.get('/listings').then((r) => r.data),
  agent: (id) => http.get(`/agents/${id}`).then((r) => r.data),
  crashTest: (id, { only, runs } = {}) => {
    const q = new URLSearchParams()
    if (only) q.set('only', only)
    if (runs) q.set('runs', String(runs))
    return http.post(`/agents/${id}/crash-test?${q.toString()}`).then((r) => r.data)
  },

  // auth
  signup: (email, password) => http.post('/auth/signup', { email, password }).then((r) => r.data),
  login: (email, password) => http.post('/auth/login', { email, password }).then((r) => r.data),
  me: () => http.get('/auth/me').then((r) => r.data),

  // maker
  myAgents: () => http.get('/agents/available').then((r) => r.data),
  submitAgent: (payload) => http.post('/maker/agents', payload).then((r) => r.data),
  makerJob: (jobId) => http.get(`/maker/jobs/${jobId}`).then((r) => r.data),

  // customer (per-user, persisted)
  getCustomer: () => http.get('/customers/me').then((r) => r.data),
  createCustomer: (payload) => http.post('/customers/me', payload).then((r) => r.data),
  addAgent: (agent) => http.post('/customers/me/agent', { agent }).then((r) => r.data),
  inject: (test_id) => http.post('/customers/me/inject', { test_id }).then((r) => r.data),
  runAgent: () => http.post('/customers/me/run').then((r) => r.data),
  customerClaim: (payment_id) => http.post('/customers/me/claims', { payment_id }).then((r) => r.data),
  resetCustomer: () => http.delete('/customers/me').then((r) => r.data),

  // Inbox Guard — live multimodal analysis of a real message
  analyze: (payload) => http.post('/analyze', payload).then((r) => r.data),

  // Generative adversarial red-team (attacker → agent → judge)
  redteam: (id) => http.post(`/agents/${id}/redteam`).then((r) => r.data),
}

export default api
