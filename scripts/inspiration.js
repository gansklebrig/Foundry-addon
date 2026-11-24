import { MOD, esc } from "./util.js";

const BARD_RE = /bardic inspiration|bardische inspiration|barden-?inspiration/i;
// Das Merkmal aus dem Regelwerk vergibt an den Empfänger den Effekt „Inspired“
const HELD_RE = /^(inspired|inspiriert)$/i;
const bardUsed = new Set();

export function registerInspirationSettings() {
  game.settings.register(MOD, "showOnUnknown", {
    name: "Inspiration auch ohne bekannten Zielwert anbieten",
    hint: "Wenn bei einem Wurf kein SG/keine RK hinterlegt ist, kann Foundry nicht wissen, ob er misslungen ist. Aktiviert: Die Knöpfe erscheinen dann trotzdem (neutral). Deaktiviert: Nur bei sicher erkannten Fehlschlägen.",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MOD, "maxAgeMinutes", {
    name: "Inspiration: Zeitfenster in Minuten",
    hint: "Wie lange nach einem Wurf die Inspirations-Knöpfe noch angeboten werden.",
    scope: "world", config: true, type: Number, default: 10
  });
  game.settings.register(MOD, "bardicButton", {
    name: "Bardische Inspiration an fremden Würfen anbieten",
    hint: "Für Runden, die den Würfel nicht vorab als Effekt vergeben: Wer einen Charakter mit dem Merkmal „Bardische Inspiration“ besitzt, bekommt an Würfen der anderen einen Knopf, um direkt einen Inspirationswürfel beizusteuern.",
    scope: "world", config: true, type: Boolean, default: true
  });
}

/* ------------------------------ Hilfen ------------------------------ */
function getD20Roll(message) {
  const D20 = CONFIG.Dice.D20Roll;
  return message.rolls?.find(r => (D20 && r instanceof D20) || r.dice?.[0]?.faces === 20) ?? null;
}

function rollType(message) {
  return message.flags?.dnd5e?.roll?.type ?? message.system?.type ?? message.type;
}

function isAttack(message) {
  return message.flags?.dnd5e?.roll?.type === "attack" || message.type === "attack";
}

/** Zielwert (SG oder RK) des Wurfs, falls bekannt */
function getTarget(message, roll) {
  const target = Number(roll.options?.target);
  if (Number.isFinite(target) && roll.options?.target != null) return target;
  if (isAttack(message)) {
    const targets = message.flags?.dnd5e?.targets ?? message.system?.targets ?? [];
    const acs = Array.from(targets).map(t => t?.ac).filter(Number.isFinite);
    if (acs.length) return Math.max(...acs);
  }
  return null;
}

/** "fail" | "success" | "unknown" */
function getOutcome(message, roll) {
  if (isAttack(message)) {
    if (roll.isFumble) return "fail";
    if (roll.isCritical) return "success";
  }
  const target = getTarget(message, roll);
  if (target === null) return "unknown";
  return roll.total >= target ? "success" : "fail";
}

function getActor(message) {
  return ChatMessage.getSpeakerActor(message.speaker) ?? null;
}

function bardItem(actor) {
  return actor.items.find(i => i.system?.identifier === "bardic-inspiration" || BARD_RE.test(i.name)) ?? null;
}

function bardHasUses(item) {
  const uses = item.system?.uses;
  if (!uses?.max) return true; // keine Anwendungen hinterlegt -> nicht mitzählen
  return (uses.value ?? (uses.max - (uses.spent ?? 0))) > 0;
}

function bardDie(actor) {
  const scale = actor.system?.scale?.bard ?? {};
  const v = scale["bardic-inspiration"] ?? scale.inspiration ?? scale["bardic-inspiration-die"];
  const formula = v?.formula ?? (v?.faces ? `1d${v.faces}` : null);
  if (formula && /d\d+/.test(formula)) return formula.startsWith("d") ? `1${formula}` : formula;
  const lvl = actor.classes?.bard?.system?.levels ?? 1;
  return lvl >= 15 ? "1d12" : lvl >= 10 ? "1d10" : lvl >= 5 ? "1d8" : "1d6";
}

/** Effekt „Bardische Inspiration“, den ein Charakter von einem Barden erhalten hat */
function heldBardicEffect(actor) {
  const effects = actor.appliedEffects ?? actor.effects.filter(e => !e.disabled);
  return effects.find(e => BARD_RE.test(e.name) || HELD_RE.test(e.name) || !!originBardItem(e)) ?? null;
}

/** Stammt der Effekt vom Merkmal „Bardische Inspiration“ eines (anderen) Charakters? */
function originBardItem(effect) {
  try {
    const itemUuid = String(effect.origin ?? "").match(/^(.*\.Item\.[^.]+)/)?.[1];
    if (!itemUuid) return null;
    const item = fromUuidSync(itemUuid);
    if (!item || item.actor === effect.parent) return null;
    return (item.system?.identifier === "bardic-inspiration" || BARD_RE.test(item.name)) ? item : null;
  } catch (err) { return null; }
}

/** Würfel für einen gehaltenen Effekt: vom Barden, der ihn vergeben hat, sonst vom Barden der Gruppe, sonst W6 */
async function heldBardicDie(effect) {
  let bard = null;
  try {
    bard = originBardItem(effect)?.actor ?? null;
    if (!bard) {
      const origin = effect.origin ? await fromUuid(effect.origin) : null;
      bard = origin?.actor ?? origin?.item?.actor ?? origin?.parent?.actor ?? (origin?.documentName === "Actor" ? origin : null);
    }
    if (bard && !bard.classes?.bard && !bardItem(bard)) bard = null;
  } catch (err) { /* Ursprung nicht auffindbar */ }
  bard ??= game.actors.find(a => a.type === "character" && a.hasPlayerOwner && a.classes?.bard);
  return bard ? bardDie(bard) : "1d6";
}

/** Eigene Barden des aktuellen Spielers (nicht für den SL) */
function myBards(exceptActor) {
  if (game.user.isGM) return [];
  return game.actors.filter(a => a.type === "character" && a.isOwner && a !== exceptActor && bardItem(a));
}

/* ------------------------- Knöpfe an der Nachricht ------------------------- */
function makeButton(cls, html, onClick) {
  const wrap = document.createElement("div");
  wrap.className = `imres-inspiration ${cls}`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.innerHTML = html;
  btn.addEventListener("click", onClick);
  wrap.append(btn);
  return wrap;
}

function onRenderMessage(message, html) {
  try {
    if (message.getFlag(MOD, "rerolled") || message.getFlag(MOD, "used") || message.getFlag(MOD, "bardic")) return;
    const roll = getD20Roll(message);
    if (!roll) return;
    if (rollType(message) === "initiative") return;
    if (message.blind && !game.user.isGM) return;

    const actor = getActor(message);
    if (!actor) return;

    const maxAge = (game.settings.get(MOD, "maxAgeMinutes") || 10) * 60000;
    if (Date.now() - message.timestamp > maxAge) return;

    const outcome = getOutcome(message, roll);
    if (outcome === "success") return;
    if (outcome === "unknown" && !game.settings.get(MOD, "showOnUnknown")) return;

    const container = html.querySelector(".message-content") ?? html;
    const prefix = outcome === "fail" ? "Fehlschlag – " : "";

    // Eigene Inspiration: Neuwurf
    if (actor.type === "character" && actor.isOwner) {
      const wrap = makeButton(outcome,
        `<i class="fa-solid fa-sun"></i> ${prefix}Use Heroic Inspiration`,
        ev => onUseInspiration(ev, message));
      wrap.dataset.actorUuid = actor.uuid;
      wrap.hidden = !actor.system?.attributes?.inspiration;
      wrap.dataset.tooltip = "Verbraucht die Inspiration und würfelt neu";
      container.append(wrap);
    }

    // Erhaltene Bardische Inspiration: Würfel zum eigenen Wurf addieren
    if (actor.isOwner && heldBardicEffect(actor)) {
      const wrap = makeButton(`${outcome} bardic`,
        `<i class="fa-solid fa-music"></i> ${prefix}Use Bardic Inspiration`,
        ev => onUseHeldBardic(ev, message));
      wrap.dataset.tooltip = "Verbraucht den erhaltenen Inspirationswürfel und addiert ihn zum Wurf";
      wrap.dataset.held = actor.uuid;
      container.append(wrap);
    }

    // Bardische Inspiration für den Wurf eines anderen
    if (game.settings.get(MOD, "bardicButton") && !bardUsed.has(message.id)) {
      for (const bard of myBards(actor)) {
        if (!bardHasUses(bardItem(bard))) continue;
        container.append(makeButton(`${outcome} bardic`,
          `<i class="fa-solid fa-music"></i> ${esc(bard.name)}: Bardische Inspiration geben (${bardDie(bard).replace(/^1/, "")})`,
          ev => onBardicInspiration(ev, message, bard)));
      }
    }
  } catch (err) {
    console.error(`${MOD} | Inspiration-Knopf`, err);
  }
}

/* ------------------------------ Aktionen ------------------------------ */
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

    // Nachricht kopieren, damit sie (je nach Systemversion) wie der ursprüngliche Wurf dargestellt wird
    const data = message.toObject();
    delete data._id;
    delete data.timestamp;
    data.author = game.user.id;
    data.rolls = [newRoll];
    data.sound = CONFIG.sounds.dice;
    data.flavor = `${message.flavor ?? ""} <span class="imres-tag"><i class="fa-solid fa-sun"></i> Inspiration – Neuwurf (vorher ${roll.total})</span>`;
    data.flags = data.flags ?? {};
    data.flags[MOD] = { rerolled: true };
    await ChatMessage.create(data);

    if (message.canUserModify(game.user, "update")) await message.setFlag(MOD, "used", true);
    btn.closest(".imres-inspiration")?.remove();
  } catch (err) {
    console.error(`${MOD} | Neuwurf`, err);
    ui.notifications.error("Neuwurf mit Inspiration ist fehlgeschlagen (Details in der Konsole, F12).");
    btn.disabled = false;
  }
}

async function onBardicInspiration(event, message, bard) {
  event.preventDefault();
  event.stopPropagation();
  const btn = event.currentTarget;
  const roll = getD20Roll(message);
  const actor = getActor(message);
  const item = bardItem(bard);
  if (!roll || !actor || !item) return;
  if (!bardHasUses(item)) {
    ui.notifications.warn(`${bard.name} hat keine Bardische Inspiration mehr übrig.`);
    return;
  }
  btn.disabled = true;
  try {
    const uses = item.system?.uses;
    if (uses?.max) await item.update({ "system.uses.spent": (uses.spent ?? 0) + 1 });

    const die = await new Roll(bardDie(bard)).evaluate();
    const total = roll.total + die.total;
    const target = getTarget(message, roll);
    const verdict = verdictHtml(message, total, target);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: bard }),
      flavor: `<span class="imres-tag"><i class="fa-solid fa-music"></i> Bardische Inspiration für ${esc(actor.name)}</span><br>${roll.total} + ${die.total} = <strong>${total}</strong>${verdict}`,
      rolls: [die],
      whisper: message.whisper ?? [],
      sound: CONFIG.sounds.dice,
      flags: { [MOD]: { bardic: true } }
    });
    bardUsed.add(message.id);
    btn.closest(".imres-inspiration")?.remove();
  } catch (err) {
    console.error(`${MOD} | Bardische Inspiration`, err);
    ui.notifications.error("Bardische Inspiration ist fehlgeschlagen (Details in der Konsole, F12).");
    btn.disabled = false;
  }
}

function verdictHtml(message, total, target) {
  if (target === null) return "";
  const ok = total >= target;
  const text = isAttack(message) ? (ok ? "damit getroffen!" : "trifft trotzdem nicht.") : (ok ? "damit geschafft!" : "reicht leider nicht.");
  return ` – <strong class="${ok ? "imres-ok" : "imres-bad"}">${text}</strong>`;
}

async function onUseHeldBardic(event, message) {
  event.preventDefault();
  event.stopPropagation();
  const btn = event.currentTarget;
  const roll = getD20Roll(message);
  const actor = getActor(message);
  const effect = actor ? heldBardicEffect(actor) : null;
  if (!roll || !actor) return;
  if (!effect) {
    ui.notifications.warn(`${actor.name} hat keine Bardische Inspiration (mehr).`);
    btn.closest(".imres-inspiration")?.remove();
    return;
  }
  btn.disabled = true;
  try {
    const formula = await heldBardicDie(effect);
    await effect.delete();
    const die = await new Roll(formula).evaluate();
    const total = roll.total + die.total;
    await ChatMessage.create({
      speaker: message.speaker,
      flavor: `<span class="imres-tag"><i class="fa-solid fa-music"></i> Bardische Inspiration</span><br>${roll.total} + ${die.total} = <strong>${total}</strong>${verdictHtml(message, total, getTarget(message, roll))}`,
      rolls: [die],
      whisper: message.whisper ?? [],
      sound: CONFIG.sounds.dice,
      flags: { [MOD]: { bardic: true } }
    });
    for (const el of document.querySelectorAll(".imres-inspiration.bardic[data-held]")) {
      if (el.dataset.held === actor.uuid) el.remove();
    }
    btn.closest(".imres-inspiration")?.remove();
  } catch (err) {
    console.error(`${MOD} | Bardische Inspiration nutzen`, err);
    ui.notifications.error("Bardische Inspiration ist fehlgeschlagen (Details in der Konsole, F12).");
    btn.disabled = false;
  }
}

export function initInspiration() {
  Hooks.on("renderChatMessageHTML", onRenderMessage);

  // Knöpfe ein-/ausblenden, sobald sich die Inspiration eines Charakters ändert
  Hooks.on("updateActor", (actor, changes) => {
    if (!foundry.utils.hasProperty(changes, "system.attributes.inspiration")) return;
    const has = !!actor.system?.attributes?.inspiration;
    for (const el of document.querySelectorAll(".imres-inspiration[data-actor-uuid]")) {
      if (el.dataset.actorUuid === actor.uuid) el.hidden = !has;
    }
  });
}
