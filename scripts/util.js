export const MOD = "imres-toolkit";
const SOCKET = `module.${MOD}`;

export const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/* Aktionen, die nur der Spielleiter ausführen darf (z. B. fremde Charaktere ändern) */
const gmHandlers = {
  async setInspiration({ actorUuid, value }) {
    const actor = await fromUuid(actorUuid);
    if (actor?.type === "character") await actor.update({ "system.attributes.inspiration": !!value });
  }
};

export function initSocket() {
  game.socket.on(SOCKET, async data => {
    if (!game.users.activeGM?.isSelf) return;
    try { await gmHandlers[data?.action]?.(data.payload ?? {}); }
    catch (err) { console.error(`${MOD} | Socket`, err); }
  });
}

/** Führt eine Aktion mit SL-Rechten aus. Gibt false zurück, wenn kein SL online ist. */
export async function gmDo(action, payload) {
  if (game.user.isGM) { await gmHandlers[action](payload); return true; }
  if (!game.users.activeGM) {
    ui.notifications.warn("Dafür muss der Spielleiter online sein.");
    return false;
  }
  game.socket.emit(SOCKET, { action, payload });
  return true;
}

/** Konzentrations-Effekte eines Actors */
export function concentrationEffects(actor) {
  const effects = actor?.concentration?.effects;
  if (effects) return [...effects];
  return actor?.effects?.filter(e => e.statuses?.has("concentrating")) ?? [];
}

export const spellName = effect => effect.name.replace(/^[^:]*:\s*/, "");

export async function confirmEndConcentration(actor, effect) {
  const spell = spellName(effect);
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Konzentration beenden" },
    content: `<p><strong>${esc(actor.name)}</strong> beendet die Konzentration auf <strong>${esc(spell)}</strong>?</p>`
  });
  if (!ok) return;
  try {
    if (typeof actor.endConcentration === "function") await actor.endConcentration(effect);
    else await effect.delete();
  } catch (err) {
    console.error(`${MOD} | Konzentration beenden`, err);
    ui.notifications.error("Konzentration konnte nicht beendet werden (Details in der Konsole, F12).");
  }
}
