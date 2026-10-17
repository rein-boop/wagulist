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

let currentFilter = "all";   // all / pending / done / deleted
let groupBy = "added";       // "added" = by the day you made it, "done" = by the day you finished it

function load(key){
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch (e) { return []; }
}

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
    if (!e.text.toLowerCase().includes(query)) return false;
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
    <span class="badge"></span>`;

  li.querySelector(".task-text").textContent = entry.text; // textContent keeps it safe

  // details line: when it was made, and when it was done/deleted
  const parts = [`Added ${formatDateTime(entry.createdAt)}`];
  if (entry.done && entry.completedAt) parts.push(`Done ${formatDateTime(entry.completedAt)}`);
  if (entry.deletedAt) parts.push(`Deleted ${formatDateTime(entry.deletedAt)}`);
  li.querySelector(".history-meta").textContent = parts.join(" · ");

  li.querySelector(".badge").textContent = { done: "Done", pending: "Pending", deleted: "Deleted" }[status];
  li.querySelector(".status-icon").textContent = { done: "✓", pending: "", deleted: "✕" }[status];
  return li;
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

renderAll();