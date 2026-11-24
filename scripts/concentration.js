import { MOD, esc, concentrationEffects, spellName, confirmEndConcentration } from "./util.js";

export function registerConcentrationSettings() {
  game.settings.register(MOD, "concentrationBar", {
    name: "Konzentrations-Leiste anzeigen",
    hint: "Zeigt über der Makroleiste ein Icon für jeden Zauber, auf den du dich konzentrierst. Klick beendet die Konzentration.",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => refreshBar()
  });
  game.settings.register(MOD, "autoBreakConcentration", {
    name: "Konzentration bei misslungenem Rettungswurf automatisch beenden",
    hint: "Das System fordert nach Schaden bereits selbst zum Konzentrationswurf auf. Mit dieser Option endet die Konzentration bei einem Fehlschlag automatisch.",
    scope: "world", config: true, type: Boolean, default: true
  });
}

/* ---------------- Automatisch beenden bei misslungenem Wurf ---------------- */
function onRollConcentration(rolls, data) {
  try {
    if (!game.settings.get(MOD, "autoBreakConcentration")) return;
    const actor = data?.subject;
    const roll = rolls?.[0];
    const raw = roll?.options?.target;
    if (!actor || !roll || raw == null || !Number.isFinite(Number(raw))) return;
    if (roll.total >= Number(raw)) return;
    const spells = concentrationEffects(actor).map(spellName);
    if (!spells.length) return;
    actor.endConcentration().then(() => ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><i class="fa-solid fa-ban"></i> <strong>${esc(actor.name)}</strong> verliert die Konzentration auf <strong>${esc(spells.join(", "))}</strong> (Wurf ${roll.total} gegen SG ${raw}).</p>`
    }));
  } catch (err) {
    console.error(`${MOD} | Konzentration automatisch beenden`, err);
  }
}

/* ------------------------- Leiste über der Makroleiste ------------------------- */
function relevantActors() {
  const actors = new Set();
  if (game.user.character) actors.add(game.user.character);
  for (const t of canvas?.tokens?.controlled ?? []) if (t.actor) actors.add(t.actor);
  if (!game.user.isGM) {
    for (const t of canvas?.tokens?.placeables ?? []) if (t.actor?.isOwner) actors.add(t.actor);
  }
  return [...actors].filter(a => a.isOwner);
}

function positionBar(bar) {
  const rect = document.getElementById("hotbar")?.getBoundingClientRect();
  if (rect?.width) {
    bar.style.left = `${rect.left + rect.width / 2}px`;
    bar.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  } else {
    bar.style.left = "50%";
    bar.style.bottom = "110px";
  }
}

export function refreshBar() {
  if (!game.ready) return;
  let bar = document.getElementById("imres-concentration");
  const entries = game.settings.get(MOD, "concentrationBar")
    ? relevantActors().flatMap(a => concentrationEffects(a).map(e => ({ actor: a, effect: e })))
    : [];
  if (!entries.length) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "imres-concentration";
    document.body.append(bar);
  }
  bar.replaceChildren();
  const many = new Set(entries.map(e => e.actor.id)).size > 1;
  for (const { actor, effect } of entries) {
    const spell = spellName(effect);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "imres-conc";
    btn.dataset.tooltip = `${actor.name} konzentriert sich auf „${spell}“ – klicken zum Beenden`;
    btn.dataset.tooltipDirection = "UP";
    const img = document.createElement("img");
    img.src = effect.img || "icons/svg/aura.svg";
    img.alt = spell;
    const x = document.createElement("i");
    x.className = "fa-solid fa-xmark";
    btn.append(img, x);
    if (many) {
      const label = document.createElement("span");
      label.textContent = actor.name;
      btn.append(label);
    }
    btn.addEventListener("click", () => confirmEndConcentration(actor, effect));
    bar.append(btn);
  }
  positionBar(bar);
}

export function initConcentration() {
  Hooks.on("dnd5e.rollConcentration", onRollConcentration);
  const debounced = foundry.utils.debounce(refreshBar, 100);
  Hooks.once("ready", () => {
    refreshBar();
    window.addEventListener("resize", debounced);
  });
  for (const hook of [
    "canvasReady", "controlToken", "createToken", "deleteToken",
    "createActiveEffect", "updateActiveEffect", "deleteActiveEffect",
    "updateUser", "renderHotbar", "collapseSidebar"
  ]) Hooks.on(hook, () => debounced());
}
