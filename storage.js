// 本地存储层（IndexedDB）+ 内置演示数据 + 双模式扭蛋加权抽取引擎 + 默认 AI 复盘模板
(function (global) {
  const DB_NAME = "SthRecordDB";
  const DB_VERSION = 1;
  const STORE_NAME = "kv";
  const STATE_KEY = "app_state_v1";

  const DEFAULT_CATEGORIES = [
    { id: "fun", name: "趣事" },
    { id: "daily", name: "日常" },
    { id: "mood", name: "情绪" },
    { id: "food", name: "美食" }
  ];

  const DEFAULT_AI_TEMPLATES = [
    {
      id: "human3",
      name: "Human 3.0 人生规划",
      desc: "Dan Koe 四象限 L1/L2/L3 诊断 + 1v1 追问采访",
      isBuiltin: true,
      checkQuadrants: true,
      body: `请基于油管大神 Dan Koe 的 Human 3.0 人生模型，结合下方我真实记录的日常、趣事与迷茫问题，帮我做一次完整的人生规划。
请从以下四个象限进行分析，分别判断我目前更接近 L1、L2 还是 L3，并**必须引用我具体哪一天的记录或迷茫问题作为依据**（避免空泛说教）：
- 心智 - Mind：认知、情绪、思维模式、自我意识
- 身体 - Body：健康、睡眠、运动、精力
- 精神 - Spirit：价值观、意义感、人际关系、人生方向
- 事业 - Vocation：工作、收入、技能、商业能力、自由度

请先像一位专业的人生战略顾问一样采访我：**每次只问我 1 个最重要的问题**，并根据我的回答继续追问，直到你认为已经足够了解我再输出完整规划。
过程中请重点识别：
1. 我真正想要的人生
2. 我的行为与目标之间的矛盾
3. 我反复拖延和逃避的问题
4. 限制我的生活习惯、身份认同和环境
5. 我最有潜力、但尚未充分开发的优势`
    },
    {
      id: "painpoints",
      name: "迷茫密集期痛点扫描",
      desc: "定位反复逃避、情绪高发期与核心矛盾",
      isBuiltin: true,
      checkQuadrants: false,
      body: `请作为一名敏锐的个人复盘教练，分析下方我在这一段时间内记录的日常与迷茫问题（尤其关注本地统计中标出的问题密集月份与重复主题）：
1. 帮我提炼出我反复陷入内耗或逃避的 2~3 个核心矛盾，并引用具体日期的原话作为证据；
2. 对比我过去提问与后来作答的变化，指出哪些认知已经松动、哪些仍卡在原地；
3. 针对每个核心矛盾，给出 1 个下周就能立刻验证的极小行动实验（不要宏大鸡汤）。`
    },
    {
      id: "strengths",
      name: "快乐源泉与优势提炼",
      desc: "从趣事与日常细节里发掘天然潜能",
      isBuiltin: true,
      checkQuadrants: false,
      body: `请结合下方我记录的日常与「趣事」回忆，帮我做一次能量与优势审计：
1. 哪些事情、场景或人际互动持续给我带来正向能量与心流？请引用具体日期的记录；
2. 从这些高频让自己开心的细节中，提炼我尚未充分开发的 3 个核心优势；
3. 给出具体建议：如何把这些正向触发点更稳定地设计进我的日常生活与事业方向中。`
    }
  ];

  function cloneDefaultTemplates() {
    return DEFAULT_AI_TEMPLATES.map((t) => ({ ...t }));
  }

  function defaultSettings() {
    return {
      aiReviewEnabled: true,
      aiApi: {
        enabled: false,
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: ""
      }
    };
  }

  function defaultAiProfile() {
    return {
      includeInPrompt: true,
      roleStage: "",
      topGoal: "",
      bodyEnergy: ""
    };
  }

  function normalizeState(raw) {
    const s = raw || {};
    if (!Array.isArray(s.categories)) s.categories = [...DEFAULT_CATEGORIES];
    if (!Array.isArray(s.stamps)) s.stamps = [];
    if (!Array.isArray(s.entries)) s.entries = [];
    if (!Array.isArray(s.questions)) s.questions = [];
    if (!Array.isArray(s.answers)) s.answers = [];
    if (!Array.isArray(s.recentFunIds)) s.recentFunIds = [];
    if (!Array.isArray(s.aiTemplates) || s.aiTemplates.length === 0) {
      s.aiTemplates = cloneDefaultTemplates();
    }
    if (!s.aiProfile) {
      s.aiProfile = defaultAiProfile();
    }
    if (typeof s.isDemoData !== "boolean") {
      s.isDemoData = s.entries.some((e) => String(e.id || "").startsWith("entry_demo_"));
    }
    if (!s.settings) {
      s.settings = defaultSettings();
    } else {
      if (typeof s.settings.aiReviewEnabled !== "boolean") {
        s.settings.aiReviewEnabled = true;
      }
      if (!s.settings.aiApi) {
        s.settings.aiApi = defaultSettings().aiApi;
      }
    }
    return s;
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function offsetDate(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return formatDate(d);
  }

  function buildDemoStamps() {
    return [
      {
        id: "stamp_sun",
        name: "小太阳",
        isReusable: true,
        svg: `<svg viewBox="0 0 260 260" xmlns="http://www.w3.org/2000/svg"><circle cx="130" cy="130" r="46" fill="none" stroke="#e07a5f" stroke-width="11" stroke-linecap="round"/><path d="M130 42v24M130 194v24M42 130h24M194 130h24M68 68l18 18M174 174l18 18M192 68l-18 18M86 174l-18 18" fill="none" stroke="#d4a017" stroke-width="10" stroke-linecap="round"/></svg>`,
        createdAt: Date.now() - 86400000 * 20
      },
      {
        id: "stamp_coffee",
        name: "热咖啡",
        isReusable: true,
        svg: `<svg viewBox="0 0 260 260" xmlns="http://www.w3.org/2000/svg"><path d="M68 112h102v54c0 24-20 42-51 42s-51-18-51-42v-54z" fill="none" stroke="#2c2825" stroke-width="10" stroke-linejoin="round"/><path d="M170 124h18c16 0 24 10 24 22s-8 22-24 22h-18" fill="none" stroke="#2c2825" stroke-width="10" stroke-linecap="round"/><path d="M98 86c0-14 14-14 14-28M136 86c0-14 14-14 14-28" fill="none" stroke="#e07a5f" stroke-width="9" stroke-linecap="round"/></svg>`,
        createdAt: Date.now() - 86400000 * 15
      },
      {
        id: "stamp_cat",
        name: "小猫",
        isReusable: true,
        svg: `<svg viewBox="0 0 260 260" xmlns="http://www.w3.org/2000/svg"><path d="M64 112L74 60l40 28h32l40-28 10 52c8 44-18 88-66 88s-74-44-66-88z" fill="none" stroke="#3d5a80" stroke-width="10" stroke-linejoin="round"/><circle cx="104" cy="134" r="7" fill="#3d5a80"/><circle cx="156" cy="134" r="7" fill="#3d5a80"/><path d="M118 156q12 12 24 0" fill="none" stroke="#e07a5f" stroke-width="9" stroke-linecap="round"/></svg>`,
        createdAt: Date.now() - 86400000 * 10
      },
      {
        id: "stamp_leaf",
        name: "小叶子",
        isReusable: true,
        svg: `<svg viewBox="0 0 260 260" xmlns="http://www.w3.org/2000/svg"><path d="M68 192C68 112 126 62 198 62c0 72-50 130-130 130z" fill="none" stroke="#52796f" stroke-width="10" stroke-linejoin="round"/><path d="M68 192L164 96" fill="none" stroke="#52796f" stroke-width="9" stroke-linecap="round"/></svg>`,
        createdAt: Date.now() - 86400000 * 6
      },
      {
        id: "stamp_star",
        name: "闪闪星",
        isReusable: true,
        svg: `<svg viewBox="0 0 260 260" xmlns="http://www.w3.org/2000/svg"><path d="M130 44l24 58 62 6-48 40 15 62-53-33-53 33 15-62-48-40 62-6z" fill="none" stroke="#d4a017" stroke-width="10" stroke-linejoin="round"/></svg>`,
        createdAt: Date.now() - 86400000 * 2
      }
    ];
  }

  function createDemoState() {
    const stamps = buildDemoStamps();
    return normalizeState({
      categories: [...DEFAULT_CATEGORIES],
      stamps,
      entries: [
        {
          id: "entry_demo_1",
          date: offsetDate(14),
          content: "下班路上偶遇一只橘猫坐在便利店门口晒夕阳，摸了它两分钟它居然翻肚皮了，一整周的疲惫瞬间清零。",
          photos: [],
          categoryIds: ["fun", "daily"],
          stampId: "stamp_cat",
          gachaDrawCount: 0,
          createdAt: Date.now() - 86400000 * 14
        },
        {
          id: "entry_demo_2",
          date: offsetDate(8),
          content: "尝试自己做手冲浅烘豆，居然一次冲出了柑橘香气！顺手画了个小咖啡杯记下来。",
          photos: [],
          categoryIds: ["fun", "food"],
          stampId: "stamp_coffee",
          gachaDrawCount: 0,
          createdAt: Date.now() - 86400000 * 8
        },
        {
          id: "entry_demo_3",
          date: offsetDate(3),
          content: "在公园散步捡到一片超完整的银杏叶，夹在书里了。天气刚好不冷不热。",
          photos: [],
          categoryIds: ["daily", "mood"],
          stampId: "stamp_leaf",
          gachaDrawCount: 0,
          createdAt: Date.now() - 86400000 * 3
        },
        {
          id: "entry_demo_4",
          date: offsetDate(0),
          content: "终于把「日历 + 手绘印章 + 双扭蛋机」的原型想法落成第一个可玩的版本啦！",
          photos: [],
          categoryIds: ["fun", "daily"],
          stampId: "stamp_star",
          gachaDrawCount: 0,
          createdAt: Date.now()
        }
      ],
      questions: [
        {
          id: "q_demo_1",
          askedDate: offsetDate(65),
          questionText: "如果一份工作稳定但缺少新鲜感，我到底是在害怕改变，还是真的适合安稳？",
          contextNote: "那天加班到十点，突然有点不确定接下来两年想要什么。",
          unlockAfterDays: 30,
          status: "open",
          createdAt: Date.now() - 86400000 * 65
        },
        {
          id: "q_demo_2",
          askedDate: offsetDate(32),
          questionText: "业余时间想做自己的小产品，但总是三分钟热度，怎么才能坚持做出真正有用的东西？",
          contextNote: "翻到文件夹里躺着三个只写了一半的 demo。",
          unlockAfterDays: 14,
          status: "open",
          createdAt: Date.now() - 86400000 * 32
        },
        {
          id: "q_demo_3",
          askedDate: offsetDate(10),
          questionText: "最近总忍不住和同龄人比较进度，半年后的我回头看，现在焦虑的这些事还重要吗？",
          contextNote: "刷完朋友圈后有点内耗。",
          unlockAfterDays: 7,
          status: "open",
          createdAt: Date.now() - 86400000 * 10
        }
      ],
      answers: [
        {
          id: "ans_demo_1",
          questionId: "q_demo_2",
          answeredDate: offsetDate(5),
          answerText: "其实不需要一开始做很大，先把给自己用的最小版本做出来，每天打开有正反馈就自然坚持下去了。",
          createdAt: Date.now() - 86400000 * 5
        }
      ],
      recentFunIds: [],
      aiTemplates: cloneDefaultTemplates(),
      aiProfile: defaultAiProfile(),
      settings: defaultSettings()
    });
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB not supported"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadState() {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(STATE_KEY);
        req.onsuccess = () => {
          if (req.result) {
            resolve(normalizeState(req.result));
          } else {
            const demo = createDemoState();
            saveState(demo).then(() => resolve(demo));
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
      const demo = createDemoState();
      localStorage.setItem(STATE_KEY, JSON.stringify(demo));
      return demo;
    }
  }

  async function saveState(state) {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(state, STATE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    }
  }

  function drawFunEntry(state) {
    const funEntries = state.entries.filter((e) => e.categoryIds.includes("fun"));
    if (funEntries.length === 0) return null;

    let pool = funEntries;
    if (funEntries.length > 2 && state.recentFunIds && state.recentFunIds.length > 0) {
      const filtered = funEntries.filter((e) => !state.recentFunIds.includes(e.id));
      if (filtered.length > 0) pool = filtered;
    }

    const weights = pool.map((e) => 1 / ((e.gachaDrawCount || 0) + 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let picked = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        picked = pool[i];
        break;
      }
    }

    picked.gachaDrawCount = (picked.gachaDrawCount || 0) + 1;
    picked.lastDrawnAt = Date.now();
    state.recentFunIds = [picked.id, ...(state.recentFunIds || [])].slice(0, 2);
    return picked;
  }

  function filterQuestionsForGacha(state, options) {
    const { startDate, endDate, unansweredOnly, ignoreLock } = options;
    const now = Date.now();
    return state.questions.filter((q) => {
      if (startDate && q.askedDate < startDate) return false;
      if (endDate && q.askedDate > endDate) return false;
      if (unansweredOnly) {
        const hasAns = state.answers.some((a) => a.questionId === q.id);
        if (hasAns) return false;
      }
      if (!ignoreLock && q.unlockAfterDays > 0) {
        const askedMs = new Date(q.askedDate + "T00:00:00").getTime();
        const diffDays = (now - askedMs) / 86400000;
        if (diffDays < q.unlockAfterDays) return false;
      }
      return true;
    });
  }

  function drawLifeQuestion(state, options) {
    const pool = filterQuestionsForGacha(state, options);
    if (pool.length === 0) return null;
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }

  global.SthStorage = {
    uid,
    formatDate,
    offsetDate,
    DEFAULT_CATEGORIES,
    DEFAULT_AI_TEMPLATES,
    cloneDefaultTemplates,
    defaultSettings,
    defaultAiProfile,
    normalizeState,
    createDemoState,
    loadState,
    saveState,
    drawFunEntry,
    filterQuestionsForGacha,
    drawLifeQuestion
  };
})(window);
