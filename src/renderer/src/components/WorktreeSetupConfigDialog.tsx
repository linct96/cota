import { useEffect, useRef, useState } from 'react'
import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { unwrap } from '../../../shared/contracts'
import { setupFileLines, worktreeSetupSchema } from '../../../shared/worktree-setup'
import { worktreeSetupFormSchema } from '../lib/form-schemas'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from './ui/field'
import { Textarea } from './ui/textarea'

export function WorktreeSetupConfigDialog({
  projectPath,
  close,
}: {
  projectPath: string
  close(): void
}) {
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string>()
  const saving = useRef(false)
  const form = useForm({
    defaultValues: { command: '', copyFiles: '' },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: worktreeSetupFormSchema },
    onSubmit: async ({ value }) => {
      if (loading || saving.current) return
      saving.current = true
      setError(undefined)
      try {
        const definition = worktreeSetupSchema.parse({
          command: value.command.trim(),
          copyFiles: setupFileLines(value.copyFiles),
        })
        unwrap(await window.desktop.saveWorktreeSetupConfig(projectPath, definition))
        close()
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        saving.current = false
      }
    },
  })
  const pending = useStore(form.store, (state) => state.isSubmitting)
  useEffect(() => {
    let disposed = false
    void window.desktop
      .worktreeSetupConfig(projectPath)
      .then(unwrap)
      .then((definition) => {
        if (disposed) return
        form.reset({ command: definition.command, copyFiles: definition.copyFiles.join('\n') })
        setLoading(false)
      })
      .catch((failure) => {
        if (!disposed) setError(failure.message)
      })
    return () => {
      disposed = true
    }
  }, [projectPath, form, attempt])
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (saving.current) details.cancel()
        else if (!open) close()
      }}
    >
      <DialogContent
        className="worktree-setup-config-dialog max-h-[85vh] overflow-y-auto"
        showCloseButton={false}
      >
        <DialogHeader className="worktree-setup-config-header">
          <DialogTitle className="worktree-setup-config-title">工作树初始化配置</DialogTitle>
          <DialogDescription className="worktree-setup-config-description break-all">
            {projectPath} 的本机项目配置。保存不会执行命令；每次初始化仍需确认。
          </DialogDescription>
        </DialogHeader>
        <form
          className="worktree-setup-config-form flex flex-col gap-5"
          noValidate
          aria-busy={loading || pending}
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <FieldGroup className="worktree-setup-config-fields">
            <form.Field name="copyFiles">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field
                    className="worktree-setup-files-field"
                    data-invalid={invalid}
                    data-disabled={loading || pending}
                  >
                    <FieldLabel
                      className="worktree-setup-files-label"
                      htmlFor="worktree-setup-files"
                    >
                      复制本地文件
                    </FieldLabel>
                    <Textarea
                      className="worktree-setup-files-input font-mono"
                      id="worktree-setup-files"
                      name={field.name}
                      value={field.state.value}
                      disabled={loading || pending}
                      rows={3}
                      maxLength={110000}
                      placeholder={'.env.local\nconfig/local.json'}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={`worktree-setup-files-hint${invalid ? ' worktree-setup-files-error' : ''}`}
                    />
                    <FieldDescription
                      className="worktree-setup-files-hint"
                      id="worktree-setup-files-hint"
                    >
                      每行一个项目内的相对文件路径，使用 /
                      分隔。从项目主目录复制，已有文件保留；不支持目录、符号链接、.git 和
                      node_modules。
                    </FieldDescription>
                    {invalid && (
                      <FieldError
                        className="worktree-setup-files-error"
                        id="worktree-setup-files-error"
                        errors={field.state.meta.errors}
                      />
                    )}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="command">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field
                    className="worktree-setup-command-field"
                    data-invalid={invalid}
                    data-disabled={loading || pending}
                  >
                    <FieldLabel
                      className="worktree-setup-command-label"
                      htmlFor="worktree-setup-command"
                    >
                      初始化命令
                    </FieldLabel>
                    <Textarea
                      className="worktree-setup-command-input font-mono"
                      id="worktree-setup-command"
                      name={field.name}
                      value={field.state.value}
                      disabled={loading || pending}
                      rows={4}
                      maxLength={16384}
                      placeholder="pnpm install --frozen-lockfile"
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={`worktree-setup-command-hint${invalid ? ' worktree-setup-command-error' : ''}`}
                    />
                    <FieldDescription
                      className="worktree-setup-command-hint"
                      id="worktree-setup-command-hint"
                    >
                      复制完成后，在工作树目录中使用当前配置的 Shell
                      执行。仅填写会自行结束的非交互命令，不用于启动服务。全部留空可取消配置。
                    </FieldDescription>
                    {invalid && (
                      <FieldError
                        className="worktree-setup-command-error"
                        id="worktree-setup-command-error"
                        errors={field.state.meta.errors}
                      />
                    )}
                  </Field>
                )
              }}
            </form.Field>
          </FieldGroup>
          {loading && !error && (
            <output className="worktree-setup-config-loading text-sm text-muted-foreground">
              正在读取配置…
            </output>
          )}
          {error && (
            <p
              className="worktree-setup-config-error text-sm text-destructive break-words"
              role="alert"
            >
              {error}
            </p>
          )}
          <DialogFooter className="worktree-setup-config-footer">
            <Button
              className="worktree-setup-config-cancel"
              type="button"
              variant="outline"
              disabled={pending}
              onClick={close}
            >
              取消
            </Button>
            {loading && error ? (
              <Button
                className="worktree-setup-config-reload"
                type="button"
                onClick={() => {
                  setLoading(true)
                  setError(undefined)
                  setAttempt((value) => value + 1)
                }}
              >
                重新读取
              </Button>
            ) : (
              <Button
                className="worktree-setup-config-save"
                type="submit"
                disabled={loading || pending}
              >
                {pending ? '保存中…' : '保存配置'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
