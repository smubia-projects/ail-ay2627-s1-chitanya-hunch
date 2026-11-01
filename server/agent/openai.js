// Minimal OpenAI-compatible chat-completions client (REST, no SDK) with tool calling.
// Environment: API_BASE_URL (default the club's gateway), API_KEY and MODEL_NAME. The older GEMINI_API_KEY and
// GEMINI_MODEL names are still read as fallbacks.

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const aiModel = () => process.env.MODEL_NAME || process.env.GEMINI_MODEL || DEFAULT_MODEL;
const baseUrl = () => (process.env.API_BASE_URL || 'https://api.apiyi.com/v1').replace(/\/+$/, '');
const apiKey = () => process.env.API_KEY || process.env.GEMINI_API_KEY || '';
export const aiEnabled = () => Boolean(apiKey());

const userMessage = status => {
  if (status === 401 || status === 403) return 'The AI service rejected this server’s key. Try again later.';
  if (status === 404) return `AI model "${aiModel()}" was not found. Set MODEL_NAME to a model the gateway serves.`;
  if (status === 429) return 'The AI service is busy. Wait a minute and try again.';
  return 'The AI analyst could not reach the AI service. Try again.';
};

// tools: [{ name, description, parameters }]. Returns the assistant message ({ role, content, tool_calls }) whole,
// so any provider-specific fields on tool calls go back unchanged on the next turn.
export async function callModel({ system, messages, tools, timeoutMs = 40000 }) {
  let response;
  try {
    response = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({
        model: aiModel(),
        messages: [{ role: 'system', content: system }, ...messages],
        ...(tools.length ? { tools: tools.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } })) } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw Object.assign(new Error('The AI analyst could not reach the AI service. Try again.'), { status: 502 });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`[Hunch analyst] AI service ${response.status}: ${data.error?.message ?? ''}`);
    throw Object.assign(new Error(userMessage(response.status)), { status: 502 });
  }
  const message = data.choices?.[0]?.message;
  if (!message) throw Object.assign(new Error('The AI returned no answer (it may have been blocked). Try rephrasing.'), { status: 502 });
  return message;
}
