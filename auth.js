// ===== Accounts + cloud sync (Firebase) =====
// - Sign up / sign in with email + password, or with Google
// - When signed in, your tasks, history, notes and streak are saved to your account
//   and stay in sync on every device you sign in on.
// - When signed out, the app works like before (saved only in this browser).
//
// How it works: the other scripts keep using localStorage like always.
// This file watches those saves and copies them to Firestore (the cloud database),
// and copies changes from other devices back into localStorage.

import { firebaseConfig } from "./firebase-config.js";

const FIREBASE_VERSION = "12.19.0";
const FIREBASE_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

const TASKS_KEY = "wagulist-tasks";
const LOG_KEY = "wagulist-log";
const UID_KEY = "wagulist-uid"; // which account this browser's saved data belongs to
const SYNC_KEYS = [TASKS_KEY, LOG_KEY];

const configured = !!(firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE"));

let fb = {};              // Firebase functions, loaded below
let auth = null, db = null;
let user = null;          // the signed-in user, or null
let docRef = null;        // this user's document in Firestore
let stopListening = null; // turns off live updates from the cloud
let applyingRemote = false;
let pushTimer = null;
let syncState = "idle";   // idle / saving / saved / offline / error


// ---------- small helpers ----------
function load(key){
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch (e) { return []; }
}

function readLocal(){
  return { tasks: load(TASKS_KEY), log: load(LOG_KEY) };
}

// put data into localStorage and tell the page to redraw
function writeLocal(data){
  applyingRemote = true;
  try {
    localStorage.setItem(TASKS_KEY, JSON.stringify(data.tasks || []));
    localStorage.setItem(LOG_KEY, JSON.stringify(data.log || []));
  } catch (e) {
    console.warn("Could not save locally", e);
  } finally {
    applyingRemote = false;
  }
  window.dispatchEvent(new CustomEvent("wagulist:data-changed"));
}

function same(a, b){ return JSON.stringify(a) === JSON.stringify(b); }

function el(tag, className, text){
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(name, email){
  const source = (name || email || "?").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}


// ---------- watch the app's own saves ----------
// Every time script22.js / history.js save tasks, also send them to the cloud.
const originalSetItem = Storage.prototype.setItem;
const originalRemoveItem = Storage.prototype.removeItem;

Storage.prototype.setItem = function(key, value){
  originalSetItem.call(this, key, value);
  if (this === window.localStorage && SYNC_KEYS.includes(key) && !applyingRemote && user) schedulePush();
};

Storage.prototype.removeItem = function(key){
  originalRemoveItem.call(this, key);
  if (this === window.localStorage && SYNC_KEYS.includes(key) && !applyingRemote && user) schedulePush();
};


// ---------- merging (used once, right after signing in) ----------
// Combines the account's saved data with what's in this browser.
// The cloud wins for the same task, but finishing/deleting is never lost.
function mergeData(cloud, local){
  const byId = new Map();
  (cloud.log || []).forEach(e => byId.set(e.id, { ...e }));

  (local.log || []).forEach(e => {
    const c = byId.get(e.id);
    if (!c){ byId.set(e.id, { ...e }); return; }
    if (e.done && !c.done){ c.done = true; c.completedAt = e.completedAt; }
    if (e.deletedAt && !c.deletedAt) c.deletedAt = e.deletedAt;
    if (e.note && !c.note){ c.note = e.note; c.noteUpdatedAt = e.noteUpdatedAt || null; }
  });
  const log = [...byId.values()];

  // tasks still on the list: everything from both, minus ones that are done or deleted
  const finished = new Set(log.filter(e => e.done || e.deletedAt).map(e => e.id));
  const seen = new Set();
  const tasks = [];
  [...(cloud.tasks || []), ...(local.tasks || [])].forEach(t => {
    if (seen.has(t.id) || finished.has(t.id)) return;
    seen.add(t.id);
    tasks.push(t);
  });

  return { tasks, log };
}


// ---------- syncing ----------
async function startSync(u){
  docRef = fb.doc(db, "users", u.uid);
  setSyncState("saving");

  try {
    const snap = await fb.getDoc(docRef);
    const cloud = snap.exists() ? snap.data() : null;
    const local = readLocal();
    const lastUid = localStorage.getItem(UID_KEY);

    let data;
    if (lastUid && lastUid !== u.uid){
      // this browser has someone else's data: never mix it in
      data = cloud ? { tasks: cloud.tasks || [], log: cloud.log || [] } : { tasks: [], log: [] };
    } else if (!cloud){
      data = local;                     // brand-new account: keep what you made as a guest
    } else {
      data = mergeData(cloud, local);   // guest tasks (or offline edits) get added to the account
    }

    originalSetItem.call(localStorage, UID_KEY, u.uid);
    if (!same(data, local)) writeLocal(data);
    if (!cloud || !same(data, { tasks: cloud.tasks || [], log: cloud.log || [] })) await push();
    else setSyncState("saved");

    // live updates: when you change something on another device, it shows up here
    stopListening = fb.onSnapshot(docRef, (snapshot) => {
      if (snapshot.metadata.hasPendingWrites || pushTimer) return; // our own change, or one is about to be sent
      const d = snapshot.data();
      if (!d) return;
      const remote = { tasks: d.tasks || [], log: d.log || [] };
      if (!same(remote, readLocal())) writeLocal(remote);
    }, (err) => {
      console.warn("Live sync stopped", err);
      setSyncState("error");
    });
  } catch (err) {
    console.error("Sync failed", err);
    setSyncState(navigator.onLine ? "error" : "offline");
  }
}

function stopSync(){
  if (stopListening) stopListening();
  stopListening = null;
  docRef = null;
  clearTimeout(pushTimer);
  pushTimer = null;
}

function schedulePush(){
  setSyncState(navigator.onLine ? "saving" : "offline");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 700); // wait a moment so quick changes go out together
}

async function push(){
  clearTimeout(pushTimer);
  pushTimer = null;
  if (!docRef || !user) return;

  const { tasks, log } = readLocal();
  setSyncState(navigator.onLine ? "saving" : "offline");
  try {
    await fb.setDoc(docRef, {
      tasks,
      log,
      name: user.displayName || "",
      email: user.email || "",
      updatedAt: fb.serverTimestamp(),
    }, { merge: true });
    setSyncState("saved");
  } catch (err) {
    console.error("Could not save to the cloud", err);
    setSyncState("error");
  }
}

window.addEventListener("online", () => { if (user) push(); });
window.addEventListener("offline", () => { if (user) setSyncState("offline"); });
window.addEventListener("beforeunload", () => { if (pushTimer) push(); }); // send unsaved changes before leaving


// ---------- error messages people can understand ----------
function friendlyError(err){
  const code = (err && err.code) || "";
  const messages = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/missing-email": "Please enter your email.",
    "auth/missing-password": "Please enter your password.",
    "auth/invalid-credential": "Wrong email or password.",
    "auth/invalid-login-credentials": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "There's no account with that email. Want to sign up?",
    "auth/email-already-in-use": "An account with this email already exists. Try signing in instead.",
    "auth/weak-password": "That password is too weak. Use at least 8 characters with letters and numbers.",
    "auth/too-many-requests": "Too many tries. Please wait a few minutes and try again.",
    "auth/network-request-failed": "No internet connection. Check your connection and try again.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/account-exists-with-different-credential": "This email is already linked to another sign-in method. Try signing in with email and password.",
    "auth/unauthorized-domain": "This website isn't allowed to sign in yet. (Owner: add this domain in Firebase → Authentication → Settings → Authorized domains.)",
    "auth/operation-not-allowed": "This sign-in method isn't turned on yet. (Owner: enable it in Firebase → Authentication → Sign-in method.)",
    "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  };
  return messages[code] || "Something went wrong. Please try again." + (code ? ` (${code})` : "");
}


// =====================================================================
// ===== UI: nav buttons, account menu, sign in / sign up window =====
// =====================================================================
const area = document.getElementById("auth-area");
let modal = null;
let mode = "signin"; // signin / signup / reset

function renderNav(){
  if (!area) return;
  area.innerHTML = "";

  if (!user){
    const signIn = el("button", "action-button auth-btn", "Sign in");
    const signUp = el("button", "action-button primary auth-btn", "Sign up");
    signIn.type = signUp.type = "button";
    signIn.addEventListener("click", () => openModal("signin"));
    signUp.addEventListener("click", () => openModal("signup"));
    area.append(signIn, signUp);
    return;
  }

  // signed in: avatar button + dropdown menu
  const wrap = el("div", "account");
  const avatarBtn = el("button", "avatar-btn");
  avatarBtn.type = "button";
  avatarBtn.title = "Your account";
  avatarBtn.setAttribute("aria-haspopup", "menu");
  avatarBtn.appendChild(makeAvatar(user));
  const dot = el("span", "avatar-sync");
  avatarBtn.appendChild(dot);

  const menu = el("div", "account-menu");
  menu.hidden = true;
  menu.setAttribute("role", "menu");

  const head = el("div", "account-head");
  head.appendChild(makeAvatar(user, true));
  const who = el("div", "account-who");
  who.append(el("strong", "", user.displayName || "Your account"), el("span", "", user.email || ""));
  head.appendChild(who);
  menu.appendChild(head);

  // email not verified yet (email + password accounts only)
  const usesPassword = user.providerData.some(p => p.providerId === "password");
  if (usesPassword && !user.emailVerified){
    const note = el("div", "verify-note");
    note.append(el("span", "", "📧 Check your inbox to verify your email."));
    const resend = el("button", "link-btn", "Resend");
    resend.type = "button";
    resend.addEventListener("click", async () => {
      try { await fb.sendEmailVerification(user); resend.textContent = "Sent ✓"; resend.disabled = true; }
      catch (err) { showToast(friendlyError(err)); }
    });
    note.appendChild(resend);
    menu.appendChild(note);
  }

  const status = el("div", "sync-status");
  status.append(el("span", "sync-dot"), el("span", "sync-text"));
  menu.appendChild(status);

  const signOutBtn = el("button", "menu-item danger", "Sign out");
  signOutBtn.type = "button";
  signOutBtn.setAttribute("role", "menuitem");
  signOutBtn.addEventListener("click", doSignOut);
  menu.appendChild(signOutBtn);

  avatarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });

  wrap.append(avatarBtn, menu);
  area.appendChild(wrap);
  setSyncState(syncState); // fill in the status text
}

// close the account menu when clicking elsewhere or pressing Esc
document.addEventListener("click", (e) => {
  const menu = document.querySelector(".account-menu");
  if (menu && !e.target.closest(".account")) menu.hidden = true;
});
document.addEventListener("keydown", (e) => {
  const menu = document.querySelector(".account-menu");
  if (menu && e.key === "Escape") menu.hidden = true;
});

function makeAvatar(u, big = false){
  const box = el("span", "avatar" + (big ? " big" : ""));
  if (u.photoURL){
    const img = el("img");
    img.src = u.photoURL;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => { img.remove(); box.textContent = initials(u.displayName, u.email); };
    box.appendChild(img);
  } else {
    box.textContent = initials(u.displayName, u.email);
  }
  return box;
}

function setSyncState(state){
  syncState = state;
  const labels = {
    idle: "Synced to your account",
    saving: "Saving…",
    saved: "All changes saved to your account",
    offline: "Offline — will sync when you're back online",
    error: "Couldn't sync. Changes are kept on this device.",
  };
  const text = document.querySelector(".sync-text");
  const box = document.querySelector(".sync-status");
  const dot = document.querySelector(".avatar-sync");
  if (text) text.textContent = labels[state];
  if (box) box.dataset.state = state;
  if (dot) dot.dataset.state = state;
}


// ---------- the sign in / sign up window ----------
function buildModal(){
  modal = el("div", "auth-overlay");
  modal.hidden = true;
  modal.innerHTML = `
    <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button type="button" class="auth-close" aria-label="Close">✕</button>

      <div class="auth-logo">✓</div>
      <h2 id="auth-title" class="auth-title"></h2>
      <p class="auth-sub"></p>

      <div class="auth-setup" hidden>
        Sign-in isn't connected yet. <strong>Site owner:</strong> add your Firebase settings to <code>firebase-config.js</code>.
      </div>

      <div class="auth-tabs" role="tablist">
        <button type="button" class="auth-tab" data-mode="signin" role="tab">Sign in</button>
        <button type="button" class="auth-tab" data-mode="signup" role="tab">Sign up</button>
      </div>

      <div class="auth-social">
        <button type="button" class="google-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
          <span>Continue with Google</span>
        </button>
        <div class="auth-divider"><span>or use your email</span></div>
      </div>

      <form class="auth-form" novalidate>
        <div class="field only-signup">
          <label for="auth-name">Name</label>
          <input id="auth-name" type="text" autocomplete="name" placeholder="What should we call you?" maxlength="60">
        </div>

        <div class="field">
          <label for="auth-email">Email</label>
          <input id="auth-email" type="email" autocomplete="email" placeholder="you@example.com" inputmode="email">
        </div>

        <div class="field not-reset">
          <div class="label-row">
            <label for="auth-password">Password</label>
            <button type="button" class="link-btn only-signin forgot-btn">Forgot password?</button>
          </div>
          <div class="password-wrap">
            <input id="auth-password" type="password" autocomplete="current-password" placeholder="••••••••">
            <button type="button" class="show-pw" aria-label="Show password">Show</button>
          </div>
        </div>

        <div class="pw-check only-signup">
          <div class="pw-meter"><span></span><span></span><span></span><span></span></div>
          <span class="pw-label">Password strength</span>
          <ul class="pw-rules">
            <li data-rule="length">At least 8 characters</li>
            <li data-rule="letter">A letter</li>
            <li data-rule="number">A number</li>
          </ul>
        </div>

        <div class="field only-signup">
          <label for="auth-confirm">Confirm password</label>
          <input id="auth-confirm" type="password" autocomplete="new-password" placeholder="Type it again">
        </div>

        <p class="auth-error" role="alert"></p>
        <p class="auth-success" role="status"></p>

        <button type="submit" class="auth-submit">
          <span class="spinner" aria-hidden="true"></span>
          <span class="submit-text"></span>
        </button>
      </form>

      <p class="auth-switch"></p>
    </div>`;
  document.body.appendChild(modal);

  const $ = (s) => modal.querySelector(s);
  const form = $(".auth-form");
  const pw = $("#auth-password");

  $(".auth-close").addEventListener("click", closeModal);
  modal.addEventListener("mousedown", (e) => { if (e.target === modal) closeModal(); }); // click outside
  modal.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  modal.querySelectorAll(".auth-tab").forEach(tab => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
  $(".forgot-btn").addEventListener("click", () => setMode("reset"));
  $(".google-btn").addEventListener("click", signInWithGoogle);

  $(".show-pw").addEventListener("click", (e) => {
    const showing = pw.type === "text";
    pw.type = showing ? "password" : "text";
    $("#auth-confirm").type = pw.type;
    e.currentTarget.textContent = showing ? "Show" : "Hide";
  });

  pw.addEventListener("input", updateStrength);
  form.addEventListener("input", () => showError(""));
  form.addEventListener("submit", handleSubmit);
}

function setMode(next){
  mode = next;
  const $ = (s) => modal.querySelector(s);
  const text = {
    signin: ["Welcome back", "Sign in to see your tasks on any device.", "Sign in", "Don't have an account?", "Sign up", "signup"],
    signup: ["Create your account", "It's free. Your tasks, history and streak will follow you everywhere.", "Create account", "Already have an account?", "Sign in", "signin"],
    reset:  ["Reset your password", "Enter your email and we'll send you a link to set a new password.", "Send reset link", "Remembered it?", "Back to sign in", "signin"],
  }[mode];

  $(".auth-title").textContent = text[0];
  $(".auth-sub").textContent = text[1];
  $(".submit-text").textContent = text[2];

  const sw = $(".auth-switch");
  sw.innerHTML = "";
  const link = el("button", "link-btn", text[4]);
  link.type = "button";
  link.addEventListener("click", () => setMode(text[5]));
  sw.append(text[3] + " ", link);

  modal.dataset.mode = mode;
  modal.querySelectorAll(".auth-tab").forEach(t => t.setAttribute("aria-selected", t.dataset.mode === mode));
  $("#auth-password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  showError("");
  $(".auth-success").textContent = "";
  updateStrength();

  // focus the first empty box
  const first = mode === "signup" ? $("#auth-name") : $("#auth-email");
  setTimeout(() => (first.value ? $("#auth-email") : first).focus(), 30);
}

function openModal(which){
  if (!modal) buildModal();
  modal.querySelector(".auth-setup").hidden = configured;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  setMode(which);
}

function closeModal(){
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  modal.querySelector(".auth-form").reset();
  setBusy(false);
}

function showError(message){
  if (modal) modal.querySelector(".auth-error").textContent = message;
}

function setBusy(busy){
  if (!modal) return;
  modal.querySelector(".auth-submit").disabled = busy;
  modal.querySelector(".google-btn").disabled = busy;
  modal.classList.toggle("busy", busy);
}

// password strength: 0 (empty) to 4 (strong)
function passwordScore(p){
  if (!p) return 0;
  const r = passwordRules(p);
  let score = r.length && r.letter && r.number ? 2 : 1;          // meets the rules = at least "Okay"
  if (p.length >= 12) score++;                                  // long
  if ((/[a-z]/.test(p) && /[A-Z]/.test(p)) || /[^A-Za-z0-9]/.test(p)) score++; // mixed case or a symbol
  return Math.min(4, score);
}

function passwordRules(p){
  return { length: p.length >= 8, letter: /[A-Za-z]/.test(p), number: /\d/.test(p) };
}

function updateStrength(){
  if (!modal) return;
  const p = modal.querySelector("#auth-password").value;
  const score = passwordScore(p);
  const check = modal.querySelector(".pw-check");
  check.dataset.score = score;
  modal.querySelector(".pw-label").textContent = p ? ["", "Weak", "Okay", "Good", "Strong"][score] : "Password strength";
  const rules = passwordRules(p);
  check.querySelectorAll("[data-rule]").forEach(li => li.classList.toggle("ok", rules[li.dataset.rule]));
}

async function handleSubmit(e){
  e.preventDefault();
  if (!configured){ showError("Sign-in isn't connected yet. Add your Firebase settings to firebase-config.js."); return; }

  const $ = (s) => modal.querySelector(s);
  const name = $("#auth-name").value.trim();
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const confirmPw = $("#auth-confirm").value;

  // check the form before sending anything
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError("Please enter a valid email address."), $("#auth-email").focus();
  if (mode === "signup"){
    if (!name) return showError("Please enter your name."), $("#auth-name").focus();
    const r = passwordRules(password);
    if (!r.length || !r.letter || !r.number) return showError("Your password needs at least 8 characters, with letters and numbers."), $("#auth-password").focus();
    if (password !== confirmPw) return showError("The passwords don't match."), $("#auth-confirm").focus();
  }
  if (mode === "signin" && !password) return showError("Please enter your password."), $("#auth-password").focus();

  setBusy(true);
  try {
    await ready;
    if (mode === "signin"){
      await fb.signInWithEmailAndPassword(auth, email, password);
      closeModal();
    } else if (mode === "signup"){
      const cred = await fb.createUserWithEmailAndPassword(auth, email, password);
      await fb.updateProfile(cred.user, { displayName: name });
      fb.sendEmailVerification(cred.user).catch(() => {});
      renderNav(); // show the new name
      closeModal();
      showToast(`Welcome, ${name}! 🎉 We sent a verification link to ${email}.`);
    } else {
      await fb.sendPasswordResetEmail(auth, email);
      // same message either way, so nobody can check which emails have accounts
      $(".auth-success").textContent = `If there's an account for ${email}, a reset link is on its way. Check your inbox (and spam).`;
      setBusy(false);
    }
  } catch (err) {
    setBusy(false);
    showError(friendlyError(err));
  }
}

async function signInWithGoogle(){
  if (!configured){ showError("Sign-in isn't connected yet. Add your Firebase settings to firebase-config.js."); return; }
  setBusy(true);
  try {
    await ready;
    const provider = new fb.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await fb.signInWithPopup(auth, provider);
    closeModal();
  } catch (err) {
    setBusy(false);
    const code = err && err.code;
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return; // they closed it
    if (code === "auth/popup-blocked"){
      // pop-up blocked: open Google sign-in in this tab instead
      try { await fb.signInWithRedirect(auth, new fb.GoogleAuthProvider()); return; } catch (e2) { err = e2; }
    }
    showError(friendlyError(err));
  }
}

async function doSignOut(){
  if (pushTimer) await push(); // don't lose the last change
  stopSync();
  await fb.signOut(auth);
  // remove this account's data from the browser so the next person can't see it
  originalRemoveItem.call(localStorage, UID_KEY);
  writeLocal({ tasks: [], log: [] });
  showToast("You're signed out. See you soon 👋");
}


// ---------- little message at the bottom ----------
let toastTimer = null;
function showToast(message){
  let toast = document.querySelector(".auth-toast");
  if (!toast){
    toast = el("div", "auth-toast");
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4500);
}


// ---------- start ----------
renderNav();

const ready = (async () => {
  if (!configured){
    console.warn("Wagulist: sign-in is off until you fill in firebase-config.js");
    return;
  }

  const [appMod, authMod, storeMod] = await Promise.all([
    import(`${FIREBASE_URL}/firebase-app.js`),
    import(`${FIREBASE_URL}/firebase-auth.js`),
    import(`${FIREBASE_URL}/firebase-firestore.js`),
  ]);
  fb = { ...appMod, ...authMod, ...storeMod };

  const app = fb.initializeApp(firebaseConfig);
  auth = fb.getAuth(app);
  db = fb.getFirestore(app);

  let firstCheck = true;
  fb.onAuthStateChanged(auth, async (u) => {
    const wasSignedIn = !!user;
    user = u;
    renderNav();

    if (u){
      if (!wasSignedIn && !firstCheck) showToast(`Signed in as ${u.displayName || u.email} ✓ Your tasks now sync across devices.`);
      await startSync(u);
    } else {
      stopSync();
      // signed out somewhere else (or session ended): don't leave the account's data behind
      if (localStorage.getItem(UID_KEY)){
        originalRemoveItem.call(localStorage, UID_KEY);
        writeLocal({ tasks: [], log: [] });
      }
    }
    firstCheck = false;
  });
})().catch(err => {
  console.error("Wagulist: couldn't load sign-in", err);
});
