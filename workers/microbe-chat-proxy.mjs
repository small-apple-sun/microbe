/**
 * Cloudflare Workers：把浏览器请求转发到 OpenAI Chat Completions，密钥仅存于 Worker 密钥变量。
 *
 * 部署概要（需本机已安装 wrangler 并登录）：
 *   cd workers
 *   wrangler secret put OPENAI_API_KEY
 *   wrangler deploy microbe-chat-proxy.mjs --name microbe-chat-proxy
 * 在 Cloudflare 控制台为该 Worker 绑定变量（可选）：
 *   OPENAI_MODEL   默认 gpt-4o-mini；使用 DeepSeek 时通常填 deepseek-chat
 *   UPSTREAM_CHAT_URL  上游 Chat Completions 完整 URL（OpenAI 兼容）。
 *                      DeepSeek 示例（与官方文档一致，任选其一）：
 *                      https://api.deepseek.com/chat/completions
 *                      或 https://api.deepseek.com/v1/chat/completions
 *                      留空则默认 OpenAI 官方地址。
 *   ALLOWED_ORIGINS  逗号分隔的前端来源，例如 https://small-apple-sun.github.io
 *                    留空则回退为 *（公开展示时建议收紧）
 *   TRUST_CLIENT_KEYS  设为 1 时，允许使用请求 JSON 中的 openaiApiKey 作为上游密钥
 *                      （仅自建、可信环境；公开展示的共享代理切勿开启）
 *
 * 请求：POST JSON { "messages": [...], "ragContext": "...", "openaiApiKey": "可选" }
 * 响应：JSON { "reply": "助手正文" } 或 { "error": "..." }
 */

function json(data, status, extraHeaders) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  };
  return new Response(JSON.stringify(data), { status, headers });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const raw = (env.ALLOWED_ORIGINS || "").trim();
  let allow = "*";
  if (raw && raw !== "*") {
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    allow = list.indexOf(origin) !== -1 ? origin : list[0] || "*";
  }
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function buildSystemPrompt(ragContext) {
  const rag = String(ragContext || "").trim() || "（无额外资料片段）";
  return [
    "你是「微生物菌落图谱」公开展示站点的讲解助手。须遵守：",
    "1）优先依据【资料片段】描述本站本次语境下的菌种与要点；资料已写明的内容不要自相矛盾。",
    "2）若用户问及资料片段未收录的其他菌种、培养或镜下知识，可用教材与公认真述里的通识作适度补充；开头用一两句说明「本次资料未收录该菌（或未涉及该点）」；通识须标明是常见概括，勿写成「如图所示」「本皿」等未经资料支持的现场鉴定，勿编造资料中未出现的具体形态、颜色、大小等细节。",
    "3）若资料片段说明访客处于「测验模式且未揭晓答案」，不得写出或暗示具体菌种中文名、拉丁名或缩写。",
    "4）内容仅供参观与教学辅助，不能替代实验室规范操作、药敏与临床诊疗；涉及用药或治疗方案时仅作原则性提醒并建议由医生评估。",
    "5）若不是测验未揭晓，请尽量按以下格式输出：先写一段「【本站资料】」总结当前图谱条目与已提供片段；再写一段「【通用补充】」补充背景知识。若某段暂无内容，也请保留标题并写「暂无额外补充」。",
    "6）使用简体中文，条理清晰，避免过长列表。",
    "",
    "【资料片段】",
    rag,
  ].join("\n");
}

export default {
  async fetch(request, env) {
    const ch = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: ch });
    }
    if (request.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405, ch);
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "无效的 JSON 请求体" }, 400, ch);
    }
    const messages = body && Array.isArray(body.messages) ? body.messages : [];
    const ragContext =
      body && typeof body.ragContext === "string" ? body.ragContext : "";
    const trustClient = String(env.TRUST_CLIENT_KEYS || "").trim() === "1";
    const clientKey =
      body && typeof body.openaiApiKey === "string"
        ? body.openaiApiKey.trim()
        : "";
    const key =
      trustClient && clientKey ? clientKey : env.OPENAI_API_KEY;
    if (!key) {
      return json(
        {
          error:
            "未配置上游密钥：请在 Worker 设置 OPENAI_API_KEY；或自建代理并设置 TRUST_CLIENT_KEYS=1 后由前端传入 openaiApiKey。",
        },
        503,
        ch
      );
    }
    if (!messages.length) {
      return json({ error: "缺少 messages" }, 400, ch);
    }
    const trimmed = messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({
        role: m.role,
        content: String(m.content || "").slice(0, 8000),
      }))
      .slice(-20);
    if (!trimmed.length) {
      return json({ error: "messages 格式不正确" }, 400, ch);
    }
    const chatUrl = (
      env.UPSTREAM_CHAT_URL ||
      "https://api.openai.com/v1/chat/completions"
    ).trim();
    const model = (env.OPENAI_MODEL || "gpt-4o-mini").trim();
    const payload = {
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: buildSystemPrompt(ragContext) },
        ...trimmed,
      ],
    };
    const upstream = await fetch(chatUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      return json(
        { error: "上游错误 " + upstream.status + ": " + text.slice(0, 500) },
        502,
        ch
      );
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return json({ error: "上游返回非 JSON" }, 502, ch);
    }
    const reply =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content
        ? String(data.choices[0].message.content)
        : "";
    if (!reply) {
      return json({ error: "上游未返回有效正文" }, 502, ch);
    }
    return json({ reply }, 200, ch);
  },
};
