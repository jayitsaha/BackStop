import { Component } from 'react'
import { WidgetUnavailable } from './widgets/shared.jsx'
import { StatCards, ItemList, Timeline, Chart, Capabilities, Markdown, MandateEditor } from './widgets/data.jsx'
import { AgentRunner, FormAction, ClaimsPanel } from './widgets/actions.jsx'
import { MessageAnalyzer, VoiceGuard, LiveCallGuard, GmailConnect } from './widgets/guards.jsx'

/* A compact per-section error boundary — one bad widget never crashes the page. */
class SectionBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('widget error:', this.props.type, error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="card p-5">
          <div className="label mb-1 text-slate-500">{this.props.title || this.props.type}</div>
          <p className="text-sm text-slate-500">This widget hit an error and was skipped — the rest of your dashboard is fine.</p>
        </div>
      )
    }
    return this.props.children
  }
}

const COMPONENTS = {
  agent_runner: AgentRunner,
  form_action: FormAction,
  message_analyzer: MessageAnalyzer,
  voice_guard: VoiceGuard,
  live_call_guard: LiveCallGuard,
  gmail_connect: GmailConnect,
  stat_cards: StatCards,
  item_list: ItemList,
  timeline: Timeline,
  claims_panel: ClaimsPanel,
  markdown: Markdown,
  chart: Chart,
  capabilities: Capabilities,
  mandate_editor: MandateEditor,
}

function renderSection(section, shared) {
  const Comp = COMPONENTS[section.type]
  if (!Comp) return <WidgetUnavailable type={section.type} title={section.title} />
  return <Comp section={section} {...shared} />
}

export default function DynamicDashboard({ schema, customer, agentId, agentName, agentRecord }) {
  if (!schema) return null
  const sections = Array.isArray(schema.sections) ? schema.sections : []
  const shared = { customer, agentId, agentName, agentRecord }

  if (sections.length === 0) {
    return <div className="card p-6 text-sm text-slate-500">This agent has no dashboard sections yet.</div>
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {sections.map((section, i) => {
        const span = section.span === 'half' ? 'lg:col-span-1' : 'lg:col-span-2'
        const withAccent = { ...section, accent: section.accent || schema.accent }
        return (
          <div key={section.id || i} className={span}>
            <SectionBoundary type={section.type} title={section.title}>
              {renderSection(withAccent, shared)}
            </SectionBoundary>
          </div>
        )
      })}
    </div>
  )
}
