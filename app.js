const storageKey = "wxyy-2-thin-section-index";

const persisted = JSON.parse(localStorage.getItem(storageKey) || "null");
const state = Object.assign(
  {
    samples: [],
    compare: [],
    lessons: [],
    assignments: [],
    currentLessonId: null,
    role: "student",
    studentName: "",
    activeTab: "index"
  },
  persisted || {}
);

/* ---------------- 基础工具 ---------------- */

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeConclusion(text) {
  return String(text || "").replace(/\s+/g, "").trim();
}

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.readAsDataURL(file);
  });
}

/* ---------------- 索引台：DOM ---------------- */

const form = document.querySelector("#sampleForm");
const photoInput = document.querySelector("#photoInput");
const photoHint = document.querySelector("#photoHint");
const saveSampleBtn = document.querySelector("#saveSampleBtn");
const cancelEditBtn = document.querySelector("#cancelEditBtn");
const sampleMsg = document.querySelector("#sampleMsg");
const sampleGrid = document.querySelector("#sampleGrid");
const comparePane = document.querySelector("#comparePane");
const mineralFilter = document.querySelector("#mineralFilter");
const polarFilter = document.querySelector("#polarFilter");

let pendingPhoto = "";
let editingSampleId = null;

/* ---------------- 轮转：DOM ---------------- */

const tabButtons = document.querySelectorAll(".tab-btn");
const roleButtons = document.querySelectorAll(".role-btn");
const studentNameInput = document.querySelector("#studentName");
const lessonSelect = document.querySelector("#lessonSelect");
const newLessonInput = document.querySelector("#newLessonInput");
const addLessonBtn = document.querySelector("#addLessonBtn");
const closeLessonBtn = document.querySelector("#closeLessonBtn");
const reopenLessonBtn = document.querySelector("#reopenLessonBtn");
const lessonStatus = document.querySelector("#lessonStatus");
const assignForm = document.querySelector("#assignForm");
const assignSample = document.querySelector("#assignSample");
const assignA = document.querySelector("#assignA");
const assignB = document.querySelector("#assignB");
const assignMsg = document.querySelector("#assignMsg");
const queueChips = document.querySelector("#queueChips");
const makeupPanel = document.querySelector("#makeupPanel");
const assignmentList = document.querySelector("#assignmentList");
const discussionQueue = document.querySelector("#discussionQueue");

function currentLesson() {
  return state.lessons.find((lesson) => lesson.id === state.currentLessonId) || null;
}

function sampleById(id) {
  return state.samples.find((sample) => sample.id === id);
}

function assignmentsOfLesson(lessonId) {
  return state.assignments
    .filter((assignment) => assignment.lessonId === lessonId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function setFormMsg(el, text, type) {
  el.textContent = text;
  el.className = `form-msg${type ? ` msg-${type}` : ""}`;
}

/* ---------------- 轮转：状态机 ----------------
   draft   已保存草稿、未提交
   waiting 已提交、等对方
   fresh   双方都提交且结论一致，自动出结果
   disputed 双方都提交但不一致，等老师仲裁
   resolved 老师已在讨论队列处理（采用甲/乙/改写）
   invalid  样本照片、倍数或偏光被修改，已交稿作废 */

function refreshStatus(assignment) {
  const { slots } = assignment;
  const validSlots = ["A", "B"].filter((slot) => slots[slot].submitted && !slots[slot].invalid);

  if (validSlots.length === 0) {
    assignment.status = "draft";
    return;
  }
  if (validSlots.length === 1) {
    assignment.status = "waiting";
    return;
  }

  if (assignment.status === "resolved") return;

  const same = normalizeConclusion(slots.A.conclusion) === normalizeConclusion(slots.B.conclusion);
  if (same) {
    assignment.status = "fresh";
    assignment.result = slots.A.conclusion;
    assignment.resultSource = "两人一致";
  } else {
    assignment.status = "disputed";
  }
}

/* 改照片、倍数或偏光：本组已交稿全部作废，原稿归档保留 */
function invalidateAssignmentsForSample(sampleId) {
  let affected = 0;
  state.assignments.forEach((assignment) => {
    if (assignment.sampleId !== sampleId) return;
    const archivedNow = [];
    ["A", "B"].forEach((slot) => {
      const entry = assignment.slots[slot];
      if ((entry.submitted || entry.draft) && !entry.invalid) {
        archivedNow.push({
          slot,
          student: entry.student,
          conclusion: entry.submitted ? entry.conclusion : entry.draft,
          wasSubmitted: Boolean(entry.submitted),
          invalidatedAt: new Date().toISOString()
        });
        entry.invalid = true;
        if (entry.submitted) {
          entry.submitted = false;
          entry.draft = entry.conclusion;
          entry.conclusion = "";
        }
      }
    });
    if (archivedNow.length) {
      affected += 1;
      assignment.archives.push({
        reason: "样本照片/放大倍数/偏光类型被修改，已交稿作废",
        at: new Date().toISOString(),
        slots: archivedNow
      });
      assignment.status = "invalid";
    }
  });
  return affected;
}

function slotLabel(assignment, slot) {
  return slot === "A" ? `甲 · ${assignment.slots.A.student}` : `乙 · ${assignment.slots.B.student}`;
}

function makeupReason(assignment) {
  if (assignment.status === "disputed") return "两人结论不一致，待老师仲裁";
  if (assignment.status === "invalid") return "样本被修改，已交稿作废，需重做";
  const missing = [];
  ["A", "B"].forEach((slot) => {
    const entry = assignment.slots[slot];
    if (!entry.submitted || entry.invalid) missing.push(slotLabel(assignment, slot));
  });
  if (missing.length === 2) return "两人均未提交结论";
  if (missing.length === 1) return `缺结论：${missing[0]}`;
  return "";
}

/* 已出有效结果的小组不用补交，其余（未提交、缺结论、待仲裁、已作废）都留下 */
function lessonMakeupList(lessonId) {
  return assignmentsOfLesson(lessonId).filter((assignment) => {
    const hasResult =
      (assignment.status === "fresh" || assignment.status === "resolved") &&
      ["A", "B"].every((slot) => {
        const entry = assignment.slots[slot];
        return entry.submitted && !entry.invalid;
      });
    return !hasResult;
  });
}

/* ---------------- 索引台：渲染 ---------------- */

function filteredSamples() {
  const mineral = mineralFilter.value.trim();
  const polarization = polarFilter.value;
  return state.samples.filter((sample) => {
    const mineralMatch = !mineral || sample.minerals.includes(mineral);
    const polarMatch = !polarization || sample.polarization === polarization;
    return mineralMatch && polarMatch;
  });
}

function renderSampleGrid() {
  const rows = filteredSamples();
  sampleGrid.innerHTML = rows.length ? rows.map((sample) => `
    <article class="sample-card">
      ${sample.photo ? `<img src="${sample.photo}" alt="${esc(sample.code)}显微照片">` : "<div class=\"photo-placeholder\"></div>"}
      <div class="sample-body">
        <h3>${esc(sample.code)}</h3>
        <p>${esc(sample.location) || "未记录地点"} · ${esc(sample.magnification) || "未记录倍数"} · ${esc(sample.polarization)}</p>
        <p>矿物：${esc(sample.minerals) || "未记录"}</p>
        <p>结构：${esc(sample.texture) || "未记录"}</p>
        <p>${esc(sample.comment) || "未填写批注"}</p>
        <div class="card-actions">
          <label><input type="checkbox" data-compare="${sample.id}" ${state.compare.includes(sample.id) ? "checked" : ""}>对比</label>
          <span class="action-links">
            <button type="button" class="link-btn" data-edit="${sample.id}">编辑</button>
            <button type="button" class="link-btn danger" data-delete="${sample.id}">删除</button>
          </span>
        </div>
      </div>
    </article>
  `).join("") : "<p>还没有样本，先从左侧录入一张薄片照片。</p>";

  const compareSamples = state.compare
    .map((id) => state.samples.find((sample) => sample.id === id))
    .filter(Boolean)
    .slice(0, 2);

  comparePane.innerHTML = compareSamples.length ? compareSamples.map((sample) => `
    <article class="compare-item">
      ${sample.photo ? `<img src="${sample.photo}" alt="${esc(sample.code)}对比图">` : ""}
      <h3>${esc(sample.code)}</h3>
      <p>${esc(sample.polarization)} · ${esc(sample.minerals) || "未记录矿物"}</p>
      <p>${esc(sample.texture) || "未记录结构"}</p>
    </article>
  `).join("") : "<p>勾选两张样本卡片后可并排对比。</p>";
}

function resetSampleForm() {
  editingSampleId = null;
  pendingPhoto = "";
  photoInput.value = "";
  photoHint.textContent = "";
  saveSampleBtn.textContent = "保存样本";
  cancelEditBtn.hidden = true;
  form.reset();
  setFormMsg(sampleMsg, "");
}

/* ---------------- 轮转：渲染 ---------------- */

function renderRoleAndTabs() {
  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === state.activeTab);
  });
  document.querySelector("#tab-index").hidden = state.activeTab !== "index";
  document.querySelector("#tab-rotation").hidden = state.activeTab !== "rotation";

  roleButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.role === state.role));
  studentNameInput.classList.toggle("hidden", state.role !== "student");
  studentNameInput.value = state.studentName;
}

function renderLessonBar() {
  lessonSelect.innerHTML = state.lessons.length
    ? state.lessons.map((lesson) => `<option value="${lesson.id}"${lesson.id === state.currentLessonId ? " selected" : ""}>${esc(lesson.name)}</option>`).join("")
    : '<option value="">（尚未开课）</option>';

  const lesson = currentLesson();
  const closed = lesson?.closed;
  lessonStatus.textContent = !lesson ? "" : closed ? `已下课（${lesson.closedAt}）` : "进行中";
  lessonStatus.className = `lesson-status${closed ? " is-closed" : " is-open"}`;
  closeLessonBtn.hidden = !lesson || closed;
  reopenLessonBtn.hidden = !lesson || !closed;
  assignForm.classList.toggle("disabled", !lesson || closed);
  closeLessonBtn.disabled = !lesson || closed;
}

function renderQueueChips() {
  const lesson = currentLesson();
  const used = new Set(lesson ? assignmentsOfLesson(lesson.id).map((a) => a.sampleId) : []);
  const queued = state.samples.filter((sample) => !used.has(sample.id));
  queueChips.innerHTML = queued.length
    ? queued.map((sample) => `<span class="chip" title="${esc(sample.code)}">${esc(sample.code)}</span>`).join("")
    : (state.samples.length ? "<p class=\"hint-text\">本节课样本已全部安排，剩余样本在其他课节可继续排。</p>" : "<p class=\"hint-text\">还没有样本，先在索引台录入。</p>");

  assignSample.innerHTML = state.samples.length
    ? state.samples.map((sample) => {
        const conflict = used.has(sample.id) ? "（本节课已安排）" : "";
        return `<option value="${sample.id}">${esc(sample.code)}${conflict}</option>`;
      }).join("")
    : '<option value="">（先录入样本）</option>';
}

const STATUS_META = {
  draft: { text: "待提交", cls: "st-draft" },
  waiting: { text: "已提交 · 等对方", cls: "st-waiting" },
  fresh: { text: "两人一致 · 已出结果", cls: "st-fresh" },
  disputed: { text: "结论不一致 · 讨论队列", cls: "st-disputed" },
  resolved: { text: "老师已处理", cls: "st-resolved" },
  invalid: { text: "已作废 · 需重做", cls: "st-invalid" }
};

function renderSlot(assignment, slot) {
  const entry = assignment.slots[slot];
  const name = slot === "A" ? assignment.slots.A.student : assignment.slots.B.student;
  const me = state.role === "student" && state.studentName.trim() && state.studentName.trim() === name;
  const isTeacher = state.role === "teacher";
  const resultOut = assignment.status === "fresh" || assignment.status === "resolved";
  const invalidBadge = entry.invalid ? '<span class="badge badge-invalid">已作废</span>' : "";

  let body = "";
  if (entry.submitted) {
    if (isTeacher || me || resultOut) {
      // 老师可见；本人可见；结果出来后双方稿件才互相公开
      body = `
        <div class="conclusion-view">${esc(entry.conclusion)}</div>
        <p class="meta-line">${entry.submittedAt ? `提交于 ${entry.submittedAt}` : ""}${entry.late ? " · 下课补交" : ""}</p>`;
    } else {
      // 另一名同学：提交后到出结果前，彼此看不到稿子
      body = '<p class="sealed">🔒 该同学已提交，结果公布前互相看不到稿件。</p>';
    }
  } else if (isTeacher) {
    body = '<p class="sealed">尚未提交。（老师不代笔，结论由学生本人提交）</p>';
  } else if (!me) {
    body = '<p class="sealed">🔒 尚未提交，稿件互相不可见。</p>';
  } else if (!state.studentName.trim()) {
    body = '<p class="sealed">请先在右上角填写学生姓名。</p>';
  } else {
    body = `
      <textarea data-draft="${assignment.id}" data-slot="${slot}" rows="4"
        placeholder="填写你的鉴定结论，保存草稿或直接提交；提交前对方完全看不到">${esc(entry.draft || "")}</textarea>
      <div class="slot-actions">
        <button type="button" class="btn-secondary btn-small" data-save-draft="${assignment.id}" data-slot="${slot}">保存草稿</button>
        <button type="button" class="btn-small" data-submit="${assignment.id}" data-slot="${slot}">提交结论</button>
      </div>`;
  }

  return `
    <div class="slot ${entry.submitted ? "is-submitted" : ""}">
      <h4>${slot === "A" ? "同学甲" : "同学乙"} · ${esc(name)} ${invalidBadge}</h4>
      ${body}
    </div>`;
}

function renderArchives(assignment) {
  if (!assignment.archives.length) return "";
  const blocks = assignment.archives.map((archive, index) => `
    <details class="archive">
      <summary>归档原稿 ${index + 1}：${esc(archive.reason)}（${new Date(archive.at).toLocaleString("zh-CN", { hour12: false })}）</summary>
      ${archive.slots.map((item) => `
        <div class="archive-entry">
          <strong>${item.slot === "A" ? "甲" : "乙"} · ${esc(item.student)}（${item.wasSubmitted ? "已提交稿" : "草稿"}）</strong>
          <p>${esc(item.conclusion) || "（空）"}</p>
        </div>`).join("")}
    </details>`).join("");
  return `<div class="archives">${blocks}</div>`;
}

function renderResult(assignment) {
  if (assignment.status === "fresh") {
    return `<div class="result-box result-fresh"><strong>结果（两人一致）：</strong>${esc(assignment.result)}</div>`;
  }
  if (assignment.status === "resolved") {
    return `
      <div class="result-box result-resolved">
        <strong>结果（老师${esc(assignment.resultSource)}）：</strong>${esc(assignment.result)}
      </div>`;
  }
  if (assignment.status === "disputed") {
    return '<div class="result-box result-disputed">两份结论不一致，已进入讨论队列，等待老师处理。</div>';
  }
  if (assignment.status === "invalid") {
    return '<div class="result-box result-invalid">样本照片、倍数或偏光被修改，本组已交稿作废，请重新观察并补交。</div>';
  }
  return "";
}

function renderAssignmentCard(assignment) {
  const sample = sampleById(assignment.sampleId);
  const meta = STATUS_META[assignment.status] || STATUS_META.draft;
  return `
    <article class="assignment-card ${meta.cls}">
      <header class="assignment-head">
        <div>
          <h3>${sample ? esc(sample.code) : "（样本已删除）"}</h3>
          <p class="meta-line">${sample ? `${esc(sample.polarization)} · ${esc(sample.magnification) || "未记录倍数"}` : ""} · 安排于 ${new Date(assignment.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
        </div>
        <span class="status-tag ${meta.cls}">${meta.text}</span>
      </header>
      <div class="slots-grid">
        ${renderSlot(assignment, "A")}
        ${renderSlot(assignment, "B")}
      </div>
      ${renderResult(assignment)}
      ${renderArchives(assignment)}
    </article>`;
}

function renderAssignments() {
  const lesson = currentLesson();
  if (!lesson) {
    assignmentList.innerHTML = "<p class=\"hint-text\">请先选择或开设一个课节。</p>";
    return;
  }
  const list = assignmentsOfLesson(lesson.id);
  assignmentList.innerHTML = list.length
    ? `<h3 class="section-title">本节课轮转安排（${list.length} 组）</h3><div class="cards">${list.map(renderAssignmentCard).join("")}</div>`
    : "<p class=\"hint-text\">本节课还没有安排，在上方把样本分给两人一组。</p>";
}

function renderDiscussionQueue() {
  const disputes = state.assignments.filter((a) => a.status === "disputed");
  if (state.role !== "teacher") {
    discussionQueue.innerHTML = disputes.length
      ? `<section class="panel discussion-panel"><h3>讨论队列（仅老师可见稿件）</h3><p class="hint-text">有 ${disputes.length} 组结论不一致，等待老师处理。</p></section>`
      : "";
    return;
  }
  if (!disputes.length) {
    discussionQueue.innerHTML = "";
    return;
  }
  discussionQueue.innerHTML = `
    <section class="panel discussion-panel">
      <h3>讨论队列（${disputes.length} 组结论不一致）</h3>
      <p class="hint-text">两份原稿均保留；老师可采用其中一份，或改写为最终结论。</p>
      <div class="discussion-list">
        ${disputes.map((a) => {
          const sample = sampleById(a.sampleId);
          const lesson = state.lessons.find((l) => l.id === a.lessonId);
          return `
            <article class="discussion-item" data-dispute="${a.id}">
              <header><strong>${sample ? esc(sample.code) : "（样本已删除）"}</strong><span class="meta-line">${esc(lesson?.name || "未知课节")} · 甲 ${esc(a.slots.A.student)} / 乙 ${esc(a.slots.B.student)}</span></header>
              <div class="discussion-slots">
                <div class="slot"><h4>甲稿 · ${esc(a.slots.A.student)}</h4><div class="conclusion-view">${esc(a.slots.A.conclusion)}</div></div>
                <div class="slot"><h4>乙稿 · ${esc(a.slots.B.student)}</h4><div class="conclusion-view">${esc(a.slots.B.conclusion)}</div></div>
              </div>
              <label>最终结论（可改写）
                <textarea data-resolve-text="${a.id}" rows="3">${esc(a.slots.A.conclusion)}</textarea>
              </label>
              <div class="slot-actions">
                <button type="button" class="btn-small" data-resolve="${a.id}" data-choice="A">采用甲稿</button>
                <button type="button" class="btn-small" data-resolve="${a.id}" data-choice="B">采用乙稿</button>
                <button type="button" class="btn-small btn-amber" data-resolve="${a.id}" data-choice="rewrite">按改写定稿</button>
              </div>
            </article>`;
        }).join("")}
      </div>
    </section>`;
}

function renderMakeup() {
  const lesson = currentLesson();
  if (!lesson || !lesson.closed) {
    makeupPanel.hidden = true;
    makeupPanel.innerHTML = "";
    return;
  }
  const list = lessonMakeupList(lesson.id);
  makeupPanel.hidden = false;
  makeupPanel.innerHTML = `
    <div class="makeup-head">
      <h3>补交清单 · ${esc(lesson.name)}（${lesson.closedAt} 截止）</h3>
      <div>
        <button type="button" class="btn-secondary btn-small" id="exportMakeupBtn">导出补交清单</button>
        <button type="button" class="btn-secondary btn-small" id="copyMakeupBtn">复制清单文本</button>
      </div>
    </div>
    ${list.length ? `
      <table class="makeup-table">
        <thead><tr><th>样本</th><th>同学甲</th><th>同学乙</th><th>补交原因</th></tr></thead>
        <tbody>
          ${list.map((a) => {
            const sample = sampleById(a.sampleId);
            return `<tr>
              <td>${sample ? esc(sample.code) : "（已删除）"}</td>
              <td>${esc(a.slots.A.student)}${a.slots.A.submitted && !a.slots.A.invalid ? ' <span class="ok">已交</span>' : ' <span class="miss">缺</span>'}</td>
              <td>${esc(a.slots.B.student)}${a.slots.B.submitted && !a.slots.B.invalid ? ' <span class="ok">已交</span>' : ' <span class="miss">缺</span>'}</td>
              <td>${esc(makeupReason(a))}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
      <p class="hint-text">下课后补交仍可在上方卡片提交；两人补齐且一致后自动核销，经老师处理的也会移出清单。</p>`
      : '<p class="ok-block">所有小组均已提交并出结果，无需补交。</p>'}
  `;
}

function makeupExportData() {
  const lesson = currentLesson();
  return lessonMakeupList(lesson.id).map((a) => {
    const sample = sampleById(a.sampleId);
    return {
      课节: lesson.name,
      样本编号: sample ? sample.code : "（已删除）",
      同学甲: a.slots.A.student,
      同学乙: a.slots.B.student,
      补交原因: makeupReason(a)
    };
  });
}

function renderRotation() {
  renderLessonBar();
  renderQueueChips();
  renderAssignments();
  renderDiscussionQueue();
  renderMakeup();
}

function renderAll() {
  renderRoleAndTabs();
  renderSampleGrid();
  renderRotation();
}

/* ---------------- 索引台：交互 ---------------- */

photoInput.addEventListener("change", async () => {
  pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
  if (editingSampleId && photoInput.files[0]) {
    photoHint.textContent = "已选择新照片：保存后本组学生已交稿将作废。";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const code = data.get("code").trim();
  const fields = {
    code,
    location: data.get("location").trim(),
    magnification: data.get("magnification").trim(),
    polarization: data.get("polarization"),
    minerals: data.get("minerals").trim(),
    texture: data.get("texture").trim(),
    comment: data.get("comment").trim()
  };

  if (!pendingPhoto && photoInput.files[0]) {
    pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
  }

  if (editingSampleId) {
    const sample = sampleById(editingSampleId);
    const newPhoto = pendingPhoto || sample.photo || "";
    const criticalChanged =
      newPhoto !== (sample.photo || "") ||
      fields.magnification !== sample.magnification ||
      fields.polarization !== sample.polarization;

    Object.assign(sample, fields, { photo: newPhoto });

    if (criticalChanged) {
      const affected = invalidateAssignmentsForSample(sample.id);
      setFormMsg(
        sampleMsg,
        `已保存。照片/倍数/偏光发生变更，${affected} 个轮转小组的已交稿已作废，原稿已归档。`,
        "warn"
      );
    } else {
      setFormMsg(sampleMsg, "样本信息已更新，未触及照片、倍数、偏光，已交稿不受影响。", "ok");
    }
    resetSampleForm();
    save();
    renderAll();
    return;
  }

  state.samples.unshift({
    id: crypto.randomUUID(),
    photo: pendingPhoto,
    ...fields,
    createdAt: new Date().toISOString()
  });
  resetSampleForm();
  setFormMsg(sampleMsg, "样本已入库，已进入课堂轮转待安排池。", "ok");
  save();
  renderAll();
});

cancelEditBtn.addEventListener("click", () => {
  resetSampleForm();
});

sampleGrid.addEventListener("click", (event) => {
  const deleteId = event.target.dataset.delete;
  const editId = event.target.dataset.edit;

  if (editId) {
    const sample = sampleById(editId);
    if (!sample) return;
    editingSampleId = editId;
    form.code.value = sample.code;
    form.location.value = sample.location;
    form.magnification.value = sample.magnification;
    form.polarization.value = sample.polarization;
    form.minerals.value = sample.minerals;
    form.texture.value = sample.texture;
    form.comment.value = sample.comment;
    pendingPhoto = sample.photo || "";
    photoHint.textContent = sample.photo
      ? "原有照片保留。换照片会作废相关小组已交稿；改倍数或偏光同样作废。"
      : "";
    saveSampleBtn.textContent = "保存修改";
    cancelEditBtn.hidden = false;
    setFormMsg(sampleMsg, `正在编辑 ${sample.code}。`, "");
    document.querySelector("#tab-index").scrollIntoView({ behavior: "smooth" });
    return;
  }

  if (deleteId) {
    const code = sampleById(deleteId)?.code || "该样本";
    if (!window.confirm(`确定删除 ${code}？相关轮转安排也会一并删除。`)) return;
    state.samples = state.samples.filter((sample) => sample.id !== deleteId);
    state.compare = state.compare.filter((id) => id !== deleteId);
    state.assignments = state.assignments.filter((a) => a.sampleId !== deleteId);
    save();
    renderAll();
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
  renderSampleGrid();
});

[mineralFilter, polarFilter].forEach((field) => field.addEventListener("input", renderSampleGrid));

document.querySelector("#exportBtn").addEventListener("click", () => {
  const checklist = state.samples.map((sample) => ({
    样本编号: sample.code,
    采样地点: sample.location,
    放大倍数: sample.magnification,
    偏光类型: sample.polarization,
    主要矿物: sample.minerals,
    颗粒结构: sample.texture,
    老师批注: sample.comment
  }));
  const blob = new Blob([JSON.stringify(checklist, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "thin-section-checklist.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

/* ---------------- 轮转：交互 ---------------- */

tabButtons.forEach((btn) => btn.addEventListener("click", () => {
  state.activeTab = btn.dataset.tab;
  save();
  renderRoleAndTabs();
  if (state.activeTab === "index") renderSampleGrid();
  else renderRotation();
}));

roleButtons.forEach((btn) => btn.addEventListener("click", () => {
  state.role = btn.dataset.role;
  save();
  renderRoleAndTabs();
  renderRotation();
}));

studentNameInput.addEventListener("input", () => {
  state.studentName = studentNameInput.value.trim();
  save();
  renderRotation();
});

addLessonBtn.addEventListener("click", () => {
  const name = newLessonInput.value.trim();
  if (!name) {
    window.alert("请填写课节名称，例如：9月23日 第3节");
    return;
  }
  if (state.lessons.some((lesson) => lesson.name === name)) {
    window.alert("已存在同名课节。");
    return;
  }
  const lesson = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    closed: false,
    closedAt: ""
  };
  state.lessons.push(lesson);
  state.currentLessonId = lesson.id;
  newLessonInput.value = "";
  save();
  renderRotation();
});

lessonSelect.addEventListener("change", () => {
  state.currentLessonId = lessonSelect.value || null;
  save();
  renderRotation();
});

assignForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const lesson = currentLesson();
  if (!lesson) {
    setFormMsg(assignMsg, "请先选择或开设课节。", "err");
    return;
  }
  if (lesson.closed) {
    setFormMsg(assignMsg, "本节课已下课，不能再安排新组；可在上方“重新开课”后补充安排。", "err");
    return;
  }
  const sampleId = assignSample.value;
  const nameA = assignA.value.trim();
  const nameB = assignB.value.trim();
  const sample = sampleById(sampleId);

  if (!sample) {
    setFormMsg(assignMsg, "请先在索引台录入样本再安排。", "err");
    return;
  }
  if (!nameA || !nameB) {
    setFormMsg(assignMsg, "一片配两人，请填写两位同学姓名。", "err");
    return;
  }
  if (nameA === nameB) {
    setFormMsg(assignMsg, "同一位同学不能占两个名额，请填写两位不同的同学。", "err");
    return;
  }

  const existing = assignmentsOfLesson(lesson.id);

  // 规则：一节课一片只进一组
  const sameSample = existing.find((a) => a.sampleId === sampleId);
  if (sameSample) {
    setFormMsg(
      assignMsg,
      `安排被退回：样本 ${sample.code} 本节课已分给「${sameSample.slots.A.student}、${sameSample.slots.B.student}」，一片一节课只进一组。`,
      "err"
    );
    return;
  }

  // 规则：一节课一位同学只进一组 —— 指出冲突样本
  const conflicts = [];
  [nameA, nameB].forEach((name) => {
    const clash = existing.find((a) => a.slots.A.student === name || a.slots.B.student === name);
    if (clash) conflicts.push({ name, assignment: clash });
  });
  if (conflicts.length) {
    const detail = conflicts
      .map((c) => `${c.name} 已排在样本 ${sampleById(c.assignment.sampleId)?.code || "（已删除）"}`)
      .join("；");
    setFormMsg(assignMsg, `安排被退回：${detail}。一节课一位同学只进一组。`, "err");
    return;
  }

  state.assignments.push({
    id: crypto.randomUUID(),
    lessonId: lesson.id,
    sampleId,
    slots: {
      A: { student: nameA, draft: "", conclusion: "", submitted: false, invalid: false, submittedAt: "", late: false },
      B: { student: nameB, draft: "", conclusion: "", submitted: false, invalid: false, submittedAt: "", late: false }
    },
    status: "draft",
    result: "",
    resultSource: "",
    archives: [],
    createdAt: new Date().toISOString()
  });
  assignA.value = "";
  assignB.value = "";
  setFormMsg(assignMsg, `已安排：${sample.code} → ${nameA}、${nameB}。`, "ok");
  save();
  renderRotation();
});

assignmentList.addEventListener("click", (event) => {
  const submitId = event.target.dataset.submit;
  const draftId = event.target.dataset.saveDraft;

  if (draftId) {
    const assignment = state.assignments.find((a) => a.id === draftId);
    const slot = event.target.dataset.slot;
    const area = assignmentList.querySelector(`textarea[data-draft="${draftId}"][data-slot="${slot}"]`);
    assignment.slots[slot].draft = area.value.trim();
    save();
    renderAssignments();
    setFormMsg(assignMsg, `${slotLabel(assignment, slot)} 的草稿已暂存，对方看不到。`, "ok");
    return;
  }

  if (submitId) {
    const assignment = state.assignments.find((a) => a.id === submitId);
    const slot = event.target.dataset.slot;
    const area = assignmentList.querySelector(`textarea[data-draft="${submitId}"][data-slot="${slot}"]`);
    const text = area.value.trim();
    if (!text) {
      window.alert("结论为空，不能提交。");
      return;
    }
    const entry = assignment.slots[slot];
    entry.conclusion = text;
    entry.draft = "";
    entry.submitted = true;
    entry.invalid = false;
    entry.submittedAt = nowText();
    entry.late = Boolean(currentLesson()?.closed);
    refreshStatus(assignment);
    save();
    renderRotation();
  }
});

closeLessonBtn.addEventListener("click", () => {
  const lesson = currentLesson();
  if (!lesson || lesson.closed) return;
  lesson.closed = true;
  lesson.closedAt = nowText();
  save();
  renderRotation();
  const remaining = lessonMakeupList(lesson.id).length;
  window.alert(remaining
    ? `已下课，共 ${remaining} 个小组需要补交（未提交、缺结论、待仲裁或已作废），清单见下方。`
    : "已下课，所有小组都已出结果，无补交项。");
});

reopenLessonBtn.addEventListener("click", () => {
  const lesson = currentLesson();
  if (!lesson) return;
  lesson.closed = false;
  lesson.closedAt = "";
  save();
  renderRotation();
});

makeupPanel.addEventListener("click", (event) => {
  if (event.target.id === "exportMakeupBtn") {
    const blob = new Blob([JSON.stringify(makeupExportData(), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `makeup-${currentLesson().name}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  if (event.target.id === "copyMakeupBtn") {
    const lines = makeupExportData().map((row) =>
      `${row.样本编号}\t${row.同学甲}\t${row.同学乙}\t${row.补交原因}`);
    const text = `样本\t甲\t乙\t原因\n${lines.join("\n")}`;
    const done = () => window.alert("补交清单已复制。");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => window.prompt("复制失败，请手动复制：", text));
    } else {
      window.prompt("请手动复制：", text);
    }
  }
});

discussionQueue.addEventListener("click", (event) => {
  const resolveId = event.target.dataset.resolve;
  if (!resolveId) return;
  const assignment = state.assignments.find((a) => a.id === resolveId);
  const choice = event.target.dataset.choice;
  const textarea = discussionQueue.querySelector(`textarea[data-resolve-text="${resolveId}"]`);
  const rewritten = textarea.value.trim();

  let result;
  let source;
  if (choice === "A") {
    result = assignment.slots.A.conclusion;
    source = "采用甲稿";
  } else if (choice === "B") {
    result = assignment.slots.B.conclusion;
    source = "采用乙稿";
  } else {
    if (!rewritten) {
      window.alert("改写结论为空，不能定稿。");
      return;
    }
    result = rewritten;
    source = "改写定稿";
  }

  assignment.archives.push({
    reason: `结论不一致，老师${source}，原稿保留`,
    at: new Date().toISOString(),
    slots: [
      { slot: "A", student: assignment.slots.A.student, conclusion: assignment.slots.A.conclusion, wasSubmitted: true },
      { slot: "B", student: assignment.slots.B.student, conclusion: assignment.slots.B.conclusion, wasSubmitted: true }
    ]
  });
  assignment.status = "resolved";
  assignment.result = result;
  assignment.resultSource = source;
  save();
  renderRotation();
});

/* ---------------- 启动 ---------------- */

renderAll();
