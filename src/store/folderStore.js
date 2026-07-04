/**
 * Persona Folders — global folder storage.
 *
 * Folders are a GLOBAL concept (not per-persona). They organize personas
 * into groups for display in the persona list. Stored in extension_settings
 * so they sync with ST settings.
 *
 * A persona can be in MULTIPLE folders.
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
 * Add a persona to a folder. Personas can be in multiple folders.
 * Does NOT remove from other folders.
 * @param {string} folderId
 * @param {string} personaId
 * @returns {PersonaFolder|null}
 */
export function addPersonaToFolder(folderId, personaId) {
  const folders = getFolders();
  const target = folders.find((f) => f.id === folderId);
  if (!target) return null;

  // Don't add duplicates
  if (!target.personaIds.includes(personaId)) {
    target.personaIds.push(personaId);
  }

  scheduleSave();
  return target;
}

/**
 * Remove a persona from a specific folder.
 * @param {string} folderId
 * @param {string} personaId
 */
export function removePersonaFromFolder(folderId, personaId) {
  const folders = getFolders();
  const f = folders.find((x) => x.id === folderId);
  if (!f) return;
  const idx = f.personaIds.indexOf(personaId);
  if (idx !== -1) {
    f.personaIds.splice(idx, 1);
    scheduleSave();
  }
}

/**
 * Toggle a persona's membership in a folder.
 * @param {string} folderId
 * @param {string} personaId
 * @returns {boolean} true if now in folder, false if removed
 */
export function togglePersonaInFolder(folderId, personaId) {
  const folders = getFolders();
  const f = folders.find((x) => x.id === folderId);
  if (!f) return false;
  const idx = f.personaIds.indexOf(personaId);
  if (idx !== -1) {
    f.personaIds.splice(idx, 1);
    scheduleSave();
    return false;
  }
  f.personaIds.push(personaId);
  scheduleSave();
  return true;
}

/**
 * Get all folders a persona belongs to (can be multiple).
 * @param {string} personaId
 * @returns {PersonaFolder[]}
 */
export function getPersonaFolders(personaId) {
  const folders = getFolders();
  return folders.filter((f) => f.personaIds.includes(personaId));
}

/**
 * Check if a persona is in a specific folder.
 * @param {string} folderId
 * @param {string} personaId
 * @returns {boolean}
 */
export function isPersonaInFolder(folderId, personaId) {
  const folders = getFolders();
  const f = folders.find((x) => x.id === folderId);
  return f ? f.personaIds.includes(personaId) : false;
}

/**
 * Returns a map of personaId → folderId[] for quick lookup.
 * A persona can map to multiple folder IDs.
 * @returns {Record<string, string[]>}
 */
export function getPersonaFolderMap() {
  const folders = getFolders();
  /** @type {Record<string, string[]>} */
  const map = {};
  for (const f of folders) {
    for (const pid of f.personaIds) {
      (map[pid] ??= []).push(f.id);
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
