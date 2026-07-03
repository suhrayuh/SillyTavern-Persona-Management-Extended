/**
 * Persona Folders — global folder storage.
 *
 * Folders are a GLOBAL concept (not per-persona). They organize personas
 * into groups for display in the persona list. Stored in extension_settings
 * so they sync with ST settings.
 */

import { saveSettingsDebounced } from "/script.js";
import { extension_settings } from "/scripts/extensions.js";

const SETTINGS_KEY = "personaManagementExtended";

/**
 * @typedef {object} PersonaFolder
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string[]} personaIds — ordered list of avatar IDs in this folder
 * @property {boolean} collapsed — reserved for future use (not currently used; nav-based)
 */

let saveTimer = undefined;

function scheduleSave() {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    saveSettingsDebounced();
  }, 200);
}

function makeId() {
  return `folder_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Returns (and initializes) the global folders array.
 * @returns {PersonaFolder[]}
 */
export function getFolders() {
  extension_settings[SETTINGS_KEY] ??= {};
  const ext = extension_settings[SETTINGS_KEY];
  ext.folders ??= [];
  if (!Array.isArray(ext.folders)) ext.folders = [];

  // Defensive normalization
  for (const f of ext.folders) {
    f.id = String(f.id ?? "").trim() || makeId();
    f.name = String(f.name ?? "").trim() || "Untitled Folder";
    f.description = String(f.description ?? "");
    f.personaIds ??= [];
    if (!Array.isArray(f.personaIds)) f.personaIds = [];
    f.personaIds = f.personaIds.map((x) => String(x ?? "").trim()).filter(Boolean);
  }

  return ext.folders;
}

/**
 * Create a new folder.
 * @param {string} name
 * @param {string} [description]
 * @returns {PersonaFolder}
 */
export function createFolder(name, description = "") {
  const folders = getFolders();
  const folder = {
    id: makeId(),
    name: String(name ?? "").trim() || "New Folder",
    description: String(description ?? ""),
    personaIds: [],
    collapsed: false,
  };
  folders.push(folder);
  scheduleSave();
  return folder;
}

/**
 * Delete a folder. Personas are NOT deleted — just ungrouped.
 * @param {string} folderId
 */
export function deleteFolder(folderId) {
  const folders = getFolders();
  const idx = folders.findIndex((f) => f.id === folderId);
  if (idx === -1) return;
  folders.splice(idx, 1);
  scheduleSave();
}

/**
 * Rename a folder.
 * @param {string} folderId
 * @param {string} name
 */
export function renameFolder(folderId, name) {
  const folders = getFolders();
  const f = folders.find((x) => x.id === folderId);
  if (!f) return;
  f.name = String(name ?? "").trim() || "Untitled Folder";
  scheduleSave();
}

/**
 * Update folder description.
 * @param {string} folderId
 * @param {string} description
 */
export function updateFolderDescription(folderId, description) {
  const folders = getFolders();
  const f = folders.find((x) => x.id === folderId);
  if (!f) return;
  f.description = String(description ?? "");
  scheduleSave();
}

/**
 * Add a persona to a folder. If the persona is already in another folder,
 * it is removed from the old one first (a persona can only be in one folder).
 * @param {string} folderId
 * @param {string} personaId
 * @returns {PersonaFolder|null}
 */
export function addPersonaToFolder(folderId, personaId) {
  const folders = getFolders();
  const target = folders.find((f) => f.id === folderId);
  if (!target) return null;

  // Remove from any existing folder first
  for (const f of folders) {
    if (f.id === folderId) continue;
    const idx = f.personaIds.indexOf(personaId);
    if (idx !== -1) f.personaIds.splice(idx, 1);
  }

  // Don't add duplicates
  if (!target.personaIds.includes(personaId)) {
    target.personaIds.push(personaId);
  }

  scheduleSave();
  return target;
}

/**
 * Remove a persona from its folder (if any).
 * @param {string} personaId
 */
export function removePersonaFromFolder(personaId) {
  const folders = getFolders();
  let changed = false;
  for (const f of folders) {
    const idx = f.personaIds.indexOf(personaId);
    if (idx !== -1) {
      f.personaIds.splice(idx, 1);
      changed = true;
      break;
    }
  }
  if (changed) scheduleSave();
}

/**
 * Get the folder a persona belongs to (if any).
 * @param {string} personaId
 * @returns {PersonaFolder|null}
 */
export function getPersonaFolder(personaId) {
  const folders = getFolders();
  for (const f of folders) {
    if (f.personaIds.includes(personaId)) return f;
  }
  return null;
}

/**
 * Returns a map of personaId → folderId for quick lookup.
 * @returns {Record<string, string>}
 */
export function getPersonaFolderMap() {
  const folders = getFolders();
  /** @type {Record<string, string>} */
  const map = {};
  for (const f of folders) {
    for (const pid of f.personaIds) {
      map[pid] = f.id;
    }
  }
  return map;
}

/**
 * Get folder by ID.
 * @param {string} folderId
 * @returns {PersonaFolder|null}
 */
export function getFolderById(folderId) {
  const folders = getFolders();
  return folders.find((f) => f.id === folderId) ?? null;
}
