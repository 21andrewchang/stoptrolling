import { json, error } from '@sveltejs/kit';
import OpenAI from 'openai';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const apiKey = env.OPENAI_API_KEY;
const client = apiKey ? new OpenAI({ apiKey }) : null;

const response_format = {
    type: 'json_schema',
    name: 'log_rating',
    strict: true,
    schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'reason'],
        properties: {
            ok: {
                type: 'boolean',
                description: 'True if the log reflects productive / non-troll behavior.'
            },
            reason: {
                type: 'string',
                description: 'Brief rationale for the verdict.'
            }
        }
    }
} as const;

export const POST: RequestHandler = async ({ request }) => {
    try {
        if (!client) throw error(500, 'OPENAI_API_KEY is not set');

        const { log, goal } = (await request.json()) as { log?: string; goal?: string };
        if (!log || typeof log !== 'string') throw error(400, 'Missing "log" string');

        const instructions = [
            "You rate a user's hourly log as PRODUCTIVE (ok=true) or NOT PRODUCTIVE (ok=false) based on their goal for the day if they have one.",
            'Rules:',
            '- ok=true if the activity is work, study, chores, exercise, rest/recovery, social time with productive intent, or neutral life admin.',
            '- ok=false if the activity is procrastination, clearly trolling, spam, abusive, social media (unless related to work), watching unproductive videos, playing video games, etc.',
            '- If ambiguous, do your best to rate it based on the context given.',
            '- If the daily goal is provided, weigh whether the activity advances that goal; however, truly necessary neutral tasks can still be ok=true.',
            '- If the user provides a goal make sure to be extremely critical of whether the activity aligns with their goal for today aside from eating and exercise.',
            '- For example, if the user has a goal to study for a big midterm but they are doing homework for another subject it should be false since the priority is to study',
            'Return ONLY the JSON specified by the provided schema.'
        ].join('\n');

        const userContent = goal && goal.trim()
            ? `Log: ${log}\nGoal: ${goal}`
            : `Log: ${log}`;

        const response = await client.responses.create({
            model: 'gpt-5-nano-2025-08-07',
            input: [
                { role: 'system', content: instructions },
                { role: 'user', content: userContent }
            ],
            text: { format: response_format }
        });

        const out = response.output_text
            ? (JSON.parse(response.output_text) as { ok: boolean; reason: string })
            : null;

        if (!out || typeof out.ok !== 'boolean' || typeof out.reason !== 'string') {
            return json(
                { ok: true, reason: 'Defaulted to ok=true because of invalid response.' },
                { status: 200 }
            );
        }

        return json(out, { status: 200 });
    } catch (err) {
        return json({ ok: true, reason: `Fallback (error: ${err})` }, { status: 200 });
    }
};
