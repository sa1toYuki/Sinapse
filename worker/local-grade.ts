import { validChoice } from './protocol';
import { serverQuestions } from './questions.server';

// Vite-only adapter for solo and shared-screen play. The public Worker must
// never register this route because it can grade any question independently.
export async function gradeLocal(request: Request): Promise<Response> {
  const invalid = () => Response.json({ code: 'INVALID_PAYLOAD' }, { status: 400 });
  if (!request.body || request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return invalid();
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let raw = '';
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 256) { await reader.cancel(); return invalid(); }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    const input = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 3) return invalid();
    const { questionId, choice, revealOnMiss } = input;
    if (!Number.isSafeInteger(questionId) || questionId < 1 || questionId > serverQuestions.length ||
      (choice !== null && !validChoice(choice)) || typeof revealOnMiss !== 'boolean') return invalid();
    const { correct, explanation } = serverQuestions[questionId - 1];
    const matched = correct === choice;
    return Response.json(matched || revealOnMiss
      ? { type: 'question_reveal', matched, correct, explanation }
      : { type: 'answer_ack', matched }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return invalid();
  } finally {
    reader.releaseLock();
  }
}
