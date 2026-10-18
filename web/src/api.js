import axios from 'axios'

const base = import.meta.env.VITE_API_BASE || '/api'
const http = axios.create({ baseURL: base, timeout: 120000 })

const TOKEN = 'backstop.token'
const REFRESH = 'backstop.refresh'
const EMAIL = 'backstop.email'

// Attach the Firebase idToken (stored at login) to every request.
http.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(TOKEN)
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

// Firebase idTokens expire after 1 hour. On a 401, transparently exchange the refresh token for a fresh
// idToken (once, shared across concurrent requests) and retry — so the session survives past the hour.
let refreshing = null
http.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config
    const status = error.response?.status
    const rt = localStorage.getItem(REFRESH)
    if (status === 401 && rt && original && !original._retried) {
      original._retried = true
      try {
        refreshing =
          refreshing ||
          axios.post(`${base}/auth/refresh`, { refresh_token: rt }).then((r) => r.data)
        const data = await refreshing
        refreshing = null
        if (data?.id_token) {
          localStorage.setItem(TOKEN, data.id_token)
          if (data.refresh_token) localStorage.setItem(REFRESH, data.refresh_token)
          original.headers = original.headers || {}
          original.headers.Authorization = `Bearer ${data.id_token}`
          return http(original)
        }
      } catch (e) {
        refreshing = null
        localStorage.removeItem(TOKEN)
        localStorage.removeItem(REFRESH)
        localStorage.removeItem(EMAIL)
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.assign('/login')
        }
      }
    }
    return Promise.reject(error)
  },
)

export const api = {
  // generic passthrough — bespoke agent pages call their own endpoints via these
  get: (path, config) => http.get(path, config).then((r) => r.data),
  post: (path, body, config) => http.post(path, body, config).then((r) => r.data),

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

  // Voice / Vishing Guard
  voiceAnalyze: (payload) => http.post('/voice/analyze', payload).then((r) => r.data),
  livekitConfig: () => http.get('/livekit/config').then((r) => r.data),
  livekitToken: () => http.post('/livekit/token').then((r) => r.data),
  calls: () => http.get('/calls').then((r) => r.data),
  call: (room) => http.get(`/calls/${room}`).then((r) => r.data),

  // Gmail one-tap: draft a safe reply
  replySuggest: (payload) => http.post('/gmail/reply-suggest', payload).then((r) => r.data),

  // Freeze / unfreeze a payee (the agent will never pay a frozen payee)
  hold: (payload) => http.post('/customers/me/hold', payload).then((r) => r.data),
  unhold: (payee) => http.delete('/customers/me/hold', { params: { payee } }).then((r) => r.data),

  // --- Secure agentic marketplace: dynamic dashboards + universal agent-task ---
  agentUI: (id) => http.get(`/agents/${id}/ui`).then((r) => r.data),            // { ui_schema }
  regenerateUI: (id) => http.post(`/agents/${id}/ui/regenerate`).then((r) => r.data),
  setActive: (agent) => http.post('/customers/me/active', { agent }).then((r) => r.data),
  agentTask: (payload) => http.post('/customers/me/agent-task', payload).then((r) => r.data), // {task, inputs?, agent?}
  chat: (payload) => http.post('/customers/me/chat', payload).then((r) => r.data),            // {messages, agent?}

  // --- Live + custom crash tests (crashtest_live router) ---
  tailoredTests: (id) => http.post(`/agents/${id}/crash-test/tailored`).then((r) => r.data),
  customCrashTest: (id, payload) => http.post(`/agents/${id}/crash-test/custom`, payload).then((r) => r.data),
  crashJob: (jobId) => http.get(`/crash-jobs/${jobId}`).then((r) => r.data),

  // --- RL defense loop + adaptive repricing (rl router) ---
  defense: (id) => http.get(`/agents/${id}/defense`).then((r) => r.data),
  exploit: (id, payload) => http.post(`/agents/${id}/exploit`, payload).then((r) => r.data),
  reprice: (id) => http.post(`/agents/${id}/reprice`).then((r) => r.data),

  // --- Litigation: file a claim with evidence + autonomous support chatbot (litigation router) ---
  litigationList: () => http.get('/litigation/cases').then((r) => r.data),
  litigationOpen: (payload) => http.post('/litigation/cases', payload).then((r) => r.data),
  litigationCase: (id) => http.get(`/litigation/cases/${id}`).then((r) => r.data),
  litigationChat: (id, payload) => http.post(`/litigation/cases/${id}/chat`, payload).then((r) => r.data),
}

export default api
