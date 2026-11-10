import type { HostedReview } from '../../../../../shared/code-hosting'
import { Badge } from '@/components/ui/badge'

const checkLabels = {
  pending: '检查等待中',
  running: '检查进行中',
  success: '检查通过',
  failure: '检查失败',
  unknown: '检查状态未知',
  none: '无检查记录',
}

export function HostedReviewStatus({ review }: { review: HostedReview }) {
  return (
    <>
      <Badge
        variant={review.state === 'merged' ? 'success' : 'secondary'}
        className="hosted-review-state shrink-0"
      >
        {review.state === 'merged'
          ? '已合并'
          : review.state === 'closed'
            ? '已关闭'
            : review.draft
              ? '草稿'
              : '开放'}
      </Badge>
      {review.state === 'open' && (
        <Badge
          variant={review.checks === 'failure' ? 'destructive' : 'secondary'}
          className="hosted-review-checks shrink-0"
        >
          {checkLabels[review.checks]}
        </Badge>
      )}
    </>
  )
}
