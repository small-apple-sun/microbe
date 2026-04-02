(function () {
  "use strict";

  const DATA_URL = "data/slides.json";
  const ALT_QUIZ_HIDDEN = "菌落图（测验模式，名称已隐藏）";
  const SEARCH_STORAGE_KEY = "microbeColonyAtlas_nameSearch";
  const REVIEW_STORAGE_KEY = "microbeColonyAtlas_needReview";
  const RANDOM_ORDER_STORAGE_KEY = "microbeColonyAtlas_randomOrder";
  /** 搜索筛选防抖（毫秒），减轻大量条目时每次按键的全量重建 */
  const SEARCH_REBUILD_DEBOUNCE_MS = 200;
  /** 测验模式下累计「会了」每满该数量触发庆贺动画 */
  const QUIZ_CELEBRATE_EVERY = 5;

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
    imageWrap: document.getElementById("imageWrap"),
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
  };

  /** 全集 */
  /** @type {{id:string,title:string,image:string}[]} */
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

  function itemMatchesNameFilter(it, rawQuery) {
    const q = String(rawQuery || "").trim();
    if (!q) return true;
    const hay = String(it.title || "").toLowerCase();
    const parts = q
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return parts.every(function (part) {
      return hay.indexOf(part) !== -1;
    });
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
    if (el.counter) {
      el.counter.textContent = formatCounterLine(item);
    }
    applyRevealUi();
    warmAround(index);
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
      return {
        id: id,
        title: title,
        image: String(row.image),
      };
    });
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

    document.addEventListener("keydown", function (e) {
      if (e.isComposing) return;
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
      allItems = await loadData();
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
  }

  init();
})();
