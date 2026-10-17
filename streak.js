// ===== Streak: how many days in a row you finished at least one task =====
// Used by both index.html and history.html.

// "2026-10-18" in your own timezone (used to compare days)
function dayKey(date){
  return date.toLocaleDateString("en-CA"); // en-CA gives YYYY-MM-DD
}

function getStreak(){
  let log = [];
  try { log = JSON.parse(localStorage.getItem("wagulist-log")) || []; } catch (e) {}

  // every day you completed something
  const days = new Set(
    log.filter(e => e.done && e.completedAt).map(e => dayKey(new Date(e.completedAt)))
  );

  // current streak: count back from today (or from yesterday if nothing is done yet today,
  // so the streak isn't "lost" until the day is over)
  const day = new Date();
  const doneToday = days.has(dayKey(day));
  if (!doneToday) day.setDate(day.getDate() - 1);

  let current = 0;
  while (days.has(dayKey(day))){
    current++;
    day.setDate(day.getDate() - 1);
  }

  // best streak ever: the longest run of back-to-back days
  let best = 0, run = 0, prev = null;
  [...days].sort().forEach(key => {
    const date = new Date(key + "T00:00");
    const gap = prev ? Math.round((date - prev) / 86400000) : null;
    run = gap === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = date;
  });

  return { current, best, doneToday, days };
}