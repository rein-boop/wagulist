const inputBox = document.getElementById("input-box");
const listContainer = document.getElementById("list-container");
const completedCounter = document.getElementById("completed-counter");
const uncompletedCounter = document.getElementById("Uncompleted-counter");
const datenow = document.getElementById("Clock");
const Day = document.getElementById("day");
const Mont = document.getElementById("month");
const todoForm = document.getElementById("todo-form");
const emptyState = document.getElementById("empty-state");
const progressBar = document.getElementById("progress-bar");
const totalPill = document.getElementById("total-pill");

// small icons for the edit and delete buttons
const ICON_EDIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>`;


// ===== Saving (localStorage keeps data even after refresh or changing pages) =====
// tasks: the list you see now        [{ id, text, done, createdAt, completedAt }]
// log:   every task you ever made     [{ id, text, done, createdAt, completedAt, deletedAt }]
//        (deleting a task removes it from "tasks" but it stays in the log for the History page)
const TASKS_KEY = "wagulist-tasks";
const LOG_KEY = "wagulist-log";

function load(key){
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch (e) { return []; }
}

function save(key, value){
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn("Could not save", e); }
}

let tasks = load(TASKS_KEY);

// change one task's entry in the log (re-read first in case the History page changed it)
function updateLog(id, changes){
  const log = load(LOG_KEY);
  const entry = log.find(e => e.id === id);
  if (entry) Object.assign(entry, changes);
  else log.push({ id, deletedAt: null, ...changes });
  save(LOG_KEY, log);
}

// tasks saved before the log existed get added to it once
(function backfillLog(){
  const log = load(LOG_KEY);
  let changed = false;
  tasks.forEach(t => {
    if (!t.createdAt){ t.createdAt = t.completedAt || new Date().toISOString(); changed = true; }
    if (!log.some(e => e.id === t.id)){
      log.push({ id: t.id, text: t.text, done: t.done, createdAt: t.createdAt, completedAt: t.completedAt, deletedAt: null });
    }
  });
  save(LOG_KEY, log);
  if (changed) save(TASKS_KEY, tasks);
})();

function makeId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// "12:51 AM"
function formatTime(iso){
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}


function redirect(){
  window.location.href = "history2.html"; // go to the history page
}


function addTask() {
  const text = inputBox.value.trim(); // get the value of the input box

  if (!text) {
    // shake the box instead of a popup
    todoForm.classList.remove("shake");
    void todoForm.offsetWidth; // restart the animation
    todoForm.classList.add("shake");
    inputBox.focus();
    return;
  }

  const task = { id: makeId(), text, done: false, createdAt: new Date().toISOString(), completedAt: null };
  tasks.push(task);
  save(TASKS_KEY, tasks);
  updateLog(task.id, { ...task }); // record it in the history

  listContainer.appendChild(createTaskElement(task));
  inputBox.value = ""; // set the inputbox into empty
  updateCounters();
}


// builds the <li> for one task
function createTaskElement(task){
  const li = document.createElement("li");
  li.className = "task";
  li.innerHTML = `
    <label class="task-check">
      <input type="checkbox">
      <span class="checkmark"></span>
    </label>
    <div class="task-body">
      <span class="task-text"></span>
      <span class="task-meta"></span>
    </div>
    <div class="task-actions">
      <button class="icon-btn edit-btn" title="Edit">${ICON_EDIT}</button>
      <button class="icon-btn delete-btn" title="Delete">${ICON_TRASH}</button>
    </div>`;

  const checkbox = li.querySelector("input");
  const taskSpan = li.querySelector(".task-text");
  const metaSpan = li.querySelector(".task-meta");
  const editbtn = li.querySelector(".edit-btn");
  const deletebtn = li.querySelector(".delete-btn");

  // textContent instead of innerHTML, so typing "<b>" can't break the page
  taskSpan.textContent = task.text;

  // show done/not-done state (used now and after changes)
  function showState(){
    checkbox.checked = task.done;
    li.classList.toggle("completed", task.done);
    metaSpan.textContent = task.done
      ? `Done at ${formatTime(task.completedAt)}`
      : `Added ${formatTime(task.createdAt)}`;
    metaSpan.classList.toggle("is-done", task.done);
  }
  showState();

  checkbox.addEventListener("change", function(){
    if (!checkbox.checked) return;

    // marked done -> record it in the history, then remove it from the list
    const before = getStreak();
    task.done = true;
    task.completedAt = new Date().toISOString();
    updateLog(task.id, { done: true, completedAt: task.completedAt });
    showState();

    const index = tasks.findIndex(t => t.id === task.id); // remember its spot for Undo
    tasks = tasks.filter(t => t.id !== task.id);
    save(TASKS_KEY, tasks);

    // let the line draw across the task (see .completed in style2.css), then slide it away
    setTimeout(() => {
      li.classList.add("removing");
      setTimeout(() => {
        li.remove();
        updateCounters();
      }, 300);
    }, 1000);

    const after = getStreak();
    const message = !before.doneToday
      ? `🔥 ${after.current}-day streak! "${task.text}" done`   // first task today
      : `"${task.text}" done ✓`;
    updateStreak();
    if (!before.doneToday){
      const chip = document.getElementById("streak");
      chip.classList.remove("bump");
      void chip.offsetWidth; // restart the animation
      chip.classList.add("bump");
    }

    showUndo(message, () => {
      // put the task back where it was
      task.done = false;
      task.completedAt = null;
      tasks.splice(Math.min(index, tasks.length), 0, task);
      save(TASKS_KEY, tasks);
      updateLog(task.id, { done: false, completedAt: null });
      renderTasks();
    });
  });

  editbtn.addEventListener("click", () => startEditing(li, task, taskSpan, showState));
  taskSpan.addEventListener("dblclick", () => startEditing(li, task, taskSpan, showState)); // double-click to edit too

  deletebtn.addEventListener("click", function(){
    if (confirm("Are you sure you want to delete this task?")){
      tasks = tasks.filter(t => t.id !== task.id);
      save(TASKS_KEY, tasks);
      updateLog(task.id, { deletedAt: new Date().toISOString() }); // stays in History as "Deleted"
      li.classList.add("removing"); // fade out first
      setTimeout(() => {
        li.remove();
        updateCounters();
      }, 200);
    }
  });

  return li;
}


// small "Task done · Undo" popup at the bottom of the screen
let undoTimer = null;
function showUndo(message, onUndo){
  let toast = document.getElementById("toast");
  if (!toast){
    toast = document.createElement("div");
    toast.id = "toast";
    toast.innerHTML = `<span class="toast-text"></span><button class="toast-undo">Undo</button>`;
    document.body.appendChild(toast);
  }
  toast.querySelector(".toast-text").textContent = message;

  // replace the old Undo button so it only undoes the latest task
  const oldBtn = toast.querySelector(".toast-undo");
  const undoBtn = oldBtn.cloneNode(true);
  oldBtn.replaceWith(undoBtn);
  undoBtn.addEventListener("click", () => {
    onUndo();
    toast.classList.remove("show");
  });

  toast.classList.add("show");
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => toast.classList.remove("show"), 5000); // hide after 5 seconds
}

// draw the whole list from the saved tasks
function renderTasks(){
  listContainer.innerHTML = "";
  tasks.forEach(task => listContainer.appendChild(createTaskElement(task)));
  updateCounters();
}


// edit right inside the list instead of a prompt() popup
function startEditing(li, task, taskSpan, showState){
  if (li.querySelector(".edit-input")) return; // already editing

  const editInput = document.createElement("input");
  editInput.className = "edit-input";
  editInput.value = task.text;
  taskSpan.replaceWith(editInput);
  editInput.focus();
  editInput.select();

  let done = false;
  function finish(saveIt){
    if (done) return;
    done = true;
    const update = editInput.value.trim();
    if (saveIt && update && update !== task.text){
      task.text = update;          // update the task text
      task.done = false;           // an edited task counts as not done yet
      task.completedAt = null;
      taskSpan.textContent = update;
      save(TASKS_KEY, tasks);
      updateLog(task.id, { text: update, done: false, completedAt: null });
    }
    editInput.replaceWith(taskSpan);
    showState();
    updateCounters();
  }

  editInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);   // Enter saves
    if (e.key === "Escape") finish(false); // Esc cancels
  });
  editInput.addEventListener("blur", () => finish(true)); // clicking away saves
}


function updateCounters(){
  const today = new Date().toDateString();
  // done tasks leave the list, so count today's finished ones from the history
  const completedTasks = load(LOG_KEY).filter(e =>
    e.done && e.completedAt && new Date(e.completedAt).toDateString() === today
  ).length;
  const uncompletedTasks = tasks.length;
  const total = completedTasks + uncompletedTasks;

  completedCounter.textContent = completedTasks;
  uncompletedCounter.textContent = uncompletedTasks;
  totalPill.textContent = uncompletedTasks;

  progressBar.style.width = total ? (completedTasks / total * 100) + "%" : "0%";
  emptyState.hidden = tasks.length > 0; // show "No tasks yet" only when the list is empty
  emptyState.textContent = completedTasks > 0 ? "All done for now! 🎉" : "No tasks yet. Add one above ✨";
  updateStreak();
}


// the 🔥 chip next to the title
function updateStreak(){
  const { current, doneToday } = getStreak();
  const chip = document.getElementById("streak");
  const hint = document.getElementById("streak-hint");

  document.getElementById("streak-count").textContent = current;
  chip.classList.toggle("active", doneToday);      // bright when today counts
  chip.classList.toggle("at-risk", !doneToday && current > 0);

  if (current === 0) hint.textContent = "Finish a task today to start a streak!";
  else if (!doneToday) hint.textContent = `Finish a task today to keep your ${current}-day streak going 🔥`;
  else hint.textContent = "";
}


function updateclock(){
  const now = new Date();

  let hours = now.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12; // 0 -> 12, 13 -> 1, etc.
  const minutes = String(now.getMinutes()).padStart(2, "0"); // add leading zeros
  const seconds = String(now.getSeconds()).padStart(2, "0");

  datenow.innerHTML = `${hours}:${minutes}<span class="sec">:${seconds}</span><span class="ampm">${ampm}</span>`;
  Day.textContent = now.toLocaleDateString("en-US", { weekday: "long" });
  Mont.textContent = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}


// Add button + Enter key both submit the form
todoForm.addEventListener("submit", function(e){
  e.preventDefault(); // stop the page from reloading
  addTask();
});

document.getElementById("history-btn").addEventListener("click", redirect);

// done tasks saved by the older version: they're in the history already, so take them off the list
if (tasks.some(t => t.done)){
  tasks = tasks.filter(t => !t.done);
  save(TASKS_KEY, tasks);
}

// show saved tasks when the page opens
renderTasks();

updateclock(); // show the time right away instead of waiting 1 second
setInterval(updateclock, 1000);
updateCounters();