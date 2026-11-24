const MOD = "imres-toolkit";

/* ------------------------------------------------------------------ */
/*  Einstellungen                                                      */
/* ------------------------------------------------------------------ */
Hooks.once("init", () => {
  game.settings.register(MOD, "showOnUnknown", {
    name: "Inspiration auch ohne bekannten Zielwert anbieten",
    hint: "Wenn bei einem Wurf kein SG/keine RK hinterlegt ist, kann Foundry nicht wissen, ob er misslungen ist. Aktiviert: Der Knopf erscheint dann trotzdem (neutral). Deaktiviert: Nur bei sicher erkannten Fehlschlägen.",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MOD, "maxAgeMinutes", {
    name: "Inspiration: Zeitfenster in Minuten",
    hint: "Wie lange nach einem Wurf der Inspirations-Knopf noch angeboten wird.",
    scope: "world", config: true, type: Number, default: 10
  });
  game.settings.register(MOD, "concentrationBar", {
    name: "Konzentrations-Leiste anzeigen",
    hint: "Zeigt über der Makroleiste ein Icon für jeden Zauber, auf den du dich konzentrierst. Klick beendet die Konzentration.",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => refreshBar()
  });
});

/* ------------------------------------------------------------------ */
/*  1) Inspiration am Wurf                                             */
/* ------------------------------------------------------------------ */
function getD20Roll(message) {
  const D20 = CONFIG.Dice.D20Roll;
  return message.rolls?.find(r => (D20 && r instanceof D20) || r.dice?.[0]?.faces === 20) ?? null;
}

/** "fail" | "success" | "unknown" */
function getOutcome(message, roll) {
  const type = message.flags?.dnd5e?.roll?.type;
  if (type === "attack") {
    if (roll.isFumble) return "fail";
    if (roll.isCritical) return "success";
  }
  const target = roll.options?.target;
  if (Number.isFinite(target)) return roll.total >= target ? "success" : "fail";
  if (type === "attack") {
    const acs = (message.flags?.dnd5e?.targets ?? []).map(t => t.ac).filter(Number.isFinite);
    if (acs.length) return acs.some(ac => roll.total < ac) ? "fail" : "success";
  }
  return "unknown";
}

function getActor(message) {
  return ChatMessage.getSpeakerActor(message.speaker) ?? null;
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  try {
    if (message.getFlag(MOD, "rerolled") || message.getFlag(MOD, "used")) return;
    const roll = getD20Roll(message);
    if (!roll) return;
    if (message.flags?.dnd5e?.roll?.type === "initiative") return;
    if (message.blind && !game.user.isGM) return;

    const actor = getActor(message);
    if (!actor || actor.type !== "character" || !actor.isOwner) return;

    const maxAge = (game.settings.get(MOD, "maxAgeMinutes") || 10) * 60000;
    if (Date.now() - message.timestamp > maxAge) return;

    const outcome = getOutcome(message, roll);
    if (outcome === "success") return;
    if (outcome === "unknown" && !game.settings.get(MOD, "showOnUnknown")) return;

    const wrap = document.createElement("div");
    wrap.className = `imres-inspiration ${outcome}`;
    wrap.dataset.actorUuid = actor.uuid;
    wrap.hidden = !actor.system?.attributes?.inspiration;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = `<i class="fa-solid fa-sun"></i> ${outcome === "fail" ? "Fehlschlag – " : ""}Inspiration nutzen &amp; neu würfeln`;
    btn.addEventListener("click", ev => onUseInspiration(ev, message));
    wrap.append(btn);

    (html.querySelector(".message-content") ?? html).append(wrap);
  } catch (err) {
    console.error(`${MOD} | Inspiration-Knopf`, err);
  }
});

async function onUseInspiration(event, message) {
  event.preventDefault();
  event.stopPropagation();
  const btn = event.currentTarget;
  const actor = getActor(message);
  const roll = getD20Roll(message);
  if (!actor || !roll) return;
  if (!actor.system?.attributes?.inspiration) {
    ui.notifications.warn(`${actor.name} hat keine Inspiration.`);
    return;
  }
  btn.disabled = true;
  try {
    await actor.update({ "system.attributes.inspiration": false });
    const newRoll = await roll.reroll();

    const flags = { [MOD]: { rerolled: true } };
    if (message.flags?.dnd5e) flags.dnd5e = foundry.utils.deepClone(message.flags.dnd5e);

    await ChatMessage.create({
      speaker: message.speaker,
      flavor: `${message.flavor ?? ""} <span class="imres-tag"><i class="fa-solid fa-sun"></i> Inspiration – Neuwurf (vorher ${roll.total})</span>`,
      rolls: [newRoll],
      whisper: message.whisper ?? [],
      blind: message.blind ?? false,
      sound: CONFIG.sounds.dice,
      flags
    });

    // Alten Wurf als verbraucht markieren (nur möglich, wenn man die Nachricht bearbeiten darf)
    if (message.canUserModify(game.user, "update")) await message.setFlag(MOD, "used", true);
    btn.closest(".imres-inspiration")?.remove();
  } catch (err) {
    console.error(`${MOD} | Neuwurf`, err);
    ui.notifications.error("Neuwurf mit Inspiration ist fehlgeschlagen (Details in der Konsole, F12).");
    btn.disabled = false;
  }
}

// Knöpfe ein-/ausblenden, sobald sich die Inspiration eines Charakters ändert
Hooks.on("updateActor", (actor, changes) => {
  if (!foundry.utils.hasProperty(changes, "system.attributes.inspiration")) return;
  const has = !!actor.system?.attributes?.inspiration;
  for (const el of document.querySelectorAll(".imres-inspiration")) {
    if (el.dataset.actorUuid === actor.uuid) el.hidden = !has;
  }
});

/* ------------------------------------------------------------------ */
/*  2) Konzentrations-Leiste                                           */
/* ------------------------------------------------------------------ */
function relevantActors() {
  const actors = new Set();
  if (game.user.character) actors.add(game.user.character);
  for (const t of canvas?.tokens?.controlled ?? []) if (t.actor) actors.add(t.actor);
  if (!game.user.isGM) {
    for (const t of canvas?.tokens?.placeables ?? []) if (t.actor?.isOwner) actors.add(t.actor);
  }
  return [...actors].filter(a => a.isOwner);
}

function concentrationEffects(actor) {
  const effects = actor.concentration?.effects;
  if (effects) return [...effects];
  return actor.effects.filter(e => e.statuses?.has("concentrating"));
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

function refreshBar() {
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
    const spell = effect.name.replace(/^[^:]*:\s*/, "");
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
    btn.addEventListener("click", () => onEndConcentration(actor, effect, spell));
    bar.append(btn);
  }
  positionBar(bar);
}

async function onEndConcentration(actor, effect, spell) {
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Konzentration beenden" },
    content: `<p><strong>${foundry.utils.escapeHTML(actor.name)}</strong> beendet die Konzentration auf <strong>${foundry.utils.escapeHTML(spell)}</strong>?</p>`
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

const debouncedRefresh = foundry.utils.debounce(refreshBar, 100);
Hooks.once("ready", () => {
  refreshBar();
  window.addEventListener("resize", debouncedRefresh);
});
for (const hook of [
  "canvasReady", "controlToken", "createToken", "deleteToken",
  "createActiveEffect", "updateActiveEffect", "deleteActiveEffect",
  "updateUser", "renderHotbar", "collapseSidebar"
]) Hooks.on(hook, () => debouncedRefresh());
