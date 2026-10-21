import { AgentHookSettings } from './AgentHookSettings'
import { Card } from './ui/card'

export function GeneralSettings() {
  return (
    <div className="general-settings flex flex-col gap-3">
      <div className="general-settings-header flex items-center justify-between pb-1">
        <h3 className="general-settings-title text-base font-semibold text-foreground">常规</h3>
      </div>
      <Card className="general-settings-card divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/80 bg-card py-0 shadow-xs ring-0">
        <AgentHookSettings />
      </Card>
    </div>
  )
}
