import { MOD, esc, gmDo, concentrationEffects, spellName, confirmEndConcentration } from "./util.js";

export function registerPartySettings() {
  game.settings.register(MOD, "partyBar", {
    name: "Gruppen-Leiste anzeigen",
    hint: "Kleine, verschiebbare Übersicht aller Helden mit Trefferpunkten, Inspiration und Konzentration.",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => renderParty()
  });
  game.settings.register(MOD, "partyState", {
    scope: "client", config: false, type: Object, default: { left: 130, top: 130, collapsed: false }
  });
}

function partyMembers() {
  let list = [];
  try {
    list = (game.actors.party?.system?.members ?? []).map(m => m?.actor).filter(a => a?.type === "character");
  } catch (err) { list = []; }
  if (!list.length) list = game.users.filter(u => !u.isGM && u.character).map(u => u.character);
  return [...new Set(list)];
}

function getState() {
  return { left: 130, top: 130, collapsed: false, ...(game.settings.get(MOD, "partyState") ?? {}) };
}

async function onInspirationClick(actor, members) {
  const has = !!actor.system?.attributes?.inspiration;
  if (game.user.isGM) {
    await actor.update({ "system.attributes.inspiration": !has });
    return;
  }
  if (actor.isOwner) {
    ui.notifications.info(has
      ? "Deine Inspiration nutzt du über den Knopf direkt an einem Wurf. Zum Weitergeben klicke auf die Sonne eines Mitspielers."
      : `${actor.name} hat gerade keine Inspiration.`);
    return;
  }
  if (has) {
    ui.notifications.info(`${actor.name} hat bereits Inspiration.`);
    return;
  }
  const giver = members.find(a => a.isOwner && a.system?.attributes?.inspiration);
  if (!giver) {
    ui.notifications.info("Du hast keine Inspiration, die du weitergeben könntest.");
    return;
  }
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Inspiration weitergeben" },
    content: `<p><strong>${esc(giver.name)}</strong> gibt die eigene Inspiration an <strong>${esc(actor.name)}</strong>?</p>`
  });
  if (!ok) return;
  if (!game.users.activeGM) {
    ui.notifications.warn("Dafür muss der Spielleiter online sein.");
    return;
  }
  await giver.update({ "system.attributes.inspiration": false });
  await gmDo("setInspiration", { actorUuid: actor.uuid, value: true });
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: giver }),
    content: `<p><i class="fa-solid fa-sun"></i> <strong>${esc(giver.name)}</strong> gibt die Inspiration an <strong>${esc(actor.name)}</strong> weiter.</p>`
  });
}

function makeDraggable(panel, handle) {
  handle.addEventListener("pointerdown", ev => {
    if (ev.button !== 0 || ev.target.closest("button")) return;
    const rect = panel.getBoundingClientRect();
    const dx = ev.clientX - rect.left;
    const dy = ev.clientY - rect.top;
    const move = e => {
      const left = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dx));
      const top = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - dy));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const r = panel.getBoundingClientRect();
      game.settings.set(MOD, "partyState", { ...getState(), left: Math.round(r.left), top: Math.round(r.top) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

export function renderParty() {
  if (!game.ready) return;
  let panel = document.getElementById("imres-party");
  const members = game.settings.get(MOD, "partyBar") ? partyMembers() : [];
  if (!members.length) { panel?.remove(); return; }

  const state = getState();
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "imres-party";
    document.body.append(panel);
  }
  panel.style.left = `${state.left}px`;
  panel.style.top = `${state.top}px`;
  panel.classList.toggle("collapsed", !!state.collapsed);
  panel.replaceChildren();

  const header = document.createElement("header");
  header.innerHTML = `<span><i class="fa-solid fa-users"></i> Gruppe</span>`;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.innerHTML = `<i class="fa-solid ${state.collapsed ? "fa-chevron-down" : "fa-chevron-up"}"></i>`;
  toggle.dataset.tooltip = state.collapsed ? "Aufklappen" : "Einklappen";
  toggle.addEventListener("click", async () => {
    await game.settings.set(MOD, "partyState", { ...getState(), collapsed: !getState().collapsed });
    renderParty();
  });
  header.append(toggle);
  panel.append(header);
  makeDraggable(panel, header);
  if (state.collapsed) return;

  for (const actor of members) {
    const hp = actor.system?.attributes?.hp ?? {};
    const max = hp.effectiveMax ?? hp.max ?? 0;
    const value = hp.value ?? 0;
    const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
    const level = pct > 50 ? "good" : pct > 25 ? "mid" : "low";
    const has = !!actor.system?.attributes?.inspiration;

    const row = document.createElement("div");
    row.className = "imres-member";

    const img = document.createElement("img");
    img.src = actor.img || "icons/svg/mystery-man.svg";
    img.alt = actor.name;
    if (actor.isOwner) {
      img.classList.add("clickable");
      img.dataset.tooltip = "Charakterbogen öffnen";
      img.addEventListener("click", () => actor.sheet?.render(true));
    }

    const info = document.createElement("div");
    info.className = "imres-info";
    info.innerHTML = `
      <div class="imres-name">${esc(actor.name)}</div>
      <div class="imres-hp ${level}"><div style="width:${pct}%"></div><span>${value} / ${max}${hp.temp ? ` (+${hp.temp})` : ""}</span></div>`;

    const icons = document.createElement("div");
    icons.className = "imres-icons";

    const sun = document.createElement("button");
    sun.type = "button";
    sun.className = `imres-sun ${has ? "active" : ""}`;
    sun.innerHTML = `<i class="fa-solid fa-sun"></i>`;
    sun.dataset.tooltip = has ? "Hat Inspiration" : "Keine Inspiration";
    sun.addEventListener("click", () => onInspirationClick(actor, members));
    icons.append(sun);

    for (const effect of concentrationEffects(actor)) {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "imres-pconc";
      c.dataset.tooltip = `Konzentriert sich auf „${spellName(effect)}“${actor.isOwner ? " – klicken zum Beenden" : ""}`;
      const ci = document.createElement("img");
      ci.src = effect.img || "icons/svg/aura.svg";
      c.append(ci);
      if (actor.isOwner) c.addEventListener("click", () => confirmEndConcentration(actor, effect));
      icons.append(c);
    }

    row.append(img, info, icons);
    panel.append(row);
  }
}

export function initParty() {
  const debounced = foundry.utils.debounce(renderParty, 100);
  Hooks.once("ready", renderParty);
  for (const hook of [
    "updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect",
    "updateUser", "updateSetting", "createActor", "deleteActor"
  ]) Hooks.on(hook, () => debounced());
}
