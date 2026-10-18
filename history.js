const historyList = document.getElementById("history-list");
const emptyState = document.getElementById("empty-state");
const clearBtn = document.getElementById("clear-history");
const searchBox = document.getElementById("search");
const dateFilter = document.getElementById("date-filter");
const clearDateBtn = document.getElementById("clear-date");
const filterButtons = document.querySelectorAll("#filters .filter");
const groupButtons = document.querySelectorAll("#group-by .filter");

const LOG_KEY = "wagulist-log";     // every task ever made (script22.js saves it)
const TASKS_KEY = "wagulist-tasks"; // the tasks currently on the main page

// streak.js normally provides these; fallbacks so the page still works without it
if (typeof dayKey !== "function"){
  window.dayKey = (date) => date.toLocaleDateString("en-CA");
}

let currentFilter = "all";   // all / pending / done / deleted
let groupBy = "added";       // "added" = by the day you made it, "done" = by the day you finished it

function load(key){
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch (e) { return []; }
}

function save(key, value){
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { alert("Couldn't save. Your browser storage might be full."); }
}

// small icons
const ICON_EDIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const ICON_NOTE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>`;

// save changes to one task in the history (and on the main list, if it's still there)
function updateEntry(id, changes){
  const log = load(LOG_KEY);
  const entry = log.find(e => e.id === id);
  if (!entry) return;
  Object.assign(entry, changes);
  save(LOG_KEY, log);

  if (changes.text !== undefined){
    const tasks = load(TASKS_KEY);
    const task = tasks.find(t => t.id === id);
    if (task){ task.text = changes.text; save(TASKS_KEY, tasks); }
  }
}

let openEditorId = null; // which task's editor is open (only one at a time)

// "Today", "Yesterday", or "Friday, October 16, 2026"
function dayLabel(date){
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatTime(iso){
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// "Oct 18, 1:05 AM"
function formatDateTime(iso){
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + formatTime(iso);
}

// what happened to the task: deleted, done or pending
function statusOf(entry){
  if (entry.deletedAt) return "deleted";
  if (entry.done) return "done";
  return "pending";
}

// the date we group/filter by, depending on "Group by"
function groupDate(entry){
  if (groupBy === "done") return entry.done && entry.completedAt ? new Date(entry.completedAt) : null;
  return new Date(entry.createdAt);
}


// ===== streak card =====
function renderStreak(){
  const card = document.querySelector(".streak-card");
  if (typeof getStreak !== "function" || !card){ if (card) card.hidden = true; return; }
  const { current, best, days, doneToday } = getStreak();
  document.getElementById("streak-current").textContent = current;
  document.getElementById("streak-best").textContent =
    `Best: ${best} day${best === 1 ? "" : "s"}` +
    (!doneToday && current > 0 ? " · finish a task today to keep it!" : "");

  // last 7 days, oldest on the left
  const week = document.getElementById("week");
  week.innerHTML = "";
  for (let i = 6; i >= 0; i--){
    const d = new Date();
    d.setDate(d.getDate() - i);
    const hit = days.has(dayKey(d));

    const cell = document.createElement("div");
    cell.className = "week-day" + (hit ? " hit" : "") + (i === 0 ? " today" : "");
    cell.title = d.toDateString() + (hit ? " — finished a task" : "");
    cell.innerHTML = `<span class="week-dot">${hit ? "🔥" : ""}</span><span class="week-name"></span>`;
    cell.querySelector(".week-name").textContent = d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2);
    week.appendChild(cell);
  }
}


// ===== the task list =====
function renderHistory(){
  const log = load(LOG_KEY);

  // stats (deleted tasks still count as "made")
  document.getElementById("stat-total").textContent = log.length;
  document.getElementById("stat-done").textContent = log.filter(e => e.done).length;
  document.getElementById("stat-pending").textContent = log.filter(e => statusOf(e) === "pending").length;

  // filter tab + search + picked date
  const query = searchBox.value.trim().toLowerCase();
  const pickedDay = dateFilter.value; // "" or "2026-10-18"
  clearDateBtn.hidden = !pickedDay;

  const shown = log.filter(e => {
    if (currentFilter !== "all" && statusOf(e) !== currentFilter) return false;
    const haystack = (e.text + " " + (e.note || "")).toLowerCase(); // search the note too
    if (!haystack.includes(query)) return false;
    if (pickedDay){
      const d = groupDate(e);
      if (!d || dayKey(d) !== pickedDay) return false;
    }
    return true;
  });

  // tasks with a date go first (newest first); in "Day done" mode, unfinished ones go last
  const dated = shown.filter(e => groupDate(e)).sort((a, b) => groupDate(b) - groupDate(a));
  const notDone = shown.filter(e => !groupDate(e)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  historyList.innerHTML = "";
  clearBtn.hidden = log.length === 0;
  emptyState.hidden = shown.length > 0;
  emptyState.textContent = log.length === 0
    ? "No tasks yet. Make one on the main page ✨"
    : pickedDay
      ? `Nothing ${groupBy === "done" ? "finished" : "added"} on that day.`
      : "No tasks match this filter.";

  // build groups: { label, entries }
  const groups = [];
  dated.forEach(entry => {
    const label = dayLabel(groupDate(entry));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  });
  if (notDone.length) groups.push({ label: "Not done yet", entries: notDone });

  groups.forEach(group => {
    const heading = document.createElement("h2");
    heading.className = "day-heading";
    heading.textContent = group.label;
    const count = document.createElement("span");
    count.className = "day-count";
    count.textContent = `${group.entries.length} task${group.entries.length === 1 ? "" : "s"}`;
    heading.appendChild(count);

    const ul = document.createElement("ul");
    group.entries.forEach(entry => ul.appendChild(makeRow(entry)));
    historyList.append(heading, ul);
  });
}

function makeRow(entry){
  const status = statusOf(entry);
  const li = document.createElement("li");
  li.className = `task history-item ${status}`;
  li.innerHTML = `
    <span class="status-icon"></span>
    <div class="task-body">
      <span class="task-text"></span>
      <span class="history-meta"></span>
    </div>
    <span class="badge"></span>
    <div class="history-actions">
      <button class="icon-btn note-btn" title="Journal note">${ICON_NOTE}</button>
      <button class="icon-btn edit-btn" title="Edit">${ICON_EDIT}</button>
    </div>`;

  li.querySelector(".task-text").textContent = entry.text; // textContent keeps it safe

  // details line: when it was made, and when it was done/deleted
  const parts = [`Added ${formatDateTime(entry.createdAt)}`];
  if (entry.done && entry.completedAt) parts.push(`Done ${formatDateTime(entry.completedAt)}`);
  if (entry.deletedAt) parts.push(`Deleted ${formatDateTime(entry.deletedAt)}`);
  li.querySelector(".history-meta").textContent = parts.join(" · ");

  li.querySelector(".badge").textContent = { done: "Done", pending: "Pending", deleted: "Deleted" }[status];
  li.querySelector(".status-icon").textContent = { done: "✓", pending: "", deleted: "✕" }[status];

  // the journal note, shown under the task
  if (entry.note){
    const note = document.createElement("div");
    note.className = "history-note";
    note.title = "Click to edit";
    note.innerHTML = `<p class="note-text"></p><span class="note-time"></span>`;
    note.querySelector(".note-text").textContent = entry.note; // line breaks kept by CSS
    if (entry.noteUpdatedAt) note.querySelector(".note-time").textContent = `Note · ${formatDateTime(entry.noteUpdatedAt)}`;
    note.addEventListener("click", () => openEditor(li, entry, "note"));
    li.appendChild(note);
  }
  li.classList.toggle("has-note", !!entry.note);

  li.querySelector(".note-btn").addEventListener("click", () => openEditor(li, entry, "note"));
  li.querySelector(".edit-btn").addEventListener("click", () => openEditor(li, entry, "name"));

  if (openEditorId === entry.id) openEditor(li, entry, "note"); // keep it open after re-render
  return li;
}


// inline editor: change the task name and write a journal note
function openEditor(li, entry, focusOn){
  // close any other open editor first
  document.querySelectorAll(".history-editor").forEach(ed => {
    if (ed.parentElement !== li) ed.closest("li").classList.remove("editing"), ed.remove();
  });
  if (li.querySelector(".history-editor")) return;
  openEditorId = entry.id;

  const editor = document.createElement("form");
  editor.className = "history-editor";
  editor.innerHTML = `
    <label class="editor-label">Task</label>
    <input class="editor-name" type="text" maxlength="200">
    <label class="editor-label">Journal note</label>
    <textarea class="editor-note" rows="4" placeholder="How did it go? Anything to remember?"></textarea>
    <div class="editor-actions">
      <span class="editor-hint">Ctrl + Enter to save · Esc to cancel</span>
      <button type="button" class="editor-cancel">Cancel</button>
      <button type="submit" class="editor-save">Save</button>
    </div>`;

  const nameInput = editor.querySelector(".editor-name");
  const noteInput = editor.querySelector(".editor-note");
  nameInput.value = entry.text;
  noteInput.value = entry.note || "";

  function close(){
    openEditorId = null;
    li.classList.remove("editing");
    editor.remove();
  }

  editor.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = nameInput.value.trim();
    if (!text){ nameInput.focus(); return; }  // a task needs a name
    const note = noteInput.value.trim();

    const changes = { text };
    if (note !== (entry.note || "")){
      changes.note = note;
      changes.noteUpdatedAt = note ? new Date().toISOString() : null;
    }
    updateEntry(entry.id, changes);
    openEditorId = null;
    renderHistory();
  });

  editor.querySelector(".editor-cancel").addEventListener("click", close);
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) editor.requestSubmit();
  });

  // hide the note preview while editing, show the editor instead
  li.classList.add("editing");
  li.appendChild(editor);
  const target = focusOn === "name" ? nameInput : noteInput;
  target.focus();
  target.setSelectionRange(target.value.length, target.value.length);
}


// ===== controls =====
filterButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    filterButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderHistory();
  });
});

groupButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    groupButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    groupBy = btn.dataset.group;
    renderHistory();
  });
});

searchBox.addEventListener("input", renderHistory);
dateFilter.addEventListener("change", renderHistory);
clearDateBtn.addEventListener("click", () => { dateFilter.value = ""; renderHistory(); });

clearBtn.addEventListener("click", () => {
  if (confirm("Clear the history? Tasks still on your main list will stay. (This also resets your streak.)")){
    // keep only tasks that are still on the main page
    const current = load(TASKS_KEY).map(t => t.id);
    const kept = load(LOG_KEY).filter(e => current.includes(e.id) && !e.deletedAt);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(kept)); } catch (e) {}
    renderAll();
  }
});

function renderAll(){
  renderStreak();
  renderHistory();
}

// if you change tasks in another tab, update this page too
window.addEventListener("storage", (e) => { if (e.key === LOG_KEY) renderAll(); });

// signing in/out, or a change from another device (auth.js): redraw,
// but wait if you're in the middle of writing a note
let refreshWaiting = false;
window.addEventListener("wagulist:data-changed", () => {
  if (document.querySelector(".history-editor")){ refreshWaiting = true; return; }
  renderAll();
});
document.addEventListener("click", (e) => {
  if (refreshWaiting && e.target.closest(".editor-cancel")){ refreshWaiting = false; setTimeout(renderAll, 0); }
});

renderAll();
