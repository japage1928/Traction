import { useEffect, useRef, useState, type FormEvent } from 'react';
import { streamAdvisor } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { PageHeader, Banner } from '@/components/ui';
import type { AdvisorMessage, AdvisorThread } from '@shared/types';

interface Bubble {
  role: 'user' | 'assistant';
  content: string;
  /** Set while the model is reasoning before any text has arrived. */
  thinking?: boolean;
}

const STARTERS = [
  'What should I focus on this week?',
  'Which platform is actually working for me?',
  'Give me three post ideas from what’s trending.',
  'Why did my engagement drop?',
];

export function Advisor() {
  const [threads, setThreads] = useState<AdvisorThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasksAdded, setTasksAdded] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load thread list once.
  useEffect(() => {
    supabase
      .from('advisor_threads')
      .select('id, title, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setThreads((data as AdvisorThread[]) ?? []));
  }, []);

  // Load messages when switching threads.
  useEffect(() => {
    if (!threadId) {
      setBubbles([]);
      return;
    }
    let active = true;
    supabase
      .from('advisor_messages')
      .select('id, thread_id, role, content, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!active) return;
        setBubbles(((data as AdvisorMessage[]) ?? []).map((m) => ({ role: m.role, content: m.content })));
      });
    return () => {
      active = false;
    };
  }, [threadId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text: string) {
    const message = text.trim();
    if (!message || streaming) return;

    setInput('');
    setError(null);
    setTasksAdded(0);
    setStreaming(true);
    setBubbles((b) => [...b, { role: 'user', content: message }, { role: 'assistant', content: '', thinking: true }]);

    const controller = new AbortController();
    abortRef.current = controller;

    const appendToLast = (chunk: string) =>
      setBubbles((b) => {
        const next = [...b];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') {
          next[next.length - 1] = { ...last, content: last.content + chunk, thinking: false };
        }
        return next;
      });

    try {
      await streamAdvisor(
        message,
        threadId,
        (event) => {
          switch (event.type) {
            case 'text':
              appendToLast(event.text);
              break;
            case 'tasks':
              setTasksAdded((n) => n + event.tasks.length);
              break;
            case 'done':
              if (!threadId) {
                setThreadId(event.threadId);
                // Surface the new thread in the sidebar without a full reload.
                setThreads((t) => [
                  { id: event.threadId, title: message.slice(0, 60), created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                  ...t,
                ]);
              }
              break;
            case 'error':
              setError(event.message);
              break;
            default:
              break;
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'The advisor could not be reached.');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Drop a trailing empty bubble if the stream produced nothing.
      setBubbles((b) => (b[b.length - 1]?.role === 'assistant' && !b[b.length - 1].content ? b.slice(0, -1) : b));
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  return (
    <div className="mx-auto flex h-screen max-w-6xl flex-col px-5 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Advisor"
        subtitle="Ask about your numbers, your positioning, or what to ship next."
        actions={
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setThreadId(null);
              setBubbles([]);
              setError(null);
            }}
            disabled={streaming}
          >
            New conversation
          </button>
        }
      />

      <div className="mt-5 flex min-h-0 flex-1 gap-4">
        {threads.length > 0 && (
          <aside className="hidden w-48 shrink-0 overflow-y-auto lg:block">
            <div className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-ink-muted">History</div>
            <ul className="space-y-0.5">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => setThreadId(thread.id)}
                    disabled={streaming}
                    className={[
                      'block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                      thread.id === threadId
                        ? 'bg-surface font-medium text-ink'
                        : 'text-ink-secondary hover:bg-surface',
                    ].join(' ')}
                    title={thread.title}
                  >
                    {thread.title}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {bubbles.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
                <div>
                  <p className="text-sm text-ink-secondary">
                    The advisor reads your connected accounts, recent metrics, and current trends before answering.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => void send(starter)}
                      className="btn-ghost text-xs"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {bubbles.map((bubble, index) => (
              <MessageBubble key={index} bubble={bubble} />
            ))}

            {tasksAdded > 0 && (
              <Banner tone="good">
                Added {tasksAdded} task{tasksAdded === 1 ? '' : 's'} to your queue — they’re on the dashboard.
              </Banner>
            )}

            {error && <Banner tone="critical">{error}</Banner>}
          </div>

          <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
            <input
              className="input flex-1"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about your distribution…"
              disabled={streaming}
              autoFocus
            />
            {streaming ? (
              <button type="button" className="btn-ghost" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            ) : (
              <button type="submit" className="btn-primary" disabled={!input.trim()}>
                Send
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ bubble }: { bubble: Bubble }) {
  if (bubble.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-surface px-4 py-2.5 text-sm text-ink">
          {bubble.content}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[92%]">
      {bubble.thinking && !bubble.content ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
          Thinking…
        </div>
      ) : (
        <div className="space-y-3 text-sm leading-relaxed text-ink">
          {bubble.content.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {para}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
