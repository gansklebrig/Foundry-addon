import { MOD } from "./util.js";

export function registerFormationSettings() {
  game.settings.register(MOD, "formation", {
    scope: "world", config: false, type: Object, default: { entries: [] }
  });
}

/** Markierte Tokens als Marschformation speichern (nur SL) */
export async function saveFormation() {
  if (!game.user.isGM) return;
  const tokens = (canvas?.tokens?.controlled ?? []).filter(t => t.actor);
  if (!tokens.length) {
    ui.notifications.warn("Markiere zuerst die Tokens, die zur Formation gehören.");
    return;
  }
  const size = canvas.grid.size || 100;
  const minX = Math.min(...tokens.map(t => t.document.x));
  const minY = Math.min(...tokens.map(t => t.document.y));
  const entries = tokens.map(t => ({
    actorId: t.actor.id,
    name: t.document.name,
    dx: (t.document.x - minX) / size,
    dy: (t.document.y - minY) / size
  }));
  await game.settings.set(MOD, "formation", { entries });
  ui.notifications.info(`Formation mit ${entries.length} Tokens gespeichert.`);
}

async function placeAt(point) {
  const entries = game.settings.get(MOD, "formation")?.entries ?? [];
  const scene = canvas.scene;
  const size = canvas.grid.size || 100;
  let origin = point;
  try { origin = canvas.grid.getTopLeftPoint(point); } catch (err) { /* gitterlos */ }

  const used = new Set();
  const updates = [];
  const creates = [];
  let missing = 0;
  for (const e of entries) {
    const x = Math.round(origin.x + e.dx * size);
    const y = Math.round(origin.y + e.dy * size);
    const existing = scene.tokens.find(t => t.actorId === e.actorId && !used.has(t.id));
    if (existing) {
      used.add(existing.id);
      updates.push({ _id: existing.id, x, y });
      continue;
    }
    const actor = game.actors.get(e.actorId);
    if (!actor) { missing++; continue; }
    const td = await actor.getTokenDocument({ x, y });
    creates.push(td.toObject());
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates, { animate: false });
  if (creates.length) await scene.createEmbeddedDocuments("Token", creates);
  ui.notifications.info(`Formation platziert: ${updates.length} verschoben, ${creates.length} neu gesetzt${missing ? `, ${missing} nicht gefunden` : ""}.`);
}

/** Gespeicherte Formation mit dem nächsten Klick auf die Karte platzieren (nur SL) */
export function placeFormation() {
  if (!game.user.isGM || !canvas?.ready) return;
  const entries = game.settings.get(MOD, "formation")?.entries ?? [];
  if (!entries.length) {
    ui.notifications.warn("Es ist noch keine Formation gespeichert.");
    return;
  }
  ui.notifications.info("Klicke auf die Karte, wo die Formation stehen soll (Rechtsklick bricht ab).");
  canvas.stage.once("pointerdown", ev => {
    if (ev.button !== undefined && ev.button !== 0) {
      ui.notifications.info("Platzieren abgebrochen.");
      return;
    }
    let point = null;
    try { point = ev.getLocalPosition(canvas.stage); } catch (err) { point = canvas.mousePosition; }
    if (!point) return;
    placeAt({ x: point.x, y: point.y }).catch(err => {
      console.error(`${MOD} | Formation`, err);
      ui.notifications.error("Formation konnte nicht platziert werden (Details in der Konsole, F12).");
    });
  });
}

export function initFormation() {
  Hooks.on("getSceneControlButtons", controls => {
    if (!game.user.isGM) return;
    // Foundry v13+: Objekt; ältere Versionen: Array
    const group = Array.isArray(controls) ? controls.find(c => c.name === "token") : (controls.tokens ?? controls.token);
    const tools = group?.tools;
    if (!tools) return;
    const defs = [
      { name: "imresFormationSave", title: "Formation speichern (markierte Tokens)", icon: "fa-solid fa-people-group", fn: saveFormation },
      { name: "imresFormationPlace", title: "Formation platzieren (danach auf die Karte klicken)", icon: "fa-solid fa-flag", fn: placeFormation }
    ];
    for (const d of defs) {
      const tool = { name: d.name, title: d.title, icon: d.icon, button: true, visible: true, onChange: () => d.fn() };
      if (Array.isArray(tools)) tools.push(tool);
      else tools[d.name] = { ...tool, order: Object.keys(tools).length };
    }
  });
}
