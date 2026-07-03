import {
  getUserAvatars,
  setUserAvatar,
  user_avatar,
} from "/scripts/personas.js";
import { getThumbnailUrl } from "/script.js";

import { getPersonaSortMode, setPersonaSortMode } from "../../core/mode.js";
import { el } from "./dom.js";
import { UI_EVENTS } from "../uiBus.js";
import {
  getFolders,
  getPersonaFolder,
  getPersonaFolderMap,
  removePersonaFromFolder,
  addPersonaToFolder,
} from "../../store/folderStore.js";
import {
  showFolderPicker,
  showCreateFolderDialog,
  showRenameFolderDialog,
  showDeleteFolderDialog,
} from "./folderPicker.js";

/**
 * @param {string} avatarId
 * @param {any} power_user
 */
function getPersonaName(power_user, avatarId) {
  return power_user?.personas?.[avatarId] ?? avatarId ?? "";
}

/**
 * @param {string} avatarId
 * @param {any} power_user
 */
function getPersonaTitle(power_user, avatarId) {
  const raw = power_user?.persona_descriptions?.[avatarId]?.title ?? "";
  return String(raw ?? "").trim();
}

/**
 * Returns persona descriptor for an avatar id (raw object stored by ST).
 * @param {any} power_user
 * @param {string} avatarId
 */
function getPersonaDescriptor(power_user, avatarId) {
  return power_user?.persona_descriptions?.[avatarId];
}

/**
 * Default is linked (legacy behavior). Only explicit `false` means unlinked.
 * @param {any} descObj
 */
function isLinkedToNative(descObj) {
  return descObj?.pme?.linkedToNative !== false;
}

/**
 * @param {any} power_user
 * @param {string} avatarId
 */
function getEffectiveDescription(power_user, avatarId) {
  const descObj = getPersonaDescriptor(power_user, avatarId);
  if (!isLinkedToNative(descObj)) {
    return String(descObj?.pme?.local?.description ?? "");
  }
  return String(descObj?.description ?? "");
}

/**
 * @param {string} avatarId
 * @param {any} power_user
 */
function getPersonaDescriptionPreview(power_user, avatarId) {
  const text = getEffectiveDescription(power_user, avatarId)
    .trim()
    .replaceAll("\n", " ");
  if (!text) return "";
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/**
 * @param {any} power_user
 * @param {string} avatarId
 */
function getDescriptionLength(power_user, avatarId) {
  return getEffectiveDescription(power_user, avatarId).trim().length;
}

/**
 * @param {any} power_user
 * @param {string} avatarId
 */
function getConnectionsCount(power_user, avatarId) {
  const conns = power_user?.persona_descriptions?.[avatarId]?.connections;
  return Array.isArray(conns) ? conns.length : 0;
}

/**
 * @param {any} power_user
 * @param {string} avatarId
 */
function hasLorebook(power_user, avatarId) {
  const raw = power_user?.persona_descriptions?.[avatarId]?.lorebook ?? "";
  return !!String(raw ?? "").trim();
}

/**
 * Sort an array of avatar IDs by the active sort mode.
 * @param {string[]} ids
 * @param {any} power
 * @param {string} sortMode
 * @returns {string[]}
 */
function sortPersonas(ids, power, sortMode) {
  return [...ids].sort((a, b) => {
    switch (sortMode) {
      case "name_asc":
        return getPersonaName(power, a).localeCompare(getPersonaName(power, b));
      case "name_desc":
        return getPersonaName(power, b).localeCompare(getPersonaName(power, a));
      case "id_asc":
        return String(a).localeCompare(String(b));
      case "id_desc":
        return String(b).localeCompare(String(a));
      case "desc_len_asc": {
        const d = getDescriptionLength(power, a) - getDescriptionLength(power, b);
        if (d !== 0) return d;
        return getPersonaName(power, a).localeCompare(getPersonaName(power, b));
      }
      case "desc_len_desc": {
        const d = getDescriptionLength(power, b) - getDescriptionLength(power, a);
        if (d !== 0) return d;
        return getPersonaName(power, a).localeCompare(getPersonaName(power, b));
      }
      case "connections_asc": {
        const d = getConnectionsCount(power, a) - getConnectionsCount(power, b);
        if (d !== 0) return d;
        return getPersonaName(power, a).localeCompare(getPersonaName(power, b));
      }
      case "connections_desc": {
        const d = getConnectionsCount(power, b) - getConnectionsCount(power, a);
        if (d !== 0) return d;
        return getPersonaName(power, a).localeCompare(getPersonaName(power, b));
      }
      case "lorebook_first": {
        const d = Number(hasLorebook(power, b)) - Number(hasLorebook(power, a));
        if (d !== 0) return d;
        return getPersonaName(power, a).localeCompare(getPersonaName(power, b));
      }
      case "lorebook_last": {
        const d = Number(hasLorebook(power, a)) - Number(hasLorebook(power, b));
        if (d !== 0) return d;
        return getPersonaName(power, a).localeCompare(getPersonaName(power, b));
      }
      default:
        return 0;
    }
  });
}

export function createPersonaList({ getPowerUser, bus }) {
  /** @type {string[]|null} */
  let personasCache = null;
  /** @type {Promise<string[]>|null} */
  let personasLoadPromise = null;

  let query = "";
  let scrollTop = 0;
  let refreshTimer = /** @type {number|undefined} */ (undefined);
  let autoScrollNext = false;

  // --- Folder navigation state ---
  /** @type {string|null} current folder view (null = root) */
  let currentFolderId = null;

  const root = el("div", "pme-card pme-personas");

  // ---- Header (title + actions) ----
  const header = el("div", "pme-card-title-row");
  const titleWrap = el("div", "pme-card-title");

  // Back button (hidden on root view)
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "menu_button menu_button_icon pme-icon-btn pme-folder-back";
  backBtn.title = "Back to all personas";
  backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
  backBtn.style.display = "none";
  backBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    currentFolderId = null;
    backBtn.style.display = "none";
    folderNameInTitle.style.display = "none";
    titleWrap.querySelector(".pme-card-title-text").textContent = "Personas ";
    bus?.emit?.(UI_EVENTS.FOLDER_NAV_CHANGED, { folderId: null });
    void renderList({ autoScroll: false });
  });

  const titleText = el("span", "pme-card-title-text", "Personas ");
  titleWrap.appendChild(titleText);
  const countEl = el("span", "pme-count", "(0)");
  titleWrap.appendChild(countEl);

  // Folder name shown in title when inside a folder
  const folderNameInTitle = el("span", "pme-folder-title-name", "");
  folderNameInTitle.style.display = "none";
  titleWrap.appendChild(folderNameInTitle);

  // Prepend back button
  titleWrap.insertBefore(backBtn, titleText);
  header.appendChild(titleWrap);

  const actions = el("div", "pme-actions");
  let nativeCreateBtn = /** @type {HTMLElement|null} */ (null);
  let nativeCreateRestore = /** @type {{ parent: HTMLElement, nextSibling: ChildNode|null } | null} */ (
    null
  );

  // Create Folder button
  const createFolderBtn = document.createElement("button");
  createFolderBtn.type = "button";
  createFolderBtn.className = "menu_button menu_button_icon pme-icon-btn pme-create-folder-btn";
  createFolderBtn.title = "Create folder";
  createFolderBtn.innerHTML = '<i class="fa-solid fa-folder-plus"></i>';
  createFolderBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const folder = await showCreateFolderDialog(bus);
    if (folder) {
      void renderList({ autoScroll: false });
    }
  });
  actions.appendChild(createFolderBtn);

  const refreshBtn = el("button", "menu_button menu_button_icon pme-icon-btn");
  refreshBtn.type = "button";
  refreshBtn.title = "Refresh list";
  refreshBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
  actions.appendChild(refreshBtn);
  header.appendChild(actions);
  root.appendChild(header);

  function attachNativeCreateButton() {
    const btn = document.getElementById("create_dummy_persona");
    if (!(btn instanceof HTMLElement)) return;

    if (!nativeCreateRestore) {
      const parent = btn.parentElement;
      if (!(parent instanceof HTMLElement)) return;
      nativeCreateRestore = {
        parent,
        nextSibling: btn.nextSibling,
      };
    }

    nativeCreateBtn = btn;
    // Put Create button to the left of Create Folder button.
    actions.insertBefore(btn, createFolderBtn);
  }

  function restoreNativeCreateButton() {
    if (!nativeCreateBtn || !nativeCreateRestore) return;
    const { parent, nextSibling } = nativeCreateRestore;
    if (nativeCreateBtn.parentElement === parent) return;
    try {
      if (nextSibling && nextSibling.parentNode === parent) {
        parent.insertBefore(nativeCreateBtn, nextSibling);
      } else {
        parent.appendChild(nativeCreateBtn);
      }
    } catch {
      // ignore
    }
  }

  // ---- Controls (search + sort) ----
  const controls = el("div", "pme-persona-controls");
  const search = el("input", "text_pole pme-persona-search");
  search.type = "search";
  search.placeholder = "Search...";

  const sort = el("select", "pme-persona-sort");
  sort.title = "Sort";
  sort.innerHTML = `
    <option value="name_asc">A-Z</option>
    <option value="name_desc">Z-A</option>
    <option value="id_asc">ID ↑</option>
    <option value="id_desc">ID ↓</option>
    <option value="desc_len_asc">Description length ↑</option>
    <option value="desc_len_desc">Description length ↓</option>
    <option value="connections_asc">Connections ↑</option>
    <option value="connections_desc">Connections ↓</option>
    <option value="lorebook_first">Lorebook first</option>
    <option value="lorebook_last">Lorebook last</option>
  `;
  controls.appendChild(search);
  controls.appendChild(sort);
  root.appendChild(controls);

  const listEl = el("div", "pme-persona-list");
  listEl.textContent = "Loading personas…";
  root.appendChild(listEl);

  async function loadPersonas() {
    if (personasCache) return personasCache;
    if (personasLoadPromise) return personasLoadPromise;
    personasLoadPromise = (async () => {
      const list = await getUserAvatars(false);
      const raw = [...(Array.isArray(list) ? list : [])];
      personasCache = raw;
      return raw;
    })().finally(() => {
      personasLoadPromise = null;
    });
    return personasLoadPromise;
  }

  // ---- Folder row builder ----
  /**
   * @param {any} power
   * @param {{id:string, name:string, description:string, personaIds:string[]}} folder
   * @returns {HTMLElement}
   */
  function buildFolderRow(power, folder) {
    const row = el("div", "pme-folder");
    row.dataset.folderId = folder.id;
    row.draggable = true;

    // 2x2 avatar grid
    const avatarGrid = el("div", "pme-folder-avatar-grid");
    const preview = folder.personaIds.slice(0, 4);
    for (let i = 0; i < 4; i++) {
      const slot = el("div", "pme-folder-avatar-slot");
      if (preview[i]) {
        const img = document.createElement("img");
        img.className = "pme-folder-avatar-mini";
        img.alt = "";
        img.loading = "lazy";
        img.src = getThumbnailUrl("persona", preview[i]);
        slot.appendChild(img);
      } else {
        slot.classList.add("pme-folder-avatar-empty");
      }
      avatarGrid.appendChild(slot);
    }
    row.appendChild(avatarGrid);

    // Meta
    const meta = el("div", "pme-folder-meta");
    const nameRow = el("div", "pme-folder-name-row");
    nameRow.appendChild(el("div", "pme-folder-name", folder.name));

    // Folder action icons (rename, delete)
    const folderActions = el("div", "pme-folder-actions");
    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "menu_button menu_button_icon pme-icon-btn pme-folder-rename-btn";
    renameBtn.title = "Rename folder";
    renameBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
    renameBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newName = await showRenameFolderDialog(folder.id, folder.name, bus);
      if (newName) void renderList({ autoScroll: false });
    });
    folderActions.appendChild(renameBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "menu_button menu_button_icon pme-icon-btn pme-folder-delete-btn";
    deleteBtn.title = "Delete folder";
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const deleted = await showDeleteFolderDialog(folder.id, folder.name, bus);
      if (deleted) void renderList({ autoScroll: false });
    });
    folderActions.appendChild(deleteBtn);

    nameRow.appendChild(folderActions);
    meta.appendChild(nameRow);

    // Folder description
    const desc = String(folder.description ?? "").trim();
    if (desc) {
      meta.appendChild(el("div", "pme-folder-desc", desc));
    }

    // Count badge
    meta.appendChild(el("div", "pme-folder-count", `${folder.personaIds.length} persona${folder.personaIds.length === 1 ? "" : "s"}`));
    row.appendChild(meta);

    // Click → navigate into folder
    row.addEventListener("click", (e) => {
      // Don't navigate if clicking action buttons
      if (e.target instanceof HTMLElement && e.target.closest(".pme-folder-actions")) return;
      currentFolderId = folder.id;
      backBtn.style.display = "";
      folderNameInTitle.style.display = "";
      folderNameInTitle.textContent = ` › ${folder.name}`;
      titleText.textContent = "";
      bus?.emit?.(UI_EVENTS.FOLDER_NAV_CHANGED, { folderId: folder.id });
      void renderList({ autoScroll: true });
    });

    // Drag-and-drop: persona dropped onto folder
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      row.classList.add("pme-folder-drag-over");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("pme-folder-drag-over");
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("pme-folder-drag-over");
      const personaId = e.dataTransfer?.getData("text/pme-persona-id");
      if (!personaId) return;
      addPersonaToFolder(folder.id, personaId);
      bus?.emit?.(UI_EVENTS.PERSONA_FOLDER_CHANGED, { personaId, folderId: folder.id });
      void renderList({ autoScroll: false });
    });

    return row;
  }

  // ---- Persona row builder ----
  /**
   * @param {any} power
   * @param {string} id
   * @param {{inFolder: boolean}} [opts]
   * @returns {HTMLElement}
   */
  function buildPersonaRow(power, id, opts = {}) {
    const { inFolder = false } = opts;
    const row = el("div", "pme-persona");
    row.dataset.personaId = id;
    if (id === user_avatar) row.classList.add("is_active");
    row.draggable = true;

    const img = document.createElement("img");
    img.className = "pme-persona-avatar";
    img.alt = "";
    img.loading = "lazy";
    img.src = getThumbnailUrl("persona", id);

    const meta = el("div", "pme-persona-meta");
    const nameRow = el("div", "pme-persona-name-row");
    nameRow.appendChild(
      el("div", "pme-persona-name", getPersonaName(power, id) || "[Unnamed Persona]")
    );
    const rightMeta = el("div", "pme-persona-badges");
    const title = getPersonaTitle(power, id);
    rightMeta.appendChild(el("div", "pme-persona-title", title || ""));
    if (hasLorebook(power, id)) {
      rightMeta.appendChild(el("div", "pme-persona-lorebook", "Lorebook"));
    }
    nameRow.appendChild(rightMeta);
    meta.appendChild(nameRow);

    const preview = getPersonaDescriptionPreview(power, id);
    if (preview) meta.appendChild(el("div", "pme-persona-desc", preview));

    row.appendChild(img);
    row.appendChild(meta);

    // Hover folder-add icon (top-right corner of row)
    const folderAddBtn = document.createElement("button");
    folderAddBtn.type = "button";
    folderAddBtn.className = "menu_button menu_button_icon pme-icon-btn pme-persona-folder-add";
    if (inFolder) {
      folderAddBtn.title = "Remove from folder";
      folderAddBtn.innerHTML = '<i class="fa-solid fa-folder-minus"></i>';
      folderAddBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removePersonaFromFolder(id);
        bus?.emit?.(UI_EVENTS.PERSONA_FOLDER_CHANGED, { personaId: id, folderId: null });
        void renderList({ autoScroll: false });
      });
    } else {
      folderAddBtn.title = "Add to folder";
      folderAddBtn.innerHTML = '<i class="fa-solid fa-folder-plus"></i>';
      folderAddBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showFolderPicker(folderAddBtn, id, bus);
        // Re-render after picker closes (delayed to catch async operations)
        setTimeout(() => {
          if (currentFolderId) void renderList({ autoScroll: false });
        }, 500);
      });
    }
    row.appendChild(folderAddBtn);

    // Drag persona
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/pme-persona-id", id);
      row.classList.add("pme-persona-dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("pme-persona-dragging");
    });

    return row;
  }

  // ---- Main render ----
  async function renderList({ autoScroll = false } = {}) {
    const preserveScroll = scrollTop;
    const power = getPowerUser();
    const personas = await loadPersonas();
    const q = String(query ?? "").trim().toLowerCase();

    // --- Search: flat results (ignore folders) ---
    if (q) {
      const filtered = personas.filter((id) => {
        const name = getPersonaName(power, id).toLowerCase();
        const desc = getPersonaDescriptionPreview(power, id).toLowerCase();
        return (
          name.includes(q) ||
          desc.includes(q) ||
          String(id).toLowerCase().includes(q)
        );
      });
      const sortMode = getPersonaSortMode();
      const sorted = sortPersonas(filtered, power, sortMode);

      listEl.innerHTML = "";
      countEl.textContent = `(${sorted.length})`;
      if (!sorted.length) {
        listEl.appendChild(el("div", "text_muted", "No personas found."));
        return;
      }

      // Hide back button, show "Personas" title
      backBtn.style.display = "none";
      folderNameInTitle.style.display = "none";
      titleText.textContent = "Personas ";

      for (const id of sorted) {
        listEl.appendChild(buildPersonaRow(power, id));
      }

      listEl.scrollTop = preserveScroll;
      scrollTop = preserveScroll;
      return;
    }

    // --- No search: folder nav view ---
    const sortMode = getPersonaSortMode();
    const folderMap = getPersonaFolderMap();
    const folders = [...getFolders()].sort((a, b) => a.name.localeCompare(b.name));

    // --- Inside a folder: only show that folder's personas ---
    if (currentFolderId) {
      const folder = folders.find((f) => f.id === currentFolderId);
      if (!folder) {
        // Folder was deleted, go back to root
        currentFolderId = null;
        backBtn.style.display = "none";
        folderNameInTitle.style.display = "none";
        titleText.textContent = "Personas ";
        void renderList({ autoScroll });
        return;
      }

      // Filter to only persona IDs that actually exist
      const validIds = folder.personaIds.filter((id) => personas.includes(id));
      const sorted = sortPersonas(validIds, power, sortMode);

      listEl.innerHTML = "";
      countEl.textContent = `(${sorted.length})`;

      // Update title
      backBtn.style.display = "";
      folderNameInTitle.style.display = "";
      folderNameInTitle.textContent = ` › ${folder.name}`;
      titleText.textContent = "";

      if (!sorted.length) {
        listEl.appendChild(el("div", "text_muted", "This folder is empty."));
      }

      for (const id of sorted) {
        listEl.appendChild(buildPersonaRow(power, id, { inFolder: true }));
      }

      if (autoScroll) {
        const active = listEl.querySelector(".pme-persona.is_active");
        if (active instanceof HTMLElement)
          active.scrollIntoView({ block: "nearest" });
        scrollTop = listEl.scrollTop;
      } else {
        listEl.scrollTop = preserveScroll;
        scrollTop = preserveScroll;
      }
      return;
    }

    // --- Root view: folders at top (alphabetical), then unfolded personas ---
    const foldedIds = new Set(Object.values(folderMap));
    const unfolded = personas.filter((id) => !foldedIds.has(id));
    const sortedUnfolded = sortPersonas(unfolded, power, sortMode);

    listEl.innerHTML = "";

    // Update title
    backBtn.style.display = "none";
    folderNameInTitle.style.display = "none";
    titleText.textContent = "Personas ";

    // Folders first
    for (const folder of folders) {
      // Only show folders that have at least one valid persona
      const validCount = folder.personaIds.filter((id) => personas.includes(id)).length;
      if (validCount === 0 && folder.personaIds.length === 0) continue; // hide empty folders? or show them? show them for now
      listEl.appendChild(buildFolderRow(power, folder));
    }

    // Then unfolded personas
    countEl.textContent = `(${personas.length})`;
    for (const id of sortedUnfolded) {
      listEl.appendChild(buildPersonaRow(power, id));
    }

    if (autoScroll) {
      const active = listEl.querySelector(".pme-persona.is_active");
      if (active instanceof HTMLElement)
        active.scrollIntoView({ block: "nearest" });
      scrollTop = listEl.scrollTop;
    } else {
      listEl.scrollTop = preserveScroll;
      scrollTop = preserveScroll;
    }
  }

  function scheduleRefresh({
    invalidateCache = true,
    autoScroll = false,
  } = {}) {
    autoScrollNext ||= autoScroll;
    if (invalidateCache) personasCache = null;
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      void renderList({ autoScroll: autoScrollNext });
      autoScrollNext = false;
    }, 150);
  }

  function setActiveVisual(id) {
    listEl
      .querySelectorAll(".pme-persona")
      .forEach((n) => n.classList.remove("is_active"));
    const row = listEl.querySelector(`[data-persona-id="${CSS.escape(id)}"]`);
    if (row instanceof HTMLElement) row.classList.add("is_active");
  }

  // ---- Events ----
  listEl.addEventListener("scroll", () => {
    scrollTop = listEl.scrollTop;
  });

  refreshBtn.addEventListener("click", async () => {
    personasCache = null;
    await renderList();
  });

  let searchTimer = /** @type {number|undefined} */ (undefined);
  search.addEventListener("input", () => {
    query = String(search.value ?? "");
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchTimer = undefined;
      void renderList();
    }, 120);
  });

  sort.addEventListener("change", () => {
    setPersonaSortMode(/** @type {any} */ (sort.value));
    void renderList();
  });

  listEl.addEventListener("click", async (ev) => {
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    const row = target?.closest?.("[data-persona-id]");
    if (!(row instanceof HTMLElement)) return;
    // Don't switch persona if clicking the folder-add button
    if (target?.closest?.(".pme-persona-folder-add")) return;
    const id = row.dataset.personaId;
    if (!id) return;
    if (id === user_avatar) return;

    setActiveVisual(id);
    try {
      await setUserAvatar(id, {
        toastPersonaNameChange: false,
        navigateToCurrent: false,
      });
    } finally {
      scheduleRefresh({ invalidateCache: false, autoScroll: false });
      bus?.emit?.(UI_EVENTS.PERSONA_CHANGED, { avatarId: id });
    }
  });

  // ---- Bus wiring for folder events ----
  bus?.on?.(UI_EVENTS.FOLDER_CREATED, () => {
    void renderList({ autoScroll: false });
  });
  bus?.on?.(UI_EVENTS.FOLDER_DELETED, () => {
    if (currentFolderId) {
      // Check if current folder still exists
      const folders = getFolders();
      if (!folders.find((f) => f.id === currentFolderId)) {
        currentFolderId = null;
        backBtn.style.display = "none";
        folderNameInTitle.style.display = "none";
        titleText.textContent = "Personas ";
      }
    }
    void renderList({ autoScroll: false });
  });
  bus?.on?.(UI_EVENTS.FOLDER_CHANGED, () => {
    void renderList({ autoScroll: false });
  });
  bus?.on?.(UI_EVENTS.PERSONA_FOLDER_CHANGED, () => {
    void renderList({ autoScroll: false });
  });

  return {
    el: root,
    mount({ autoScroll = false } = {}) {
      attachNativeCreateButton();
      search.value = query;
      sort.value = getPersonaSortMode();
      autoScrollNext = autoScroll;
      void renderList({ autoScroll });
    },
    update({ invalidateCache = false, autoScroll = false } = {}) {
      scheduleRefresh({ invalidateCache, autoScroll });
    },
    updatePreviewOnly() {
      scheduleRefresh({ invalidateCache: false, autoScroll: false });
    },
    destroy() {
      restoreNativeCreateButton();
    },
  };
}
