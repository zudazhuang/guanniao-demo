const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
    return { statusCode: 500, body: { error: "Missing GEMINI_API_KEY" } };
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
    return { statusCode: response.status, body: { error: "Gemini request failed", detail: data } };
  }

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  const parsed = extractJson(text);
  return {
    statusCode: 200,
    body: {
      provider: "Gemini",
      isBird: Boolean(parsed.isBird),
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      message: parsed.message || "",
    },
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    if (!body.imageBase64) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing imageBase64" }) };
    }
    const result = await callGemini(body);
    return { statusCode: result.statusCode, headers: corsHeaders, body: JSON.stringify(result.body) };
  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message || "Recognition failed" }),
    };
  }
};
