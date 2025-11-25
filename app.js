// app.js — improved, robust version of your code
// Notes:
// - Local storage key: notes_app_v1 (array of note objects)
// - Cloud: users/{uid} doc, field "notes" (array)
// - Merge strategy: for each note id pick the note with larger updatedAt
// - Debounce: local save 350ms, cloud push 900ms
// - Uses Firebase compat API (matches your SDK <script> tags)

///// CONFIG /////
const firebaseConfig = {
  apiKey: "AIzaSyBc_xHf1wiQX0EbtrlgNg9TJyFrBYcrA9M",
  authDomain: "simnotes-5d6dc.firebaseapp.com",
  projectId: "simnotes-5d6dc",
  // NOTE: confirm this value in Firebase Console -> Project settings -> Storage bucket.
  // Common default pattern is: "<project-id>.appspot.com"
  storageBucket: "simnotes-5d6dc.appspot.com",
  messagingSenderId: "455811987726",
  appId: "1:455811987726:web:97baa93d5535f05173bf5f",
};

///// SANITY WAIT + BOOT /////
function initApp() {
  // Retry if firebase SDK isn't available yet
  if (typeof firebase === "undefined") {
    console.warn("Firebase SDK not loaded yet — retrying in 100ms...");
    setTimeout(initApp, 100);
    return;
  }

  // Initialize firebase app once
  try {
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp(firebaseConfig);
      console.log("Firebase initialized");
    } else {
      console.log("Firebase already initialized");
    }
  } catch (err) {
    console.error("Firebase initialization error:", err);
    return;
  }

  // DOM-ready guard
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startApp);
  } else {
    startApp();
  }
}

///// APP START /////
function startApp() {
  console.log("Starting Notes app...");

  // DOM references (must match your HTML)
  const notesListEl = document.getElementById("notesList");
  const noteTitleEl = document.getElementById("noteTitle");
  const noteBodyEl = document.getElementById("noteBody");
  const newNoteBtn = document.getElementById("newNoteBtn");
  const themeToggle = document.getElementById("themeToggle");
  const refreshBtn = document.getElementById("refreshBtn");
  const deleteBtn = document.getElementById("deleteBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const importInput = document.getElementById("importInput");
  const searchInput = document.getElementById("searchInput");
  const authBtn = document.getElementById("authBtn");
  const userInfoEl = document.getElementById("userInfo");
  const userNameEl = document.getElementById("userName");
  const userPhotoEl = document.getElementById("userPhoto");
  const lastSavedEl = document.getElementById("lastSaved");

  // quick DOM sanity
  if (!notesListEl || !noteTitleEl || !noteBodyEl || !authBtn) {
    console.error("Missing critical DOM elements; aborting init.", {
      notesListEl,
      noteTitleEl,
      noteBodyEl,
      authBtn,
    });
    return;
  }

  // constants & state
  const STORAGE_KEY = "notes_app_v1";
  const DELETED_KEY = "notes_deleted_v1";
  const THEME_KEY = "notes_theme_v1";
  const LOCAL_DEBOUNCE_MS = 350;
  const CLOUD_DEBOUNCE_MS = 900;

  let notes = []; // Array of { id, title, body, updatedAt (ISO string) }
  let currentNoteId = null;
  let saveDebounce = null;
  let cloudDebounce = null;
  let unsubscribeSnapshot = null;
  let deletedIds = new Set();

  const auth = firebase.auth();
  const db = firebase.firestore();
  const provider = new firebase.auth.GoogleAuthProvider();

  ///// utilities /////
  function generateId() {
    return (
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9)
    );
  }
  function nowISO() {
    return new Date().toISOString();
  }
  function safeParseJSON(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  function formatTime(date) {
    if (!date) return "Unknown";
    const d = new Date(date);
    if (isNaN(d.getTime())) return "Unknown";
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
  }
  function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  ///// local storage /////
  function loadFromLocal() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = safeParseJSON(raw);
    if (!Array.isArray(parsed)) {
      notes = [];
      return;
    }
    notes = parsed.map((n) => ({
      id: n.id || generateId(),
      title: n.title || "Untitled Note",
      body: n.body || "",
      updatedAt: n.updatedAt || nowISO(),
    }));
    notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function loadDeletedFromLocal() {
    const raw = localStorage.getItem(DELETED_KEY);
    const parsed = safeParseJSON(raw);
    if (Array.isArray(parsed)) {
      deletedIds = new Set(parsed);
    } else {
      deletedIds = new Set();
    }
  }

  function saveDeletedToLocal() {
    try {
      localStorage.setItem(DELETED_KEY, JSON.stringify(Array.from(deletedIds)));
    } catch (e) {
      console.error("saveDeletedToLocal error:", e);
    }
  }

  ///// theme /////
  function applyTheme(theme) {
    const t = theme === "dark" ? "dark" : "light";
    const root = document.documentElement;
    root.setAttribute("data-theme", t);
    if (themeToggle) {
      themeToggle.textContent = t === "dark" ? "Light" : "Dark";
      themeToggle.title =
        t === "dark" ? "Switch to light mode" : "Switch to dark mode";
    }
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const initial = saved === "dark" || saved === "light" ? saved : "light";
    applyTheme(initial);
  }

  function saveToLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      // update last saved UI (for selected)
      const cur = notes.find((n) => n.id === currentNoteId);
      if (cur && lastSavedEl)
        lastSavedEl.textContent = `Last saved: ${formatTime(cur.updatedAt)}`;
      else if (lastSavedEl) lastSavedEl.textContent = "Saved";
    } catch (e) {
      console.error("saveToLocal error:", e);
      alert("Could not save to localStorage (maybe quota).");
    }
  }

  ///// rendering /////
  function renderNotes(filter = "") {
    if (!notesListEl) return;
    const q = (filter || "").trim().toLowerCase();

    const filtered = q
      ? notes.filter((n) =>
          ((n.title || "") + " " + (n.body || "")).toLowerCase().includes(q)
        )
      : notes;

    if (filtered.length === 0) {
      notesListEl.innerHTML = '<div class="empty-state">No notes found</div>';
      return;
    }

    notesListEl.innerHTML = filtered
      .map((n) => {
        const active = n.id === currentNoteId ? "active" : "";
        const preview = (n.body || "").replace(/\n/g, " ").slice(0, 120);
        return `
        <div class="note-item ${active}" data-id="${escapeHtml(n.id)}">
          <div class="note-item-title">${escapeHtml(
            n.title || "Untitled"
          )}</div>
          <div class="note-item-preview">${escapeHtml(preview)}</div>
          <div class="note-item-time">${escapeHtml(
            formatTime(n.updatedAt)
          )}</div>
        </div>
      `;
      })
      .join("");

    // attach handlers
    notesListEl.querySelectorAll(".note-item").forEach((el) => {
      el.onclick = () => {
        const id = el.getAttribute("data-id");
        if (id) selectNote(id);
      };
    });
  }

  function renderEditor() {
    const note = notes.find((n) => n.id === currentNoteId);
    if (!note) {
      noteTitleEl.value = "";
      noteBodyEl.value = "";
      noteTitleEl.disabled = true;
      noteBodyEl.disabled = true;
      deleteBtn.disabled = true;
      if (lastSavedEl) lastSavedEl.textContent = "";
      return;
    }
    noteTitleEl.disabled = false;
    noteBodyEl.disabled = false;
    deleteBtn.disabled = false;
    // set values (don't preserve caret — acceptable for MVP)
    noteTitleEl.value = note.title || "";
    noteBodyEl.value = note.body || "";
    if (lastSavedEl)
      lastSavedEl.textContent = `Last saved: ${formatTime(note.updatedAt)}`;
  }

  ///// selection / CRUD /////
  function selectNote(id) {
    currentNoteId = id;
    renderNotes(searchInput ? searchInput.value : "");
    renderEditor();
    // focus body for typing
    setTimeout(() => {
      if (document.activeElement !== noteBodyEl) noteBodyEl.focus();
    }, 50);
  }

  function createNote() {
    const n = {
      id: generateId(),
      title: "Untitled Note",
      body: "",
      updatedAt: nowISO(),
    };
    notes.unshift(n);
    saveToLocal();
    renderNotes(searchInput ? searchInput.value : "");
    selectNote(n.id);
    scheduleCloudPush();
  }

  function deleteCurrentNote() {
    if (!currentNoteId) return;
    if (!confirm("Delete this note?")) return;
    const deletedIndex = notes.findIndex((n) => n.id === currentNoteId);
    deletedIds.add(currentNoteId);
    saveDeletedToLocal();
    notes = notes.filter((n) => n.id !== currentNoteId);
    saveToLocal();
    renderNotes(searchInput ? searchInput.value : "");
    if (notes.length > 0) {
      const nextIndex =
        deletedIndex >= 0 ? Math.min(deletedIndex, notes.length - 1) : 0;
      const nextId = notes[nextIndex].id;
      selectNote(nextId);
    } else {
      currentNoteId = null;
      renderEditor();
    }
    scheduleCloudPush();
  }

  ///// editor autosave (debounced local save) /////
  function scheduleLocalSave() {
    if (!currentNoteId) return;
    const note = notes.find((n) => n.id === currentNoteId);
    if (!note) return;

    note.title = noteTitleEl.value || "Untitled Note";
    note.body = noteBodyEl.value || "";
    note.updatedAt = nowISO();

    // update UI optimistic
    renderNotes(searchInput ? searchInput.value : "");
    if (lastSavedEl) lastSavedEl.textContent = "Saving...";

    clearTimeout(saveDebounce);
    saveDebounce = setTimeout(() => {
      saveToLocal();
      scheduleCloudPush(); // sync to cloud after local saved
    }, LOCAL_DEBOUNCE_MS);
  }

  ///// import / export /////
  function exportNotes() {
    try {
      const blob = new Blob([JSON.stringify(notes, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `notes_export_${new Date().toISOString().slice(0, 19)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("export error", e);
      alert("Export failed.");
    }
  }

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = safeParseJSON(ev.target.result);
        if (!Array.isArray(imported)) {
          // Accept either array or object map for compatibility
          if (imported && typeof imported === "object") {
            // convert object map to array
            const arr = Object.values(imported);
            mergeImported(arr);
          } else {
            throw new Error(
              "Imported JSON must be an array or object map of notes."
            );
          }
        } else {
          mergeImported(imported);
        }
      } catch (e) {
        console.error("Import failed", e);
        alert("Import failed: " + (e.message || e));
      }
    };
    reader.onerror = () => alert("Failed to read file");
    reader.readAsText(file);
  }

  function mergeImported(importedArray) {
    // merge by id, choose larger updatedAt
    const map = new Map(notes.map((n) => [n.id, n]));
    let added = 0,
      updated = 0;
    importedArray.forEach((item) => {
      if (!item) return;
      const id = item.id || generateId();
      const title = item.title || "Untitled Note";
      const body = item.body || "";
      const updatedAt = item.updatedAt || nowISO();
      const existing = map.get(id);
      if (!existing) {
        map.set(id, { id, title, body, updatedAt });
        added++;
      } else if (new Date(updatedAt) > new Date(existing.updatedAt)) {
        map.set(id, { id, title, body, updatedAt });
        updated++;
      }
    });
    notes = Array.from(map.values()).sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
    saveToLocal();
    renderNotes(searchInput ? searchInput.value : "");
    scheduleCloudPush();
    alert(`Import complete — added: ${added}, updated: ${updated}`);
  }

  ///// cloud sync helpers /////
  // Merge remote array into local array (per-note updatedAt wins)
  function mergeRemoteNotesArray(remoteArr, remoteDeletedIds = []) {
    if (!Array.isArray(remoteArr)) return;
    const remoteDeletedSet = new Set(remoteDeletedIds || []);

    // sync remote deletions into local cache
    let deletedChanged = false;
    remoteDeletedSet.forEach((id) => {
      if (id && !deletedIds.has(id)) {
        deletedIds.add(id);
        deletedChanged = true;
      }
    });
    if (deletedChanged) saveDeletedToLocal();

    const blockedIds = new Set([...remoteDeletedSet, ...deletedIds]);

    const map = new Map();

    // seed with remote notes (excluding deleted)
    remoteArr.forEach((rn) => {
      if (!rn || !rn.id || blockedIds.has(rn.id)) return;
      map.set(rn.id, {
        id: rn.id,
        title: rn.title || "Untitled Note",
        body: rn.body || "",
        updatedAt: rn.updatedAt || nowISO(),
      });
    });

    // merge current local notes to preserve unsynced changes
    notes.forEach((local) => {
      if (!local || !local.id || blockedIds.has(local.id)) return;
      const existing = map.get(local.id);
      if (
        !existing ||
        new Date(local.updatedAt) > new Date(existing.updatedAt || 0)
      ) {
        map.set(local.id, {
          id: local.id,
          title: local.title || "Untitled Note",
          body: local.body || "",
          updatedAt: local.updatedAt || nowISO(),
        });
      }
    });

    notes = Array.from(map.values()).sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
    saveToLocal();
    renderNotes(searchInput ? searchInput.value : "");
    // refresh editor if not editing
    if (
      currentNoteId &&
      document.activeElement !== noteTitleEl &&
      document.activeElement !== noteBodyEl
    ) {
      const cur = notes.find((n) => n.id === currentNoteId);
      if (cur) {
        noteTitleEl.value = cur.title;
        noteBodyEl.value = cur.body;
        if (lastSavedEl)
          lastSavedEl.textContent = `Last saved: ${formatTime(cur.updatedAt)}`;
      }
    }
  }

  // Debounced push to Firestore
  function scheduleCloudPush() {
    const user = auth.currentUser;
    if (!user) return; // offline behaviour: only local
    clearTimeout(cloudDebounce);
    cloudDebounce = setTimeout(async () => {
      try {
        const userRef = db.collection("users").doc(user.uid);

        // Read remote to merge server-side to avoid overwriting someone else's edits
        const doc = await userRef.get();
        const data = doc.exists ? doc.data() : {};
        const remote = data && Array.isArray(data.notes) ? data.notes : [];
        const remoteDeleted =
          data && Array.isArray(data.deletedIds) ? data.deletedIds : [];
        // convert remote to map for merging
        const remoteMap = new Map((remote || []).map((n) => [n.id, n]));
        const mergedMap = new Map(remoteMap); // start with remote
        const pendingDeletes = new Set(deletedIds);
        const mergedDeletedSet = new Set([...remoteDeleted, ...pendingDeletes]);

        // For each local note, pick the most recent
        notes.forEach((localN) => {
          const rn = mergedMap.get(localN.id);
          if (
            !rn ||
            new Date(localN.updatedAt) >= new Date(rn.updatedAt || 0)
          ) {
            mergedMap.set(localN.id, {
              id: localN.id,
              title: localN.title,
              body: localN.body,
              updatedAt: localN.updatedAt,
            });
          }
        });
        // remove any notes that were marked deleted (remote or local)
        mergedDeletedSet.forEach((id) => mergedMap.delete(id));
        const mergedArray = Array.from(mergedMap.values());
        await userRef.set(
          {
            notes: mergedArray,
            deletedIds: Array.from(mergedDeletedSet),
            lastUpdated: nowISO(),
          },
          { merge: true }
        );
        // clear any deletes that successfully synced
        pendingDeletes.forEach((id) => deletedIds.delete(id));
        saveDeletedToLocal();
        console.log("Pushed merged notes to cloud:", mergedArray.length);
        // update last saved UI for selected
        const cur = notes.find((n) => n.id === currentNoteId);
        if (cur && lastSavedEl)
          lastSavedEl.textContent = `Last saved: ${formatTime(cur.updatedAt)}`;
      } catch (e) {
        console.error("Cloud push error:", e);
      }
    }, CLOUD_DEBOUNCE_MS);
  }

  // Start real-time listener for user's doc
  function startRealtimeSync(uid) {
    stopRealtimeSync();
    try {
      const userRef = db.collection("users").doc(uid);
      unsubscribeSnapshot = userRef.onSnapshot(
        (doc) => {
          if (!doc.exists) return;
          const data = doc.data() || {};
          const remote = data.notes || [];
          const remoteDeleted = data.deletedIds || [];
          mergeRemoteNotesArray(remote, remoteDeleted);
        },
        (err) => {
          console.error("Snapshot error:", err);
        }
      );

      // initial pull
      userRef
        .get()
        .then((doc) => {
          if (doc.exists) {
            const data = doc.data() || {};
            const remote = data.notes || [];
            const remoteDeleted = data.deletedIds || [];
            mergeRemoteNotesArray(remote, remoteDeleted);
          } else {
            // if no remote document exists, push local to cloud
            scheduleCloudPush();
          }
        })
        .catch((err) => console.error("Initial pull error:", err));
    } catch (e) {
      console.error("startRealtimeSync error:", e);
    }
  }

  function stopRealtimeSync() {
    if (typeof unsubscribeSnapshot === "function") {
      try {
        unsubscribeSnapshot();
      } catch (_) {}
      unsubscribeSnapshot = null;
    }
    if (cloudDebounce) {
      clearTimeout(cloudDebounce);
      cloudDebounce = null;
    }
  }

  ///// auth actions /////
  async function toggleAuth() {
    const user = auth.currentUser;
    if (user) {
      try {
        await auth.signOut();
        console.log("Signed out");
      } catch (e) {
        console.error("Sign out error", e);
        alert("Sign out failed.");
      }
      return;
    }

    try {
      await auth.signInWithPopup(provider);
      console.log("Signed in");
    } catch (err) {
      console.error("Sign-in error", err);
      if (err.code === "auth/popup-blocked") {
        alert("Popup blocked. Allow popups and retry.");
      } else if (err.code === "auth/unauthorized-domain") {
        alert(
          "Add this domain to Firebase Console > Authentication > Authorized domains."
        );
      } else {
        alert("Sign-in failed: " + (err.message || err.code || "unknown"));
      }
    }
  }

  auth.onAuthStateChanged(
    (user) => {
      console.log("Auth state change:", user ? user.email : "signed out");
      if (user) {
        // UI
        if (userInfoEl) userInfoEl.classList.remove("hidden");
        if (userNameEl)
          userNameEl.textContent = user.displayName || user.email || "";
        if (userPhotoEl) userPhotoEl.src = user.photoURL || "";
        if (authBtn) authBtn.textContent = "Sign out";

        // start cloud sync
        startRealtimeSync(user.uid);
        // ensure local wins if it's newer
        scheduleCloudPush();
      } else {
        if (userInfoEl) userInfoEl.classList.add("hidden");
        if (authBtn) authBtn.textContent = "Sign in with Google";
        stopRealtimeSync();
      }
    },
    (err) => {
      console.error("Auth observer error:", err);
    }
  );

  ///// event wiring /////
  if (newNoteBtn)
    newNoteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      createNote();
    });
  if (deleteBtn)
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      deleteCurrentNote();
    });
  if (exportBtn)
    exportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      exportNotes();
    });
  if (importBtn)
    importBtn.addEventListener("click", (e) => {
      e.preventDefault();
      importInput && importInput.click();
    });
  if (importInput)
    importInput.addEventListener("change", (e) => {
      handleImportFile(e.target.files[0]);
      e.target.value = "";
    });

  if (searchInput)
    searchInput.addEventListener("input", (e) => {
      renderNotes(e.target.value);
    });
  if (authBtn)
    authBtn.addEventListener("click", (e) => {
      e.preventDefault();
      toggleAuth();
    });

  if (themeToggle)
    themeToggle.addEventListener("click", (e) => {
      e.preventDefault();
      const current =
        document.documentElement.getAttribute("data-theme") || "light";
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (_) {}
    });

  if (refreshBtn)
    refreshBtn.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.reload();
    });

  if (noteTitleEl) noteTitleEl.addEventListener("input", scheduleLocalSave);
  if (noteBodyEl) noteBodyEl.addEventListener("input", scheduleLocalSave);

  // keyboard shortcut: new note
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
      e.preventDefault();
      createNote();
    }
  });

  ///// boot from local /////
  initTheme();
  loadDeletedFromLocal();
  loadFromLocal();
  renderNotes();
  if (notes.length > 0) {
    selectNote(notes[0].id);
  } else {
    // keep editor disabled
    noteTitleEl.value = "";
    noteBodyEl.value = "";
    noteTitleEl.disabled = true;
    noteBodyEl.disabled = true;
    if (lastSavedEl) lastSavedEl.textContent = "";
  }

  console.log("Notes app ready. Local notes:", notes.length);
} // end startApp

// Start init
initApp();
