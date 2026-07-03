/**
 * Folder picker dropdown + create/rename/delete dialogs.
 * Shared between personaList (hover icon) and currentPersonaPanel (button).
 */

import { el } from "./dom.js";
import { UI_EVENTS } from "../uiBus.js";
import {
  getFolders,
  getPersonaFolder,
  createFolder,
  renameFolder,
  deleteFolder,
  addPersonaToFolder,
  removePersonaFromFolder,
} from "../../store/folderStore.js";
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from "/scripts/popup.js";

/**
 * Show a floating folder picker dropdown near an anchor element.
 * Handles add/remove/move operations internally and emits bus events.
 * @param {HTMLElement} anchorEl
 * @param {string} personaId
 * @param {{emit: Function}} bus
 */
export function showFolderPicker(anchorEl, personaId, bus) {
  // Close any existing picker
  document
    .querySelectorAll(".pme-folder-picker")
    .forEach((n) => n.remove());

  const picker = el("div", "pme-folder-picker");
  const currentFolder = getPersonaFolder(personaId);
  const folders = [...getFolders()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  if (folders.length > 0) {
    for (const f of folders) {
      const item = el("div", "pme-folder-picker-item");
      if (currentFolder?.id === f.id) item.classList.add("is-current");

      const folderIcon = document.createElement("i");
      folderIcon.className = "fa-solid fa-folder";
      item.appendChild(folderIcon);
      item.appendChild(el("span", "pme-folder-picker-label", f.name));

      if (currentFolder?.id === f.id) {
        const check = document.createElement("i");
        check.className =
          "fa-solid fa-check pme-folder-picker-check";
        item.appendChild(check);
      }

      item.addEventListener("click", () => {
        if (currentFolder?.id === f.id) {
          // Already in this folder — close
          picker.remove();
          return;
        }
        addPersonaToFolder(f.id, personaId);
        bus?.emit?.(UI_EVENTS.PERSONA_FOLDER_CHANGED, {
          personaId,
          folderId: f.id,
        });
        picker.remove();
      });
      picker.appendChild(item);
    }
    picker.appendChild(el("div", "pme-folder-picker-divider"));
  }

  // Create new folder option
  const createItem = el(
    "div",
    "pme-folder-picker-item pme-folder-picker-create"
  );
  {
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-folder-plus";
    createItem.appendChild(icon);
    createItem.appendChild(
      el("span", "pme-folder-picker-label", "Create new folder...")
    );
  }
  createItem.addEventListener("click", async () => {
    picker.remove();
    const folder = await showCreateFolderDialog(bus);
    if (folder) {
      addPersonaToFolder(folder.id, personaId);
      bus?.emit?.(UI_EVENTS.PERSONA_FOLDER_CHANGED, {
        personaId,
        folderId: folder.id,
      });
    }
  });
  picker.appendChild(createItem);

  // Remove from folder option (if currently in a folder)
  if (currentFolder) {
    picker.appendChild(el("div", "pme-folder-picker-divider"));
    const removeItem = el(
      "div",
      "pme-folder-picker-item pme-folder-picker-remove"
    );
    {
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-folder-minus";
      removeItem.appendChild(icon);
      removeItem.appendChild(
        el(
          "span",
          "pme-folder-picker-label",
          `Remove from "${currentFolder.name}"`
        )
      );
    }
    removeItem.addEventListener("click", () => {
      removePersonaFromFolder(personaId);
      bus?.emit?.(UI_EVENTS.PERSONA_FOLDER_CHANGED, {
        personaId,
        folderId: null,
      });
      picker.remove();
    });
    picker.appendChild(removeItem);
  }

  // Position near anchor
  const rect = anchorEl.getBoundingClientRect();
  picker.style.position = "fixed";
  picker.style.zIndex = "100000";
  picker.style.top = `${rect.bottom + 4}px`;
  const pickerWidth = 240;
  let left = rect.right - pickerWidth;
  if (left < 8) left = 8;
  picker.style.left = `${left}px`;

  // Copy theme colors from PME root (inside ST's themed area)
  const themedEl = document.getElementById("pme_root") || document.getElementById("PersonaManagement") || document.body;
  const themedStyle = getComputedStyle(themedEl);
  picker.style.background = themedStyle.backgroundColor || "var(--SmartThemeBodyColor, #1a1a2e)";
  picker.style.color = themedStyle.color || "";
  picker.style.borderColor = getComputedStyle(themedEl).getPropertyValue("--SmartThemeBorderColor").trim() || "rgba(255,255,255,0.15)";

  document.body.appendChild(picker);

  // Prevent clicks inside picker from closing ST's drawer
  picker.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  }, true);

  // Close on outside click or escape
  requestAnimationFrame(() => {
    const clickHandler = (e) => {
      if (!picker.contains(/** @type {Node} */ (e.target))) {
        picker.remove();
        document.removeEventListener("mousedown", clickHandler, true);
      }
    };
    document.addEventListener("mousedown", clickHandler, true);

    const escHandler = (e) => {
      if (e.key === "Escape") {
        picker.remove();
        document.removeEventListener("keydown", escHandler);
        document.removeEventListener("mousedown", clickHandler, true);
      }
    };
    document.addEventListener("keydown", escHandler);
  });
}

/**
 * Show a popup dialog to create a new folder.
 * @param {{emit: Function}} bus
 * @returns {Promise<import("../../store/folderStore.js").PersonaFolder|null>}
 */
export async function showCreateFolderDialog(bus) {
  const content = el("div", "pme-create-folder-dialog");
  content.appendChild(
    el("div", "pme-create-folder-hint", "Create a new persona folder.")
  );

  const nameLabel = el("label", "pme-create-folder-label", "Folder Name");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "text_pole";
  nameInput.placeholder = "My Folder";
  nameInput.autocomplete = "off";

  const descLabel = el(
    "label",
    "pme-create-folder-label",
    "Description (optional)"
  );
  const descInput = document.createElement("textarea");
  descInput.className = "text_pole";
  descInput.rows = 3;
  descInput.placeholder = "A short description of this folder...";

  content.appendChild(nameLabel);
  content.appendChild(nameInput);
  content.appendChild(descLabel);
  content.appendChild(descInput);

  // Focus the name input after popup opens
  setTimeout(() => nameInput.focus(), 100);

  const result = await callGenericPopup(content, POPUP_TYPE.CONFIRM, "", {
    okButton: "Create",
    cancelButton: "Cancel",
    wide: true,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    const folder = createFolder(nameInput.value, descInput.value);
    bus?.emit?.(UI_EVENTS.FOLDER_CREATED, { folderId: folder.id });
    return folder;
  }
  return null;
}

/**
 * Show a popup dialog to rename a folder.
 * @param {string} folderId
 * @param {string} currentName
 * @param {{emit: Function}} bus
 * @returns {Promise<string|null>}
 */
export async function showRenameFolderDialog(folderId, currentName, bus) {
  const content = el("div", "");
  content.appendChild(el("div", "", "Rename folder:"));

  const input = document.createElement("input");
  input.type = "text";
  input.className = "text_pole";
  input.value = currentName;
  input.autocomplete = "off";

  content.appendChild(input);
  setTimeout(() => {
    input.focus();
    input.select();
  }, 100);

  const result = await callGenericPopup(content, POPUP_TYPE.CONFIRM, "", {
    okButton: "Rename",
    cancelButton: "Cancel",
    wide: true,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    renameFolder(folderId, input.value);
    bus?.emit?.(UI_EVENTS.FOLDER_CHANGED, { folderId });
    return input.value;
  }
  return null;
}

/**
 * Show a confirmation dialog to delete a folder.
 * @param {string} folderId
 * @param {string} folderName
 * @param {{emit: Function}} bus
 * @returns {Promise<boolean>}
 */
export async function showDeleteFolderDialog(folderId, folderName, bus) {
  const content = el("div", "text_pole");
  content.appendChild(
    el(
      "p",
      "",
      `Delete folder "${folderName}"?`
    )
  );
  content.appendChild(
    el(
      "p",
      "",
      "Personas inside will not be deleted — they will just return to the unsorted list."
    )
  );

  const result = await callGenericPopup(content, POPUP_TYPE.CONFIRM, "", {
    okButton: "Delete",
    cancelButton: "Cancel",
    wide: true,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    deleteFolder(folderId);
    bus?.emit?.(UI_EVENTS.FOLDER_DELETED, { folderId });
    return true;
  }
  return false;
}
