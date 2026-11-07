import { TOOLS, runTool } from './tools.js';
import { callModel as callGateway } from './openai.js';

// The Hunch analyst: a tool-using agent. The model decides which analyses to run, the server runs them on the study
// report, the results go back to the model, and it repeats until it writes an answer. Every number in the answer has to
// come from a tool result, so the statistics stay the code's, not the model's.

export const MAX_STEPS = 8;        // model turns before we stop and ask for an answer with what it has
const TIME_BUDGET_MS = 60000;      // after this, the next turn must answer; gateways like APIYI take 10-15 s a call

export const SYSTEM_PROMPT = `You are Hunch's pricing research analyst. You answer a client's questions about one price-perception study.

How the data was made: people play Hunch, a game where they guess a product's retail price before it is revealed. Players who opt in to research (18+) become respondents. Guesses measure what people THINK things cost; they are not purchases.

Rules:
- Use the tools to look things up. Start with get_study_overview unless you already have what you need. Call several tools when a question needs it.
- Every number you state must appear in a tool result in this conversation, copied as given. Never estimate, derive, convert or invent figures, intervals or biases. If you need a number you have not looked up, call a tool.
- If a figure is withheld (too few responses), say so plainly and say what would be needed. Do not guess it.
- If the sample includes synthetic demo data, mention that once.
- Mention uncertainty when it matters: quote intervals, and say when an effect is not clearly different from zero.
- Write for a marketing or pricing manager: plain English, short paragraphs or bullets, at most about 200 words.
- Use **bold** for the key finding. Do not use headings, tables or em dashes.
- End with one concrete, testable recommendation when the question invites one.
- If the question is not about this study's pricing data, say briefly what you can help with instead.`;

const clean = text => String(text ?? '').replace(/\s+\n/g, '\n').trim();

// history: earlier turns of this conversation, [{ role: 'user' | 'model', text }]. Text only: tool results are
// re-fetched each question, so stale numbers are never carried over.
export async function runAnalyst({ report, question, history = [], onEvent = () => {}, callModel = callGateway, now = Date.now }) {
  const started = now();
  // OpenAI-format chat: earlier turns as text, then the question; tool calls and results are appended as they happen.
  const messages = [
    ...history.map(turn => ({ role: turn.role === 'model' ? 'assistant' : 'user', content: turn.text })),
    { role: 'user', content: question },
  ];
  const steps = [];
  for (let turn = 0; turn < MAX_STEPS; turn++) {
    const outOfTime = now() - started > TIME_BUDGET_MS;
    const lastTurn = turn === MAX_STEPS - 1 || outOfTime;
    // On the last turn, offer no tools so the model has to answer with what it has.
    const message = await callModel({ system: SYSTEM_PROMPT, messages, tools: lastTurn ? [] : TOOLS });
    const calls = message.tool_calls ?? [];
    if (!calls.length) {
      const answer = clean(message.content);
      if (!answer) throw Object.assign(new Error('The analyst finished without an answer. Try rephrasing the question.'), { status: 502 });
      onEvent({ type: 'answer', text: answer });
      return { answer, steps };
    }
    messages.push({ ...message, role: 'assistant' });
    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}') ?? {}; } catch { /* bad JSON: the tool reports what is missing */ }
      const result = runTool(report, call.function?.name, args);
      const step = { tool: call.function?.name, args, ok: !result.error };
      steps.push(step);
      onEvent({ type: 'step', ...step });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ result }) });
    }
  }
  throw Object.assign(new Error('The analyst ran out of steps. Try a narrower question.'), { status: 502 });
}
