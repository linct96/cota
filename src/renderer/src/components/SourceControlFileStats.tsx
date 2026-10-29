import type { GitChange } from '../../../shared/source-control'

export function SourceControlFileStats({ stats }: { stats: GitChange['stats'] }) {
  return (
    <span
      className="source-control-file-stats"
      aria-label={
        stats
          ? `新增 ${stats.additions} 行，删除 ${stats.deletions} 行`
          : stats === null
            ? '二进制文件'
            : '行数统计暂不可用'
      }
      title={stats === undefined ? '行数统计暂不可用' : undefined}
    >
      {stats ? (
        <>
          {stats.additions > 0 && (
            <span className="source-control-file-additions">+{stats.additions}</span>
          )}
          {stats.deletions > 0 && (
            <span className="source-control-file-deletions">-{stats.deletions}</span>
          )}
        </>
      ) : stats === null ? (
        '二进制'
      ) : (
        '—'
      )}
    </span>
  )
}
