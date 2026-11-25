// 主交互逻辑：日历渲染、极简秒记输入、拍照/传图压缩、手绘 SVG 印章画板、分类筛选与双模式扭蛋机
(function () {
  const {
    uid,
    formatDate,
    offsetDate,
    createDemoState,
    loadState,
    saveState,
    drawFunEntry,
    filterQuestionsForGacha,
    drawLifeQuestion
  } = window.SthStorage;

  let state = null;
  const todayStr = formatDate(new Date());

  // UI 状态
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth(); // 0-11
  let selectedDate = todayStr;
  let activeCategoryFilter = "all";
  let gachaMode = "fun"; // 'fun' | 'question'

  // 极简秒记输入条状态
  let composerDate = todayStr;
  let composerIsFun = false;
  let composerIsQuestion = false;
  let draftPhotos = [];
  let draftExtraCategories = [];
  let draftStampId = null;

  // 手绘画板状态
  let strokes = [];
  let currentStroke = null;
  let brushColor = "#2c2825";
  let brushWidth = 5;
  let isDrawing = false;

  // 相机流
  let cameraStream = null;

  // 语音转文字状态（Web Speech API）
  let speechRec = null;
  let isListening = false;
  let voiceBaseText = "";
  let voiceFinalTranscript = "";

  const $ = (id) => document.getElementById(id);

  function showToast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.add("hidden"), 2200);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function daysBetween(dateStr) {
    const d1 = new Date(dateStr + "T00:00:00").getTime();
    const d2 = new Date(todayStr + "T00:00:00").getTime();
    return Math.max(0, Math.round((d2 - d1) / 86400000));
  }

  function getStampById(id) {
    if (!id) return null;
    return state.stamps.find((s) => s.id === id) || null;
  }

  function getCategoryName(id) {
    const c = state.categories.find((x) => x.id === id);
    return c ? c.name : id;
  }

  // ==================== 1. 日历视图 ====================
  function renderCalendar() {
    $("calendar-month-label").textContent = `${viewYear}年 ${viewMonth + 1}月`;
    const grid = $("calendar-grid");
    grid.innerHTML = "";

    const firstDay = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

    const entriesByDate = {};
    state.entries.forEach((e) => {
      if (!entriesByDate[e.date]) entriesByDate[e.date] = [];
      entriesByDate[e.date].push(e);
    });
    const questionsByDate = {};
    state.questions.forEach((q) => {
      if (!questionsByDate[q.askedDate]) questionsByDate[q.askedDate] = [];
      questionsByDate[q.askedDate].push(q);
    });

    const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
      let cellDate;
      let isOtherMonth = false;

      if (i < startWeekday) {
        const day = prevMonthDays - startWeekday + 1 + i;
        cellDate = new Date(viewYear, viewMonth - 1, day);
        isOtherMonth = true;
      } else if (i >= startWeekday + daysInMonth) {
        const day = i - (startWeekday + daysInMonth) + 1;
        cellDate = new Date(viewYear, viewMonth + 1, day);
        isOtherMonth = true;
      } else {
        const day = i - startWeekday + 1;
        cellDate = new Date(viewYear, viewMonth, day);
      }

      const dateStr = formatDate(cellDate);
      const dayEntries = entriesByDate[dateStr] || [];
      const dayQuestions = questionsByDate[dateStr] || [];

      const stampedEntry = [...dayEntries].reverse().find((e) => e.stampId);
      const stamp = stampedEntry ? getStampById(stampedEntry.stampId) : null;
      const hasPhoto = dayEntries.some((e) => e.photos && e.photos.length > 0);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "day-cell";
      if (isOtherMonth) btn.classList.add("other-month");
      if (dateStr === todayStr) btn.classList.add("today");
      if (dateStr === selectedDate) btn.classList.add("selected");

      let inner = `<span class="day-num">${cellDate.getDate()}</span>`;
      if (stamp) {
        inner += `<div class="day-stamp-mini">${stamp.svg}</div>`;
      }
      if (dayEntries.length > 0 || dayQuestions.length > 0) {
        inner += `<div class="day-dots">`;
        if (hasPhoto) inner += `<span class="dot-photo" title="有照片"></span>`;
        else if (dayEntries.length > 0 && !stamp) inner += `<span class="dot-entry" title="有记录"></span>`;
        if (dayQuestions.length > 0) inner += `<span class="dot-question" title="有迷茫问题"></span>`;
        inner += `</div>`;
      }

      btn.innerHTML = inner;
      btn.addEventListener("click", () => {
        selectedDate = dateStr;
        composerDate = dateStr;
        if (isOtherMonth) {
          viewYear = cellDate.getFullYear();
          viewMonth = cellDate.getMonth();
        }
        renderCalendar();
        renderComposer();
        renderSelectedDayList();
      });

      grid.appendChild(btn);
    }
  }

  function renderSelectedDayList() {
    const [y, m, d] = selectedDate.split("-");
    $("selected-date-title").textContent = `${Number(m)}月${Number(d)}日`;
    $("selected-date-sub").textContent = selectedDate === todayStr ? "今天" : `${y}年`;

    const dayEntries = state.entries
      .filter((e) => e.date === selectedDate)
      .sort((a, b) => b.createdAt - a.createdAt);
    const dayQuestions = state.questions
      .filter((q) => q.askedDate === selectedDate)
      .sort((a, b) => b.createdAt - a.createdAt);

    const total = dayEntries.length + dayQuestions.length;
    $("selected-date-count").textContent = total > 0 ? `${total} 条印记` : "";

    const container = $("day-entries-list");
    container.innerHTML = "";

    if (total === 0) {
      container.innerHTML = `<div class="empty-state">这一天还没有留下印记，在上方随手写一句、拍张照或画个标记吧。</div>`;
      return;
    }

    dayEntries.forEach((e) => container.appendChild(buildEntryCard(e)));
    dayQuestions.forEach((q) => container.appendChild(buildQuestionCard(q)));
  }

  // ==================== 2. 极简秒记输入条 ====================
  function renderComposer() {
    const box = $("quick-composer");
    box.classList.toggle("question-mode", composerIsQuestion);

    // 日期标签
    $("composer-date").value = composerDate;
    if (composerDate === todayStr) {
      $("composer-date-label").textContent = "今天";
    } else {
      const [, m, d] = composerDate.split("-");
      $("composer-date-label").textContent = `${Number(m)}月${Number(d)}日`;
    }

    // 两个快捷开关
    $("toggle-fun").classList.toggle("active-fun", composerIsFun);
    $("toggle-question").classList.toggle("active-question", composerIsQuestion);

    // 问题模式下简化工具栏，聚焦提问
    $("composer-question-extra").classList.toggle("hidden", !composerIsQuestion);
    $("btn-open-stamp-pad").classList.toggle("hidden", composerIsQuestion);
    $("btn-toggle-tags").classList.toggle("hidden", composerIsQuestion);
    $("btn-quick-camera").classList.toggle("hidden", composerIsQuestion);
    $("input-photo-file").parentElement.classList.toggle("hidden", composerIsQuestion);
    if (composerIsQuestion) {
      $("composer-tag-tray").classList.add("hidden");
    }

    $("composer-input").placeholder = composerIsQuestion
      ? "写下此刻让你迷茫、想问未来自己的问题…"
      : "想到什么随手记一句…（也可只拍照或只画标记）";
    $("btn-quick-submit").textContent = composerIsQuestion ? "投入问题池" : "记下来";

    // 附件预览（印章 + 照片）
    const stamp = !composerIsQuestion ? getStampById(draftStampId) : null;
    const hasPhotos = !composerIsQuestion && draftPhotos.length > 0;
    const hasAttachments = Boolean(stamp || hasPhotos);

    $("composer-attachments").classList.toggle("hidden", !hasAttachments);
    $("composer-stamp-wrap").classList.toggle("hidden", !stamp);
    if (stamp) {
      $("composer-stamp-svg").innerHTML = stamp.svg;
    }

    const strip = $("composer-photo-strip");
    strip.innerHTML = "";
    if (hasPhotos) {
      draftPhotos.forEach((src, idx) => {
        const div = document.createElement("div");
        div.className = "composer-photo-item";
        div.innerHTML = `
          <img src="${src}" alt="待保存照片" />
          <button type="button" class="mini-remove" title="移除照片">✕</button>
        `;
        div.querySelector("button").addEventListener("click", () => {
          draftPhotos.splice(idx, 1);
          renderComposer();
        });
        strip.appendChild(div);
      });
    }

    // 折叠标签区渲染
    renderComposerTagTray();
  }

  function renderComposerTagTray() {
    const tray = $("composer-tag-tray");
    tray.innerHTML = "";
    // 排除 'fun'（已有顶部一键开关），显示其余分类
    state.categories
      .filter((c) => c.id !== "fun")
      .forEach((c) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const isSelected = draftExtraCategories.includes(c.id);
        btn.className = `tag-option ${isSelected ? "selected" : ""}`;
        btn.textContent = `#${c.name}`;
        btn.addEventListener("click", () => {
          if (draftExtraCategories.includes(c.id)) {
            draftExtraCategories = draftExtraCategories.filter((x) => x !== c.id);
          } else {
            draftExtraCategories.push(c.id);
          }
          renderComposerTagTray();
        });
        tray.appendChild(btn);
      });
  }

  function resetComposerDraft() {
    $("composer-input").value = "";
    $("composer-input").style.height = "auto";
    draftPhotos = [];
    draftStampId = null;
    draftExtraCategories = [];
    composerIsFun = false;
    composerIsQuestion = false;
    $("composer-tag-tray").classList.add("hidden");
    $("btn-toggle-tags").classList.remove("active");
    renderComposer();
  }

  // ==================== 2.5 语音转文字（微信式） ====================
  function setVoiceUI(listening) {
    isListening = listening;
    $("btn-voice-input").classList.toggle("recording", listening);
    $("voice-status-bar").classList.toggle("hidden", !listening);
  }

  function stopVoiceInput() {
    if (speechRec && isListening) {
      try {
        speechRec.stop();
      } catch (e) {}
    }
    setVoiceUI(false);
  }

  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("当前浏览器暂不支持语音识别，建议使用 Chrome 或 Safari");
      return;
    }

    const input = $("composer-input");
    voiceBaseText = input.value || "";
    if (voiceBaseText && !/[\s\n]$/.test(voiceBaseText)) {
      voiceBaseText += " ";
    }
    voiceFinalTranscript = "";

    const rec = new SpeechRecognition();
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => {
      setVoiceUI(true);
      $("voice-status-text").textContent = "正在聆听，直接说话即可实时转文字…";
    };

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const seg = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          voiceFinalTranscript += seg;
        } else {
          interim += seg;
        }
      }
      input.value = (voiceBaseText + voiceFinalTranscript + interim).trimStart();
      input.style.height = "auto";
      input.style.height = Math.min(140, input.scrollHeight) + "px";
      $("voice-status-text").textContent = interim ? `识别中：${interim}` : "正在聆听，说完点「说完了」结束";
    };

    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        showToast("未获得麦克风权限（若为 file:// 打开，请用 localhost 启动后再试）");
      } else if (event.error === "no-speech") {
        showToast("没有检测到声音，已自动停止");
      } else if (event.error !== "aborted") {
        showToast(`语音识别中断（${event.error}）`);
      }
      setVoiceUI(false);
    };

    rec.onend = () => {
      setVoiceUI(false);
    };

    speechRec = rec;
    try {
      rec.start();
    } catch (e) {
      setVoiceUI(false);
      showToast("无法启动语音识别，请稍后再试");
    }
  }

  function toggleVoiceInput() {
    if (isListening) {
      stopVoiceInput();
    } else {
      startVoiceInput();
    }
  }

  async function handleQuickSubmit() {
    if (isListening) stopVoiceInput();
    const text = ($("composer-input").value || "").trim();
    const targetDate = composerDate || selectedDate;

    if (composerIsQuestion) {
      if (!text) {
        showToast("先写下你的迷茫问题吧");
        $("composer-input").focus();
        return;
      }
      state.questions.push({
        id: uid("q"),
        askedDate: targetDate,
        questionText: text,
        contextNote: "",
        unlockAfterDays: Number($("composer-lock-days").value || 7),
        status: "open",
        createdAt: Date.now()
      });
      await saveState(state);
      selectedDate = targetDate;
      const d = new Date(targetDate + "T00:00:00");
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
      resetComposerDraft();
      refreshAll();
      showToast("已投入人生问题池 🧭");
      return;
    }

    // 日常 / 拍照 / 印章模式：支持任意单元素直接保存
    if (!text && draftPhotos.length === 0 && !draftStampId) {
      showToast("写一句、拍张照或画个标记即可保存");
      $("composer-input").focus();
      return;
    }

    const categoryIds = [...draftExtraCategories];
    if (composerIsFun) categoryIds.unshift("fun");
    if (categoryIds.length === 0) categoryIds.push("daily");

    state.entries.push({
      id: uid("entry"),
      date: targetDate,
      content: text,
      photos: [...draftPhotos],
      categoryIds,
      stampId: draftStampId,
      gachaDrawCount: 0,
      createdAt: Date.now()
    });
    await saveState(state);
    selectedDate = targetDate;
    const d = new Date(targetDate + "T00:00:00");
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    resetComposerDraft();
    refreshAll();
    showToast(composerIsFun ? "已记下并塞进趣味扭蛋池 🎉" : "已记到日历 ✨");
  }

  // ==================== 3. 卡片构建 ====================
  function buildEntryCard(entry) {
    const card = document.createElement("article");
    card.className = "record-card";
    const stamp = getStampById(entry.stampId);

    const photosHtml =
      entry.photos && entry.photos.length > 0
        ? `<div class="card-photos">${entry.photos
            .map((src) => `<img src="${src}" alt="记录照片" loading="lazy" />`)
            .join("")}</div>`
        : "";

    const tagsHtml = (entry.categoryIds || [])
      .map((cid) => `<span class="tag-chip ${cid === "fun" ? "fun" : ""}">#${escapeHtml(getCategoryName(cid))}</span>`)
      .join("");

    const displayText = entry.content
      ? escapeHtml(entry.content)
      : entry.photos && entry.photos.length > 0
      ? "📷 留下了一张此刻的画面"
      : "✏️ 盖下了一个今日手绘印章";

    card.innerHTML = `
      <div class="card-top">
        <div class="card-meta">
          ${stamp ? `<span class="card-stamp-badge">${stamp.svg}</span>` : ""}
          <span>${entry.date}</span>
        </div>
        <button class="card-delete" title="删除记录">✕</button>
      </div>
      ${photosHtml}
      <div class="card-text">${displayText}</div>
      <div class="card-tags">${tagsHtml}</div>
    `;

    card.querySelector(".card-delete").addEventListener("click", async () => {
      if (!confirm("确定删除这条记录吗？")) return;
      state.entries = state.entries.filter((x) => x.id !== entry.id);
      await saveState(state);
      refreshAll();
      showToast("已删除记录");
    });

    return card;
  }

  function buildQuestionCard(q) {
    const card = document.createElement("article");
    card.className = "record-card question-card";
    const answers = state.answers
      .filter((a) => a.questionId === q.id)
      .sort((a, b) => a.createdAt - b.createdAt);

    const timelineHtml =
      answers.length > 0
        ? `<div class="answer-timeline">
            ${answers
              .map(
                (a) => `
              <div class="answer-item">
                <div class="answer-date">${a.answeredDate} 的回答</div>
                <div>${escapeHtml(a.answerText)}</div>
              </div>
            `
              )
              .join("")}
          </div>`
        : "";

    card.innerHTML = `
      <div class="card-top">
        <div class="card-meta">
          <span class="tag-chip question">迷茫问题</span>
          <span>${q.askedDate}</span>
          <span>· 已答 ${answers.length} 次</span>
        </div>
        <button class="card-delete" title="删除问题">✕</button>
      </div>
      <div class="card-text">${escapeHtml(q.questionText)}</div>
      ${q.contextNote ? `<div class="card-context">当时心境：${escapeHtml(q.contextNote)}</div>` : ""}
      ${timelineHtml}
      <div class="card-footer-actions">
        <button type="button" class="btn-outline-sm btn-answer-now">✍️ 现在的我来作答</button>
      </div>
    `;

    card.querySelector(".card-delete").addEventListener("click", async () => {
      if (!confirm("确定删除这个问题及其回答吗？")) return;
      state.questions = state.questions.filter((x) => x.id !== q.id);
      state.answers = state.answers.filter((a) => a.questionId !== q.id);
      await saveState(state);
      refreshAll();
      showToast("已删除问题");
    });

    card.querySelector(".btn-answer-now").addEventListener("click", () => {
      openQuestionResultModal(q, false);
    });

    return card;
  }

  // ==================== 4. 分类与检索视图 ====================
  function renderCategoriesView() {
    const pills = $("category-pills");
    pills.innerHTML = "";

    const allTabs = [
      { id: "all", name: "全部" },
      ...state.categories,
      { id: "__questions__", name: "迷茫问题" }
    ];

    allTabs.forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `cat-pill ${activeCategoryFilter === t.id ? "active" : ""}`;
      btn.textContent = t.name;
      btn.addEventListener("click", () => {
        activeCategoryFilter = t.id;
        renderCategoriesView();
      });
      pills.appendChild(btn);
    });

    const keyword = ($("input-search").value || "").trim().toLowerCase();
    const feed = $("category-feed");
    feed.innerHTML = "";

    const items = [];

    if (activeCategoryFilter !== "__questions__") {
      state.entries.forEach((e) => {
        if (activeCategoryFilter !== "all" && !(e.categoryIds || []).includes(activeCategoryFilter)) {
          return;
        }
        if (keyword && !(e.content || "").toLowerCase().includes(keyword)) return;
        items.push({ kind: "entry", sortDate: e.date, createdAt: e.createdAt, data: e });
      });
    }

    if (activeCategoryFilter === "all" || activeCategoryFilter === "__questions__") {
      state.questions.forEach((q) => {
        if (
          keyword &&
          !q.questionText.toLowerCase().includes(keyword) &&
          !(q.contextNote || "").toLowerCase().includes(keyword)
        ) {
          return;
        }
        items.push({ kind: "question", sortDate: q.askedDate, createdAt: q.createdAt, data: q });
      });
    }

    items.sort((a, b) => (b.sortDate > a.sortDate ? 1 : b.sortDate < a.sortDate ? -1 : b.createdAt - a.createdAt));

    if (items.length === 0) {
      feed.innerHTML = `<div class="empty-state">当前分类下还没有匹配的记录。</div>`;
      return;
    }

    items.forEach((it) => {
      feed.appendChild(it.kind === "entry" ? buildEntryCard(it.data) : buildQuestionCard(it.data));
    });
  }

  // ==================== 5. 拍照 & 压缩图片 ====================
  function compressImageFromBlobOrCanvas(source, maxDim = 880) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        c.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL("image/jpeg", 0.78));
      };
      img.src = source;
    });
  }

  async function openCameraModal() {
    if (draftPhotos.length >= 4) {
      showToast("每条记录最多放 4 张照片");
      return;
    }
    $("modal-camera").classList.remove("hidden");
    const statusEl = $("camera-status");
    const video = $("camera-video");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      statusEl.textContent = "当前浏览器环境不支持直接调用摄像头（请点 🖼️ 选择图片或通过 localhost 打开）。";
      return;
    }

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false
      });
      video.srcObject = cameraStream;
      statusEl.textContent = "点击下方圆钮拍照";
    } catch (err) {
      statusEl.textContent = "未能打开摄像头（可能是未授权或 file:// 限制），可以直接点 🖼️ 选择图片。";
    }
  }

  function closeCameraModal() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
    $("camera-video").srcObject = null;
    $("modal-camera").classList.add("hidden");
  }

  // ==================== 6. 手绘印章画板 ====================
  function redrawStampCanvas() {
    const canvas = $("stamp-canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    strokes.forEach((s) => {
      if (s.points.length === 0) return;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      if (s.points.length === 1) {
        ctx.fillStyle = s.color;
        ctx.arc(s.points[0][0], s.points[0][1], s.width / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(s.points[0][0], s.points[0][1]);
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i][0], s.points[i][1]);
        }
        ctx.stroke();
      }
    });
  }

  function strokesToSvg(strokeList) {
    const paths = strokeList
      .filter((s) => s.points.length > 0)
      .map((s) => {
        if (s.points.length === 1) {
          const [x, y] = s.points[0];
          return `<circle cx="${x}" cy="${y}" r="${(s.width / 2).toFixed(1)}" fill="${s.color}"/>`;
        }
        const d = s.points
          .map((p, idx) => `${idx === 0 ? "M" : "L"}${p[0]} ${p[1]}`)
          .join(" ");
        return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"/>`;
      })
      .join("");
    return `<svg viewBox="0 0 260 260" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
  }

  function openStampPad() {
    strokes = [];
    redrawStampCanvas();
    renderStampLibrary();
    $("modal-stamp").classList.remove("hidden");
  }

  function renderStampLibrary() {
    const grid = $("stamp-library-grid");
    grid.innerHTML = "";
    const reusable = state.stamps.filter((s) => s.isReusable);
    if (reusable.length === 0) {
      grid.innerHTML = `<span style="font-size:12px;color:#7a7269;grid-column:1/-1;">还没有保存的印章，画一个试试吧</span>`;
      return;
    }
    reusable.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "library-stamp-btn";
      btn.innerHTML = s.svg;
      btn.title = s.name || "复用印章";
      btn.addEventListener("click", () => {
        draftStampId = s.id;
        renderComposer();
        $("modal-stamp").classList.add("hidden");
        showToast("已贴到输入框，点「记下来」即可保存");
      });
      grid.appendChild(btn);
    });
  }

  async function saveDrawnStampToState() {
    if (strokes.length === 0) return null;
    const newStamp = {
      id: uid("stamp"),
      isReusable: $("chk-save-to-library").checked,
      svg: strokesToSvg(strokes),
      createdAt: Date.now()
    };
    state.stamps.unshift(newStamp);
    await saveState(state);
    return newStamp;
  }

  function initStampCanvasEvents() {
    const canvas = $("stamp-canvas");
    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return [
        Math.round((e.clientX - rect.left) * scaleX),
        Math.round((e.clientY - rect.top) * scaleY)
      ];
    };

    canvas.addEventListener("pointerdown", (e) => {
      isDrawing = true;
      canvas.setPointerCapture(e.pointerId);
      currentStroke = { color: brushColor, width: brushWidth, points: [getPos(e)] };
      strokes.push(currentStroke);
      redrawStampCanvas();
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!isDrawing || !currentStroke) return;
      const pt = getPos(e);
      const last = currentStroke.points[currentStroke.points.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 3) {
        currentStroke.points.push(pt);
        redrawStampCanvas();
      }
    });

    const endDraw = () => {
      isDrawing = false;
      currentStroke = null;
    };
    canvas.addEventListener("pointerup", endDraw);
    canvas.addEventListener("pointercancel", endDraw);
  }

  // ==================== 7. 双模式扭蛋机 ====================
  function getQuestionGachaOptions() {
    return {
      startDate: $("gacha-start-date").value || "",
      endDate: $("gacha-end-date").value || "",
      unansweredOnly: $("chk-unanswered-only").checked,
      ignoreLock: $("chk-ignore-lock").checked
    };
  }

  function updateGachaStats() {
    const funCount = state.entries.filter((e) => (e.categoryIds || []).includes("fun")).length;
    $("fun-pool-count").textContent = funCount;

    const qPool = filterQuestionsForGacha(state, getQuestionGachaOptions());
    $("question-pool-count").textContent = qPool.length;
  }

  function triggerGachaSpin() {
    const machine = $("gacha-machine");
    if (machine.classList.contains("spinning")) return;

    if (gachaMode === "fun") {
      const funCount = state.entries.filter((e) => (e.categoryIds || []).includes("fun")).length;
      if (funCount === 0) {
        showToast("趣味扭蛋池还是空的，先去勾选「🎉 趣味扭蛋」记一条吧！");
        return;
      }
    } else {
      const qPool = filterQuestionsForGacha(state, getQuestionGachaOptions());
      if (qPool.length === 0) {
        showToast("当前日期区间里没有符合条件的迷茫问题，放宽区间或先去记一个吧");
        return;
      }
    }

    machine.classList.add("spinning");
    setTimeout(async () => {
      machine.classList.remove("spinning");
      if (gachaMode === "fun") {
        const entry = drawFunEntry(state);
        await saveState(state);
        if (entry) openFunResultModal(entry);
      } else {
        const question = drawLifeQuestion(state, getQuestionGachaOptions());
        if (question) openQuestionResultModal(question, true);
      }
    }, 900);
  }

  function openFunResultModal(entry) {
    $("gacha-result-title").textContent = "🎉 扭出了一件过往趣事！";
    $("btn-spin-again").classList.remove("hidden");

    const stamp = getStampById(entry.stampId);
    const ago = daysBetween(entry.date);
    const agoLabel = ago === 0 ? "就是今天" : `${ago} 天前的你`;

    const photosHtml =
      entry.photos && entry.photos.length > 0
        ? `<div class="card-photos">${entry.photos.map((src) => `<img src="${src}" alt="回忆照片" />`).join("")}</div>`
        : "";

    $("gacha-result-body").innerHTML = `
      <div class="polaroid-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span class="days-ago-badge">${agoLabel} · ${entry.date}</span>
          ${stamp ? `<span class="card-stamp-badge">${stamp.svg}</span>` : ""}
        </div>
        ${photosHtml}
        <div class="card-text" style="font-size:15px;">${escapeHtml(entry.content || "📷 照片/手绘回忆")}</div>
      </div>
    `;

    $("modal-gacha-result").classList.remove("hidden");
  }

  function openQuestionResultModal(question, showSpinAgain) {
    $("gacha-result-title").textContent = "🧭 来自过去自己的提问";
    $("btn-spin-again").classList.toggle("hidden", !showSpinAgain);

    const ago = daysBetween(question.askedDate);
    const agoLabel = ago === 0 ? "今天刚写下" : `${ago} 天前的你问`;

    const answers = state.answers
      .filter((a) => a.questionId === question.id)
      .sort((a, b) => a.createdAt - b.createdAt);

    const historyHtml =
      answers.length > 0
        ? `<div class="answer-timeline">
            <div class="field-label">过往回答时间线（${answers.length}）</div>
            ${answers
              .map(
                (a) => `
              <div class="answer-item">
                <div class="answer-date">${a.answeredDate}</div>
                <div>${escapeHtml(a.answerText)}</div>
              </div>
            `
              )
              .join("")}
          </div>`
        : `<p style="font-size:12px;color:#7a7269;margin-top:8px;">这个问题还没有回答过，写下你此刻的想法吧。</p>`;

    $("gacha-result-body").innerHTML = `
      <div class="polaroid-card">
        <span class="days-ago-badge">${agoLabel} · ${question.askedDate}</span>
        <div class="card-text" style="font-size:16px;font-weight:600;">${escapeHtml(question.questionText)}</div>
        ${question.contextNote ? `<div class="card-context">当时心境：${escapeHtml(question.contextNote)}</div>` : ""}
        ${historyHtml}
        <div class="question-answer-box">
          <label class="field-label">现在的你怎么回答？</label>
          <textarea id="input-new-answer" rows="3" placeholder="写下此刻的答案，它会作为新的一条记录保存在时间线里..."></textarea>
          <button type="button" id="btn-submit-answer" class="btn-primary-sm">保存此刻的回答</button>
        </div>
      </div>
    `;

    $("btn-submit-answer").addEventListener("click", async () => {
      const text = ($("input-new-answer").value || "").trim();
      if (!text) {
        showToast("先写点想法再保存吧");
        return;
      }
      state.answers.push({
        id: uid("ans"),
        questionId: question.id,
        answeredDate: todayStr,
        answerText: text,
        createdAt: Date.now()
      });
      await saveState(state);
      refreshAll();
      openQuestionResultModal(question, showSpinAgain);
      showToast("已记录此刻的回答 ✨");
    });

    $("modal-gacha-result").classList.remove("hidden");
  }

  // ==================== 8. 全局刷新与事件绑定 ====================
  function renderDemoBanner() {
    const banner = $("demo-banner");
    if (!banner) return;
    banner.classList.toggle("hidden", !state.isDemoData);
  }

  function refreshAll() {
    renderDemoBanner();
    renderCalendar();
    renderComposer();
    renderSelectedDayList();
    renderCategoriesView();
    updateGachaStats();
  }

  function bindEvents() {
    // 底部 Tab 切换
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b === btn));
        document.querySelectorAll(".tab-view").forEach((v) => v.classList.remove("active"));
        $(`view-${tab}`).classList.add("active");
        if (tab === "gacha") updateGachaStats();
        if (tab === "categories") renderCategoriesView();
      });
    });

    // 日历翻月
    $("btn-prev-month").addEventListener("click", () => {
      viewMonth--;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear--;
      }
      renderCalendar();
    });
    $("btn-next-month").addEventListener("click", () => {
      viewMonth++;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear++;
      }
      renderCalendar();
    });
    $("btn-today").addEventListener("click", () => {
      const now = new Date();
      viewYear = now.getFullYear();
      viewMonth = now.getMonth();
      selectedDate = todayStr;
      composerDate = todayStr;
      renderCalendar();
      renderComposer();
      renderSelectedDayList();
    });

    // 极简秒记输入条事件
    $("composer-date").addEventListener("change", (e) => {
      if (!e.target.value) return;
      composerDate = e.target.value;
      selectedDate = composerDate;
      const d = new Date(composerDate + "T00:00:00");
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
      renderCalendar();
      renderComposer();
      renderSelectedDayList();
    });

    $("toggle-fun").addEventListener("click", () => {
      composerIsFun = !composerIsFun;
      if (composerIsFun) composerIsQuestion = false;
      renderComposer();
    });

    $("toggle-question").addEventListener("click", () => {
      composerIsQuestion = !composerIsQuestion;
      if (composerIsQuestion) composerIsFun = false;
      renderComposer();
      $("composer-input").focus();
    });

    $("composer-input").addEventListener("input", (e) => {
      e.target.style.height = "auto";
      e.target.style.height = Math.min(140, e.target.scrollHeight) + "px";
    });

    $("composer-input").addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleQuickSubmit();
      }
    });

    $("btn-remove-draft-stamp").addEventListener("click", () => {
      draftStampId = null;
      renderComposer();
    });

    $("btn-toggle-tags").addEventListener("click", () => {
      const tray = $("composer-tag-tray");
      tray.classList.toggle("hidden");
      $("btn-toggle-tags").classList.toggle("active", !tray.classList.contains("hidden"));
    });

    $("btn-quick-submit").addEventListener("click", handleQuickSubmit);

    // 通用关闭弹窗
    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        $(btn.dataset.close).classList.add("hidden");
      });
    });

    // 语音转文字
    $("btn-voice-input").addEventListener("click", toggleVoiceInput);
    $("btn-voice-stop").addEventListener("click", stopVoiceInput);

    // 好友体验数据一键清零引导条
    $("btn-demo-start-fresh").addEventListener("click", async () => {
      if (!confirm("清空内置演示记录，开始记录你自己的生活？（预设手绘印章与复盘模板会保留）")) return;
      state.entries = [];
      state.questions = [];
      state.answers = [];
      state.recentFunIds = [];
      state.isDemoData = false;
      await saveState(state);
      refreshAll();
      showToast("已清空演示数据，开始你的第一条记录吧 ✨");
    });

    $("btn-demo-dismiss").addEventListener("click", async () => {
      state.isDemoData = false;
      await saveState(state);
      renderDemoBanner();
    });

    // 拍照与选图（手机端优先调用系统原生相机，电脑端打开实时拍摄弹窗）
    $("btn-quick-camera").addEventListener("click", () => {
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        if (draftPhotos.length >= 4) {
          showToast("每条记录最多放 4 张照片");
          return;
        }
        $("input-native-camera").click();
      } else {
        openCameraModal();
      }
    });

    $("input-native-camera").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file || draftPhotos.length >= 4) return;
      const rawUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      const compressed = await compressImageFromBlobOrCanvas(rawUrl);
      draftPhotos.push(compressed);
      e.target.value = "";
      renderComposer();
      showToast("已拍下照片，可直接点「记下来」");
    });

    $("btn-close-camera").addEventListener("click", closeCameraModal);
    $("btn-shutter").addEventListener("click", async () => {
      const video = $("camera-video");
      if (!video.srcObject) return;
      const c = $("camera-canvas");
      c.width = video.videoWidth || 640;
      c.height = video.videoHeight || 480;
      c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
      const dataUrl = await compressImageFromBlobOrCanvas(c.toDataURL("image/jpeg", 0.9));
      draftPhotos.push(dataUrl);
      renderComposer();
      closeCameraModal();
      showToast("照片已附到秒记栏，可直接点「记下来」");
    });

    $("input-photo-file").addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        if (draftPhotos.length >= 4) break;
        const rawUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        const compressed = await compressImageFromBlobOrCanvas(rawUrl);
        draftPhotos.push(compressed);
      }
      e.target.value = "";
      renderComposer();
    });

    // 手绘画板按钮
    $("btn-open-stamp-pad").addEventListener("click", openStampPad);

    document.querySelectorAll("#brush-colors .swatch").forEach((sw) => {
      sw.addEventListener("click", () => {
        document.querySelectorAll("#brush-colors .swatch").forEach((x) => x.classList.remove("active"));
        sw.classList.add("active");
        brushColor = sw.dataset.color;
      });
    });

    document.querySelectorAll(".brush-sizes .size-btn[data-width]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".brush-sizes .size-btn[data-width]").forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
        brushWidth = Number(btn.dataset.width);
      });
    });

    $("btn-stamp-undo").addEventListener("click", () => {
      strokes.pop();
      redrawStampCanvas();
    });

    $("btn-stamp-clear").addEventListener("click", () => {
      strokes = [];
      redrawStampCanvas();
    });

    // 仅贴到输入框（方便顺便写字或配图）
    $("btn-confirm-stamp").addEventListener("click", async () => {
      if (strokes.length === 0) {
        showToast("先画几笔，或直接点下方已有印章");
        return;
      }
      const newStamp = await saveDrawnStampToState();
      draftStampId = newStamp.id;
      renderComposer();
      $("modal-stamp").classList.add("hidden");
      showToast("标记已贴到秒记栏");
    });

    // 直接盖章保存（只画标记即可完成一条记录）
    $("btn-stamp-quick-save").addEventListener("click", async () => {
      if (strokes.length === 0) {
        showToast("先在画板上画几笔吧");
        return;
      }
      const newStamp = await saveDrawnStampToState();
      const targetDate = composerDate || selectedDate;
      state.entries.push({
        id: uid("entry"),
        date: targetDate,
        content: ($("composer-input").value || "").trim(),
        photos: [...draftPhotos],
        categoryIds: composerIsFun ? ["fun"] : ["daily"],
        stampId: newStamp.id,
        gachaDrawCount: 0,
        createdAt: Date.now()
      });
      await saveState(state);
      $("modal-stamp").classList.add("hidden");
      resetComposerDraft();
      refreshAll();
      showToast("已盖章保存到日历 ✏️");
    });

    // 分类搜索与新增分类
    $("input-search").addEventListener("input", renderCategoriesView);
    $("btn-add-category").addEventListener("click", async () => {
      const name = (prompt("输入新的分类名称（如：旅行、读书、灵感）：") || "").trim();
      if (!name) return;
      if (state.categories.some((c) => c.name === name)) {
        showToast("这个分类已经存在了");
        return;
      }
      state.categories.push({ id: uid("cat"), name });
      await saveState(state);
      renderCategoriesView();
      renderComposerTagTray();
      showToast(`已添加分类「${name}」`);
    });

    // 扭蛋机模式切换
    document.querySelectorAll(".gacha-mode-switch .mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        gachaMode = btn.dataset.mode;
        document.querySelectorAll(".gacha-mode-switch .mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
        $("gacha-fun-panel").classList.toggle("hidden", gachaMode !== "fun");
        $("gacha-question-panel").classList.toggle("hidden", gachaMode !== "question");
        updateGachaStats();
      });
    });

    // 人生问题日期快捷区间
    document.querySelectorAll(".range-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".range-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        const r = chip.dataset.range;
        if (r === "all") {
          $("gacha-start-date").value = "";
          $("gacha-end-date").value = "";
        } else if (r === "30d") {
          $("gacha-start-date").value = offsetDate(30);
          $("gacha-end-date").value = todayStr;
        } else if (r === "180d") {
          $("gacha-start-date").value = offsetDate(180);
          $("gacha-end-date").value = todayStr;
        } else if (r === "older7") {
          $("gacha-start-date").value = "";
          $("gacha-end-date").value = offsetDate(7);
        }
        updateGachaStats();
      });
    });

    ["gacha-start-date", "gacha-end-date", "chk-unanswered-only", "chk-ignore-lock"].forEach((id) => {
      $(id).addEventListener("change", updateGachaStats);
    });

    $("btn-spin-gacha").addEventListener("click", triggerGachaSpin);
    $("btn-spin-again").addEventListener("click", () => {
      $("modal-gacha-result").classList.add("hidden");
      setTimeout(triggerGachaSpin, 120);
    });

    // 设置与备份
    $("btn-open-settings").addEventListener("click", () => {
      window.SthAiReview.syncAiToggleUI();
      $("modal-settings").classList.remove("hidden");
    });

    $("btn-export-json").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sth_record_backup_${todayStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("已导出 JSON 备份");
    });

    $("input-import-json").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.questions)) {
          throw new Error("格式不正确");
        }
        state = window.SthStorage.normalizeState(parsed);
        await saveState(state);
        $("modal-settings").classList.add("hidden");
        window.SthAiReview.syncAiToggleUI();
        refreshAll();
        showToast("已导入备份数据");
      } catch (err) {
        showToast("导入失败：请检查 JSON 文件格式");
      }
      e.target.value = "";
    });

    $("btn-reset-demo").addEventListener("click", async () => {
      if (!confirm("恢复演示数据将覆盖当前本地数据，确定继续吗？")) return;
      state = createDemoState();
      await saveState(state);
      $("modal-settings").classList.add("hidden");
      window.SthAiReview.syncAiToggleUI();
      refreshAll();
      showToast("已恢复内置演示数据");
    });

    $("btn-clear-all").addEventListener("click", async () => {
      if (!confirm("确定清空所有记录、印章和问题吗？此操作不可撤销。")) return;
      state = window.SthStorage.normalizeState({
        categories: [...window.SthStorage.DEFAULT_CATEGORIES],
        stamps: [],
        entries: [],
        questions: [],
        answers: [],
        recentFunIds: [],
        aiTemplates: state.aiTemplates,
        aiProfile: state.aiProfile,
        settings: state.settings
      });
      await saveState(state);
      $("modal-settings").classList.add("hidden");
      window.SthAiReview.syncAiToggleUI();
      refreshAll();
      showToast("已清空全部本地数据");
    });
  }

  async function init() {
    state = await loadState();
    initStampCanvasEvents();
    bindEvents();
    window.SthAiReview.init({
      getState: () => state,
      setState: (next) => { state = next; },
      todayStr,
      showToast,
      escapeHtml,
      getCategoryName,
      refreshAll
    });
    refreshAll();
  }

  // 注册 PWA Service Worker（仅在 HTTPS 或 localhost 环境下启用）
  if (
    "serviceWorker" in navigator &&
    (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  init();
})();
