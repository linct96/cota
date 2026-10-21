import { useEffect, useRef, useState } from 'react'
import { revalidateLogic, useForm, useStore } from '@tanstack/react-form'
import { worktreeFormSchema } from '../lib/form-schemas'
import { unwrap, type WorktreePlan } from '../../../shared/contracts'
import { worktreeBranchSegment } from '../../../shared/worktree-names'
import { useWorkspace } from '../store'
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
import { Input } from './ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

export function WorktreeDialog({ projectPath, close }: { projectPath: string; close(): void }) {
  const [branchPrefix, setBranchPrefix] = useState('')
  const [suggestionAttempt, setSuggestionAttempt] = useState(0)
  const [branches, setBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [repositoryError, setRepositoryError] = useState<string>()
  const [error, setError] = useState<string>()
  const [plan, setPlan] = useState<WorktreePlan>()
  const [checkingPlan, setCheckingPlan] = useState(false)
  const submitting = useRef(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const nameEdited = useRef(false)
  const baseEdited = useRef(false)
  const form = useForm({
    defaultValues: { name: '', baseRef: '' },
    validationLogic: revalidateLogic({ mode: 'blur' }),
    validators: { onDynamic: worktreeFormSchema },
    onSubmit: async ({ value }) => {
      const branchName = `${branchPrefix}/${worktreeBranchSegment(value.name)}`
      if (
        !plan ||
        plan.name !== value.name.trim() ||
        plan.branchName !== branchName ||
        plan.baseRef !== value.baseRef ||
        submitting.current ||
        repositoryError ||
        checkingPlan
      )
        return
      submitting.current = true
      setError(undefined)
      try {
        await useWorkspace.getState().createGitWorktree({
          projectPath,
          name: value.name.trim(),
          branchName,
          baseRef: value.baseRef,
          planId: plan.id,
        })
        close()
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure))
        setPlan(undefined)
      } finally {
        submitting.current = false
      }
    },
  })
  const name = useStore(form.store, (state) => state.values.name)
  const baseRef = useStore(form.store, (state) => state.values.baseRef)
  const pending = useStore(form.store, (state) => state.isSubmitting) || checkingPlan
  const branchSegment = worktreeBranchSegment(name)
  const branchName = branchPrefix && branchSegment ? `${branchPrefix}/${branchSegment}` : ''
  useEffect(() => {
    let disposed = false
    void Promise.all([
      window.desktop.worktreeBranches(projectPath).then(unwrap),
      window.desktop.projectBranch(projectPath).then(unwrap),
    ])
      .then(([value, currentBranch]) => {
        if (disposed) return
        setBranches(value)
        setCurrentBranch(currentBranch)
        if (!baseEdited.current) form.setFieldValue('baseRef', currentBranch || 'HEAD')
        setRepositoryError(undefined)
      })
      .catch((failure) => {
        if (!disposed) setRepositoryError(failure.message)
      })
    void window.desktop
      .suggestWorktreeName(projectPath)
      .then(unwrap)
      .then((suggested) => {
        if (disposed) return
        if (!nameEdited.current) form.setFieldValue('name', suggested.name)
        setBranchPrefix(suggested.branchPrefix)
        setError(undefined)
      })
      .catch((failure) => {
        if (!disposed) setError(failure.message)
      })
    return () => {
      disposed = true
    }
  }, [projectPath, suggestionAttempt])
  useEffect(() => {
    let disposed = false
    if (!branchName || !worktreeFormSchema.safeParse({ name, baseRef }).success) return
    const timer = window.setTimeout(() => {
      void window.desktop
        .planGitWorktree({ projectPath, name, branchName, baseRef })
        .then(unwrap)
        .then((value) => {
          if (!disposed) {
            setPlan(value)
            setError(undefined)
            setRepositoryError(undefined)
          }
        })
        .catch((failure) => {
          if (!disposed) setError(failure.message)
        })
    }, 300)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [projectPath, name, branchName, baseRef])
  const validPlan =
    plan && plan.name === name.trim() && plan.branchName === branchName && plan.baseRef === baseRef
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (submitting.current) details.cancel()
        else if (!open) close()
      }}
    >
      <DialogContent
        className="worktree-create-dialog"
        showCloseButton={false}
        initialFocus={nameInput}
      >
        <DialogHeader className="worktree-create-header">
          <DialogTitle className="worktree-create-title">新建工作树</DialogTitle>
          <DialogDescription className="worktree-create-description">
            从本地引用创建新分支和独立目录。
          </DialogDescription>
        </DialogHeader>
        <form
          className="worktree-create-form flex flex-col gap-5"
          aria-busy={pending}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <FieldGroup className="worktree-create-fields">
            <form.Field name="name">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field
                    className="worktree-name-field"
                    data-invalid={invalid}
                    data-disabled={pending}
                  >
                    <FieldLabel className="worktree-name-label" htmlFor="worktree-name">
                      工作区名称
                    </FieldLabel>
                    <Input
                      className="worktree-name-input"
                      id="worktree-name"
                      name={field.name}
                      value={field.state.value}
                      maxLength={1024}
                      required
                      disabled={pending}
                      ref={nameInput}
                      onBlur={field.handleBlur}
                      aria-invalid={invalid}
                      aria-describedby={
                        invalid ? 'worktree-name-hint worktree-name-error' : 'worktree-name-hint'
                      }
                      onChange={(event) => {
                        nameEdited.current = true
                        field.handleChange(event.target.value)
                        setPlan(undefined)
                        if (branchPrefix) setError(undefined)
                      }}
                    />
                    <FieldDescription id="worktree-name-hint" className="worktree-name-hint">
                      可修改名称，分支名自动更新；名称需包含字母、数字或下划线。
                    </FieldDescription>
                    {invalid && (
                      <FieldError id="worktree-name-error" errors={field.state.meta.errors} />
                    )}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="baseRef">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field
                    className="worktree-base-field"
                    data-invalid={invalid}
                    data-disabled={pending || !baseRef}
                  >
                    <FieldLabel className="worktree-base-label" htmlFor="worktree-base">
                      基础引用
                    </FieldLabel>
                    <Select
                      name={field.name}
                      value={field.state.value || null}
                      disabled={pending || !baseRef}
                      onValueChange={(value) => {
                        if (!value) return
                        baseEdited.current = true
                        field.handleChange(value)
                        setPlan(undefined)
                        if (branchPrefix) setError(undefined)
                      }}
                    >
                      <SelectTrigger
                        className="worktree-base-select w-full"
                        id="worktree-base"
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? 'worktree-base-error' : undefined}
                      >
                        <SelectValue
                          className="worktree-base-value"
                          placeholder="正在读取当前分支…"
                        >
                          {(value) => (value === 'HEAD' ? 'HEAD（当前提交）' : value)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="worktree-base-options max-h-[min(9.25rem,var(--available-height))]">
                        <SelectGroup className="worktree-base-group">
                          {!currentBranch && (
                            <SelectItem className="worktree-base-option" value="HEAD">
                              HEAD（当前提交）
                            </SelectItem>
                          )}
                          {branches.map((branch) => (
                            <SelectItem
                              className="worktree-base-option"
                              key={branch}
                              value={branch}
                            >
                              {branch}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {invalid && (
                      <FieldError id="worktree-base-error" errors={field.state.meta.errors} />
                    )}
                  </Field>
                )
              }}
            </form.Field>
          </FieldGroup>
          {(repositoryError || error) && (
            <p className="worktree-create-error text-sm text-destructive break-words" role="alert">
              {repositoryError || error}
            </p>
          )}
          {(error || repositoryError) && !plan && (
            <Button
              type="button"
              variant="outline"
              className="worktree-replan-button"
              disabled={pending || (!!branchPrefix && !!baseRef && (!name || !branchName))}
              onClick={() => {
                if (!branchPrefix || !baseRef) {
                  setSuggestionAttempt((attempt) => attempt + 1)
                  return
                }
                setCheckingPlan(true)
                void window.desktop
                  .planGitWorktree({ projectPath, name, branchName, baseRef })
                  .then(unwrap)
                  .then((value) => {
                    setPlan(value)
                    setError(undefined)
                    setRepositoryError(undefined)
                  })
                  .catch((failure) => setError(failure.message))
                  .finally(() => setCheckingPlan(false))
              }}
            >
              {branchPrefix && baseRef ? '重新检查' : '重新读取工作树信息'}
            </Button>
          )}
          <DialogFooter className="worktree-create-footer">
            <Button
              className="worktree-create-cancel"
              type="button"
              variant="outline"
              disabled={pending}
              onClick={close}
            >
              取消
            </Button>
            <Button
              className="worktree-create-submit"
              type="submit"
              disabled={pending || !validPlan || !!repositoryError}
            >
              {pending ? '正在创建…' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
