import Anthropic from '@anthropic-ai/sdk';
import { authenticate, serviceClient } from './_shared/supabase.js';
import { error, json, withErrorHandling } from './_shared/http.js';
import { buildMarketingContext } from './_shared/context.js';

/**
 * POST /.netlify/functions/brief
 *
 * Generates the daily briefing: a short read on where things stand plus a
 * fresh set of queued tasks. This is the proactive half of the advisor — it
 * runs without the operator asking a question.
 */

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description: 'One sentence on the single most important thing right now.',
    },
    summary: {
      type: 'string',
      description: 'Two or three short paragraphs of plain prose. No bullet lists, no headers.',
    },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          rationale: { type: 'string' },
          platform: { type: 'string', enum: ['x', 'linkedin', 'reddit', 'youtube', 'instagram', 'tiktok'] },
          effort: { type: 'string', enum: ['quick', 'medium', 'deep'] },
          priority: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['title', 'rationale', 'effort', 'priority'],
        additionalProperties: false,
      },
    },
  },
  required: ['headline', 'summary', 'tasks'],
  additionalProperties: false,
} as const;

interface BriefPayload {
  headline: string;
  summary: string;
  tasks: Array<{
    title: string;
    detail?: string;
    rationale: string;
    platform?: string;
    effort: string;
    priority: number;
  }>;
}

export default withErrorHandling(async (req: Request) => {
  if (req.method !== 'POST') return error('Method not allowed', 405);

  if (!process.env.ANTHROPIC_API_KEY) {
    return error('ANTHROPIC_API_KEY is not configured on this deployment.', 503);
  }

  const auth = await authenticate(req);
  if (!auth) return error('Not signed in', 401);

  const db = serviceClient();
  const context = await buildMarketingContext(db, auth.userId);

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    system:
      'You are the strategist inside Traction, a marketing and distribution tool. ' +
      'You are writing the operator\'s briefing for today. Ground everything in the data you are given — ' +
      'if the data does not support a claim, do not make it. Lead with what matters most. ' +
      'Propose three to five tasks, each small enough to finish in one sitting, ordered by priority. ' +
      'If there is genuinely nothing worth doing, say so and return an empty task list rather than inventing busywork.',
    messages: [
      {
        role: 'user',
        content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\n${context}\n\nWrite my briefing.`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    return error('The briefing was declined by safety filters.', 422);
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return error('The model returned no usable briefing.', 502);
  }

  let payload: BriefPayload;
  try {
    payload = JSON.parse(textBlock.text) as BriefPayload;
  } catch {
    return error('Could not parse the briefing.', 502);
  }

  const proposed = (payload.tasks ?? []).slice(0, 5);
  let inserted = 0;

  if (proposed.length) {
    const { error: insertError, count } = await db
      .from('tasks')
      .insert(
        proposed.map((t) => ({
          user_id: auth.userId,
          title: t.title,
          detail: t.detail ?? null,
          rationale: t.rationale,
          platform: t.platform ?? null,
          effort: t.effort,
          priority: t.priority,
          status: 'suggested',
          source: 'brief',
        })),
        { count: 'exact' },
      );
    if (insertError) throw new Error(insertError.message);
    inserted = count ?? proposed.length;
  }

  return json({ headline: payload.headline, summary: payload.summary, tasksCreated: inserted });
});

function client(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}
