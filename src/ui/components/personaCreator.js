import { saveSettingsDebounced } from "/script.js";
import { ConnectionManagerRequestService } from "/scripts/extensions/shared.js";
import {
  initPersona,
  setUserAvatar,
  getCurrentConnectionObj,
  getUserAvatars,
} from "/scripts/personas.js";
import { characters, this_chid, getRequestHeaders } from "/script.js";
import { power_user } from "/scripts/power-user.js";

import {
  getCreatorSettings,
  patchCreatorSettings,
  getCreatorDefaultPrompt,
} from "../../store/personaStore.js";
import { el, setHidden } from "./dom.js";
import {
  callGenericPopup,
  POPUP_TYPE,
  POPUP_RESULT,
} from "/scripts/popup.js";

function substituteMacros(template, personaName) {
  const char = characters[Number(this_chid)];
  const vars = {
    char: char?.name ?? "",
    description: char?.description ?? "",
    personaName: personaName ?? "",
  };
  let result = template;
  // Process {{#if var}}...{{/if}}
  result = result.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/gi, (_match, key, content) => {
    return vars[key] ? content : "";
  });
  // Process {{#unless var}}...{{/unless}}
  result = result.replace(/\{\{#unless (\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/gi, (_match, key, content) => {
    return vars[key] ? "" : content;
  });
  // Process simple {{var}} replacements
  result = result.replace(/\{\{char\}\}/gi, vars.char);
  result = result.replace(/\{\{description\}\}/gi, vars.description);
  result = result.replace(/\{\{personaName\}\}/gi, vars.personaName);
  return result;
}

function extractPersonaName(text) {
  const firstLine = String(text ?? "").split("\n")[0].trim();
  const match = firstLine.match(/^(?:Name|Persona):\s*(.+)/i);
  return (match ? match[1].trim() : firstLine).replace(/[*#_`]/g, "").trim();
}

function makeId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function uploadAvatar(avatarId, base64Data) {
  try {
    const resp = await fetch(base64Data);
    const blob = await resp.blob();
    const file = new File([blob], "avatar.png", { type: "image/png" });
    const formData = new FormData();
    formData.append("avatar", file);
    formData.append("overwrite_name", avatarId);
    const uploadResp = await fetch("/api/avatars/upload", {
      method: "POST",
      headers: getRequestHeaders({ omitContentType: true }),
      cache: "no-cache",
      body: formData,
    });
    if (!uploadResp.ok) throw new Error(uploadResp.statusText);
    return true;
  } catch (e) {
    console.error("[PME] Avatar upload failed:", e);
    return false;
  }
}

export function createPersonaCreatorCard() {
  let collapsed = true;
  let imageDataUrl = null;
  let generating = false;

  const settings = getCreatorSettings();

  const root = el("div", "pme-card pme-creator-card");

  // --- Header ---
  const header = el("div", "pme-card-title-row");
  header.appendChild(el("div", "pme-card-title", "Create Persona"));
  const actions = el("div", "pme-actions");
  const collapseBtn = el("button", "menu_button menu_button_icon pme-icon-btn");
  collapseBtn.type = "button";
  actions.appendChild(collapseBtn);
  header.appendChild(actions);
  root.appendChild(header);

  const body = el("div", "pme-creator-body");
  root.appendChild(body);

  // --- Connection Profile ---
  body.appendChild(el("label", "", "Connection Profile"));
  const profileSelect = document.createElement("select");
  profileSelect.className = "text_pole pme-creator-select";
  body.appendChild(profileSelect);

  // --- Prompt Template ---
  body.appendChild(el("label", "", "Prompt Template"));
  const promptRow = el("div", "pme-creator-prompt-row");
  const promptSelect = document.createElement("select");
  promptSelect.className = "text_pole pme-creator-select";
  promptRow.appendChild(promptSelect);

  const renameBtn = el("button", "menu_button menu_button_icon pme-icon-btn");
  renameBtn.type = "button";
  renameBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
  renameBtn.title = "Rename prompt";
  promptRow.appendChild(renameBtn);

  const newBtn = el("button", "menu_button menu_button_icon pme-icon-btn");
  newBtn.type = "button";
  newBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
  newBtn.title = "New prompt";
  promptRow.appendChild(newBtn);

  const delBtn = el("button", "menu_button menu_button_icon pme-icon-btn");
  delBtn.type = "button";
  delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
  delBtn.title = "Delete prompt";
  promptRow.appendChild(delBtn);

  const savePromptBtn = el("button", "menu_button menu_button_icon pme-icon-btn");
  savePromptBtn.type = "button";
  savePromptBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>';
  savePromptBtn.title = "Save changes to this prompt";
  promptRow.appendChild(savePromptBtn);
  body.appendChild(promptRow);

  const promptTextarea = document.createElement("textarea");
  promptTextarea.className = "text_pole pme-creator-prompt-textarea";
  promptTextarea.rows = 6;
  promptTextarea.placeholder = "Prompt template...";
  body.appendChild(promptTextarea);

  const resetBtn = el("button", "menu_button pme-creator-reset-btn", "Reset to Default");
  resetBtn.type = "button";
  body.appendChild(resetBtn);

  body.appendChild(el("hr", "sysHR"));

  // --- Persona Name ---
  body.appendChild(el("label", "", "Persona Name"));
  const nameHint = el("span", "pme-creator-hint", " (optional — AI picks if empty)");
  body.lastChild.appendChild(nameHint);
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "text_pole";
  nameInput.placeholder = "Leave empty for AI to choose";
  body.appendChild(nameInput);

  // --- Name Pool ---
  const namePoolSection = el("div", "pme-creator-name-pool");
  const namePoolLabel = el("label", "checkbox_label pme-creator-name-toggle");
  const namePoolCheckbox = document.createElement("input");
  namePoolCheckbox.type = "checkbox";
  namePoolCheckbox.checked = settings.namePoolEnabled === true;
  namePoolLabel.appendChild(namePoolCheckbox);
  namePoolLabel.appendChild(el("span", "", "Prevent reuse of existing persona names"));
  namePoolSection.appendChild(namePoolLabel);

  const nameCarousel = el("div", "pme-creator-name-carousel displayNone");
  namePoolSection.appendChild(nameCarousel);
  body.appendChild(namePoolSection);

  // --- Additional Instructions ---
  body.appendChild(el("label", "", "Additional Instructions"));
  const extraHint = el("span", "pme-creator-hint", " (optional — appended to prompt)");
  body.lastChild.appendChild(extraHint);
  const extraInput = document.createElement("textarea");
  extraInput.className = "text_pole pme-creator-extra-input";
  extraInput.rows = 2;
  extraInput.placeholder = "e.g., she is a cat demi-human";
  body.appendChild(extraInput);

  // --- Image ---
  body.appendChild(el("label", "", "Visual Reference"));
  const imgRow = el("div", "pme-creator-img-row");
  const imgLabel = document.createElement("label");
  imgLabel.className = "menu_button menu_button_icon pme-creator-img-label";
  imgLabel.innerHTML = '<i class="fa-solid fa-paperclip"></i> Attach Image';
  const imgInput = document.createElement("input");
  imgInput.type = "file";
  imgInput.accept = "image/*";
  imgInput.style.display = "none";
  imgLabel.appendChild(imgInput);
  imgRow.appendChild(imgLabel);

  const imgPreview = document.createElement("img");
  imgPreview.className = "pme-creator-img-preview displayNone";
  imgRow.appendChild(imgPreview);

  const imgClear = el("button", "menu_button menu_button_icon pme-icon-btn displayNone");
  imgClear.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  imgClear.title = "Remove image";
  imgRow.appendChild(imgClear);
  body.appendChild(imgRow);

  // --- Max Tokens ---
  const tokenLabel = el("div", "", "Max Tokens: ");
  const tokenVal = el("span", "pme-creator-token-val", String(settings.maxTokens));
  tokenLabel.appendChild(tokenVal);
  body.appendChild(tokenLabel);
  const tokenSlider = document.createElement("input");
  tokenSlider.type = "range";
  tokenSlider.min = "256";
  tokenSlider.max = "8096";
  tokenSlider.step = "64";
  tokenSlider.value = String(settings.maxTokens);
  tokenSlider.className = "neo-range-slider";
  body.appendChild(tokenSlider);

  body.appendChild(el("hr", "sysHR"));

  // --- Link to character toggle ---
  const linkLabel = el("label", "checkbox_label pme-creator-link-toggle");
  const linkCheckbox = document.createElement("input");
  linkCheckbox.type = "checkbox";
  linkCheckbox.checked = settings.linkToCharacter === true;
  linkLabel.appendChild(linkCheckbox);
  linkLabel.appendChild(el("span", "", "Link persona to active character"));
  body.appendChild(linkLabel);

  // --- Generate button ---
  const generateBtn = el("button", "menu_button interactable pme-creator-generate-btn", "✨ Generate Persona");
  generateBtn.type = "button";
  body.appendChild(generateBtn);

  // --- Status ---
  const status = el("div", "pme-creator-status displayNone");
  body.appendChild(status);

  // --- Result preview ---
  const resultSection = el("div", "pme-creator-result displayNone");
  body.appendChild(resultSection);

  // --- Result action buttons ---
  const resultActions = el("div", "pme-creator-result-actions displayNone");
  const saveBtn = el("button", "menu_button interactable", settings.linkToCharacter ? "💾 Save & Link" : "💾 Save");
  saveBtn.type = "button";
  const retryBtn = el("button", "menu_button interactable", "🔄 Retry");
  retryBtn.type = "button";
  const discardBtn = el("button", "menu_button interactable", "✕ Discard");
  discardBtn.type = "button";
  resultActions.appendChild(saveBtn);
  resultActions.appendChild(retryBtn);
  resultActions.appendChild(discardBtn);
  body.appendChild(resultActions);

  // --- State ---
  let generatedName = null;
  let generatedDescription = null;

  // --- Helpers ---
  function populateProfiles() {
    profileSelect.innerHTML = "";
    let profiles = [];
    try { profiles = ConnectionManagerRequestService.getSupportedProfiles(); } catch { /* ignore */ }
    for (const p of profiles) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name || p.model || p.id;
      profileSelect.appendChild(opt);
    }
    if (settings.lastProfileId && profiles.some(p => p.id === settings.lastProfileId)) {
      profileSelect.value = settings.lastProfileId;
    }
    return profiles.length;
  }

  function refreshPromptSelect() {
    promptSelect.innerHTML = "";
    for (const p of settings.prompts) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      promptSelect.appendChild(opt);
    }
    if (!settings.prompts.find(p => p.id === settings.activePromptId)) {
      settings.activePromptId = settings.prompts[0]?.id ?? "default";
    }
    promptSelect.value = settings.activePromptId;
    updatePromptPreview();
  }

  function updatePromptPreview() {
    const selected = settings.prompts.find(p => p.id === promptSelect.value);
    promptTextarea.value = selected ? selected.prompt : "";
  }

  function refreshNamePool() {
    nameCarousel.innerHTML = "";
    const allNames = Object.values(power_user?.personas ?? {}).filter(Boolean);
    if (!allNames.length) {
      setHidden(nameCarousel, true);
      return;
    }
    setHidden(nameCarousel, !settings.namePoolEnabled);
    const typedName = nameInput.value.trim().toLowerCase();
    for (const name of allNames.sort((a, b) => a.localeCompare(b))) {
      const chip = el("span", "pme-creator-name-chip", name);
      if (typedName && name.toLowerCase() === typedName) {
        chip.classList.add("overridden");
        chip.title = "Matches persona name input — will be allowed";
      }
      nameCarousel.appendChild(chip);
    }
  }

  function getNamePool() {
    if (!settings.namePoolEnabled) return [];
    const allNames = Object.values(power_user?.personas ?? {}).filter(Boolean);
    const typedName = nameInput.value.trim().toLowerCase();
    if (!typedName) return allNames;
    return allNames.filter(n => n.toLowerCase() !== typedName);
  }

  function setGeneratingState(active) {
    generating = active;
    generateBtn.disabled = active;
    generateBtn.textContent = active ? "⏳ Generating..." : "✨ Generate Persona";
    setHidden(status, !active);
    if (active) status.textContent = "Generating persona...";
  }

  function showResult(name, description) {
    resultSection.innerHTML = "";
    const card = el("div", "pme-creator-preview-card");
    const avatar = document.createElement("img");
    avatar.className = "pme-creator-preview-avatar";
    avatar.src = imageDataUrl || "/img/default_user_avatar.png";
    card.appendChild(avatar);
    const info = el("div", "pme-creator-preview-info");
    info.appendChild(el("strong", "", name));
    const desc = el("div", "pme-creator-preview-desc", description);
    info.appendChild(desc);
    card.appendChild(info);
    resultSection.appendChild(card);
    setHidden(resultSection, false);
    setHidden(resultActions, false);
    setHidden(generateBtn, true);
  }

  function hideResult() {
    resultSection.innerHTML = "";
    setHidden(resultSection, true);
    setHidden(resultActions, true);
    setHidden(generateBtn, false);
  }

  // --- Event wiring ---
  collapseBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    collapsed = !collapsed;
    syncCollapsedUI();
  });

  promptSelect.addEventListener("change", () => {
    patchCreatorSettings({ activePromptId: promptSelect.value });
    settings.activePromptId = promptSelect.value;
    updatePromptPreview();
  });

  renameBtn.addEventListener("click", async () => {
    const selected = settings.prompts.find(p => p.id === promptSelect.value);
    if (!selected) return;
    const editPanel = document.createElement("div");
    editPanel.appendChild(el("label", "", "Prompt Name"));
    const editName = document.createElement("input");
    editName.type = "text";
    editName.className = "text_pole";
    editName.value = selected.name;
    editPanel.appendChild(editName);
    const editResult = await callGenericPopup(editPanel, POPUP_TYPE.CONFIRM, "", {
      okButton: "Save",
      cancelButton: "Cancel",
    });
    if (editResult === POPUP_RESULT.AFFIRMATIVE) {
      selected.name = editName.value.trim() || selected.name;
      patchCreatorSettings({ prompts: settings.prompts });
      refreshPromptSelect();
    }
  });

  savePromptBtn.addEventListener("click", () => {
    const selected = settings.prompts.find(p => p.id === promptSelect.value);
    if (!selected) return;
    selected.prompt = promptTextarea.value;
    patchCreatorSettings({ prompts: settings.prompts });
    toastr.success(`Prompt "${selected.name}" saved`);
  });

  newBtn.addEventListener("click", () => {
    const newId = makeId();
    settings.prompts.push({ id: newId, name: "New Prompt", prompt: getCreatorDefaultPrompt() });
    patchCreatorSettings({ prompts: settings.prompts, activePromptId: newId });
    refreshPromptSelect();
  });

  delBtn.addEventListener("click", async () => {
    if (settings.prompts.length <= 1) {
      toastr.warning("Cannot delete the last prompt");
      return;
    }
    const confirm = await callGenericPopup("Delete this prompt template?", POPUP_TYPE.CONFIRM, "", { okButton: "Delete" });
    if (confirm !== POPUP_RESULT.AFFIRMATIVE) return;
    settings.prompts = settings.prompts.filter(p => p.id !== promptSelect.value);
    settings.activePromptId = settings.prompts[0]?.id ?? "default";
    patchCreatorSettings({ prompts: settings.prompts, activePromptId: settings.activePromptId });
    refreshPromptSelect();
  });

  resetBtn.addEventListener("click", async () => {
    const confirm = await callGenericPopup("Reset this prompt to the default template?", POPUP_TYPE.CONFIRM, "", { okButton: "Reset" });
    if (confirm !== POPUP_RESULT.AFFIRMATIVE) return;
    const selected = settings.prompts.find(p => p.id === promptSelect.value);
    if (selected) {
      selected.prompt = getCreatorDefaultPrompt();
      patchCreatorSettings({ prompts: settings.prompts });
      refreshPromptSelect();
    }
  });

  namePoolCheckbox.addEventListener("change", () => {
    settings.namePoolEnabled = namePoolCheckbox.checked;
    patchCreatorSettings({ namePoolEnabled: settings.namePoolEnabled });
    refreshNamePool();
  });

  nameInput.addEventListener("input", () => {
    refreshNamePool();
  });

  imgInput.addEventListener("change", () => {
    const file = imgInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      imageDataUrl = reader.result;
      imgPreview.src = imageDataUrl;
      imgPreview.classList.remove("displayNone");
      imgClear.classList.remove("displayNone");
    };
    reader.readAsDataURL(file);
  });

  imgClear.addEventListener("click", () => {
    imageDataUrl = null;
    imgInput.value = "";
    imgPreview.src = "";
    imgPreview.classList.add("displayNone");
    imgClear.classList.add("displayNone");
  });

  tokenSlider.addEventListener("input", () => {
    tokenVal.textContent = tokenSlider.value;
  });

  linkCheckbox.addEventListener("change", () => {
    settings.linkToCharacter = linkCheckbox.checked;
    patchCreatorSettings({ linkToCharacter: settings.linkToCharacter });
    saveBtn.textContent = settings.linkToCharacter ? "💾 Save & Link" : "💾 Save";
  });

  generateBtn.addEventListener("click", async () => {
    if (generating) return;
    if (linkCheckbox.checked) {
      const char = characters[Number(this_chid)];
      if (!char) { toastr.warning("No character selected"); return; }
    }
    if (!profileSelect.value) { toastr.warning("No connection profile selected"); return; }
    await doGenerate();
  });

  async function doGenerate() {
    const selectedPrompt = settings.prompts.find(p => p.id === promptSelect.value);
    if (!selectedPrompt) { toastr.error("No prompt selected"); return; }

    setGeneratingState(true);
    patchCreatorSettings({ lastProfileId: profileSelect.value, maxTokens: Number(tokenSlider.value) });

    try {
      let prompt = substituteMacros(selectedPrompt.prompt, nameInput.value.trim());

      // Auto-inject additional instructions
      const extraInstructions = extraInput.value.trim();
      if (extraInstructions) {
        prompt += `\n\n${extraInstructions}`;
      }

      // Auto-inject name pool exclusion
      const excludedNames = getNamePool();
      if (excludedNames.length) {
        prompt += `\n\nThe following persona names already exist and MUST NOT be used: ${JSON.stringify(excludedNames)}`;
      }

      let content;
      if (imageDataUrl) {
        content = [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl, detail: "auto" } },
        ];
      } else {
        content = prompt;
      }

      const response = await ConnectionManagerRequestService.sendRequest(
        profileSelect.value,
        [{ role: "user", content }],
        Number(tokenSlider.value),
        { stream: false, extractData: true },
      );

      const rawText = String(response?.content ?? "").trim();
      if (!rawText) {
        toastr.error("AI returned empty response");
        status.textContent = "Generation failed — empty response.";
        setGeneratingState(false);
        return;
      }

      const userProvidedName = nameInput.value.trim();

      // Try to parse structured JSON response
      const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          generatedName = userProvidedName || parsed.name || extractPersonaName(rawText);
          generatedDescription = parsed.description || rawText;
        } catch {
          // JSON parse failed, fall back to heuristic
          generatedName = userProvidedName || extractPersonaName(rawText);
          generatedDescription = rawText;
        }
      } else {
        // No JSON block — fall back to heuristic extraction
        generatedName = userProvidedName || extractPersonaName(rawText);
        generatedDescription = rawText;
      }
      setGeneratingState(false);
      showResult(generatedName, generatedDescription);
    } catch (e) {
      console.error("[PME] Persona generation failed:", e);
      toastr.error(`Generation failed: ${e.message}`);
      status.textContent = `Error: ${e.message}`;
      setGeneratingState(false);
    }
  }

  function clearInputs() {
    extraInput.value = "";
    imageDataUrl = null;
    imgInput.value = "";
    imgPreview.src = "";
    imgPreview.classList.add("displayNone");
    imgClear.classList.add("displayNone");
  }

  saveBtn.addEventListener("click", async () => {
    if (!generatedName || !generatedDescription) return;
    try {
      await savePersona(generatedName, generatedDescription, imageDataUrl, linkCheckbox.checked);
      const msg = linkCheckbox.checked
        ? `Persona "${generatedName}" created and linked`
        : `Persona "${generatedName}" created`;
      toastr.success(msg);
      hideResult();
      clearInputs();
      generatedName = null;
      generatedDescription = null;
    } catch (e) {
      console.error("[PME] Save failed:", e);
      toastr.error(`Save failed: ${e.message}`);
    }
  });

  retryBtn.addEventListener("click", () => {
    hideResult();
    generatedName = null;
    generatedDescription = null;
  });

  discardBtn.addEventListener("click", () => {
    hideResult();
    clearInputs();
    generatedName = null;
    generatedDescription = null;
  });

  function syncCollapsedUI() {
    collapseBtn.title = collapsed ? "Expand" : "Collapse";
    collapseBtn.innerHTML = collapsed
      ? '<i class="fa-solid fa-chevron-down"></i>'
      : '<i class="fa-solid fa-chevron-up"></i>';
    setHidden(body, collapsed);
    root.classList.toggle("pme-collapsed", collapsed);
  }

  function render() {
    const profiles = populateProfiles();
    if (!profiles) {
      generateBtn.disabled = true;
      generateBtn.textContent = "No Connection Manager profiles";
    }
    refreshPromptSelect();
    refreshNamePool();
  }

  return {
    el: root,
    mount() {
      render();
      syncCollapsedUI();
    },
    update() {
      render();
      syncCollapsedUI();
    },
  };
}

async function savePersona(name, description, imageDataUrl, linkToCharacter = true) {
  const avatarId = `${Date.now()}-${name.replace(/[^a-zA-Z0-9]/g, "")}.png`;

  if (imageDataUrl) {
    await uploadAvatar(avatarId, imageDataUrl);
  } else {
    await uploadAvatar(avatarId, "/img/default_user_avatar.png");
  }

  await initPersona(avatarId, name, description, "");

  if (linkToCharacter) {
    const connectionObj = getCurrentConnectionObj();
    if (connectionObj) {
      const descriptor = power_user.persona_descriptions[avatarId];
      if (descriptor) {
        descriptor.connections = descriptor.connections || [];
        if (!descriptor.connections.some(c => c.type === connectionObj.type && c.id === connectionObj.id)) {
          descriptor.connections.push(connectionObj);
        }
        saveSettingsDebounced();
      }
    }
  }

  await setUserAvatar(avatarId);
  await getUserAvatars(true, avatarId);
}
