const storageKey = "wxyy-2-thin-section-index";
const state = JSON.parse(localStorage.getItem(storageKey) || "{}");
state.samples = state.samples || [];
state.compare = state.compare || [];
state.sessions = state.sessions || [];
state.makeup = state.makeup || [];

const form = document.querySelector("#sampleForm");
const saveSampleBtn = document.querySelector("#saveSampleBtn");
const cancelEditBtn = document.querySelector("#cancelEditBtn");
const photoInput = document.querySelector("#photoInput");
const sampleGrid = document.querySelector("#sampleGrid");
const comparePane = document.querySelector("#comparePane");
const mineralFilter = document.querySelector("#mineralFilter");
const polarFilter = document.querySelector("#polarFilter");
const scheduleForm = document.querySelector("#scheduleForm");
const scheduleSample = document.querySelector("#scheduleSample");
const scheduleSlot = document.querySelector("#scheduleSlot");
const memberA = document.querySelector("#memberA");
const memberB = document.querySelector("#memberB");
const scheduleError = document.querySelector("#scheduleError");
const poolCount = document.querySelector("#poolCount");
const poolList = document.querySelector("#poolList");
const sessionList = document.querySelector("#sessionList");
const discussionList = document.querySelector("#discussionList");
const makeupList = document.querySelector("#makeupList");

let pendingPhoto = "";
let editingId = null;
const identityBySession = {};

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.readAsDataURL(file);
  });
}

function findSample(id) {
  return state.samples.find((sample) => sample.id === id);
}

function findSession(id) {
  return state.sessions.find((session) => session.id === id);
}

function sessionOfSample(sampleId) {
  return state.sessions.find((session) => session.sampleId === sampleId);
}

function poolSamples() {
  return state.samples.filter((sample) => !sessionOfSample(sample.id));
}

function blankConclusion() {
  return { draft: "", text: "", submitted: false, submittedAt: null, voided: [] };
}

function normalizeConclusion(text) {
  return text.replace(/\s+/g, "");
}

function slotNumber(slot) {
  return Number(slot.replace(/\D/g, "")) || 0;
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function filteredSamples() {
  const mineral = mineralFilter.value.trim();
  const polarization = polarFilter.value;
  return state.samples.filter((sample) => {
    const mineralMatch = !mineral || sample.minerals.includes(mineral);
    const polarMatch = !polarization || sample.polarization === polarization;
    return mineralMatch && polarMatch;
  });
}

function sessionStatus(session) {
  if (session.result) return ["已出结果", ""];
  if (session.discussion && !session.discussion.resolved) return ["讨论中", "warn"];
  const submitted = session.conclusions.filter((conclusion) => conclusion.submitted).length;
  return [`进行中 ${submitted}/2`, "muted"];
}

function captureOpenDrafts() {
  document.querySelectorAll("textarea[data-draft-session]").forEach((textarea) => {
    const session = findSession(textarea.dataset.draftSession);
    if (!session) return;
    const conclusion = session.conclusions[Number(textarea.dataset.draftMember)];
    if (conclusion && !conclusion.submitted) conclusion.draft = textarea.value;
  });
}

function evaluateSession(session) {
  const [a, b] = session.conclusions;
  if (session.result || !a.submitted || !b.submitted) return;
  if (normalizeConclusion(a.text) === normalizeConclusion(b.text)) {
    session.result = { text: a.text, source: "双方一致", at: new Date().toISOString() };
    session.discussion = null;
    session.notice = "两份结论一致，已出结果。";
  } else if (!session.discussion) {
    session.discussion = { enqueuedAt: new Date().toISOString(), resolved: false };
    session.notice = "两份结论不一致，已进入讨论队列。";
  }
}

function refreshMakeup() {
  state.makeup.forEach((entry) => {
    if (entry.cleared) return;
    const session = findSession(entry.sessionId);
    if (session && session.conclusions.every((conclusion) => conclusion.submitted)) {
      entry.cleared = true;
      entry.clearedAt = new Date().toISOString();
    }
  });
}

function submitConclusion(sessionId, index) {
  const session = findSession(sessionId);
  if (!session) return;
  const conclusion = session.conclusions[index];
  if (!conclusion.draft.trim()) {
    session.notice = "结论不能为空，请先填写再提交。";
    return;
  }
  conclusion.text = conclusion.draft.trim();
  conclusion.draft = "";
  conclusion.submitted = true;
  conclusion.submittedAt = new Date().toISOString();
  session.notice = `${session.members[index]} 的结论已提交。`;
  evaluateSession(session);
  refreshMakeup();
}

function dismissSession(sessionId) {
  const session = findSession(sessionId);
  if (!session || session.ended) return;
  session.ended = true;
  const missing = session.members.filter((_, index) => !session.conclusions[index].submitted);
  if (missing.length) {
    state.makeup = state.makeup.filter((entry) => entry.sessionId !== sessionId);
    state.makeup.unshift({
      id: crypto.randomUUID(),
      sessionId,
      missing,
      at: new Date().toISOString(),
      cleared: false,
      clearedAt: null
    });
    session.notice = `已下课，${missing.join("、")} 未提交结论，已记入补交清单。`;
  } else {
    session.notice = "已下课，两人结论均已提交。";
  }
}

function resolveDiscussion(sessionId, index, rewriteText) {
  const session = findSession(sessionId);
  if (!session || !session.discussion || session.discussion.resolved) return;
  const isRewrite = index < 0;
  const text = isRewrite ? rewriteText.trim() : session.conclusions[index].text;
  if (!text) {
    session.notice = "改写内容为空，无法定稿。";
    return;
  }
  session.result = {
    text,
    source: isRewrite ? "老师改写" : `老师选定·${session.members[index]}`,
    at: new Date().toISOString()
  };
  session.discussion.resolved = true;
  session.notice = "老师已定稿，两份原稿保留在讨论队列。";
}

function invalidateSessions(sampleId, fields) {
  state.sessions.forEach((session) => {
    if (session.sampleId !== sampleId) return;
    let voidedCount = 0;
    session.conclusions.forEach((conclusion) => {
      if (!conclusion.submitted) return;
      conclusion.voided.push({ text: conclusion.text, at: conclusion.submittedAt });
      conclusion.draft = conclusion.text;
      conclusion.text = "";
      conclusion.submitted = false;
      conclusion.submittedAt = null;
      voidedCount += 1;
    });
    if (voidedCount) {
      session.result = null;
      session.discussion = null;
      session.notice = `样本${fields.join("、")}已修改，${voidedCount} 份已交稿作废，请重新提交。`;
    }
  });
}

function resetFormState() {
  editingId = null;
  pendingPhoto = "";
  photoInput.value = "";
  form.reset();
  saveSampleBtn.textContent = "保存样本";
  cancelEditBtn.hidden = true;
}

function startEdit(sample) {
  editingId = sample.id;
  pendingPhoto = sample.photo;
  photoInput.value = "";
  form.elements.code.value = sample.code;
  form.elements.location.value = sample.location;
  form.elements.magnification.value = sample.magnification;
  form.elements.polarization.value = sample.polarization;
  form.elements.minerals.value = sample.minerals;
  form.elements.texture.value = sample.texture;
  form.elements.comment.value = sample.comment;
  saveSampleBtn.textContent = "保存修改";
  cancelEditBtn.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function draftArea(session, index, viewer) {
  const member = session.members[index];
  const conclusion = session.conclusions[index];
  const voidedNote = conclusion.voided.length
    ? `<p class="voided-note">有 ${conclusion.voided.length} 份已交稿因样本照片、倍数或偏光修改作废</p>`
    : "";

  if (viewer === "teacher") {
    return `<div class="draft">
      <h4>${member}</h4>
      ${conclusion.submitted
        ? `<p class="draft-text">${conclusion.text}</p><span class="badge">已提交</span>`
        : `<p class="draft-locked">未提交</p>`}
      ${voidedNote}
    </div>`;
  }

  if (String(index) === viewer) {
    return conclusion.submitted
      ? `<div class="draft">
          <h4>${member}（本人）</h4>
          <p class="draft-text">${conclusion.text}</p>
          <span class="badge">已提交 · ${fmtTime(conclusion.submittedAt)}</span>
          ${voidedNote}
        </div>`
      : `<div class="draft">
          <h4>${member}（本人）</h4>
          <textarea rows="4" data-draft-session="${session.id}" data-draft-member="${index}" placeholder="写下你的鉴定结论，对方看不到这份稿子">${conclusion.draft}</textarea>
          <div class="draft-actions">
            <button type="button" data-save-draft="${session.id}:${index}">保存草稿</button>
            <button type="button" data-submit-conclusion="${session.id}:${index}">提交结论</button>
          </div>
          ${voidedNote}
        </div>`;
  }

  return `<div class="draft">
    <h4>${member}</h4>
    <p class="draft-locked">对方稿子不可见</p>
    <span class="badge ${conclusion.submitted ? "" : "muted"}">${conclusion.submitted ? "已提交" : "未提交"}</span>
  </div>`;
}

function renderSessionCard(session) {
  const sample = findSample(session.sampleId);
  const viewer = identityBySession[session.id] || "0";
  const [statusText, statusClass] = sessionStatus(session);
  return `
    <article class="session-card">
      <header class="session-head">
        <strong>${session.slot} · ${sample ? sample.code : "已删样本"}</strong>
        <span class="badge ${statusClass}">${statusText}</span>
        ${session.ended ? `<span class="badge muted">已下课</span>` : ""}
      </header>
      <p class="session-sub">${session.members[0]}（甲） · ${session.members[1]}（乙）</p>
      <label class="identity">当前身份
        <select data-identity="${session.id}">
          <option value="0" ${viewer === "0" ? "selected" : ""}>${session.members[0]}（甲）</option>
          <option value="1" ${viewer === "1" ? "selected" : ""}>${session.members[1]}（乙）</option>
          <option value="teacher" ${viewer === "teacher" ? "selected" : ""}>老师</option>
        </select>
      </label>
      <div class="drafts">
        ${draftArea(session, 0, viewer)}
        ${draftArea(session, 1, viewer)}
      </div>
      ${session.notice ? `<p class="notice">${session.notice}</p>` : ""}
      ${session.result ? `<div class="result"><strong>课堂结论（${session.result.source} · ${fmtTime(session.result.at)}）</strong><p>${session.result.text}</p></div>` : ""}
      <div class="session-actions">
        ${!session.ended ? `<button type="button" data-dismiss="${session.id}">下课结算</button>` : ""}
        <button type="button" data-unschedule="${session.id}">退回待安排</button>
      </div>
    </article>`;
}

function renderOpenDiscussion(session) {
  const sample = findSample(session.sampleId);
  return `
    <article class="discussion-item">
      <strong>${sample ? sample.code : "已删样本"} · ${session.slot}</strong>
      <p>${session.members.join("、")} 的结论不一致，待老师定稿。</p>
      <div class="verdicts">
        ${session.conclusions.map((conclusion, index) => `
          <div class="verdict">
            <h4>${session.members[index]}的稿子</h4>
            <p>${conclusion.text}</p>
            <button type="button" data-pick="${session.id}:${index}">采用这份</button>
          </div>`).join("")}
      </div>
      <label>老师改写（两份原稿保留）
        <textarea rows="3" data-rewrite="${session.id}" placeholder="综合两份结论后改写定稿"></textarea>
      </label>
      <button type="button" data-rewrite-submit="${session.id}">以改写定稿</button>
    </article>`;
}

function renderResolvedDiscussion(session) {
  const sample = findSample(session.sampleId);
  return `
    <article class="discussion-item resolved">
      <strong>${sample ? sample.code : "已删样本"} · ${session.slot}</strong>
      <span class="badge">已定稿 · ${session.result.source}</span>
      <div class="verdicts">
        ${session.conclusions.map((conclusion, index) => `
          <div class="verdict">
            <h4>${session.members[index]}的原稿</h4>
            <p>${conclusion.text}</p>
          </div>`).join("")}
      </div>
      <div class="result"><strong>定稿</strong><p>${session.result.text}</p></div>
    </article>`;
}

function renderRotation() {
  const pool = poolSamples();
  poolCount.textContent = pool.length;
  poolList.innerHTML = pool.length
    ? pool.map((sample) => `<li>${sample.code} · ${sample.polarization} · ${sample.magnification || "未记录倍数"}</li>`).join("")
    : "<li>没有待安排的样本。</li>";

  const selectedSample = scheduleSample.value;
  scheduleSample.innerHTML = state.samples.length
    ? state.samples.map((sample) => {
        const session = sessionOfSample(sample.id);
        return `<option value="${sample.id}">${sample.code}${session ? `（已排·${session.slot}）` : ""}</option>`;
      }).join("")
    : `<option value="">（请先录入样本）</option>`;
  scheduleSample.value = selectedSample;

  const sessions = [...state.sessions].sort((a, b) => slotNumber(a.slot) - slotNumber(b.slot));
  sessionList.innerHTML = sessions.length
    ? sessions.map(renderSessionCard).join("")
    : "<p>还没有排课，先从左侧把待安排样本排进课堂。</p>";

  const openDiscussions = sessions.filter((session) => session.discussion && !session.discussion.resolved);
  const resolvedDiscussions = sessions.filter((session) => session.discussion && session.discussion.resolved);
  discussionList.innerHTML = openDiscussions.length || resolvedDiscussions.length
    ? [
        ...openDiscussions.map(renderOpenDiscussion),
        ...resolvedDiscussions.map(renderResolvedDiscussion)
      ].join("")
    : "<p>两人结论不一致时会自动进入这里。</p>";

  const makeupRows = state.makeup
    .map((entry) => ({ entry, session: findSession(entry.sessionId) }))
    .filter((row) => row.session);
  makeupList.innerHTML = makeupRows.length
    ? makeupRows.map(({ entry, session }) => {
        const sample = findSample(session.sampleId);
        return `
          <div class="makeup-item ${entry.cleared ? "cleared" : ""}">
            <strong>${sample ? sample.code : "已删样本"} · ${session.slot}</strong>
            <span class="badge ${entry.cleared ? "muted" : "warn"}">${entry.cleared ? "已补齐" : "待补交"}</span>
            <p>${session.members.join("、")}，缺：${entry.missing.join("、")}</p>
            <p>${fmtTime(entry.at)} 下课时记录${entry.cleared ? `，${fmtTime(entry.clearedAt)} 补齐` : ""}</p>
            <button type="button" data-makeup-drop="${entry.id}">移除</button>
          </div>`;
      }).join("")
    : "<p>下课时未交齐结论的小组会列在这里。</p>";
}

function render() {
  const rows = filteredSamples();
  sampleGrid.innerHTML = rows.length ? rows.map((sample) => {
    const session = sessionOfSample(sample.id);
    return `
    <article class="sample-card">
      ${sample.photo ? `<img src="${sample.photo}" alt="${sample.code}显微照片">` : "<div class=\"photo-placeholder\"></div>"}
      <div class="sample-body">
        <h3>${sample.code}</h3>
        <p>${sample.location || "未记录地点"} · ${sample.magnification || "未记录倍数"} · ${sample.polarization}</p>
        <p>矿物：${sample.minerals || "未记录"}</p>
        <p>结构：${sample.texture || "未记录"}</p>
        <p>${sample.comment || "未填写批注"}</p>
        <p class="card-slot">${session ? `${session.slot} · ${session.members.join("、")}` : "待安排"}</p>
        ${session && session.result ? `<p class="card-result">课堂结论：${session.result.text}（${session.result.source}）</p>` : ""}
        <div class="card-actions">
          <label><input type="checkbox" data-compare="${sample.id}" ${state.compare.includes(sample.id) ? "checked" : ""}>对比</label>
          <button type="button" data-edit="${sample.id}">编辑</button>
          <button type="button" data-delete="${sample.id}">删除</button>
        </div>
      </div>
    </article>`;
  }).join("") : "<p>还没有样本，先从左侧录入一张薄片照片。</p>";

  const compareSamples = state.compare
    .map((id) => state.samples.find((sample) => sample.id === id))
    .filter(Boolean)
    .slice(0, 2);

  comparePane.innerHTML = compareSamples.length ? compareSamples.map((sample) => `
    <article class="compare-item">
      ${sample.photo ? `<img src="${sample.photo}" alt="${sample.code}对比图">` : ""}
      <h3>${sample.code}</h3>
      <p>${sample.polarization} · ${sample.minerals || "未记录矿物"}</p>
      <p>${sample.texture || "未记录结构"}</p>
    </article>
  `).join("") : "<p>勾选两张样本卡片后可并排对比。</p>";

  renderRotation();
}

photoInput.addEventListener("change", async () => {
  pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  if (!pendingPhoto && photoInput.files[0]) {
    pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
  }
  if (editingId) {
    const sample = findSample(editingId);
    if (sample) {
      const changed = [];
      if (pendingPhoto !== sample.photo) changed.push("照片");
      if (data.get("magnification").trim() !== sample.magnification) changed.push("倍数");
      if (data.get("polarization") !== sample.polarization) changed.push("偏光");
      sample.photo = pendingPhoto;
      sample.code = data.get("code").trim();
      sample.location = data.get("location").trim();
      sample.magnification = data.get("magnification").trim();
      sample.polarization = data.get("polarization");
      sample.minerals = data.get("minerals").trim();
      sample.texture = data.get("texture").trim();
      sample.comment = data.get("comment").trim();
      if (changed.length) invalidateSessions(sample.id, changed);
    }
  } else {
    state.samples.unshift({
      id: crypto.randomUUID(),
      photo: pendingPhoto,
      code: data.get("code").trim(),
      location: data.get("location").trim(),
      magnification: data.get("magnification").trim(),
      polarization: data.get("polarization"),
      minerals: data.get("minerals").trim(),
      texture: data.get("texture").trim(),
      comment: data.get("comment").trim(),
      createdAt: new Date().toISOString()
    });
  }
  resetFormState();
  save();
  render();
});

cancelEditBtn.addEventListener("click", resetFormState);

sampleGrid.addEventListener("click", (event) => {
  const editId = event.target.dataset.edit;
  if (editId) {
    const sample = findSample(editId);
    if (sample) startEdit(sample);
  }

  const deleteId = event.target.dataset.delete;
  if (deleteId) {
    state.samples = state.samples.filter((sample) => sample.id !== deleteId);
    state.compare = state.compare.filter((id) => id !== deleteId);
    state.sessions = state.sessions.filter((session) => session.sampleId !== deleteId);
    const sessionIds = new Set(state.sessions.map((session) => session.id));
    state.makeup = state.makeup.filter((entry) => sessionIds.has(entry.sessionId));
    if (editingId === deleteId) resetFormState();
    save();
    render();
  }
});

sampleGrid.addEventListener("change", (event) => {
  const id = event.target.dataset.compare;
  if (!id) return;
  if (event.target.checked) {
    state.compare = [id, ...state.compare.filter((item) => item !== id)].slice(0, 2);
  } else {
    state.compare = state.compare.filter((item) => item !== id);
  }
  save();
  render();
});

[mineralFilter, polarFilter].forEach((field) => field.addEventListener("input", render));

scheduleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const sampleId = scheduleSample.value;
  const slot = scheduleSlot.value;
  const first = memberA.value.trim();
  const second = memberB.value.trim();
  const sample = findSample(sampleId);

  let error = "";
  if (!sample) {
    error = "已退回：请选择待安排样本。";
  } else if (!first || !second) {
    error = "已退回：一片配两人，请填写两位同学姓名。";
  } else if (first === second) {
    error = `已退回：${first} 不能同时占一个组的两个位置。`;
  } else {
    const slotTaken = state.sessions.find((session) => session.slot === slot);
    if (slotTaken) {
      const conflictSample = findSample(slotTaken.sampleId);
      error = `已退回：${slot}已有样本「${conflictSample ? conflictSample.code : "?"}」（${slotTaken.members.join("、")}），一节课只进一组。`;
    } else if (sessionOfSample(sampleId)) {
      const existing = sessionOfSample(sampleId);
      error = `已退回：样本「${sample.code}」已排在${existing.slot}（${existing.members.join("、")}），一片只配两人，冲突样本：${sample.code}。`;
    }
  }

  if (error) {
    scheduleError.textContent = error;
    scheduleError.hidden = false;
    return;
  }
  scheduleError.hidden = true;

  state.sessions.push({
    id: crypto.randomUUID(),
    slot,
    sampleId,
    members: [first, second],
    conclusions: [blankConclusion(), blankConclusion()],
    result: null,
    discussion: null,
    ended: false,
    notice: "",
    createdAt: new Date().toISOString()
  });
  scheduleForm.reset();
  save();
  render();
});

sessionList.addEventListener("click", (event) => {
  const saveDraftKey = event.target.dataset.saveDraft;
  const submitKey = event.target.dataset.submitConclusion;
  const dismissId = event.target.dataset.dismiss;
  const unscheduleId = event.target.dataset.unschedule;
  if (!saveDraftKey && !submitKey && !dismissId && !unscheduleId) return;

  captureOpenDrafts();
  if (saveDraftKey) {
    const session = findSession(saveDraftKey.split(":")[0]);
    if (session) session.notice = "草稿已单独保存。";
  }
  if (submitKey) {
    const [sessionId, index] = submitKey.split(":");
    submitConclusion(sessionId, Number(index));
  }
  if (dismissId) {
    dismissSession(dismissId);
  }
  if (unscheduleId) {
    state.sessions = state.sessions.filter((session) => session.id !== unscheduleId);
    state.makeup = state.makeup.filter((entry) => entry.sessionId !== unscheduleId);
  }
  save();
  render();
});

sessionList.addEventListener("change", (event) => {
  const sessionId = event.target.dataset.identity;
  if (!sessionId) return;
  captureOpenDrafts();
  identityBySession[sessionId] = event.target.value;
  save();
  render();
});

discussionList.addEventListener("click", (event) => {
  const pickKey = event.target.dataset.pick;
  const rewriteId = event.target.dataset.rewriteSubmit;
  if (!pickKey && !rewriteId) return;

  if (pickKey) {
    const [sessionId, index] = pickKey.split(":");
    resolveDiscussion(sessionId, Number(index), "");
  }
  if (rewriteId) {
    const textarea = discussionList.querySelector(`textarea[data-rewrite="${rewriteId}"]`);
    resolveDiscussion(rewriteId, -1, textarea ? textarea.value : "");
  }
  save();
  render();
});

makeupList.addEventListener("click", (event) => {
  const dropId = event.target.dataset.makeupDrop;
  if (!dropId) return;
  state.makeup = state.makeup.filter((entry) => entry.id !== dropId);
  save();
  render();
});

document.querySelector("#exportBtn").addEventListener("click", () => {
  const checklist = state.samples.map((sample) => {
    const session = sessionOfSample(sample.id);
    return {
      样本编号: sample.code,
      采样地点: sample.location,
      放大倍数: sample.magnification,
      偏光类型: sample.polarization,
      主要矿物: sample.minerals,
      颗粒结构: sample.texture,
      老师批注: sample.comment,
      课堂结论: session && session.result ? session.result.text : "",
      结论来源: session && session.result ? session.result.source : ""
    };
  });
  const blob = new Blob([JSON.stringify(checklist, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "thin-section-checklist.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

render();
