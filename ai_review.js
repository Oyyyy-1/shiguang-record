// 可选 AI 复盘模块：模板查看/编辑/新建 + 本地统计与四象限盲区检测 + 基础档案小卡 + 回流闭环 + 可选 BYOK 直连对话
(function (global) {
  const { uid, offsetDate, DEFAULT_AI_TEMPLATES, saveState } = global.SthStorage;

  const QUADRANT_RULES = [
    {
      key: "mind",
      label: "心智 Mind",
      keywords: ["焦虑", "内耗", "情绪", "思维", "认知", "拖延", "害怕", "比较", "心态", "压力", "自我", "迷茫", "专注", "开心", "疲惫", "治愈"]
    },
    {
      key: "body",
      label: "身体 Body",
      keywords: ["睡眠", "熬夜", "运动", "跑步", "健身", "精力", "累", "散步", "饮食", "咖啡", "早睡", "生病", "体检", "健康", "体重"]
    },
    {
      key: "spirit",
      label: "精神 Spirit",
      keywords: ["意义", "价值", "方向", "人生", "朋友", "家人", "伴侣", "关系", "孤独", "热爱", "自由", "梦想", "选择", "值得", "幸福"]
    },
    {
      key: "vocation",
      label: "事业 Vocation",
      keywords: ["工作", "加班", "职业", "收入", "赚钱", "技能", "项目", "产品", "副业", "跳槽", "商业", "客户", "学习", "代码", "效率", "晋升"]
    }
  ];

  let ctx = null; // { getState, setState, todayStr, showToast, escapeHtml, getCategoryName, refreshAll }
  let activeTemplateId = "human3";
  let editingTemplateId = null;
  let aiExcludedIds = new Set();

  // BYOK 对话状态
  let chatMessages = [];
  let isChatSending = false;

  const $ = (id) => document.getElementById(id);

  function getState() {
    return ctx.getState();
  }

  function isByokReady() {
    const api = getState().settings?.aiApi;
    if (!api || !api.enabled) return false;
    const base = (api.baseUrl || "").trim();
    const key = (api.apiKey || "").trim();
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(base);
    return Boolean(base && (key || isLocal));
  }

  function syncAiToggleUI() {
    const s = getState();
    const enabled = s.settings.aiReviewEnabled !== false;
    $("btn-open-ai-review").classList.toggle("hidden", !enabled);
    $("chk-enable-ai-review").checked = enabled;

    const api = s.settings.aiApi;
    $("chk-enable-ai-api").checked = Boolean(api.enabled);
    $("ai-api-fields").classList.toggle("hidden", !api.enabled);
    $("input-api-base").value = api.baseUrl || "https://api.openai.com/v1";
    $("input-api-model").value = api.model || "gpt-4o-mini";
    $("input-api-key").value = api.apiKey || "";

    const startBtn = $("btn-start-ai-chat");
    if (startBtn) {
      startBtn.classList.toggle("hidden", !isByokReady());
    }
  }

  // ==================== 1. 本地统计与四象限盲区扫描 ====================
  function computeMonthlyDensity() {
    const s = getState();
    const counts = {};
    s.questions.forEach((q) => {
      const ym = (q.askedDate || "").slice(0, 7);
      if (!ym) return;
      counts[ym] = (counts[ym] || 0) + 1;
    });
    const months = Object.keys(counts).sort().slice(-6);
    const maxVal = Math.max(...months.map((m) => counts[m]), 0);
    const peakMonths = months.filter((m) => counts[m] === maxVal && maxVal > 0);
    return { counts, months, maxVal, peakMonths };
  }

  function renderAiDensityChart() {
    const s = getState();
    const totalEntries = s.entries.length;
    const totalQuestions = s.questions.length;
    const totalAnswers = s.answers.length;

    $("ai-readiness-bar").innerHTML =
      totalEntries + totalQuestions < 10
        ? `当前共 <strong>${totalEntries}</strong> 条日常、<strong>${totalQuestions}</strong> 个迷茫问题（已答 ${totalAnswers} 次）。建议积累满 15 条后分析更准，现在也可先试玩。`
        : `已积累 <strong>${totalEntries}</strong> 条日常、<strong>${totalQuestions}</strong> 个迷茫问题（已答 ${totalAnswers} 次），数据量已足够做阶段深度复盘。`;

    const chart = $("ai-density-chart");
    chart.innerHTML = "";
    const { counts, months, maxVal } = computeMonthlyDensity();
    if (months.length === 0) {
      chart.innerHTML = `<div style="font-size:12px;color:#7a7269;">还没有记录过迷茫问题，记录后这里会自动统计各月密集度。</div>`;
      return;
    }

    months.forEach((ym) => {
      const val = counts[ym];
      const pct = Math.round((val / Math.max(maxVal, 1)) * 100);
      const isPeak = val === maxVal && val > 0;
      const row = document.createElement("div");
      row.className = "density-row";
      row.innerHTML = `
        <span class="density-month">${ym}</span>
        <div class="density-track"><div class="density-fill ${isPeak ? "peak" : ""}" style="width:${pct}%"></div></div>
        <span class="density-val ${isPeak ? "peak" : ""}">${val} 个${isPeak ? "🔥" : ""}</span>
      `;
      chart.appendChild(row);
    });
  }

  function analyzeQuadrantCoverage(selectedItems) {
    const s = getState();
    const result = QUADRANT_RULES.map((q) => ({ key: q.key, label: q.label, count: 0 }));

    selectedItems.forEach((it) => {
      let text = "";
      if (it.kind === "question") {
        text = `${it.data.questionText || ""} ${it.data.contextNote || ""}`;
        const ans = s.answers.filter((a) => a.questionId === it.data.id);
        ans.forEach((a) => {
          text += " " + a.answerText;
        });
      } else {
        const tagNames = (it.data.categoryIds || []).map((cid) => ctx.getCategoryName(cid)).join(" ");
        text = `${it.data.content || ""} ${tagNames}`;
      }

      QUADRANT_RULES.forEach((rule, idx) => {
        if (rule.keywords.some((kw) => text.includes(kw))) {
          result[idx].count += 1;
        }
      });
    });

    // 如果基础档案里填了睡眠/精力，也算给身体补了一点上下文
    const p = s.aiProfile;
    if (p && p.includeInPrompt && (p.bodyEnergy || "").trim()) {
      const bodyItem = result.find((r) => r.key === "body");
      if (bodyItem) bodyItem.count += 1;
    }

    return result;
  }

  function renderQuadrantCoverage(selectedItems) {
    const strip = $("ai-quadrant-strip");
    const coverage = analyzeQuadrantCoverage(selectedItems);
    strip.innerHTML = coverage
      .map((c) => {
        const isGap = c.count === 0;
        return `<span class="quad-pill ${isGap ? "gap" : "ok"}">${c.label} ${c.count}条${isGap ? " ⚠️盲区" : ""}</span>`;
      })
      .join("");
    return coverage;
  }

  // ==================== 2. 模板管理（查看 / 编辑 / 新建 / 恢复默认） ====================
  function getActiveTemplate() {
    const tpls = getState().aiTemplates;
    return tpls.find((t) => t.id === activeTemplateId) || tpls[0];
  }

  function renderTemplatePicker() {
    const container = $("ai-template-picker");
    container.innerHTML = "";
    const tpls = getState().aiTemplates;
    if (!tpls.some((t) => t.id === activeTemplateId) && tpls.length > 0) {
      activeTemplateId = tpls[0].id;
    }

    tpls.forEach((tpl) => {
      const card = document.createElement("div");
      card.className = `ai-tpl-card ${tpl.id === activeTemplateId ? "active" : ""}`;
      card.innerHTML = `
        <div class="ai-tpl-main">
          <strong>${ctx.escapeHtml(tpl.name)}</strong>
          <span>${ctx.escapeHtml(tpl.desc || "自定义复盘模板")}</span>
        </div>
        <button type="button" class="ai-tpl-edit-btn">查看/编辑</button>
      `;

      card.addEventListener("click", (e) => {
        if (e.target.closest(".ai-tpl-edit-btn")) return;
        activeTemplateId = tpl.id;
        renderTemplatePicker();
        updateAiPromptPreview();
      });

      card.querySelector(".ai-tpl-edit-btn").addEventListener("click", () => {
        openTemplateEditor(tpl.id);
      });

      container.appendChild(card);
    });
  }

  function openTemplateEditor(templateId) {
    editingTemplateId = templateId; // null 表示新建
    const isNew = !templateId;
    const tpl = isNew ? null : getState().aiTemplates.find((t) => t.id === templateId);

    $("modal-tpl-title").textContent = isNew ? "新建自定义复盘模板" : `编辑模板：${tpl.name}`;
    $("tpl-name").value = tpl ? tpl.name : "";
    $("tpl-desc").value = tpl ? tpl.desc || "" : "";
    $("tpl-body").value = tpl ? tpl.body : "";
    $("btn-delete-tpl").classList.toggle("hidden", isNew || Boolean(tpl?.isBuiltin));
    $("btn-reset-tpl").classList.toggle("hidden", isNew || !tpl?.isBuiltin);

    $("modal-template-editor").classList.remove("hidden");
  }

  async function saveTemplateEditor() {
    const name = ($("tpl-name").value || "").trim();
    const desc = ($("tpl-desc").value || "").trim();
    const body = ($("tpl-body").value || "").trim();
    if (!name || !body) {
      ctx.showToast("请填写模板名称和 Prompt 内容");
      return;
    }

    const s = getState();
    if (editingTemplateId) {
      const target = s.aiTemplates.find((t) => t.id === editingTemplateId);
      if (target) {
        target.name = name;
        target.desc = desc;
        target.body = body;
      }
    } else {
      const newTpl = {
        id: uid("tpl"),
        name,
        desc: desc || "自定义复盘模板",
        isBuiltin: false,
        checkQuadrants: false,
        body
      };
      s.aiTemplates.push(newTpl);
      activeTemplateId = newTpl.id;
    }

    await saveState(s);
    $("modal-template-editor").classList.add("hidden");
    renderTemplatePicker();
    updateAiPromptPreview();
    ctx.showToast("模板已保存");
  }

  // ==================== 3. 个人基础档案小卡 ====================
  function loadProfileUI() {
    const p = getState().aiProfile;
    $("ai-inc-profile").checked = Boolean(p.includeInPrompt);
    $("profile-role").value = p.roleStage || "";
    $("profile-goal").value = p.topGoal || "";
    $("profile-body").value = p.bodyEnergy || "";
  }

  async function saveProfileFromUI() {
    const s = getState();
    s.aiProfile = {
      includeInPrompt: $("ai-inc-profile").checked,
      roleStage: ($("profile-role").value || "").trim(),
      topGoal: ($("profile-goal").value || "").trim(),
      bodyEnergy: ($("profile-body").value || "").trim()
    };
    await saveState(s);
    updateAiPromptPreview();
  }

  // ==================== 4. 日期筛选、私密剔除与 Prompt 组装 ====================
  function getAiFilteredItems() {
    const s = getState();
    const start = $("ai-start-date").value || "";
    const end = $("ai-end-date").value || "";
    const incEntries = $("ai-inc-entries").checked;
    const incQuestions = $("ai-inc-questions").checked;

    const list = [];
    if (incEntries) {
      s.entries.forEach((e) => {
        if (start && e.date < start) return;
        if (end && e.date > end) return;
        list.push({ key: `e:${e.id}`, kind: "entry", date: e.date, createdAt: e.createdAt, data: e });
      });
    }
    if (incQuestions) {
      s.questions.forEach((q) => {
        if (start && q.askedDate < start) return;
        if (end && q.askedDate > end) return;
        list.push({ key: `q:${q.id}`, kind: "question", date: q.askedDate, createdAt: q.createdAt, data: q });
      });
    }
    list.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : a.createdAt - b.createdAt));
    return list;
  }

  function renderAiPrivacyList() {
    const items = getAiFilteredItems();
    const container = $("ai-privacy-list");
    container.innerHTML = "";

    if (items.length === 0) {
      container.innerHTML = `<div style="font-size:12px;color:#7a7269;padding:8px;text-align:center;">当前时间范围没有可打包的记录</div>`;
    } else {
      items.forEach((it) => {
        const checked = !aiExcludedIds.has(it.key);
        const label = document.createElement("label");
        label.className = "ai-privacy-item";
        const isQ = it.kind === "question";
        const badge = isQ
          ? "🧭 迷茫问题"
          : (it.data.categoryIds || []).includes("fun")
          ? "🎉 趣事"
          : "📝 日常";
        const previewText = isQ
          ? it.data.questionText
          : it.data.content || (it.data.photos && it.data.photos.length ? "（照片记录）" : "（手绘标记）");

        label.innerHTML = `
          <input type="checkbox" ${checked ? "checked" : ""} />
          <div style="flex:1;min-width:0;">
            <div class="ai-privacy-meta">${it.date} · ${badge}</div>
            <div class="ai-privacy-text">${ctx.escapeHtml(previewText)}</div>
          </div>
        `;
        label.querySelector("input").addEventListener("change", (e) => {
          if (e.target.checked) aiExcludedIds.delete(it.key);
          else aiExcludedIds.add(it.key);
          updateAiPromptPreview();
        });
        container.appendChild(label);
      });
    }

    updateAiPromptPreview();
  }

  function buildAiPromptText() {
    const s = getState();
    const allItems = getAiFilteredItems();
    const selectedItems = allItems.filter((it) => !aiExcludedIds.has(it.key));
    const entries = selectedItems.filter((it) => it.kind === "entry").map((it) => it.data);
    const questions = selectedItems.filter((it) => it.kind === "question").map((it) => it.data);

    $("ai-selected-summary").textContent = `已选 ${selectedItems.length} / ${allItems.length} 条（取消勾选即可剔除私密条目）`;

    const coverage = renderQuadrantCoverage(selectedItems);
    const gaps = coverage.filter((c) => c.count === 0).map((c) => c.label);

    const tpl = getActiveTemplate();
    const lines = [];
    lines.push(tpl.body);

    // 自动附加本地统计摘要 + 信息盲区指令
    const { counts, peakMonths } = computeMonthlyDensity();
    const unansweredCount = questions.filter((q) => !s.answers.some((a) => a.questionId === q.id)).length;
    const tagCounts = {};
    entries.forEach((e) => {
      (e.categoryIds || []).forEach((cid) => {
        const name = ctx.getCategoryName(cid);
        tagCounts[name] = (tagCounts[name] || 0) + 1;
      });
    });
    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `#${k}(${v})`)
      .join("、");

    lines.push("\n---\n### 本地统计摘要（系统自动计算）");
    lines.push(`- 纳入分析：${entries.length} 条日常/趣事，${questions.length} 个迷茫问题（其中 ${unansweredCount} 个尚未作答）`);
    if (peakMonths.length > 0) {
      lines.push(`- 迷茫问题高发月份：${peakMonths.join("、")}（各 ${counts[peakMonths[0]]} 个）`);
    }
    if (topTags) {
      lines.push(`- 高频记录标签：${topTags}`);
    }
    if (gaps.length > 0) {
      lines.push(`- ⚠️ 信息盲区提示：以下象限在现有记录中几乎空白【${gaps.join("、")}】。请优先针对这些缺失盲区向我发问补充信息，记录里已经写清楚的事实无需重复询问。`);
    }

    // 个人基础档案小卡
    const p = s.aiProfile;
    if (p && p.includeInPrompt && (p.roleStage || p.topGoal || p.bodyEnergy)) {
      lines.push("\n### 我的基础背景档案");
      if (p.roleStage) lines.push(`- 当前阶段 / 职业方向：${p.roleStage}`);
      if (p.topGoal) lines.push(`- 近半年最想突破的事：${p.topGoal}`);
      if (p.bodyEnergy) lines.push(`- 近期睡眠 / 运动 / 精力状态：${p.bodyEnergy}`);
    }

    lines.push("\n### 筛选后的真实记录（已做隐私剔除）");
    if (questions.length > 0) {
      lines.push(`\n#### 迷茫与人生问题（${questions.length} 个）`);
      questions.forEach((q, idx) => {
        lines.push(`${idx + 1}. [${q.askedDate}] ${q.questionText}`);
        if (q.contextNote) lines.push(`   - 当时心境：${q.contextNote}`);
        const ans = s.answers
          .filter((a) => a.questionId === q.id)
          .sort((a, b) => a.createdAt - b.createdAt);
        ans.forEach((a) => {
          lines.push(`   - 后续自我作答 (${a.answeredDate})：${a.answerText}`);
        });
      });
    }

    if (entries.length > 0) {
      lines.push(`\n#### 日常与趣事（${entries.length} 条）`);
      entries.forEach((e) => {
        const tags = (e.categoryIds || []).map((cid) => `#${ctx.getCategoryName(cid)}`).join(" ");
        const text = e.content || (e.photos && e.photos.length ? "（拍了照片留念）" : "（画了日历标记）");
        lines.push(`- [${e.date}] ${tags} ${text}`);
      });
    }

    if (questions.length === 0 && entries.length === 0) {
      lines.push("（当前未勾选任何记录，请至少保留 1 条记录。）");
    }

    lines.push(
      "\n---\n【回流格式要求】当本次采访或分析最终结束时，请顺便输出一段 300 字以内的「复盘卡片」（含 3 条核心结论），并单独列出 1~2 个值得我半年后再放进「人生问题扭蛋机」回顾的新问题。"
    );

    return lines.join("\n");
  }

  function updateAiPromptPreview() {
    const text = buildAiPromptText();
    $("ai-prompt-preview").textContent = text;
    $("ai-char-count").textContent = text.length;
  }

  async function copyAiPromptToClipboard() {
    const selected = getAiFilteredItems().filter((it) => !aiExcludedIds.has(it.key));
    if (selected.length === 0) {
      ctx.showToast("请至少勾选 1 条记录后再复制");
      return;
    }
    const text = buildAiPromptText();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("fallback");
      }
      ctx.showToast("已复制！直接粘贴到 ChatGPT / Claude / Gemini 即可 ✨");
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      ctx.showToast("已复制！直接粘贴到常用 AI 对话框即可 ✨");
    }
  }

  // ==================== 5. 回流沉淀（保存复盘结论 / 新问题进扭蛋池） ====================
  async function saveLoopbackInsight(text, asQuestion) {
    const clean = (text || "").trim();
    if (!clean) {
      ctx.showToast("先粘贴或输入内容再保存");
      return;
    }
    const s = getState();
    if (asQuestion) {
      s.questions.push({
        id: uid("q"),
        askedDate: ctx.todayStr,
        questionText: clean,
        contextNote: "来自 AI 深度复盘提炼的新问题",
        unlockAfterDays: 30,
        status: "open",
        createdAt: Date.now()
      });
      await saveState(s);
      ctx.refreshAll();
      ctx.showToast("已将新问题投入人生扭蛋池 🧭");
    } else {
      if (!s.categories.some((c) => c.id === "review")) {
        s.categories.push({ id: "review", name: "复盘" });
      }
      s.entries.push({
        id: uid("entry"),
        date: ctx.todayStr,
        content: clean,
        photos: [],
        categoryIds: ["review"],
        stampId: null,
        gachaDrawCount: 0,
        createdAt: Date.now()
      });
      await saveState(s);
      ctx.refreshAll();
      ctx.showToast("已将复盘结论存回今日日历 ✨");
    }
  }

  // ==================== 6. 可选 BYOK 应用内 AI 对话（默认关闭且留空） ====================
  function renderChatMessages() {
    const box = $("ai-chat-messages");
    box.innerHTML = "";
    // 隐藏第一条超长系统打包上下文，只展示简洁开场提示和后续对话
    chatMessages.forEach((m, idx) => {
      if (idx === 0 && m.role === "user") {
        const notice = document.createElement("div");
        notice.className = "chat-system-note";
        notice.textContent = "已将你的复盘模板、统计摘要与筛选后的记录发给 AI，正在开启 1v1 采访…";
        box.appendChild(notice);
        return;
      }
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble ${m.role === "user" ? "user" : "assistant"}`;
      bubble.innerHTML = `<div class="chat-text">${ctx.escapeHtml(m.content)}</div>`;

      if (m.role === "assistant") {
        const actions = document.createElement("div");
        actions.className = "chat-msg-actions";
        actions.innerHTML = `
          <button type="button" class="btn-text-sm btn-save-as-review">存为今日复盘</button>
          <button type="button" class="btn-text-sm btn-save-as-question">提炼进问题池</button>
        `;
        actions.querySelector(".btn-save-as-review").addEventListener("click", () => {
          saveLoopbackInsight(m.content, false);
        });
        actions.querySelector(".btn-save-as-question").addEventListener("click", () => {
          const picked = prompt("确认或删改要投入「人生问题扭蛋池」的问题：", m.content.slice(0, 120));
          if (picked) saveLoopbackInsight(picked, true);
        });
        bubble.appendChild(actions);
      }
      box.appendChild(bubble);
    });

    if (isChatSending) {
      const loading = document.createElement("div");
      loading.className = "chat-bubble assistant";
      loading.textContent = "思考中…";
      box.appendChild(loading);
    }

    box.scrollTop = box.scrollHeight;
  }

  async function callByokCompletion() {
    const api = getState().settings.aiApi;
    const base = (api.baseUrl || "").replace(/\/+$/, "");
    const headers = { "Content-Type": "application/json" };
    if ((api.apiKey || "").trim()) {
      headers.Authorization = `Bearer ${api.apiKey.trim()}`;
    }

    isChatSending = true;
    renderChatMessages();

    try {
      const resp = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: (api.model || "gpt-4o-mini").trim(),
          messages: chatMessages,
          temperature: 0.7
        })
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 120)}`);
      }
      const data = await resp.json();
      const reply = data?.choices?.[0]?.message?.content;
      if (!reply) throw new Error("接口未返回有效回复");
      chatMessages.push({ role: "assistant", content: reply });
    } catch (err) {
      chatMessages.push({
        role: "assistant",
        content: `请求失败：${err.message}\n（提示：部分官方 API 禁止浏览器直接跨域请求，或请检查 Base URL / API Key / 模型名是否正确；你也可以直接用「一键复制给 AI」方案。）`
      });
    } finally {
      isChatSending = false;
      renderChatMessages();
    }
  }

  function startByokInterview() {
    if (!isByokReady()) {
      ctx.showToast("请先在右上角「设置」中开启并填写你的 API 配置");
      return;
    }
    const selected = getAiFilteredItems().filter((it) => !aiExcludedIds.has(it.key));
    if (selected.length === 0) {
      ctx.showToast("请至少勾选 1 条记录后再开始");
      return;
    }
    const initialPrompt = buildAiPromptText();
    chatMessages = [{ role: "user", content: initialPrompt }];
    $("modal-ai-review").classList.add("hidden");
    $("modal-ai-chat").classList.remove("hidden");
    callByokCompletion();
  }

  function openAiReviewModal() {
    aiExcludedIds.clear();
    loadProfileUI();
    renderAiDensityChart();
    renderTemplatePicker();
    renderAiPrivacyList();
    syncAiToggleUI();
    $("modal-ai-review").classList.remove("hidden");
  }

  function bindEvents() {
    $("btn-open-ai-review").addEventListener("click", openAiReviewModal);

    // 设置页：AI 总开关 + BYOK API 配置
    $("chk-enable-ai-review").addEventListener("change", async (e) => {
      const s = getState();
      s.settings.aiReviewEnabled = e.target.checked;
      await saveState(s);
      syncAiToggleUI();
      ctx.showToast(e.target.checked ? "已开启 AI 复盘入口" : "已隐藏 AI 复盘入口");
    });

    $("chk-enable-ai-api").addEventListener("change", async (e) => {
      const s = getState();
      s.settings.aiApi.enabled = e.target.checked;
      await saveState(s);
      syncAiToggleUI();
    });

    ["input-api-base", "input-api-model", "input-api-key"].forEach((id) => {
      $(id).addEventListener("change", async () => {
        const s = getState();
        s.settings.aiApi.baseUrl = ($("input-api-base").value || "").trim();
        s.settings.aiApi.model = ($("input-api-model").value || "").trim();
        s.settings.aiApi.apiKey = ($("input-api-key").value || "").trim();
        await saveState(s);
        syncAiToggleUI();
        ctx.showToast("本地 API 配置已保存");
      });
    });

    // 模板管理
    $("btn-new-template").addEventListener("click", () => openTemplateEditor(null));
    $("btn-save-tpl").addEventListener("click", saveTemplateEditor);

    $("btn-delete-tpl").addEventListener("click", async () => {
      if (!editingTemplateId) return;
      if (!confirm("确定删除这个自定义模板吗？")) return;
      const s = getState();
      s.aiTemplates = s.aiTemplates.filter((t) => t.id !== editingTemplateId);
      await saveState(s);
      $("modal-template-editor").classList.add("hidden");
      renderTemplatePicker();
      updateAiPromptPreview();
      ctx.showToast("已删除模板");
    });

    $("btn-reset-tpl").addEventListener("click", async () => {
      const orig = DEFAULT_AI_TEMPLATES.find((t) => t.id === editingTemplateId);
      if (!orig) return;
      $("tpl-name").value = orig.name;
      $("tpl-desc").value = orig.desc;
      $("tpl-body").value = orig.body;
      ctx.showToast("已还原为默认内容，点击保存即可生效");
    });

    // 个人基础档案
    ["ai-inc-profile", "profile-role", "profile-goal", "profile-body"].forEach((id) => {
      $(id).addEventListener("change", saveProfileFromUI);
    });

    // 日期区间与隐私勾选
    document.querySelectorAll(".ai-range-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".ai-range-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        const r = chip.dataset.range;
        if (r === "all") {
          $("ai-start-date").value = "";
          $("ai-end-date").value = "";
        } else if (r === "30d") {
          $("ai-start-date").value = offsetDate(30);
          $("ai-end-date").value = ctx.todayStr;
        } else if (r === "180d") {
          $("ai-start-date").value = offsetDate(180);
          $("ai-end-date").value = ctx.todayStr;
        }
        renderAiPrivacyList();
      });
    });

    ["ai-start-date", "ai-end-date", "ai-inc-entries", "ai-inc-questions"].forEach((id) => {
      $(id).addEventListener("change", renderAiPrivacyList);
    });

    $("btn-ai-select-all").addEventListener("click", () => {
      aiExcludedIds.clear();
      renderAiPrivacyList();
    });

    $("btn-ai-select-none").addEventListener("click", () => {
      getAiFilteredItems().forEach((it) => aiExcludedIds.add(it.key));
      renderAiPrivacyList();
    });

    // 复制与 BYOK 直连
    $("btn-copy-ai-prompt").addEventListener("click", copyAiPromptToClipboard);
    $("btn-start-ai-chat").addEventListener("click", startByokInterview);

    // 回流保存
    $("btn-loopback-entry").addEventListener("click", async () => {
      await saveLoopbackInsight($("input-loopback").value, false);
      $("input-loopback").value = "";
    });
    $("btn-loopback-question").addEventListener("click", async () => {
      await saveLoopbackInsight($("input-loopback").value, true);
      $("input-loopback").value = "";
    });

    // BYOK 对话发送
    $("btn-ai-chat-send").addEventListener("click", () => {
      if (isChatSending) return;
      const text = ($("input-ai-chat").value || "").trim();
      if (!text) return;
      $("input-ai-chat").value = "";
      chatMessages.push({ role: "user", content: text });
      callByokCompletion();
    });
    $("input-ai-chat").addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        $("btn-ai-chat-send").click();
      }
    });
  }

  global.SthAiReview = {
    init(context) {
      ctx = context;
      bindEvents();
      syncAiToggleUI();
    },
    syncAiToggleUI
  };
})(window);
