// Chooses a bespoke, purpose-built page for the active agent (by use_case_type) when one exists,
// otherwise renders the generic schema-driven dashboard. The chatbot concierge above stays docked.
import DynamicDashboard from './DynamicDashboard.jsx'
import { pageFor } from './agent_pages/registry.js'

export default function AgentDashboard({ schema, customer, agentId, agentName, agentRecord }) {
  const uct = agentRecord?.use_case_type || schema?.use_case_type
  const Bespoke = pageFor(uct)
  if (Bespoke) {
    return (
      <Bespoke
        agentId={agentId}
        agent={agentRecord}
        customer={customer}
        agentName={agentName}
        schema={schema}
      />
    )
  }
  return (
    <DynamicDashboard
      schema={schema}
      customer={customer}
      agentId={agentId}
      agentName={agentName}
      agentRecord={agentRecord}
    />
  )
}
