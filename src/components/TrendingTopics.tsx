import { PLATFORM_LABELS, type TrendingTopic } from '@shared/types';
import { formatDelta } from '@/lib/format';

/**
 * Ranked trending topics.
 *
 * A ranked list beats a bar chart here: the labels are long, the count varies,
 * and the reader wants to scan names rather than compare bar lengths. The
 * magnitude bar behind each row is a supporting cue, not the primary encoding —
 * one hue, light to dark, since score is a magnitude rather than an identity.
 */
export function TrendingTopics({ topics }: { topics: TrendingTopic[] }) {
  if (!topics.length) {
    return (
      <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-ink-muted">
        No trends captured yet. Use “Refresh trends” to scan what’s moving.
      </div>
    );
  }

  const max = Math.max(...topics.map((t) => t.score), 1);

  return (
    <ol className="space-y-1">
      {topics.map((topic, index) => {
        const width = Math.max(4, (topic.score / max) * 100);
        const momentum = topic.momentum;

        return (
          <li key={topic.id} className="relative overflow-hidden rounded-lg">
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-lg"
              style={{ width: `${width}%`, backgroundColor: 'var(--brand-soft)', opacity: 0.45 }}
            />
            <div className="relative flex items-center gap-3 px-3 py-2.5">
              <span className="tabular w-5 shrink-0 text-xs font-medium text-ink-muted">{index + 1}</span>

              <div className="min-w-0 flex-1">
                {topic.url ? (
                  <a
                    href={topic.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block truncate text-sm font-medium text-ink hover:underline"
                  >
                    {topic.topic}
                  </a>
                ) : (
                  <span className="block truncate text-sm font-medium text-ink">{topic.topic}</span>
                )}
                <span className="text-xs text-ink-muted">{PLATFORM_LABELS[topic.platform]}</span>
              </div>

              {momentum != null && (
                <span
                  className="tabular shrink-0 text-xs font-medium"
                  style={{ color: momentum >= 0 ? 'var(--delta-up)' : 'var(--delta-down)' }}
                >
                  <span aria-hidden>{momentum >= 0 ? '↑' : '↓'}</span> {formatDelta(momentum)}
                </span>
              )}

              <span className="tabular w-8 shrink-0 text-right text-xs text-ink-secondary">
                {Math.round(topic.score)}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
