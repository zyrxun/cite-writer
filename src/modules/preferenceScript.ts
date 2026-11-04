// Wiring for the plugin preference pane: populate the CSL style picker,
// mirror current pref values into the controls, and persist changes.

import { config } from "../../package.json";
import { getVisibleStyles } from "./citationFormatter";
import { getPref, setPref } from "../utils/prefs";
import { logError } from "../utils/error";

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

export async function registerPrefsScripts(window: Window) {
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window,
      columns: [],
      rows: [],
    };
  } else {
    addon.data.prefs.window = window;
  }
  const doc = window.document;
  try {
    initStyleMenulist(doc);
    initRadiogroup(
      doc,
      "triggerMode",
      `${config.addonRef}-triggermode`,
      (value) => setPref("triggerMode", value),
    );
    initRadiogroup(doc, "scope", `${config.addonRef}-scope`, (value) =>
      setPref("scope", value),
    );
    initNumberInput(doc);
    initEnableCheckbox(doc);
  } catch (e) {
    logError(e);
  }
}

/** CSL style menulist, populated from Zotero.Styles. */
function initStyleMenulist(doc: Document): void {
  const menulist = doc.getElementById(
    `${config.addonRef}-style`,
  ) as XUL.MenuList | null;
  if (!menulist) return;
  const popup = doc.createElementNS(XUL_NS, "menupopup");
  for (const style of getVisibleStyles()) {
    const menuitem = doc.createElementNS(XUL_NS, "menuitem");
    menuitem.setAttribute("label", style.name);
    menuitem.setAttribute("value", style.id);
    popup.appendChild(menuitem);
  }
  menulist.appendChild(popup);
  const current = String(getPref("style"));
  if (popup.querySelector(`menuitem[value="${current}"]`)) {
    menulist.value = current;
  }
  menulist.addEventListener("command", () => {
    if (menulist.value) setPref("style", menulist.value);
  });
}

function initRadiogroup(
  doc: Document,
  prefValue: string,
  elementId: string,
  setter: (value: string) => void,
): void {
  const group = doc.getElementById(elementId) as XUL.RadioGroup | null;
  if (!group) return;
  group.value = String(getPref(prefValue as "scope"));
  group.addEventListener("command", () => {
    if (group.value) setter(group.value);
  });
}

function initNumberInput(doc: Document): void {
  const input = doc.getElementById(
    `${config.addonRef}-minscore`,
  ) as HTMLInputElement | null;
  if (!input) return;
  input.value = String(getPref("minScore"));
  input.addEventListener("change", () => {
    const value = Number(input.value);
    if (!Number.isNaN(value) && value >= 0) setPref("minScore", value);
  });
}

function initEnableCheckbox(doc: Document): void {
  const checkbox = doc.getElementById(
    `${config.addonRef}-enable`,
  ) as XUL.Checkbox | null;
  if (!checkbox) return;
  checkbox.checked = getPref("enable") !== false;
  checkbox.addEventListener("command", () => {
    setPref("enable", checkbox.checked);
  });
}
