const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, headers) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function askAi(deal, question) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY não configurada no servidor");
  }
  const system =
    "Você ajuda um vendedor a entender a priorização de um deal no CRM. " +
    "Responda em português, em 2-4 frases, direto ao ponto, usando só os dados fornecidos. " +
    "Nunca invente números que não estejam no contexto.";
  const context = JSON.stringify(deal, null, 2);
  const userMsg = `Contexto do deal (dados reais do CRM):\n${context}\n\nPergunta do vendedor: ${question}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: userMsg }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text}`);
  }
  const data = await res.json();
  const answer = data.content?.[0]?.text ?? "Não consegui gerar uma resposta agora.";
  return answer;
}

function serveStatic(req, res) {
  let reqPath = decodeURIComponent(req.url.split("?")[0]);
  if (reqPath === "/") reqPath = "/index.html";
  const filePath = path.normalize(path.join(FRONTEND_DIR, reqPath));
  if (!filePath.startsWith(FRONTEND_DIR)) {
    send(res, 403, { error: "forbidden" });
    return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      send(res, 404, { error: "not found" });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    send(res, 200, { status: "ok", hasKey: Boolean(ANTHROPIC_API_KEY) });
    return;
  }

  if (req.method === "POST" && req.url === "/api/ask-ai") {
    try {
      const raw = await readBody(req);
      const { deal, question } = JSON.parse(raw || "{}");
      if (!deal || !question) {
        send(res, 400, { error: "deal e question são obrigatórios" });
        return;
      }
      const answer = await askAi(deal, question);
      send(res, 200, { answer });
    } catch (err) {
      send(res, 500, { error: err.message || "erro interno" });
    }
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`Lead Scorer rodando em http://localhost:${PORT}`);
  console.log(`ANTHROPIC_API_KEY configurada: ${Boolean(ANTHROPIC_API_KEY)}`);
});
