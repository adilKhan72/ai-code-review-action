// A stand-in for an Ollama server, used by the CI self-test so the bundled action runs end to end
// (real GitHub API, real HTTP to a "model") without an API key. It answers every /api/chat request with
// one finding on the first added line of the first file in the prompt.
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 11434);

createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/api/chat') {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(raw);
    const prompt = body.messages.at(-1).content;
    const path = /^File: (.+)$/m.exec(prompt)?.[1];
    const line = /^\s*(\d+) \+ /m.exec(prompt)?.[1];
    const findings =
      path && line
        ? [
            {
              path,
              line: Number(line),
              severity: 'low',
              title: 'Self-test finding',
              body: 'Emitted by the CI mock model.',
            },
          ]
        : [];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        model: body.model,
        message: { role: 'assistant', content: JSON.stringify({ findings }) },
        done_reason: 'stop',
        prompt_eval_count: Math.ceil(prompt.length / 4),
        eval_count: 20,
      }),
    );
  });
}).listen(port, () => console.log(`mock ollama listening on ${port}`));
