// Bespoke, purpose-built agent dashboards — hand-designed per agent domain, keyed by use_case_type.
// If an agent's use_case_type has a bespoke page here, it is rendered instead of the generic
// schema-driven DynamicDashboard (see AgentDashboard.jsx). Otherwise we fall back to the schema.
import AegisPage from './AegisPage.jsx'
import VantaPage from './VantaPage.jsx'
import WanderPage from './WanderPage.jsx'
import QuantPage from './QuantPage.jsx'
import ScholarPage from './ScholarPage.jsx'
import EncorePage from './EncorePage.jsx'

export const AGENT_PAGES = {
  'fraud-detector': AegisPage,
  'bot-detector': VantaPage,
  'travel-booker': WanderPage,
  trading: QuantPage,
  research: ScholarPage,
  'ticket-buyer': EncorePage,
}

export function pageFor(useCaseType) {
  return AGENT_PAGES[useCaseType] || null
}
