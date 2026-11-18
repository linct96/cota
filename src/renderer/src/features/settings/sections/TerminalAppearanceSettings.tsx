import { terminalAppearanceSchema } from '../../../../../shared/terminal-appearance'
import { Button } from '@/components/ui/button'
import { FieldError, FieldGroup } from '@/components/ui/field'
import type { TerminalAppearanceState } from './terminal-appearance/use-terminal-appearance-form'
import { TerminalAppearancePreview } from './terminal-appearance/TerminalAppearancePreview'
import { TerminalAppearanceGroup } from './terminal-appearance/TerminalAppearanceGroup'
import { APPEARANCE_GROUPS } from './terminal-appearance/fields'

export function TerminalAppearanceSettings({
  appearance,
}: {
  appearance: TerminalAppearanceState
}) {
  const { form, error, saving, saveAppearance } = appearance
  return (
    <section
      className="terminal-appearance-settings flex flex-col gap-3"
      aria-labelledby="terminal-appearance-title"
    >
      <form
        id="terminal-appearance-form"
        className="terminal-appearance-form flex flex-col gap-6"
        noValidate
        onSubmit={(event) => event.preventDefault()}
      >
        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <fieldset
              className="terminal-appearance-controls flex min-w-0 flex-col gap-6"
              aria-busy={saving}
            >
              <div className="terminal-appearance-preview-section flex flex-col gap-2.5">
                <div className="terminal-appearance-heading flex flex-wrap items-center justify-between gap-2">
                  <h2
                    id="terminal-appearance-title"
                    className="terminal-appearance-title settings-section-title"
                  >
                    实时预览
                  </h2>
                  {error && (
                    <Button
                      className="terminal-appearance-retry"
                      type="button"
                      size="sm"
                      disabled={saving || !terminalAppearanceSchema.safeParse(values).success}
                      onClick={() => void saveAppearance(form.state.values)}
                    >
                      重试保存
                    </Button>
                  )}
                </div>
                <TerminalAppearancePreview settings={values} />
                <FieldError className="terminal-appearance-save-error">{error}</FieldError>
              </div>

              <FieldGroup className="terminal-appearance-groups gap-6">
                {APPEARANCE_GROUPS.map((group) => (
                  <TerminalAppearanceGroup
                    key={group.name}
                    group={group}
                    form={form}
                    values={values}
                  />
                ))}
              </FieldGroup>
            </fieldset>
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}
