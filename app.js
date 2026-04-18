(function () {
  "use strict";

  const DATA_URL = "data/slides.json";
  const INTROS_URL = "data/microbe_intros.json";
  const ALT_QUIZ_HIDDEN = "菌落图（测验模式，名称已隐藏）";
  const SEARCH_STORAGE_KEY = "microbeColonyAtlas_nameSearch";
  const REVIEW_STORAGE_KEY = "microbeColonyAtlas_needReview";
  const RANDOM_ORDER_STORAGE_KEY = "microbeColonyAtlas_randomOrder";
  /** 本机覆盖：对话代理 POST 地址（优先于 window.__MICROBE_CHAT_API__） */
  const CHAT_API_URL_STORAGE_KEY = "microbeColonyAtlas_chatApiUrl";
  /** 本机可选：API 密钥（Worker 走 TRUST 时，或直连 DeepSeek 时） */
  const CHAT_OPENAI_KEY_STORAGE_KEY = "microbeColonyAtlas_chatOpenaiKey";
  /** worker（默认）| deepseek_direct：直连不部署 Worker，依赖浏览器能否跨域访问 DeepSeek */
  const CHAT_MODE_STORAGE_KEY = "microbeColonyAtlas_chatMode";
  /** 直连时模型，默认 deepseek-chat */
  const CHAT_DEEPSEEK_MODEL_STORAGE_KEY = "microbeColonyAtlas_deepseekModel";
  /** 与 DeepSeek 官方文档 curl 一致 */
  const DEEPSEEK_DIRECT_URL = "https://api.deepseek.com/chat/completions";
  /** 搜索筛选防抖（毫秒），减轻大量条目时每次按键的全量重建 */
  const SEARCH_REBUILD_DEBOUNCE_MS = 200;
  /** 特征查询面板内筛选防抖 */
  const FEATURE_SEARCH_DEBOUNCE_MS = 200;
  /** 测验模式下累计「会了」每满该数量触发庆贺动画 */
  const QUIZ_CELEBRATE_EVERY = 5;
  /** 菌落识别考试：固定题量 */
  const EXAM_TOTAL = 10;

  const el = {
    counter: document.getElementById("counter"),
    loadError: document.getElementById("loadError"),
    viewerEmpty: document.getElementById("viewerEmpty"),
    searchEmpty: document.getElementById("searchEmpty"),
    reviewEmpty: document.getElementById("reviewEmpty"),
    detailCard: document.getElementById("detailCard"),
    detailInfo: document.getElementById("detailInfo"),
    detailHead: document.getElementById("detailHead"),
    detailControls: document.getElementById("detailControls"),
    detailImage: document.getElementById("detailImage"),
    detailId: document.getElementById("detailId"),
    detailTitle: document.getElementById("detailTitle"),
    detailAboutWrap: document.getElementById("detailAboutWrap"),
    detailAbout: document.getElementById("detailAbout"),
    imageWrap: document.getElementById("imageWrap"),
    btnArrowPrev: document.getElementById("btnArrowPrev"),
    btnArrowNext: document.getElementById("btnArrowNext"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    btnReveal: document.getElementById("btnReveal"),
    btnKnow: document.getElementById("btnKnow"),
    btnNotKnow: document.getElementById("btnNotKnow"),
    quizMode: document.getElementById("quizMode"),
    reviewOnly: document.getElementById("reviewOnly"),
    randomOrder: document.getElementById("randomOrder"),
    nameSearch: document.getElementById("nameSearch"),
    btnSearchClear: document.getElementById("btnSearchClear"),
    toast: document.getElementById("toast"),
    celebrateOverlay: document.getElementById("celebrateOverlay"),
    featureDrawer: document.getElementById("featureDrawer"),
    featureBackdrop: document.getElementById("featureBackdrop"),
    featureSearch: document.getElementById("featureSearch"),
    featureList: document.getElementById("featureList"),
    featureEmpty: document.getElementById("featureEmpty"),
    btnFeaturePanel: document.getElementById("btnFeaturePanel"),
    btnExamPanel: document.getElementById("btnExamPanel"),
    btnFeatureClose: document.getElementById("btnFeatureClose"),
    btnFeatureSearchClear: document.getElementById("btnFeatureSearchClear"),
    examDrawer: document.getElementById("examDrawer"),
    examBackdrop: document.getElementById("examBackdrop"),
    btnExamClose: document.getElementById("btnExamClose"),
    examPlay: document.getElementById("examPlay"),
    examResults: document.getElementById("examResults"),
    examResultsSummary: document.getElementById("examResultsSummary"),
    examWrongList: document.getElementById("examWrongList"),
    examImageWrap: document.getElementById("examImageWrap"),
    examImage: document.getElementById("examImage"),
    examChoices: document.getElementById("examChoices"),
    examFeedback: document.getElementById("examFeedback"),
    examScoreLine: document.getElementById("examScoreLine"),
    btnExamNext: document.getElementById("btnExamNext"),
    btnExamSubmit: document.getElementById("btnExamSubmit"),
    btnExamReset: document.getElementById("btnExamReset"),
    btnExamAgain: document.getElementById("btnExamAgain"),
    chatDrawer: document.getElementById("chatDrawer"),
    chatBackdrop: document.getElementById("chatBackdrop"),
    chatMessages: document.getElementById("chatMessages"),
    chatInput: document.getElementById("chatInput"),
    chatContextBanner: document.getElementById("chatContextBanner"),
    chatApiHint: document.getElementById("chatApiHint"),
    btnAgentPanel: document.getElementById("btnAgentPanel"),
    btnChatClose: document.getElementById("btnChatClose"),
    btnChatSend: document.getElementById("btnChatSend"),
    btnChatClear: document.getElementById("btnChatClear"),
    chatSettings: document.getElementById("chatSettings"),
    chatSettingUrl: document.getElementById("chatSettingUrl"),
    chatSettingUrlHint: document.getElementById("chatSettingUrlHint"),
    chatSettingKey: document.getElementById("chatSettingKey"),
    chatSettingKeyStatus: document.getElementById("chatSettingKeyStatus"),
    btnChatSettingSave: document.getElementById("btnChatSettingSave"),
    btnChatSettingTest: document.getElementById("btnChatSettingTest"),
    btnChatSettingClear: document.getElementById("btnChatSettingClear"),
    chatSettingTestStatus: document.getElementById("chatSettingTestStatus"),
    chatModeWorker: document.getElementById("chatModeWorker"),
    chatModeDirect: document.getElementById("chatModeDirect"),
    chatSettingModelWrap: document.getElementById("chatSettingModelWrap"),
    chatSettingModel: document.getElementById("chatSettingModel"),
  };

  /** 按菌名（与 slides 中 title 一致）索引的简介文案 */
  /** @type {Record<string, string>} */
  let introsByTitle = {};

  /** 全集 */
  /** @type {{id:string,title:string,image:string,about?:string}[]} */
  let allItems = [];
  /** 当前池：全集或复习池，再经菌名筛选 */
  /** @type {typeof allItems} */
  let items = [];
  let index = 0;
  /** 测验模式下是否已显示题号与菌名 */
  let revealed = true;
  /** @type {Set<string>} */
  let needReview = new Set();
  const loadedSrc = new Set();
  const preloadingSrc = new Set();
  let currentImageRel = "";
  let searchSaveTimer = null;
  let searchRebuildTimer = null;
  let toastTimer = null;
  let toastHideTimer = null;
  let celebrateCleanupTimer = null;
  /** 手机触摸滑动：左右滑动切换上一/下一张 */
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let swipeTriggeredByTouch = false;
  /** 当触摸起点在按钮/箭头等交互元素上时，不要触发滑动翻页 */
  let swipeIgnoreTouch = false;
  const SWIPE_MIN_X_PX = 45;
  const SWIPE_MAX_TIME_MS = 900;
  const SWIPE_Y_RATIO = 1.3;
  /** 测验模式下连续「会了」次数，点「不会」清零 */
  let quizKnowStreak = 0;
  /** 测验模式下本轮累计「会了」（取消测验模式后清零） */
  let quizKnowSessionTotal = 0;
  /** 全集中有多少条在复习池中（与 needReview / allItems 同步，避免每次渲染 O(n) 扫描） */
  let needReviewCountInDeck = 0;
  /** 为 true 时上一张/下一张按洗牌后的顺序（对应当前 items） */
  let randomOrderOn = false;
  /** @type {number[] | null} 为 null 表示顺序浏览；否则第 i 张为 items[randomPerm[i]] */
  let randomPerm = null;
  let featureDrawerOpen = false;
  let featureSearchTimer = null;
  let chatDrawerOpen = false;
  let examDrawerOpen = false;
  /** @type {'off'|'playing'|'results'|'error'} */
  let examPhase = "off";
  let examQueue = [];
  let examIndex = 0;
  /** @type {{ item: object, picked: string, ok: boolean }[]} */
  let examRecords = [];
  let examSession = { correct: 0, wrong: 0 };
  let examQuestion = null;
  /** @type {{role:string,content:string}[]} */
  let chatHistory = [];
  let chatSending = false;
  let chatTesting = false;

  function quizOn() {
    return Boolean(el.quizMode && el.quizMode.checked);
  }

  function reviewOnlyOn() {
    return Boolean(el.reviewOnly && el.reviewOnly.checked);
  }

  function initialRevealed() {
    return !quizOn();
  }

  function hideAnswer() {
    return quizOn() && !revealed;
  }

  function loadNeedReview() {
    try {
      const raw = localStorage.getItem(REVIEW_STORAGE_KEY);
      if (!raw) return new Set();
      const p = JSON.parse(raw);
      if (p && Array.isArray(p.ids)) {
        return new Set(p.ids.map(String));
      }
    } catch {
      /* ignore */
    }
    return new Set();
  }

  function saveNeedReview() {
    try {
      localStorage.setItem(
        REVIEW_STORAGE_KEY,
        JSON.stringify({ ids: Array.from(needReview) })
      );
    } catch {
      /* quota */
    }
  }

  function syncNeedReviewCountInDeck() {
    if (!allItems.length) {
      needReviewCountInDeck = 0;
      return;
    }
    let n = 0;
    allItems.forEach(function (x) {
      if (needReview.has(x.id)) n += 1;
    });
    needReviewCountInDeck = n;
  }

  function pruneNeedReview() {
    if (!allItems.length) {
      needReviewCountInDeck = 0;
      return;
    }
    const valid = new Set(
      allItems.map(function (x) {
        return x.id;
      })
    );
    let changed = false;
    needReview.forEach(function (id) {
      if (!valid.has(id)) {
        needReview.delete(id);
        changed = true;
      }
    });
    if (changed) saveNeedReview();
    syncNeedReviewCountInDeck();
  }

  function countNeedReviewInDeck() {
    return needReviewCountInDeck;
  }

  function loadRandomOrderPref() {
    try {
      return localStorage.getItem(RANDOM_ORDER_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function saveRandomOrderPref() {
    try {
      if (randomOrderOn) localStorage.setItem(RANDOM_ORDER_STORAGE_KEY, "1");
      else localStorage.removeItem(RANDOM_ORDER_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Fisher–Yates，返回 0..len-1 的一个排列 */
  function shufflePermutation(len) {
    const a = [];
    for (let i = 0; i < len; i += 1) a.push(i);
    for (let i = len - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function reshuffleRandomPerm() {
    if (randomOrderOn && items.length) {
      randomPerm = shufflePermutation(items.length);
    } else {
      randomPerm = null;
    }
  }

  /** 当前浏览位置对应的条目（考虑随机顺序排列） */
  function getCurrentItem() {
    if (!items.length || index < 0 || index >= items.length) return null;
    if (randomPerm && randomPerm.length === items.length) {
      const k = randomPerm[index];
      if (typeof k === "number" && k >= 0 && k < items.length) {
        return items[k];
      }
    }
    return items[index];
  }

  function displayPosForItemId(id) {
    if (!items.length) return 0;
    if (!randomPerm || randomPerm.length !== items.length) {
      const j = items.findIndex(function (x) {
        return x.id === id;
      });
      return j >= 0 ? j : 0;
    }
    for (let p = 0; p < randomPerm.length; p += 1) {
      if (items[randomPerm[p]].id === id) return p;
    }
    return 0;
  }

  function reviewPoolIsEmpty() {
    return reviewOnlyOn() && countNeedReviewInDeck() === 0;
  }

  function getNameSearchQuery() {
    return el.nameSearch ? String(el.nameSearch.value || "").trim() : "";
  }

  function introTextForItem(it) {
    if (!it) return "";
    const row = it.about != null ? String(it.about).trim() : "";
    if (row) return row;
    const t = it.title != null ? String(it.title) : "";
    return introsByTitle[t] || "";
  }

  function itemMatchesNameFilter(it, rawQuery) {
    const q = String(rawQuery || "").trim();
    if (!q) return true;
    const hay = String(it.title || "").toLowerCase();
    const introHay = introTextForItem(it).toLowerCase();
    const parts = q
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return parts.every(function (part) {
      return hay.indexOf(part) !== -1 || introHay.indexOf(part) !== -1;
    });
  }

  function rowMatchesFeatureQuery(row, rawQuery) {
    const q = String(rawQuery || "").trim();
    if (!q) return true;
    const titleHay = String(row.title || "").toLowerCase();
    const introHay = String(row.intro || "").toLowerCase();
    const parts = q
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return parts.every(function (part) {
      return titleHay.indexOf(part) !== -1 || introHay.indexOf(part) !== -1;
    });
  }

  function getUniqueSpeciesRows() {
    const map = new Map();
    allItems.forEach(function (it) {
      const t = it.title;
      if (!map.has(t)) {
        map.set(t, {
          title: t,
          intro: introTextForItem(it),
          count: 1,
        });
      } else {
        map.get(t).count += 1;
      }
    });
    return Array.from(map.values()).sort(function (a, b) {
      return a.title.localeCompare(b.title, "zh-CN");
    });
  }

  function setFeatureDrawer(open) {
    if (open && el.chatDrawer) {
      chatDrawerOpen = false;
      el.chatDrawer.classList.add("hidden");
      el.chatDrawer.setAttribute("aria-hidden", "true");
    }
    if (open && el.examDrawer) {
      examDrawerOpen = false;
      el.examDrawer.classList.add("hidden");
      el.examDrawer.setAttribute("aria-hidden", "true");
    }
    featureDrawerOpen = Boolean(open);
    if (!el.featureDrawer) return;
    el.featureDrawer.classList.toggle("hidden", !open);
    el.featureDrawer.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      renderFeatureListFiltered();
      if (el.featureSearch) {
        setTimeout(function () {
          el.featureSearch.focus();
        }, 0);
      }
    }
  }

  function getLocalSavedChatUrl() {
    try {
      const ls = localStorage.getItem(CHAT_API_URL_STORAGE_KEY);
      return ls && ls.trim() ? ls.trim() : "";
    } catch (e) {
      return "";
    }
  }

  function getChatMode() {
    try {
      return localStorage.getItem(CHAT_MODE_STORAGE_KEY) === "deepseek_direct"
        ? "deepseek_direct"
        : "worker";
    } catch (e) {
      return "worker";
    }
  }

  function isDeepseekDirectMode() {
    return getChatMode() === "deepseek_direct";
  }

  /** 自建代理（Worker）地址；直连模式不使用 */
  function getWorkerProxyUrl() {
    const local = getLocalSavedChatUrl();
    if (local && /^https?:\/\//i.test(local)) return local;
    try {
      const u = window.__MICROBE_CHAT_API__;
      return typeof u === "string" && /^https?:\/\//i.test(u.trim())
        ? u.trim()
        : "";
    } catch (e2) {
      return "";
    }
  }

  function getDeepseekModel() {
    try {
      const m = localStorage.getItem(CHAT_DEEPSEEK_MODEL_STORAGE_KEY);
      if (m === "deepseek-reasoner" || m === "deepseek-chat") return m;
    } catch (e) {
      /* ignore */
    }
    return "deepseek-chat";
  }

  function chatCanSend() {
    if (isDeepseekDirectMode()) {
      return Boolean(getStoredOpenaiKeyForRequest());
    }
    return Boolean(getWorkerProxyUrl());
  }

  function buildDirectSystemPrompt(ragContext) {
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

  function setChatSettingTestStatus(text, tone) {
    if (!el.chatSettingTestStatus) return;
    el.chatSettingTestStatus.textContent = String(text || "");
    if (tone === "error") {
      el.chatSettingTestStatus.setAttribute("data-tone", "error");
    } else if (tone === "success") {
      el.chatSettingTestStatus.setAttribute("data-tone", "success");
    } else if (tone === "loading") {
      el.chatSettingTestStatus.setAttribute("data-tone", "loading");
    } else {
      el.chatSettingTestStatus.removeAttribute("data-tone");
    }
  }

  function refreshChatActionState() {
    if (el.btnChatSend) {
      el.btnChatSend.disabled =
        !chatCanSend() || Boolean(chatSending) || Boolean(chatTesting);
      el.btnChatSend.textContent = chatSending ? "正在回答…" : "发送";
    }
    if (el.btnChatSettingTest) {
      el.btnChatSettingTest.disabled =
        !chatCanSend() || Boolean(chatSending) || Boolean(chatTesting);
      el.btnChatSettingTest.textContent = chatTesting ? "测试中…" : "测试连接";
    }
    if (el.btnChatClear) {
      el.btnChatClear.disabled = Boolean(chatSending) || Boolean(chatTesting);
    }
    if (el.chatInput) {
      el.chatInput.disabled = Boolean(chatSending);
      el.chatInput.setAttribute("aria-busy", chatSending ? "true" : "false");
    }
    if (el.chatMessages) {
      el.chatMessages.setAttribute(
        "aria-busy",
        chatSending || chatTesting ? "true" : "false"
      );
    }
  }

  function updateChatModeUi() {
    const direct = isDeepseekDirectMode();
    if (el.chatModeWorker) el.chatModeWorker.checked = !direct;
    if (el.chatModeDirect) el.chatModeDirect.checked = direct;
    setChatSettingTestStatus("");
    if (el.chatSettingUrlHint) {
      el.chatSettingUrlHint.textContent = direct
        ? "直连时实际请求发往 DeepSeek 官方；此处可预先填写或保留 Worker 地址，切回「自建代理」后即生效。"
        : "";
    }
    if (el.chatSettingModelWrap) {
      el.chatSettingModelWrap.classList.toggle("hidden", !direct);
    }
    if (el.chatSettingModel) {
      el.chatSettingModel.value = getDeepseekModel();
    }
  }

  function persistChatModeFromUi() {
    if (!el.chatModeWorker || !el.chatModeDirect) return;
    const direct = Boolean(el.chatModeDirect.checked);
    try {
      if (direct) {
        localStorage.setItem(CHAT_MODE_STORAGE_KEY, "deepseek_direct");
      } else {
        localStorage.removeItem(CHAT_MODE_STORAGE_KEY);
      }
    } catch (e) {
      /* ignore */
    }
    setChatSettingTestStatus("");
    updateChatModeUi();
    refreshChatChrome();
  }

  function getStoredOpenaiKeyForRequest() {
    try {
      const k = localStorage.getItem(CHAT_OPENAI_KEY_STORAGE_KEY);
      return k && k.trim() ? k.trim() : "";
    } catch (e) {
      return "";
    }
  }

  function hasStoredOpenaiKey() {
    return Boolean(getStoredOpenaiKeyForRequest());
  }

  function populateChatSettingsForm() {
    if (el.chatSettingUrl) {
      el.chatSettingUrl.value = getLocalSavedChatUrl();
    }
    if (el.chatSettingKey) {
      el.chatSettingKey.value = "";
    }
    updateChatModeUi();
    if (el.chatSettingKeyStatus) {
      if (isDeepseekDirectMode()) {
        el.chatSettingKeyStatus.textContent = hasStoredOpenaiKey()
          ? "直连模式：已保存 DeepSeek API 密钥。"
          : "直连模式：须填写并保存 DeepSeek 的 API 密钥（sk- 开头）。";
      } else {
        el.chatSettingKeyStatus.textContent = hasStoredOpenaiKey()
          ? "已在本机保存 API 密钥；更换请重新输入并点「保存」；留空保存则沿用原密钥。"
          : "未保存 API 密钥。若代理端已配置密钥可留空。";
      }
    }
  }

  function saveChatSettings() {
    const rawUrl = el.chatSettingUrl
      ? String(el.chatSettingUrl.value || "").trim()
      : "";
    const rawKey = el.chatSettingKey
      ? String(el.chatSettingKey.value || "").trim()
      : "";
    try {
      const directMode = isDeepseekDirectMode();
      if (rawUrl) {
        if (!/^https?:\/\//i.test(rawUrl)) {
          showToast("地址需为 http:// 或 https:// 开头", 2200);
          return;
        }
        localStorage.setItem(CHAT_API_URL_STORAGE_KEY, rawUrl);
      } else if (!directMode) {
        localStorage.removeItem(CHAT_API_URL_STORAGE_KEY);
      }
      if (rawKey) {
        localStorage.setItem(CHAT_OPENAI_KEY_STORAGE_KEY, rawKey);
      }
      if (el.chatSettingModel && isDeepseekDirectMode()) {
        const mv = String(el.chatSettingModel.value || "").trim();
        if (mv === "deepseek-reasoner" || mv === "deepseek-chat") {
          localStorage.setItem(CHAT_DEEPSEEK_MODEL_STORAGE_KEY, mv);
        }
      }
      if (el.chatSettingKey) el.chatSettingKey.value = "";
      setChatSettingTestStatus("");
      populateChatSettingsForm();
      showToast("连接设置已保存到本机浏览器", 2200);
      refreshChatChrome();
    } catch (e) {
      showToast("无法写入本地存储", 2400);
    }
  }

  function clearChatConnectionSettings() {
    try {
      localStorage.removeItem(CHAT_API_URL_STORAGE_KEY);
      localStorage.removeItem(CHAT_OPENAI_KEY_STORAGE_KEY);
      localStorage.removeItem(CHAT_MODE_STORAGE_KEY);
      localStorage.removeItem(CHAT_DEEPSEEK_MODEL_STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
    if (el.chatModeWorker) el.chatModeWorker.checked = true;
    if (el.chatModeDirect) el.chatModeDirect.checked = false;
    setChatSettingTestStatus("");
    populateChatSettingsForm();
    showToast("已清除本机保存的地址、密钥与直连选项", 2200);
    refreshChatChrome();
  }

  function setChatDrawer(open) {
    if (open && el.featureDrawer) {
      featureDrawerOpen = false;
      el.featureDrawer.classList.add("hidden");
      el.featureDrawer.setAttribute("aria-hidden", "true");
    }
    if (open && el.examDrawer) {
      examDrawerOpen = false;
      el.examDrawer.classList.add("hidden");
      el.examDrawer.setAttribute("aria-hidden", "true");
    }
    chatDrawerOpen = Boolean(open);
    if (!el.chatDrawer) return;
    el.chatDrawer.classList.toggle("hidden", !open);
    el.chatDrawer.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      if (el.chatSettings && !chatCanSend()) {
        el.chatSettings.open = true;
      }
      refreshChatChrome();
      setTimeout(function () {
        if (!chatCanSend()) {
          if (isDeepseekDirectMode() && el.chatSettingKey) {
            el.chatSettingKey.focus();
          } else if (!isDeepseekDirectMode() && el.chatSettingUrl) {
            el.chatSettingUrl.focus();
          }
        } else if (el.chatInput) {
          el.chatInput.focus();
        }
      }, 0);
    }
  }

  function shuffleArrayCopy(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function getAllSpeciesTitlesInDeck() {
    const s = new Set();
    allItems.forEach(function (it) {
      const t = String(it.title || "").trim();
      if (t) s.add(t);
    });
    return Array.from(s);
  }

  function itemEligibleForExam(it) {
    if (!itemMatchesNameFilter(it, getNameSearchQuery())) return false;
    if (reviewOnlyOn() && !needReview.has(it.id)) return false;
    return true;
  }

  function getExamItemDeck() {
    return allItems.filter(itemEligibleForExam);
  }

  function showExamPlayUi() {
    if (el.examPlay) el.examPlay.classList.remove("hidden");
    if (el.examResults) {
      el.examResults.classList.add("hidden");
      el.examResults.setAttribute("aria-hidden", "true");
    }
  }

  function showExamResultsUi() {
    if (el.examPlay) el.examPlay.classList.add("hidden");
    if (el.examResults) {
      el.examResults.classList.remove("hidden");
      el.examResults.setAttribute("aria-hidden", "false");
    }
  }

  function renderExamScoreLine() {
    if (!el.examScoreLine) return;
    if (examPhase !== "playing") {
      el.examScoreLine.textContent = "";
      return;
    }
    const cur = Math.min(examIndex + 1, EXAM_TOTAL);
    el.examScoreLine.textContent =
      "第 " +
      cur +
      " / " +
      EXAM_TOTAL +
      " 题 · 本场答对 " +
      examSession.correct +
      " · 答错 " +
      examSession.wrong;
  }

  function mountExamChoices(choices) {
    if (!el.examChoices) return;
    el.examChoices.innerHTML = "";
    choices.forEach(function (title) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "exam-choice";
      btn.setAttribute("data-title", title);
      btn.textContent = title;
      btn.addEventListener("click", function () {
        if (examPhase !== "playing" || !examQuestion || examQuestion.answered) {
          return;
        }
        examQuestion.answered = true;
        examQuestion.picked = title;
        const ok = title === String(examQuestion.item.title || "").trim();
        if (ok) examSession.correct += 1;
        else examSession.wrong += 1;
        examRecords.push({
          n: examIndex + 1,
          item: examQuestion.item,
          picked: title,
          ok: ok,
        });
        if (el.examFeedback) {
          el.examFeedback.textContent = "";
          el.examFeedback.classList.add("hidden");
        }
        if (examIndex < EXAM_TOTAL - 1) {
          examIndex += 1;
          showCurrentExamQuestion();
        } else {
          submitExamRun();
        }
      });
      el.examChoices.appendChild(btn);
    });
  }

  function showExamSetupError(msg) {
    examPhase = "error";
    examQueue = [];
    examIndex = 0;
    examRecords = [];
    examQuestion = null;
    examSession = { correct: 0, wrong: 0 };
    showExamPlayUi();
    if (el.examImageWrap) el.examImageWrap.classList.add("hidden");
    if (el.examChoices) {
      el.examChoices.innerHTML = "";
      el.examChoices.classList.add("hidden");
    }
    if (el.examFeedback) {
      el.examFeedback.classList.remove("hidden");
      el.examFeedback.textContent = msg;
    }
    if (el.btnExamNext) {
      el.btnExamNext.textContent = "再试";
      el.btnExamNext.classList.remove("hidden");
      el.btnExamNext.disabled = false;
    }
    if (el.btnExamSubmit) {
      el.btnExamSubmit.classList.add("hidden");
      el.btnExamSubmit.disabled = true;
    }
    renderExamScoreLine();
  }

  function showCurrentExamQuestion() {
    if (!el.examImageWrap || !el.examChoices || !el.examImage) return;
    if (el.examFeedback) {
      el.examFeedback.textContent = "";
      el.examFeedback.classList.add("hidden");
    }
    if (el.btnExamNext) {
      el.btnExamNext.textContent = "下一题";
      el.btnExamNext.classList.add("hidden");
      el.btnExamNext.disabled = true;
    }
    if (el.btnExamSubmit) {
      el.btnExamSubmit.classList.add("hidden");
      el.btnExamSubmit.disabled = true;
    }
    el.examChoices.classList.remove("hidden");
    el.examImageWrap.classList.remove("hidden");

    if (!examQueue.length || examIndex >= examQueue.length) {
      showExamSetupError("抽题数据异常，请点「再试」。");
      return;
    }
    const picked = examQueue[examIndex];
    const titles = getAllSpeciesTitlesInDeck();
    const correctTitle = String(picked.title || "").trim();
    const wrongPool = titles.filter(function (t) {
      return t !== correctTitle;
    });
    const shuffledWrong = shuffleArrayCopy(wrongPool);
    const maxWrong = Math.min(3, shuffledWrong.length);
    const wrongs = shuffledWrong.slice(0, maxWrong);
    const choices = shuffleArrayCopy([correctTitle].concat(wrongs));

    examQuestion = {
      item: picked,
      choices: choices,
      answered: false,
    };

    el.examImage.alt = "菌落图（请识别）";
    el.examImage.src = picked.image;
    mountExamChoices(choices);
    renderExamScoreLine();
  }

  function startExamRun() {
    if (!el.examImageWrap || !el.examChoices || !el.examImage) return;
    examPhase = "playing";
    examQueue = [];
    examIndex = 0;
    examRecords = [];
    examQuestion = null;
    examSession = { correct: 0, wrong: 0 };
    showExamPlayUi();

    const titles = getAllSpeciesTitlesInDeck();
    if (titles.length < 2) {
      showExamSetupError(
        "全库至少需有 2 个不同菌名才能进行选择题考试，请先在数据中补充更多菌种。"
      );
      return;
    }
    const deck = getExamItemDeck();
    if (deck.length < EXAM_TOTAL) {
      showExamSetupError(
        "当前「菌名筛选」或「仅复习不会的」条件下可抽题目不足 " +
          EXAM_TOTAL +
          " 道（当前 " +
          deck.length +
          " 道），请放宽筛选或先退出「仅复习不会的」后再试。"
      );
      return;
    }
    examQueue = shuffleArrayCopy(deck).slice(0, EXAM_TOTAL);
    examIndex = 0;
    showCurrentExamQuestion();
  }

  function buildExamWrongChatPrompt(rec) {
    return (
      "我在刚才的 " +
      EXAM_TOTAL +
      " 题考试第 " +
      (rec && rec.n ? rec.n : "?") +
      " 题选错了：我选了「" +
      (rec && rec.picked ? rec.picked : "") +
      "」，正确是「" +
      (rec && rec.item && rec.item.title ? rec.item.title : "") +
      "」。请只依据本站【当前图谱条目】的文字资料，先带我观察菌落形态上有哪些肉眼可见的依据，再给出 2～3 个容易混淆的鉴别要点；未在资料中出现的形态细节请勿臆测。"
    );
  }

  /** 定位到指定条目（自学/错题回顾）；成功返回 true */
  function jumpToItemByIdForStudy(it) {
    if (!it || !allItems.length) return false;
    const targetId = String(it.id != null ? it.id : "");
    if (!targetId) return false;
    const exists = allItems.some(function (x) {
      return String(x.id) === targetId;
    });
    if (!exists) {
      showToast("图库中已找不到该条目", 2200);
      return false;
    }
    if (el.quizMode) el.quizMode.checked = false;
    if (el.reviewOnly) el.reviewOnly.checked = false;
    const t = String(it.title || "").trim();
    if (el.nameSearch) el.nameSearch.value = t;
    try {
      localStorage.setItem(SEARCH_STORAGE_KEY, t);
    } catch (e) {
      /* ignore */
    }
    rebuildPool();
    reshuffleRandomPerm();
    let ni = items.findIndex(function (x) {
      return String(x.id) === targetId;
    });
    if (ni < 0) {
      if (el.nameSearch) el.nameSearch.value = "";
      try {
        localStorage.removeItem(SEARCH_STORAGE_KEY);
      } catch (e2) {
        /* ignore */
      }
      rebuildPool();
      reshuffleRandomPerm();
      ni = items.findIndex(function (x) {
        return String(x.id) === targetId;
      });
      if (ni < 0) {
        showToast("当前列表中找不到该图，请稍后重试。", 2600);
        return false;
      }
    }
    index = randomPerm ? displayPosForItemId(targetId) : ni;
    revealed = initialRevealed();
    hideExamDrawerKeepSession();
    setFeatureDrawer(false);
    renderDetail();
    try {
      if (el.detailCard) {
        el.detailCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } catch (e3) {
      /* ignore */
    }
    syncFeaturePanelButton();
    return true;
  }

  function openStudyChatFromExamWrong(rec) {
    if (!jumpToItemByIdForStudy(rec.item)) return;
    if (el.chatInput) {
      el.chatInput.value = buildExamWrongChatPrompt(rec);
    }
    setChatDrawer(true);
  }

  function renderExamResultsReport() {
    if (!el.examResultsSummary || !el.examWrongList) return;
    const c = examSession.correct;
    el.examResultsSummary.textContent =
      "得分：" + c + " / " + EXAM_TOTAL + "（答错 " + (EXAM_TOTAL - c) + " 题）";
    el.examWrongList.innerHTML = "";
    const wrongs = examRecords.filter(function (r) {
      return !r.ok;
    });
    if (!wrongs.length) {
      const p = document.createElement("p");
      p.className = "exam-results-summary";
      p.textContent = "没有错题，全部答对。";
      el.examWrongList.appendChild(p);
      return;
    }
    const h = document.createElement("p");
    h.className = "exam-results-summary";
    h.style.marginBottom = "0.25rem";
    h.textContent = "答错的题：";
    el.examWrongList.appendChild(h);
    wrongs.forEach(function (rec) {
      const card = document.createElement("div");
      card.className = "exam-wrong-card";
      const img = document.createElement("img");
      img.className = "exam-wrong-thumb";
      img.alt = "";
      img.src = rec.item.image;
      const body = document.createElement("div");
      body.className = "exam-wrong-body";
      const p1 = document.createElement("p");
      p1.textContent = "第 " + (rec.n || "?") + " 题";
      const p2 = document.createElement("p");
      p2.textContent = "你的答案：「" + rec.picked + "」";
      const p3 = document.createElement("p");
      p3.textContent = "正确答案：「" + rec.item.title + "」";
      body.appendChild(p1);
      body.appendChild(p2);
      body.appendChild(p3);
      const actions = document.createElement("div");
      actions.className = "exam-wrong-actions";
      const btnChat = document.createElement("button");
      btnChat.type = "button";
      btnChat.className = "nav-btn";
      btnChat.textContent = "智能讲解";
      btnChat.addEventListener("click", function () {
        openStudyChatFromExamWrong(rec);
      });
      actions.appendChild(btnChat);
      card.appendChild(img);
      card.appendChild(body);
      card.appendChild(actions);
      el.examWrongList.appendChild(card);
    });
  }

  function submitExamRun() {
    if (examPhase !== "playing") return;
    if (examIndex !== EXAM_TOTAL - 1 || !examQuestion || !examQuestion.answered) {
      return;
    }
    if (examRecords.length !== EXAM_TOTAL) return;
    examPhase = "results";
    if (el.btnExamSubmit) el.btnExamSubmit.disabled = true;
    showExamResultsUi();
    renderExamResultsReport();
  }

  function resetExamSession() {
    if (examDrawerOpen) {
      startExamRun();
      showToast("已重新抽题并开始新一轮", 2000);
    } else {
      examPhase = "off";
      examQueue = [];
      examIndex = 0;
      examRecords = [];
      examQuestion = null;
      examSession = { correct: 0, wrong: 0 };
    }
  }

  function onExamNextOrRetry() {
    if (!examDrawerOpen) return;
    startExamRun();
  }

  /** 仅收起考试抽屉，不结束当前场次（用于切去智能讲解等） */
  function hideExamDrawerKeepSession() {
    examDrawerOpen = false;
    if (el.examDrawer) {
      el.examDrawer.classList.add("hidden");
      el.examDrawer.setAttribute("aria-hidden", "true");
    }
  }

  function setExamDrawer(open) {
    if (open && el.featureDrawer) {
      featureDrawerOpen = false;
      el.featureDrawer.classList.add("hidden");
      el.featureDrawer.setAttribute("aria-hidden", "true");
    }
    if (open && el.chatDrawer) {
      chatDrawerOpen = false;
      el.chatDrawer.classList.add("hidden");
      el.chatDrawer.setAttribute("aria-hidden", "true");
    }
    examDrawerOpen = Boolean(open);
    if (!el.examDrawer) return;
    el.examDrawer.classList.toggle("hidden", !open);
    el.examDrawer.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      const canResumePlaying =
        examPhase === "playing" &&
        examQueue.length === EXAM_TOTAL &&
        examRecords.length < EXAM_TOTAL;
      const canResumeResults =
        examPhase === "results" && examRecords.length === EXAM_TOTAL;
      if (canResumePlaying) {
        showExamPlayUi();
        showCurrentExamQuestion();
        syncFeaturePanelButton();
      } else if (canResumeResults) {
        showExamResultsUi();
        renderExamResultsReport();
        syncFeaturePanelButton();
      } else {
        startExamRun();
      }
    } else {
      examPhase = "off";
    }
  }

  function refreshChatChrome() {
    populateChatSettingsForm();
    const direct = isDeepseekDirectMode();
    const workerUrl = getWorkerProxyUrl();
    if (el.chatApiHint) {
      if (chatCanSend()) {
        el.chatApiHint.classList.add("hidden");
        el.chatApiHint.textContent = "";
      } else if (direct) {
        el.chatApiHint.classList.remove("hidden");
        el.chatApiHint.textContent =
          "直连模式：请填写并保存 DeepSeek 的 API 密钥。若保存后仍无法对话，可能是浏览器跨域限制，需改用「自建代理」。";
      } else {
        el.chatApiHint.classList.remove("hidden");
        el.chatApiHint.textContent =
          "尚未配置代理地址：在下方选择「自建代理」并填写 Worker 的 HTTPS 地址，或由管理员配置 js/chat-config.js。";
      }
    }
    refreshChatActionState();
    updateChatContextBanner();
    renderChatMessages();
  }

  function updateChatContextBanner() {
    if (!el.chatContextBanner) return;
    if (!allItems.length) {
      el.chatContextBanner.textContent =
        "当前无图谱数据，对话将无具体条目上下文。";
      return;
    }
    if (hideAnswer()) {
      el.chatContextBanner.textContent =
        "当前为「测验模式」且未显示答案：不会向模型发送菌种名与全文特征介绍，仅作泛在学习提示。";
      return;
    }
    const it = getCurrentItem();
    if (!it) {
      el.chatContextBanner.textContent = "未选中条目。";
      return;
    }
    el.chatContextBanner.textContent =
      "当前浏览：" + it.title + "（" + it.id + "）。下方资料会一并送给模型。";
  }

  /** 将 **加粗** 转为 <strong>；不成对的 ** 原样显示 */
  function appendTextWithBoldMarkdown(p, rawLine) {
    const line = String(rawLine);
    const parts = line.split("**");
    if (parts.length === 1) {
      p.appendChild(document.createTextNode(line));
      return;
    }
    if ((parts.length - 1) % 2 !== 0) {
      p.appendChild(document.createTextNode(line));
      return;
    }
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      if (i % 2 === 0) {
        if (seg) p.appendChild(document.createTextNode(seg));
      } else {
        const strong = document.createElement("strong");
        strong.className = "agent-msg-strong";
        strong.textContent = seg;
        p.appendChild(strong);
      }
    }
  }

  /** 段落内按单换行拆成多行，每行再处理 **…** */
  function appendChatRichParagraph(parent, paragraph, className) {
    const p = document.createElement("p");
    p.className = className;
    const lines = String(paragraph || "").split("\n");
    lines.forEach(function (ln, idx) {
      if (idx > 0) p.appendChild(document.createElement("br"));
      appendTextWithBoldMarkdown(p, ln);
    });
    parent.appendChild(p);
  }

  function appendChatTextParagraphs(parent, text, className) {
    const chunks = String(text || "")
      .trim()
      .split(/\n{2,}/)
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
    if (!chunks.length) return;
    chunks.forEach(function (part) {
      appendChatRichParagraph(parent, part, className);
    });
  }

  function parseAssistantSections(text) {
    const raw = String(text || "").replace(/\r/g, "").trim();
    if (!raw) return [];
    const reg = /(?:^|\n)(?:#{1,3}\s*)?[【\[]?(本站资料|通用补充)[】\]]?[：:]?\s*(?=\n|$)/g;
    const hits = [];
    let m;
    while ((m = reg.exec(raw))) {
      hits.push({
        label: m[1] === "本站资料" ? "本站资料" : "通用补充",
        start: m.index,
        bodyStart: reg.lastIndex,
      });
    }
    if (!hits.length) return [];
    return hits
      .map(function (hit, idx) {
        const next = hits[idx + 1];
        const body = raw
          .slice(hit.bodyStart, next ? next.start : raw.length)
          .trim();
        return { label: hit.label, body: body || "暂无额外补充。" };
      })
      .filter(function (part) {
        return Boolean(part.label);
      });
  }

  function renderAssistantMessage(div, text) {
    const sections = parseAssistantSections(text);
    if (!sections.length) {
      appendChatTextParagraphs(div, text, "agent-msg-text");
      return;
    }
    sections.forEach(function (section) {
      const block = document.createElement("section");
      block.className = "agent-msg-section";
      const title = document.createElement("p");
      title.className = "agent-msg-section-title";
      title.textContent = section.label;
      block.appendChild(title);
      appendChatTextParagraphs(block, section.body, "agent-msg-text");
      div.appendChild(block);
    });
  }

  function renderChatMessages() {
    if (!el.chatMessages) return;
    el.chatMessages.innerHTML = "";
    chatHistory.forEach(function (m) {
      const div = document.createElement("div");
      const cls =
        m.role === "user"
          ? "agent-msg--user"
          : m.role === "error"
            ? "agent-msg--error"
            : "agent-msg--assistant";
      div.className = "agent-msg " + cls;
      if (m.role === "assistant") {
        renderAssistantMessage(div, m.content);
      } else {
        div.textContent = m.content;
      }
      el.chatMessages.appendChild(div);
    });
    if (chatSending) {
      const pending = document.createElement("div");
      pending.className = "agent-msg agent-msg--pending";
      pending.textContent = "正在整理本站资料并生成回答…";
      el.chatMessages.appendChild(pending);
    }
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function buildChatRagForRequest() {
    if (hideAnswer()) {
      return (
        "【测验模式·未揭晓】用户正在使用本图谱的测验模式浏览一张菌落平板图，尚未点击显示答案。" +
        "请勿在回答中出现或暗示具体菌种名称（中英文及缩写），也不要复述本网站按菌名索引的特征介绍；" +
        "只能泛泛讨论如何从溶血、色素、气味、菌落大小与边缘等角度进行观察与学习。"
      );
    }
    const it = getCurrentItem();
    if (!it) {
      return "【当前无选中条目】用户可能在浏览空列表或加载中。";
    }
    const intro = introTextForItem(it);
    return (
      "【当前图谱条目】编号：" +
      it.id +
      "\n菌名：" +
      it.title +
      "\n【本站收录的菌落/培养特征介绍】\n" +
      (intro || "（该条目暂无文字介绍）")
    );
  }

  function clearChatHistory() {
    chatHistory = [];
    renderChatMessages();
  }

  /** 兼容自建代理返回 { reply } 或上游原生 OpenAI 格式 choices[0].message.content */
  function extractChatReplyFromJson(data) {
    if (!data || typeof data !== "object") return "";
    if (typeof data.reply === "string" && data.reply.trim()) {
      return data.reply.trim();
    }
    try {
      const c =
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content;
      if (typeof c === "string" && c.trim()) return c.trim();
    } catch (e) {
      /* ignore */
    }
    return "";
  }

  function formatUpstreamErrorPayload(data, res) {
    let t = "请求失败 " + String(res.status);
    if (!data || typeof data !== "object") return t;
    if (typeof data.error === "string") return t + ": " + data.error;
    if (data.error && typeof data.error.message === "string") {
      return data.error.message;
    }
    return t;
  }

  async function requestChatCompletion(payloadMessages, rag) {
    let res;
    let data = {};
    if (isDeepseekDirectMode()) {
      const key = getStoredOpenaiKeyForRequest();
      if (!key) {
        throw new Error("未找到已保存的 API 密钥");
      }
      const systemContent = buildDirectSystemPrompt(rag);
      const dsMessages = [{ role: "system", content: systemContent }].concat(
        payloadMessages
      );
      try {
        res = await fetch(DEEPSEEK_DIRECT_URL, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: getDeepseekModel(),
            messages: dsMessages,
            stream: false,
          }),
        });
      } catch (netErr) {
        throw new Error(
          "无法连接 DeepSeek（常见为浏览器跨域拦截）。请改用「自建代理」并在地址栏填写 Worker。"
        );
      }
      try {
        data = await res.json();
      } catch (e2) {
        data = {};
      }
      if (!res.ok) {
        throw new Error(formatUpstreamErrorPayload(data, res));
      }
    } else {
      const url = getWorkerProxyUrl();
      const keyForBody = getStoredOpenaiKeyForRequest();
      const reqBody = {
        messages: payloadMessages,
        ragContext: rag,
      };
      if (keyForBody) {
        reqBody.openaiApiKey = keyForBody;
      }
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
      try {
        data = await res.json();
      } catch (e2) {
        data = {};
      }
      if (!res.ok) {
        throw new Error(formatUpstreamErrorPayload(data, res));
      }
      if (data && data.error) {
        throw new Error(String(data.error));
      }
    }
    return data;
  }

  async function testChatConnection() {
    if (!chatCanSend()) {
      showToast(
        isDeepseekDirectMode()
          ? "直连模式请先填写并保存 API 密钥"
          : "请先填写并保存自建代理的 HTTPS 地址",
        2400
      );
      return;
    }
    if (chatSending || chatTesting) return;
    chatTesting = true;
    setChatSettingTestStatus("正在测试连接，请稍候…", "loading");
    refreshChatActionState();
    try {
      const data = await requestChatCompletion(
        [{ role: "user", content: "请仅回复“连接测试成功”。" }],
        "【连接测试】请忽略图谱问答场景，仅用于确认接口可访问。"
      );
      const reply = extractChatReplyFromJson(data);
      setChatSettingTestStatus(
        reply
          ? "连接成功：" + reply.slice(0, 48)
          : "连接成功：接口已返回可解析结果。",
        "success"
      );
      showToast("连接测试成功", 1800);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      setChatSettingTestStatus("连接失败：" + msg, "error");
      showToast("连接测试失败", 1800);
    } finally {
      chatTesting = false;
      refreshChatActionState();
    }
  }

  async function sendChat() {
    if (!chatCanSend()) {
      showToast(
        isDeepseekDirectMode()
          ? "直连模式请先填写并保存 API 密钥"
          : "请先填写并保存自建代理的 HTTPS 地址",
        2400
      );
      return;
    }
    const raw = el.chatInput ? String(el.chatInput.value || "").trim() : "";
    if (!raw) {
      showToast("请先输入问题", 1600);
      return;
    }
    if (chatSending || chatTesting) return;
    chatSending = true;
    refreshChatActionState();
    if (el.chatInput) el.chatInput.value = "";
    chatHistory.push({ role: "user", content: raw });
    chatHistory = chatHistory.slice(-24);
    renderChatMessages();
    try {
      const rag = buildChatRagForRequest();
      const payloadMessages = chatHistory
        .filter(function (m) {
          return m.role === "user" || m.role === "assistant";
        })
        .map(function (m) {
          return { role: m.role, content: m.content };
        });
      const data = await requestChatCompletion(payloadMessages, rag);
      const reply = extractChatReplyFromJson(data);
      if (!reply) {
        throw new Error(
          "未收到模型回复（代理需返回 reply 或 OpenAI 格式 choices[0].message）"
        );
      }
      chatHistory.push({ role: "assistant", content: reply });
      chatHistory = chatHistory.slice(-24);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      chatHistory.push({
        role: "error",
        content: "（请求出错）" + msg,
      });
      chatHistory = chatHistory.slice(-24);
    } finally {
      chatSending = false;
      refreshChatActionState();
      renderChatMessages();
      if (chatDrawerOpen) {
        updateChatContextBanner();
      }
    }
  }

  function renderFeatureListFiltered() {
    if (!el.featureList) return;
    const q = el.featureSearch ? String(el.featureSearch.value || "").trim() : "";
    const rows = getUniqueSpeciesRows();
    const filtered = rows.filter(function (row) {
      return rowMatchesFeatureQuery(row, q);
    });
    if (el.featureEmpty) {
      if (!rows.length) {
        el.featureEmpty.textContent = "暂无图谱数据";
        el.featureEmpty.classList.remove("hidden");
      } else if (!filtered.length) {
        el.featureEmpty.textContent =
          "没有匹配的菌种，请换关键词或点「清空」";
        el.featureEmpty.classList.remove("hidden");
      } else {
        el.featureEmpty.classList.add("hidden");
      }
    }
    el.featureList.innerHTML = "";
    filtered.forEach(function (row) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "feature-card";
      const h = document.createElement("p");
      h.className = "feature-card-title";
      h.textContent = row.title;
      card.appendChild(h);
      const meta = document.createElement("p");
      meta.className = "feature-card-meta";
      meta.textContent = "本图谱共 " + row.count + " 张图";
      card.appendChild(meta);
      const body = document.createElement("p");
      body.className = "feature-card-body";
      body.textContent =
        row.intro ||
        "暂无文字介绍，可在 data/microbe_intros.json 中补充。";
      card.appendChild(body);
      card.addEventListener("click", function () {
        jumpToSpecies(row.title);
      });
      el.featureList.appendChild(card);
    });
  }

  function jumpToSpecies(title) {
    const t = String(title || "").trim();
    if (!t || !allItems.length) return;
    if (el.quizMode) el.quizMode.checked = false;
    if (el.reviewOnly) el.reviewOnly.checked = false;
    if (el.nameSearch) el.nameSearch.value = t;
    try {
      localStorage.setItem(SEARCH_STORAGE_KEY, t);
    } catch (e) {
      /* ignore */
    }
    rebuildPool();
    reshuffleRandomPerm();
    index = 0;
    revealed = initialRevealed();
    setFeatureDrawer(false);
    setExamDrawer(false);
    renderDetail();
    try {
      if (el.detailCard) {
        el.detailCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } catch (e2) {
      /* ignore */
    }
  }

  function flushFeatureListFilter() {
    if (featureSearchTimer) {
      clearTimeout(featureSearchTimer);
      featureSearchTimer = null;
    }
    renderFeatureListFiltered();
  }

  function scheduleFeatureListFilter() {
    if (featureSearchTimer) clearTimeout(featureSearchTimer);
    featureSearchTimer = setTimeout(function () {
      featureSearchTimer = null;
      renderFeatureListFiltered();
    }, FEATURE_SEARCH_DEBOUNCE_MS);
  }

  function syncFeaturePanelButton() {
    if (el.btnFeaturePanel) {
      el.btnFeaturePanel.disabled = !allItems.length;
    }
    if (el.btnExamPanel) {
      const titles = getAllSpeciesTitlesInDeck();
      const deckLen = getExamItemDeck().length;
      const examSessionActive =
        examPhase === "playing" ||
        examPhase === "results" ||
        examPhase === "error";
      el.btnExamPanel.disabled =
        !allItems.length ||
        titles.length < 2 ||
        (!examSessionActive && deckLen < EXAM_TOTAL);
    }
  }

  function rebuildPool() {
    pruneNeedReview();
    let base = allItems;
    if (reviewOnlyOn()) {
      base = allItems.filter(function (x) {
        return needReview.has(x.id);
      });
    }
    const q = getNameSearchQuery();
    items = base.filter(function (x) {
      return itemMatchesNameFilter(x, q);
    });
    if (index >= items.length) {
      index = Math.max(0, items.length - 1);
    }
  }

  function applyPoolRebuild() {
    const cur = getCurrentItem();
    const curId = cur ? cur.id : null;
    rebuildPool();
    reshuffleRandomPerm();
    if (curId) {
      const ni = items.findIndex(function (x) {
        return x.id === curId;
      });
      if (ni >= 0) {
        index = randomPerm ? displayPosForItemId(curId) : ni;
      } else {
        index = Math.min(index, Math.max(0, items.length - 1));
      }
    } else {
      index = Math.min(index, Math.max(0, items.length - 1));
    }
    revealed = initialRevealed();
    persistSearchSoon();
    renderDetail();
  }

  function applySearchRebuild() {
    applyPoolRebuild();
  }

  function flushSearchRebuild() {
    if (searchRebuildTimer) {
      clearTimeout(searchRebuildTimer);
      searchRebuildTimer = null;
    }
    applySearchRebuild();
  }

  function scheduleSearchRebuild() {
    if (searchRebuildTimer) clearTimeout(searchRebuildTimer);
    searchRebuildTimer = setTimeout(function () {
      searchRebuildTimer = null;
      applySearchRebuild();
    }, SEARCH_REBUILD_DEBOUNCE_MS);
  }

  function persistSearchSoon() {
    if (searchSaveTimer) clearTimeout(searchSaveTimer);
    searchSaveTimer = setTimeout(function () {
      searchSaveTimer = null;
      try {
        const v = getNameSearchQuery();
        if (v) localStorage.setItem(SEARCH_STORAGE_KEY, v);
        else localStorage.removeItem(SEARCH_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }, 320);
  }

  function showToast(msg, ms, celebrate) {
    const duration = typeof ms === "number" && ms > 0 ? ms : 2000;
    if (!el.toast) return;
    if (toastTimer) clearTimeout(toastTimer);
    if (toastHideTimer) clearTimeout(toastHideTimer);
    el.toast.textContent = msg;
    el.toast.classList.remove("hidden", "is-out");
    el.toast.classList.toggle("toast--celebrate", Boolean(celebrate));
    toastTimer = setTimeout(function () {
      el.toast.classList.add("is-out");
      toastHideTimer = setTimeout(function () {
        el.toast.classList.add("hidden");
        el.toast.classList.remove("is-out", "toast--celebrate");
      }, 280);
    }, duration);
  }

  /** 测验模式累计答对满 5、10、15… 题时播放庆贺动画 + 鼓励文案 */
  function maybePlayQuizCelebrate() {
    if (!quizOn()) return;
    if (
      quizKnowSessionTotal <= 0 ||
      quizKnowSessionTotal % QUIZ_CELEBRATE_EVERY !== 0
    ) {
      return;
    }
    playCelebrateAnimation();
    showQuizCheerToast(quizKnowSessionTotal);
  }

  function showQuizCheerToast(total) {
    var openers = ["太棒啦", "真厉害", "好样的", "棒棒哒", "漂亮"];
    var o = openers[Math.floor(Math.random() * openers.length)];
    showToast(o + "！本轮已累计答对 " + total + " 题", 3200, true);
  }

  function playCelebrateAnimation() {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
    } catch {
      /* ignore */
    }
    var root = el.celebrateOverlay;
    if (!root) return;
    if (celebrateCleanupTimer) {
      clearTimeout(celebrateCleanupTimer);
      celebrateCleanupTimer = null;
    }
    root.innerHTML = "";
    root.classList.remove("hidden");
    root.setAttribute("aria-hidden", "false");

    var n = 48;
    var i;
    var w = window.innerWidth;
    var h = window.innerHeight;
    var cx = w * 0.5;
    var cy = h * 0.38;
    for (i = 0; i < n; i += 1) {
      var p = document.createElement("span");
      p.className = "celebrate-particle";
      var angle = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.4;
      var dist = 100 + Math.random() * Math.min(w, h) * 0.22;
      var tx = Math.cos(angle) * dist;
      var ty = Math.sin(angle) * dist;
      var rot = Math.random() * 540 - 270;
      p.style.setProperty("--tx", tx.toFixed(1) + "px");
      p.style.setProperty("--ty", ty.toFixed(1) + "px");
      p.style.setProperty("--rot", rot.toFixed(1) + "deg");
      p.style.setProperty("--hue", String(Math.floor(Math.random() * 360)));
      p.style.setProperty("--delay", (Math.random() * 0.12).toFixed(3) + "s");
      p.style.left = cx + "px";
      p.style.top = cy + "px";
      root.appendChild(p);
    }

    var burst = document.createElement("div");
    burst.className = "celebrate-burst";
    burst.setAttribute("aria-hidden", "true");
    burst.style.left = cx + "px";
    burst.style.top = cy + "px";
    root.appendChild(burst);

    celebrateCleanupTimer = setTimeout(function () {
      celebrateCleanupTimer = null;
      root.classList.add("hidden");
      root.setAttribute("aria-hidden", "true");
      root.innerHTML = "";
    }, 1450);
  }

  function setNavDisabled(disabled) {
    if (el.btnPrev) el.btnPrev.disabled = disabled;
    if (el.btnNext) el.btnNext.disabled = disabled;
    if (el.btnArrowPrev) el.btnArrowPrev.disabled = disabled;
    if (el.btnArrowNext) el.btnArrowNext.disabled = disabled;
  }

  function setKnowDisabled(disabled) {
    if (el.btnKnow) el.btnKnow.disabled = disabled;
    if (el.btnNotKnow) el.btnNotKnow.disabled = disabled;
  }

  function applyRevealUi() {
    const hidden = hideAnswer();
    const hasItem = Boolean(getCurrentItem());
    const quiz = quizOn();
    if (el.detailHead) {
      el.detailHead.classList.toggle("is-hidden-answer", hidden);
      if (quiz && hasItem) {
        el.detailHead.setAttribute("aria-hidden", hidden ? "true" : "false");
      } else {
        el.detailHead.removeAttribute("aria-hidden");
      }
    }
    if (el.detailAboutWrap) {
      const cur = getCurrentItem();
      const hasIntro = Boolean(cur && introTextForItem(cur));
      el.detailAboutWrap.classList.toggle(
        "is-hidden-answer",
        Boolean(hidden && hasIntro)
      );
      if (quiz && hasItem && hasIntro) {
        el.detailAboutWrap.setAttribute("aria-hidden", hidden ? "true" : "false");
      } else {
        el.detailAboutWrap.removeAttribute("aria-hidden");
      }
    }
    if (el.btnReveal) {
      el.btnReveal.disabled = !quiz || !hasItem;
      el.btnReveal.textContent = revealed ? "隐藏答案" : "显示答案";
      el.btnReveal.setAttribute("aria-expanded", String(revealed || !quiz));
    }
    if (el.imageWrap) {
      el.imageWrap.title = !hasItem
        ? ""
        : quiz
          ? revealed
            ? "点击隐藏名称"
            : "点击显示名称"
          : "点击切换下一张";
    }
    const item = getCurrentItem();
    if (el.detailImage && item) {
      el.detailImage.alt = hidden ? ALT_QUIZ_HIDDEN : item.title;
    }
  }

  function setRevealed(v) {
    revealed = v;
    applyRevealUi();
  }

  function toggleReveal() {
    if (!items.length || !quizOn()) return;
    setRevealed(!revealed);
  }

  function setImageLoading(on) {
    if (el.imageWrap) {
      el.imageWrap.classList.toggle("is-loading", Boolean(on));
    }
  }

  function formatCounterLine(item) {
    const noData = allItems.length === 0;
    const q = getNameSearchQuery();
    const pending = countNeedReviewInDeck();
    if (noData) return "0 / 0";
    if (!item) {
      if (reviewPoolIsEmpty()) {
        return "0 / 0 · 待复习 0 张";
      }
      if (!noData && items.length === 0 && q.length > 0) {
        return "0 / 0（无匹配） · 待复习 " + pending + " 张";
      }
      return "0 / 0 · 待复习 " + pending + " 张";
    }
    let t = index + 1 + " / " + items.length;
    if (q) t += "（筛选）";
    t += " · 待复习 " + pending + " 张";
    return t;
  }

  function renderDetail() {
    const noData = allItems.length === 0;
    const q = getNameSearchQuery();
    const poolEmpty = reviewPoolIsEmpty();
    const noSearchMatch =
      !noData && !poolEmpty && items.length === 0 && q.length > 0;

    if (el.viewerEmpty) {
      el.viewerEmpty.classList.toggle("hidden", !noData);
    }
    if (el.searchEmpty) {
      el.searchEmpty.classList.toggle("hidden", !noSearchMatch);
    }
    if (el.reviewEmpty) {
      el.reviewEmpty.classList.toggle("hidden", !poolEmpty);
    }

    const item = getCurrentItem();
    const showCard = Boolean(item);
    if (el.detailCard) {
      el.detailCard.classList.toggle("hidden", !showCard);
    }
    if (el.detailControls) {
      el.detailControls.classList.toggle("is-muted", !showCard);
    }
    setNavDisabled(!showCard || items.length <= 1);
    setKnowDisabled(!showCard);

    if (!item) {
      currentImageRel = "";
      if (el.detailAboutWrap) {
        el.detailAboutWrap.classList.add("hidden");
        el.detailAboutWrap.classList.remove("is-hidden-answer");
      }
      if (el.counter) {
        el.counter.textContent = formatCounterLine(null);
      }
      applyRevealUi();
      return;
    }

    const nextRel = item.image;
    if (currentImageRel !== nextRel) {
      currentImageRel = nextRel;
      setImageLoading(true);
      el.detailImage.onload = function () {
        setImageLoading(false);
        el.detailImage.onload = null;
      };
      el.detailImage.onerror = function () {
        setImageLoading(false);
        el.detailImage.onerror = null;
      };
      el.detailImage.src = nextRel;
    }

    el.detailId.textContent = item.id;
    el.detailTitle.textContent = item.title;
    const intro = introTextForItem(item);
    if (el.detailAboutWrap && el.detailAbout) {
      if (intro) {
        el.detailAboutWrap.classList.remove("hidden");
        el.detailAbout.textContent = intro;
      } else {
        el.detailAboutWrap.classList.add("hidden");
        el.detailAbout.textContent = "";
      }
    }
    if (el.counter) {
      el.counter.textContent = formatCounterLine(item);
    }
    applyRevealUi();
    warmAround(index);
    if (chatDrawerOpen) {
      updateChatContextBanner();
    }
  }

  function moveBy(step) {
    if (!items.length) return;
    index = (index + step + items.length) % items.length;
    revealed = initialRevealed();
    renderDetail();
  }

  function onKnow() {
    if (!items.length) return;
    const curItem = getCurrentItem();
    if (!curItem) return;
    const id = curItem.id;
    needReview.delete(id);
    saveNeedReview();
    syncNeedReviewCountInDeck();
    if (quizOn()) {
      quizKnowStreak += 1;
      quizKnowSessionTotal += 1;
    }

    if (reviewOnlyOn()) {
      const cur = index;
      rebuildPool();
      if (!items.length) {
        showToast("本轮复习全部完成！", 2400);
        randomPerm = null;
        index = 0;
        revealed = initialRevealed();
        maybePlayQuizCelebrate();
        renderDetail();
        return;
      }
      reshuffleRandomPerm();
      index = Math.min(cur, items.length - 1);
      revealed = initialRevealed();
      maybePlayQuizCelebrate();
      renderDetail();
      return;
    }

    if (items.length <= 1) {
      maybePlayQuizCelebrate();
      renderDetail();
      return;
    }
    maybePlayQuizCelebrate();
    index = (index + 1) % items.length;
    revealed = initialRevealed();
    renderDetail();
  }

  function onNotKnow() {
    if (!items.length) return;
    const curItem = getCurrentItem();
    if (!curItem) return;
    const id = curItem.id;
    const had = needReview.has(id);
    needReview.add(id);
    saveNeedReview();
    syncNeedReviewCountInDeck();
    const n = countNeedReviewInDeck();
    const tail = had ? "（已在复习池 · 共 " + n + " 张）" : "（复习池共 " + n + " 张）";
    if (quizOn()) {
      quizKnowStreak = 0;
    }
    showToast("已加入复习池 " + tail, 2400);
    renderDetail();
  }

  function preloadSrc(src) {
    if (!src || loadedSrc.has(src) || preloadingSrc.has(src)) return;
    preloadingSrc.add(src);
    const img = new Image();
    img.onload = function () {
      loadedSrc.add(src);
      preloadingSrc.delete(src);
    };
    img.onerror = function () {
      preloadingSrc.delete(src);
    };
    img.src = src;
  }

  function warmAround(centerDisplayIndex) {
    if (!items.length) return;
    function itemAtDisplay(i) {
      if (randomPerm && randomPerm.length === items.length) {
        return items[randomPerm[i]];
      }
      return items[i];
    }
    const c = itemAtDisplay(centerDisplayIndex);
    if (c) preloadSrc(c.image);
    for (let i = 1; i <= 4; i += 1) {
      const next = (centerDisplayIndex + i) % items.length;
      const prev = (centerDisplayIndex - i + items.length) % items.length;
      const inext = itemAtDisplay(next);
      const iprev = itemAtDisplay(prev);
      if (inext) preloadSrc(inext.image);
      if (iprev) preloadSrc(iprev.image);
    }
  }

  function render() {
    renderDetail();
  }

  /**
   * 去掉菌名末尾「编号式」数字：半角/全角阿拉伯数字、其他 Unicode 十进制数字；
   * 数字前允许半角/全角空格。需 /u 才能让 \\d 匹配全角 ０-９ 等。
   */
  function stripTrailingDigits(s) {
    const t = String(s).trim();
    if (!t) return "";
    const re = /(?:[\s\u3000]*\d)+$/u;
    const stripped = t.replace(re, "").trim();
    return stripped || t;
  }

  function parseItems(rows) {
    if (!Array.isArray(rows)) {
      throw new Error("数据格式不是数组");
    }
    return rows.map(function (row, index) {
      if (!row || !row.image) {
        throw new Error("第 " + (index + 1) + " 条缺少 image");
      }
      const id = String(row.id != null ? row.id : index + 1);
      const rawTitle = row.title != null ? String(row.title) : "";
      const title = stripTrailingDigits(rawTitle) || "未命名菌株";
      const aboutFromRow =
        row.about != null ? String(row.about).trim() : "";
      return {
        id: id,
        title: title,
        image: String(row.image),
        about: aboutFromRow || undefined,
      };
    });
  }

  function normalizeIntroMap(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    /** @type {Record<string, string>} */
    const out = {};
    Object.keys(raw).forEach(function (k) {
      const v = raw[k];
      if (typeof v === "string" && v.trim()) {
        out[k] = v.trim();
      }
    });
    return out;
  }

  function loadEmbedIntros() {
    try {
      var w = window;
      if (
        w.__COLONY_INTROS__ &&
        typeof w.__COLONY_INTROS__ === "object" &&
        !Array.isArray(w.__COLONY_INTROS__)
      ) {
        return normalizeIntroMap(w.__COLONY_INTROS__);
      }
    } catch {
      /* ignore */
    }
    return {};
  }

  async function loadIntros() {
    if (window.location.protocol === "file:") {
      return loadEmbedIntros();
    }
    try {
      const res = await fetch(INTROS_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return normalizeIntroMap(await res.json());
    } catch {
      return loadEmbedIntros();
    }
  }

  function loadEmbedData() {
    if (Array.isArray(window.__COLONY_DATA__)) {
      return parseItems(window.__COLONY_DATA__);
    }
    throw new Error("没有可用的内嵌数据");
  }

  async function loadData() {
    if (window.location.protocol === "file:") {
      return loadEmbedData();
    }
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return parseItems(await res.json());
    } catch (err) {
      if (Array.isArray(window.__COLONY_DATA__)) {
        return parseItems(window.__COLONY_DATA__);
      }
      throw err;
    }
  }

  function bindEvents() {
    if (el.btnPrev) {
      el.btnPrev.addEventListener("click", function () {
        moveBy(-1);
      });
    }
    if (el.btnNext) {
      el.btnNext.addEventListener("click", function () {
        moveBy(1);
      });
    }
    if (el.btnReveal) {
      el.btnReveal.addEventListener("click", function () {
        toggleReveal();
      });
    }
    if (el.btnKnow) {
      el.btnKnow.addEventListener("click", function () {
        onKnow();
      });
    }
    if (el.btnNotKnow) {
      el.btnNotKnow.addEventListener("click", function () {
        onNotKnow();
      });
    }
    if (el.quizMode) {
      el.quizMode.addEventListener("change", function () {
        revealed = initialRevealed();
        if (!quizOn()) {
          quizKnowStreak = 0;
          quizKnowSessionTotal = 0;
        }
        renderDetail();
      });
    }
    if (el.reviewOnly) {
      el.reviewOnly.addEventListener("change", function () {
        applyPoolRebuild();
      });
    }
    if (el.randomOrder) {
      el.randomOrder.addEventListener("change", function () {
        randomOrderOn = Boolean(el.randomOrder.checked);
        saveRandomOrderPref();
        const cur = getCurrentItem();
        const curId = cur ? cur.id : null;
        reshuffleRandomPerm();
        if (curId) {
          const ni = items.findIndex(function (x) {
            return x.id === curId;
          });
          if (ni >= 0) {
            index = randomPerm ? displayPosForItemId(curId) : ni;
          }
        }
        revealed = initialRevealed();
        renderDetail();
      });
    }
    if (el.nameSearch) {
      el.nameSearch.addEventListener("input", function () {
        scheduleSearchRebuild();
      });
      el.nameSearch.addEventListener("keydown", function (e) {
        if (e.code === "Escape") {
          e.preventDefault();
          el.nameSearch.value = "";
          try {
            localStorage.removeItem(SEARCH_STORAGE_KEY);
          } catch {
            /* ignore */
          }
          flushSearchRebuild();
          el.nameSearch.blur();
        }
      });
    }
    if (el.btnSearchClear) {
      el.btnSearchClear.addEventListener("click", function () {
        if (el.nameSearch) el.nameSearch.value = "";
        try {
          localStorage.removeItem(SEARCH_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        flushSearchRebuild();
        if (el.nameSearch) el.nameSearch.focus();
      });
    }
    if (el.btnFeaturePanel) {
      el.btnFeaturePanel.addEventListener("click", function () {
        if (!allItems.length) return;
        setFeatureDrawer(true);
      });
    }
    if (el.btnExamPanel) {
      el.btnExamPanel.addEventListener("click", function () {
        if (el.btnExamPanel.disabled) return;
        setExamDrawer(true);
      });
    }
    if (el.btnExamClose) {
      el.btnExamClose.addEventListener("click", function () {
        setExamDrawer(false);
      });
    }
    if (el.examBackdrop) {
      el.examBackdrop.addEventListener("click", function () {
        setExamDrawer(false);
      });
    }
    if (el.btnExamNext) {
      el.btnExamNext.addEventListener("click", function () {
        onExamNextOrRetry();
      });
    }
    if (el.btnExamSubmit) {
      el.btnExamSubmit.addEventListener("click", function () {
        submitExamRun();
      });
    }
    if (el.btnExamAgain) {
      el.btnExamAgain.addEventListener("click", function () {
        startExamRun();
      });
    }
    if (el.btnExamReset) {
      el.btnExamReset.addEventListener("click", function () {
        resetExamSession();
      });
    }
    if (el.btnFeatureClose) {
      el.btnFeatureClose.addEventListener("click", function () {
        setFeatureDrawer(false);
      });
    }
    if (el.featureBackdrop) {
      el.featureBackdrop.addEventListener("click", function () {
        setFeatureDrawer(false);
      });
    }
    if (el.featureSearch) {
      el.featureSearch.addEventListener("input", function () {
        scheduleFeatureListFilter();
      });
      el.featureSearch.addEventListener("keydown", function (e) {
        if (e.code !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        if (String(el.featureSearch.value || "").trim()) {
          el.featureSearch.value = "";
          flushFeatureListFilter();
        } else {
          setFeatureDrawer(false);
        }
      });
    }
    if (el.btnFeatureSearchClear) {
      el.btnFeatureSearchClear.addEventListener("click", function () {
        if (el.featureSearch) el.featureSearch.value = "";
        flushFeatureListFilter();
        if (el.featureSearch) el.featureSearch.focus();
      });
    }
    if (el.btnAgentPanel) {
      el.btnAgentPanel.addEventListener("click", function () {
        setChatDrawer(true);
      });
    }
    if (el.btnChatClose) {
      el.btnChatClose.addEventListener("click", function () {
        setChatDrawer(false);
      });
    }
    if (el.chatBackdrop) {
      el.chatBackdrop.addEventListener("click", function () {
        setChatDrawer(false);
      });
    }
    if (el.btnChatSend) {
      el.btnChatSend.addEventListener("click", function () {
        sendChat();
      });
    }
    if (el.btnChatClear) {
      el.btnChatClear.addEventListener("click", function () {
        clearChatHistory();
      });
    }
    if (el.chatModeWorker) {
      el.chatModeWorker.addEventListener("change", function () {
        if (el.chatModeWorker.checked) persistChatModeFromUi();
      });
    }
    if (el.chatModeDirect) {
      el.chatModeDirect.addEventListener("change", function () {
        if (el.chatModeDirect.checked) persistChatModeFromUi();
      });
    }
    if (el.btnChatSettingSave) {
      el.btnChatSettingSave.addEventListener("click", function () {
        saveChatSettings();
      });
    }
    if (el.btnChatSettingTest) {
      el.btnChatSettingTest.addEventListener("click", function () {
        testChatConnection();
      });
    }
    if (el.btnChatSettingClear) {
      el.btnChatSettingClear.addEventListener("click", function () {
        clearChatConnectionSettings();
      });
    }
    if (el.chatInput) {
      el.chatInput.addEventListener("keydown", function (e) {
        if (e.code === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          if (String(el.chatInput.value || "").trim()) {
            el.chatInput.value = "";
          } else {
            setChatDrawer(false);
          }
          return;
        }
        if (e.code === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendChat();
        }
      });
    }
    if (el.imageWrap) {
      el.imageWrap.addEventListener("click", function () {
        // 避免触发滑动手势后，紧随其后的 click 再次翻页/切换答案
        if (swipeTriggeredByTouch) {
          swipeTriggeredByTouch = false;
          return;
        }
        if (!items.length) return;
        if (quizOn()) {
          toggleReveal();
        } else {
          moveBy(1);
        }
      });

      el.imageWrap.addEventListener("touchstart", function (e) {
        if (!e.touches || !e.touches[0]) return;
        swipeIgnoreTouch = Boolean(
          e.target instanceof Element &&
            typeof e.target.closest === "function" &&
            e.target.closest(".image-arrow")
        );
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        touchStartTime = Date.now();
        swipeTriggeredByTouch = false;
      });

      el.imageWrap.addEventListener(
        "touchend",
        function (e) {
          if (!e.changedTouches || !e.changedTouches[0]) return;
          if (!items.length) return;
          if (swipeIgnoreTouch) {
            swipeIgnoreTouch = false;
            return;
          }
          const t = e.changedTouches[0];
          const dx = t.clientX - touchStartX;
          const dy = t.clientY - touchStartY;
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);
          const elapsed = Date.now() - touchStartTime;
          if (
            absDx < SWIPE_MIN_X_PX ||
            elapsed > SWIPE_MAX_TIME_MS ||
            absDy > absDx / SWIPE_Y_RATIO
          ) {
            return;
          }
          // 水平滑动：向左 -> 下一张；向右 -> 上一张
          swipeTriggeredByTouch = true;
          if (dx < 0) moveBy(1);
          else moveBy(-1);
        },
        { passive: true }
      );
    }

    // 图片左右箭头：上一张 / 下一张
    if (el.btnArrowPrev) {
      el.btnArrowPrev.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        // 仅作为指示，不主动翻页；翻页仍以左滑/右滑或键盘为主
        return;
      });
    }
    if (el.btnArrowNext) {
      el.btnArrowNext.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        // 仅作为指示，不主动翻页；翻页仍以左滑/右滑或键盘为主
        return;
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.isComposing) return;
      if (e.code === "Escape" && examDrawerOpen) {
        e.preventDefault();
        setExamDrawer(false);
        return;
      }
      if (
        e.code === "Escape" &&
        chatDrawerOpen &&
        el.chatDrawer &&
        document.activeElement &&
        el.chatDrawer.contains(document.activeElement) &&
        document.activeElement !== el.chatInput
      ) {
        e.preventDefault();
        setChatDrawer(false);
        return;
      }
      if (
        e.code === "Escape" &&
        featureDrawerOpen &&
        el.featureDrawer &&
        document.activeElement &&
        el.featureDrawer.contains(document.activeElement) &&
        document.activeElement !== el.featureSearch
      ) {
        e.preventDefault();
        setFeatureDrawer(false);
        return;
      }
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        moveBy(-1);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        moveBy(1);
      } else if (e.code === "Space") {
        if (quizOn()) {
          e.preventDefault();
          toggleReveal();
        } else {
          e.preventDefault();
          moveBy(1);
        }
      } else if (e.code === "KeyK" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onKnow();
      } else if (e.code === "KeyN" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onNotKnow();
      }
    });
  }

  async function init() {
    needReview = loadNeedReview();
    randomOrderOn = loadRandomOrderPref();
    if (el.randomOrder) el.randomOrder.checked = randomOrderOn;
    bindEvents();
    try {
      const results = await Promise.all([loadData(), loadIntros()]);
      allItems = results[0];
      introsByTitle = results[1];
      try {
        const saved = localStorage.getItem(SEARCH_STORAGE_KEY);
        if (saved && el.nameSearch) el.nameSearch.value = saved;
      } catch {
        /* ignore */
      }
      pruneNeedReview();
      rebuildPool();
      reshuffleRandomPerm();
      index = items.length ? 0 : 0;
      revealed = initialRevealed();
      render();
    } catch (err) {
      el.loadError.classList.remove("hidden");
      el.loadError.textContent =
        "加载失败：" +
        (err && err.message ? err.message : String(err)) +
        "。请先运行处理脚本生成数据，再用本地 HTTP 服务打开。";
    }
    syncFeaturePanelButton();
  }

  init();
})();
