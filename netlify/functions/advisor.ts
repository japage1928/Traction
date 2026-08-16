import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticate, serviceClient } from './_shared/supabase.js';
import { error, readJson, withErrorHandling } from './_shared/http.js';
import { buildMarketingContext } from './_shared/context.js';
import type { AdvisorEvent } from '../../shared/types.js';

/**
 * POST /.netlify/functions/advisor
 * Body: { threadId?: string, message: string }
 *
 * Streams the advisor's reply back as server-sent events. The model can call
 * `create_tasks` to put concrete next actions into the user's queue, which is
 * what makes this an advisor rather than a chatbot.
 */

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';
const MAX_TOOL_ROUNDS = 4;

const SYSTEM_PROMPT = `You are the strategist inside Traction, a marketing and distribution tool.

Your job is to tell the operator what to do next and why — not to summarize their dashboard back to them. They can already see their numbers; what they cannot see is which move matters most this week.

How to work:
- Ground every claim in the context block you are given. If the data does not support a claim, say what you would need to see rather than guessing. Never invent a metric.
- Lead with the recommendation. Reasoning comes after, for the reader who wants it.
- Prefer one or two high-leverage moves over a long list. A plan the operator actually executes beats a comprehensive one they skim.
- Be concrete. "Post three times this week" is not actionable; "Post a teardown of <specific trending topic> on <platform> Tuesday morning, since that is when your impressions peak" is.
- When the operator is thinking out loud or asking a question, answer it. Only queue tasks when there is real work to do.

When you have identified concrete next actions, call create_tasks to add them to the queue. Keep each task small enough to finish in one sitting, and write the rationale so it still makes sense a week later.

Write in plain prose. Use short paragraphs, not walls of bullets. No preamble.`;

const CREATE_TASKS_TOOL: Anthropic.Tool = {
  name: 'create_tasks',
  description:
    'Add concrete next actions to the operator\'s task queue. Call this once you have identified specific work worth doing, not for vague intentions. Each task should be finishable in a single sitting.',
  input_schema: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'One to five tasks, most important first.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Imperative and specific, e.g. "Draft a teardown of the X thread on pricing psychology".' },
            detail: { type: 'string', description: 'What doing this actually involves. Optional.' },
            rationale: { type: 'string', description: 'Why this matters now, tied to the data you were given.' },
            platform: {
              type: 'string',
              enum: ['x', 'linkedin', 'reddit', 'youtube', 'instagram', 'tiktok'],
              description: 'Target platform, when the task is platform-specific.',
            },
            effort: { type: 'string', enum: ['quick', 'medium', 'deep'], description: 'quick: under 30 min. medium: an hour or two. deep: half a day or more.' },
            priority: { type: 'integer', minimum: 1, maximum: 5, description: '1 is most urgent.' },
          },
          required: ['title', 'rationale', 'effort', 'priority'],
        },
      },
    },
    required: ['tasks'],
  },
};

function sse(event: AdvisorEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Returns the id of the thread this turn belongs to, creating one when the
 * caller supplied no id or an id that is not theirs.
 */
async function resolveThread(
  db: SupabaseClient,
  userId: string,
  requestedId: string | undefined,
  firstMessage: string,
): Promise<string> {
  if (requestedId) {
    const { data } = await db
      .from('advisor_threads')
      .select('id')
      .eq('id', requestedId)
      .eq('user_id', userId)
      .maybeSingle();
    if (data) return data.id as string;
  }

  const { data, error: insertError } = await db
    .from('advisor_threads')
    .insert({
      user_id: userId,
      title: firstMessage.slice(0, 60) + (firstMessage.length > 60 ? '…' : ''),
    })
    .select('id')
    .single();

  if (insertError) throw new Error(insertError.message);
  return data.id as string;
}

export default withErrorHandling(async (req: Request) => {
  if (req.method !== 'POST') return error('Method not allowed', 405);

  if (!process.env.ANTHROPIC_API_KEY) {
    return error('ANTHROPIC_API_KEY is not configured on this deployment.', 503);
  }

  const auth = await authenticate(req);
  if (!auth) return error('Not signed in', 401);

  const body = await readJson<{ threadId?: string; message?: string }>(req);
  const userMessage = body?.message?.trim();
  if (!userMessage) return error('A message is required.', 400);

  const db = serviceClient();

  // --- Resolve or create the thread -----------------------------------------
  // A thread id from the client is only honoured if it really belongs to the
  // caller; anything else starts a fresh thread rather than erroring.
  const threadId: string = await resolveThread(db, auth.userId, body?.threadId, userMessage);

  // --- Load history and context ---------------------------------------------
  const { data: history } = await db
    .from('advisor_messages')
    .select('role, content')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(40);

  const context = await buildMarketingContext(db, auth.userId);

  await db.from('advisor_messages').insert({
    thread_id: threadId,
    user_id: auth.userId,
    role: 'user',
    content: userMessage,
  });

  const messages: Anthropic.MessageParam[] = [
    ...(history ?? []).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AdvisorEvent) => controller.enqueue(encoder.encode(sse(event)));
      let assistantText = '';

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const turn = client.messages.stream({
            model: MODEL,
            max_tokens: 8000,
            // Adaptive thinking lets the model decide how much reasoning a
            // question warrants; `effort` bounds the overall spend.
            thinking: { type: 'adaptive' },
            output_config: { effort: 'high' },
            system: [
              { type: 'text', text: SYSTEM_PROMPT },
              {
                type: 'text',
                text: `Here is the operator's current situation.\n\n${context}`,
                // Context is stable across a conversation, so cache it.
                cache_control: { type: 'ephemeral' },
              },
            ],
            tools: [CREATE_TASKS_TOOL],
            messages,
          });

          turn.on('text', (delta) => {
            assistantText += delta;
            send({ type: 'text', text: delta });
          });

          for await (const event of turn) {
            if (event.type === 'content_block_start' && event.content_block.type === 'thinking') {
              send({ type: 'thinking' });
            }
          }

          const message = await turn.finalMessage();

          if (message.stop_reason !== 'tool_use') break;

          // Echo the assistant turn back verbatim — thinking blocks included,
          // which the API requires when continuing a thinking conversation.
          messages.push({ role: 'assistant', content: message.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of message.content) {
            if (block.type !== 'tool_use') continue;

            if (block.name === 'create_tasks') {
              const input = block.input as {
                tasks?: Array<{
                  title: string;
                  detail?: string;
                  rationale: string;
                  platform?: string;
                  effort: string;
                  priority: number;
                }>;
              };
              const proposed = (input.tasks ?? []).slice(0, 5);

              if (!proposed.length) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: 'No tasks provided, so nothing was queued.',
                  is_error: true,
                });
                continue;
              }

              const { error: insertError } = await db.from('tasks').insert(
                proposed.map((t) => ({
                  user_id: auth.userId,
                  title: t.title,
                  detail: t.detail ?? null,
                  rationale: t.rationale,
                  platform: t.platform ?? null,
                  effort: t.effort,
                  priority: t.priority,
                  status: 'suggested',
                  source: 'advisor',
                })),
              );

              if (insertError) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: `Could not save tasks: ${insertError.message}`,
                  is_error: true,
                });
              } else {
                send({ type: 'tasks', tasks: proposed as never });
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: `Queued ${proposed.length} task(s). They are now visible on the operator's dashboard.`,
                });
              }
            } else {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Unknown tool: ${block.name}`,
                is_error: true,
              });
            }
          }

          messages.push({ role: 'user', content: toolResults });
        }

        if (assistantText.trim()) {
          await db.from('advisor_messages').insert({
            thread_id: threadId,
            user_id: auth.userId,
            role: 'assistant',
            content: assistantText,
          });
          await db
            .from('advisor_threads')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', threadId);
        }

        send({ type: 'done', threadId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[advisor]', err);
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
});
