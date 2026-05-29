import { el, setHidden } from "./dom.js";
import { UI_EVENTS } from "../uiBus.js";

const PRONOUN_FIELDS = [
  { key: "subjective", label: "Subjective", placeholder: "e.g. she, he, they, it", macro: "pronounSubjective" },
  { key: "objective", label: "Objective", placeholder: "e.g. her, him, them, it", macro: "pronounObjective" },
  { key: "posDet", label: "Pos. Det.", placeholder: "e.g. her, his, their, its", macro: "pronounPosDet" },
  { key: "posPro", label: "Pos. Pro.", placeholder: "e.g. hers, his, theirs, its", macro: "pronounPosPro" },
  { key: "reflexive", label: "Reflexive", placeholder: "e.g. herself, himself, themselves, itself", macro: "pronounReflexive" },
];

const PRESETS = [
  { key: "she", label: "She/Her" },
  { key: "he", label: "He/Him" },
  { key: "they", label: "They/Them" },
  { key: "it", label: "It/Its" },
];

/**
 * Creates the Pronouns card for PME Advanced mode.
 * Dynamically imports the Pronouns extension API; returns a stub if unavailable.
 *
 * @param {{ bus: import("../uiBus.js").UiBus }} opts
 */
export function createPronounsCard({ bus } = {}) {
  let collapsed = true;
  let pronounsApi = null;
  let loadAttempted = false;

  const root = el("div", "pme-card pme-pronouns");

  // Header
  const header = el("div", "pme-card-title-row");
  header.appendChild(el("div", "pme-card-title", "Pronouns"));

  const actions = el("div", "pme-actions");
  const collapseBtn = el("button", "menu_button menu_button_icon pme-icon-btn");
  collapseBtn.type = "button";
  actions.appendChild(collapseBtn);
  header.appendChild(actions);
  root.appendChild(header);

  const body = el("div", "pme-pronouns-body");
  root.appendChild(body);

  // Presets row
  const presetsRow = el("div", "pme-pronouns-presets");
  body.appendChild(presetsRow);

  // Fields container
  const fieldsContainer = el("div", "pme-pronouns-fields");
  body.appendChild(fieldsContainer);

  /** @type {Record<string, HTMLInputElement>} */
  const inputs = {};

  // Build preset buttons
  for (const preset of PRESETS) {
    const btn = el("div", "menu_button menu_button_icon pme-preset-btn");
    btn.dataset.preset = preset.key;
    btn.title = `Set pronouns to ${preset.label}`;
    btn.textContent = preset.label;
    presetsRow.appendChild(btn);
  }

  // Build input fields
  for (const field of PRONOUN_FIELDS) {
    const wrapper = el("div", "pme-pronouns-field");

    const labelRow = el("div", "pme-pronouns-field-label");
    labelRow.appendChild(el("label", "", field.label));

    const infoIcon = el("i", "fa-solid fa-circle-info pme-pronoun-info");
    infoIcon.title = `{{${field.macro}}}`;
    labelRow.appendChild(infoIcon);
    wrapper.appendChild(labelRow);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "text_pole";
    input.placeholder = field.placeholder;
    input.dataset.key = field.key;
    wrapper.appendChild(input);

    inputs[field.key] = input;
    fieldsContainer.appendChild(wrapper);
  }

  // Collapse toggle
  function syncCollapsedUI() {
    collapseBtn.title = collapsed ? "Expand" : "Collapse";
    collapseBtn.innerHTML = collapsed
      ? '<i class="fa-solid fa-chevron-down"></i>'
      : '<i class="fa-solid fa-chevron-up"></i>';
    setHidden(body, collapsed);
    root.classList.toggle("pme-collapsed", collapsed);
  }

  collapseBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    collapsed = !collapsed;
    syncCollapsedUI();
  });

  // Preset button clicks
  presetsRow.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target.closest("[data-preset]");
    if (!btn || !pronounsApi) return;
    e.preventDefault();
    e.stopPropagation();
    const presetKey = btn.dataset.preset;
    pronounsApi.applyPronounPreset(presetKey);
    render();
  });

  // Input saves
  for (const field of PRONOUN_FIELDS) {
    inputs[field.key].addEventListener("input", () => {
      if (!pronounsApi) return;
      pronounsApi.setCurrentPronounValue(field.key, inputs[field.key].value);
    });
  }

  /** Load the Pronouns extension API (once). */
  async function ensureApi() {
    if (loadAttempted) return pronounsApi;
    loadAttempted = true;
    try {
      const mod = await import("/scripts/extensions/third-party/SillyTavern-Pronouns/src/pronouns.js");
      pronounsApi = mod;
    } catch {
      console.warn("[PME] SillyTavern-Pronouns not found — pronouns card disabled");
      pronounsApi = null;
    }
    return pronounsApi;
  }

  function render() {
    if (!pronounsApi) return;
    const values = pronounsApi.getCurrentPronounValues();
    for (const field of PRONOUN_FIELDS) {
      inputs[field.key].value = values[field.key] ?? "";
    }
  }

  return {
    el: root,
    async mount() {
      const api = await ensureApi();
      if (!api) {
        // Pronouns extension not installed — hide the entire card
        setHidden(root, true);
        return;
      }
      syncCollapsedUI();
      render();
    },
    update() {
      render();
      syncCollapsedUI();
    },
    destroy() {
      // Nothing to restore — no native nodes relocated
    },
  };
}
