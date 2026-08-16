import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PLATFORM_LABELS, type Task, type TaskStatus } from '@shared/types';

const EFFORT_LABEL: Record<Task['effort'], string> = {
  quick: 'Quick',
  medium: '1–2 hrs',
  deep: 'Half day+',
};

/**
 * The "what do I do next" list. This is the product's point of view: the
 * dashboard shows what happened, this shows what to do about it.
 */
export function TaskQueue({ tasks, onChange }: { tasks: Task[]; onChange: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function setStatus(task: Task, status: TaskStatus) {
    setPending(task.id);
    try {
      await supabase
        .from('tasks')
        .update({
          status,
          completed_at: status === 'done' ? new Date().toISOString() : null,
        })
        .eq('id', task.id);
      onChange();
    } finally {
      setPending(null);
    }
  }

  if (!tasks.length) {
    return (
      <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
        <p className="text-sm text-ink-secondary">Nothing queued right now.</p>
        <p className="mt-1 text-xs text-ink-muted">
          Generate a briefing or ask the advisor what to work on.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {tasks.map((task) => {
        const isOpen = expanded === task.id;
        const busy = pending === task.id;

        return (
          <li key={task.id} className="rounded-lg border border-line p-3">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => void setStatus(task, 'done')}
                disabled={busy}
                aria-label={`Mark "${task.title}" done`}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border border-line-strong transition-colors hover:border-brand disabled:opacity-50"
                style={busy ? { backgroundColor: 'var(--brand-soft)' } : undefined}
              />

              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : task.id)}
                  className="block w-full text-left"
                >
                  <span className="text-sm font-medium text-ink">{task.title}</span>
                </button>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                  <PriorityBadge priority={task.priority} />
                  <span>{EFFORT_LABEL[task.effort]}</span>
                  {task.platform && <span>{PLATFORM_LABELS[task.platform]}</span>}
                  {task.status === 'accepted' && <span className="text-ink-secondary">In progress</span>}
                </div>

                {isOpen && (
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    {task.detail && <p className="text-sm text-ink-secondary">{task.detail}</p>}
                    {task.rationale && (
                      <p className="text-xs text-ink-muted">
                        <span className="font-medium text-ink-secondary">Why now: </span>
                        {task.rationale}
                      </p>
                    )}
                    <div className="flex gap-2 pt-1">
                      {task.status === 'suggested' && (
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          disabled={busy}
                          onClick={() => void setStatus(task, 'accepted')}
                        >
                          Start
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        disabled={busy}
                        onClick={() => void setStatus(task, 'dismissed')}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Priority carries a number as well as a colour — the status palette is never
 * the only channel.
 */
function PriorityBadge({ priority }: { priority: number }) {
  const color =
    priority <= 1 ? 'var(--status-critical)' : priority === 2 ? 'var(--status-serious)' : 'var(--text-muted)';

  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span style={{ color }}>P{priority}</span>
    </span>
  );
}
