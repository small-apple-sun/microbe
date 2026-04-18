/**
 * 智能讲解：可选默认对话代理 POST 地址（如团队部署的 Worker）。
 * 访客也可在页面「智能讲解 → 连接设置」里填写自己的地址（存本机浏览器，优先于本变量）。
 * 密钥推荐只放在 Worker；若使用请求体传密钥，须自建 Worker 并设置 TRUST_CLIENT_KEYS=1。
 */
window.__MICROBE_CHAT_API__ = "";
