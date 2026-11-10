import { useRef, useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form'
import { useWorkspace } from '@/state/workspace'
import { terminalAppearanceSchema } from '../../../../../../shared/terminal-appearance'
import type { TerminalAppearance } from '../../../../../../shared/terminal-appearance'
import type { Preferences } from '../../../../../../shared/contracts'

export function useTerminalAppearanceForm(
  savePreferences: (patch: Partial<Preferences>) => Promise<void>,
) {
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [initialValues] = useState(() =>
    structuredClone(useWorkspace.getState().preferences.terminalAppearance),
  )
  const lastQueued = useRef(JSON.stringify(initialValues))
  const latestSave = useRef<Promise<void> | null>(null)
  const form = useForm({
    defaultValues: initialValues,
    validationLogic: revalidateLogic({ mode: 'change' }),
    validators: { onDynamic: terminalAppearanceSchema },
    listeners: {
      onChange: ({ formApi }) => void saveAppearance(formApi.state.values),
    },
  })

  async function saveAppearance(value: TerminalAppearance) {
    const parsed = terminalAppearanceSchema.safeParse({
      ...value,
      fontFamily: value.fontFamily.trim(),
    })
    setSaved(false)
    if (!parsed.success) return
    const signature = JSON.stringify(parsed.data)
    if (signature === lastQueued.current) return
    lastQueued.current = signature
    setError(undefined)
    setSaving(true)
    const operation = savePreferences({ terminalAppearance: parsed.data })
    latestSave.current = operation
    try {
      await operation
      if (latestSave.current === operation) setSaved(true)
    } catch (cause) {
      if (latestSave.current === operation) {
        lastQueued.current = ''
        setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
      }
    } finally {
      if (latestSave.current === operation) setSaving(false)
    }
  }
  return { form, error, saved, saving, saveAppearance, markEdited: () => setSaved(false) }
}

export type TerminalAppearanceForm = ReturnType<typeof useTerminalAppearanceForm>['form']
