const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 7_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Gemini returned empty text");
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

async function callGemini({ imageBase64, mimeType, fileName, locationHint, knownBirds }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { status: 500, body: { error: "Missing GEMINI_API_KEY" } };
  }

  const birdList = Array.isArray(knownBirds) ? knownBirds.slice(0, 140).join("、") : "";
  const prompt = [
    "你是严谨的鸟类图片识别助手，只识别图片里是否有真实鸟类主体。",
    "请优先判断：图片里是否有鸟。若没有鸟、主体太模糊、只是玩具/图标/文字/风景，请返回 isBird:false。",
    "如果有鸟，请只从候选鸟种列表里选择最可能的 1-3 个中文鸟名；不确定时宁可低置信度或 isBird:false。",
    `地点提示：${locationHint || "南京及周边"}`,
    `文件名：${fileName || "未提供"}`,
    `候选鸟种：${birdList}`,
    "只返回 JSON，不要 Markdown。格式：{\"isBird\":true,\"candidates\":[{\"name\":\"白鹭\",\"confidence\":86,\"reason\":\"全白鹭形、黑嘴黑脚\"}],\"message\":\"\"} 或 {\"isBird\":false,\"candidates\":[],\"message\":\"未检测到鸟类主体\"}。"
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const response = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    signal: controller.signal,
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    }),
  });
  clearTimeout(timeout);

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { status: response.status, body: { error: "Gemini request failed", detail: data } };
  }

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  const parsed = extractJson(text);
  return {
    status: 200,
    body: {
      provider: "Gemini",
      isBird: Boolean(parsed.isBird),
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      message: parsed.message || "",
    },
  };
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = await readBody(req);
    if (!body.imageBase64) {
      res.status(400).json({ error: "Missing imageBase64" });
      return;
    }
    const result = await callGemini(body);
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({ error: error.message || "Recognition failed" });
  }
};
