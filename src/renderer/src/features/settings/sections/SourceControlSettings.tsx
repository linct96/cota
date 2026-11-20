import { CommitMessageSection } from './source-control/CommitMessageSection'
import { HostingPlatformSection } from './source-control/HostingPlatformSection'

export function SourceControlSettings() {
  return (
    <section
      className="source-control-settings flex min-h-0 flex-1 flex-col gap-6"
      aria-labelledby="source-control-settings-title"
    >
      <header className="source-control-settings-header border-b pb-4">
        <h1
          id="source-control-settings-title"
          className="source-control-settings-title settings-page-title"
        >
          源代码管理
        </h1>
      </header>
      <HostingPlatformSection />
      <CommitMessageSection />
    </section>
  )
}
