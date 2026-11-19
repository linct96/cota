import type { TerminalAppearanceState } from './terminal-appearance/use-terminal-appearance-form'
import { TerminalAppearancePreview } from './terminal-appearance/TerminalAppearancePreview'
import { TerminalAppearanceGroup } from './terminal-appearance/TerminalAppearanceGroup'
import { APPEARANCE_GROUPS } from './terminal-appearance/fields'

export function TerminalAppearanceSettings({
  appearance,
  ready,
}: {
  appearance: TerminalAppearanceState
  ready: boolean
}) {
  const { form, saving } = appearance
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <>
          <section
            className="terminal-appearance-preview-group flex flex-col gap-2.5"
            aria-labelledby="terminal-appearance-title"
          >
            <h2
              id="terminal-appearance-title"
              className="terminal-appearance-title settings-section-title"
            >
              实时预览
            </h2>
            <TerminalAppearancePreview settings={values} />
          </section>

          {APPEARANCE_GROUPS.map((group) => (
            <TerminalAppearanceGroup
              key={group.name}
              group={group}
              form={form}
              values={values}
              ready={ready}
              saving={saving}
            />
          ))}
        </>
      )}
    </form.Subscribe>
  )
}
