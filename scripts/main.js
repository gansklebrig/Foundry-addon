import { MOD, initSocket } from "./util.js";
import { registerInspirationSettings, initInspiration } from "./inspiration.js";
import { registerConcentrationSettings, initConcentration } from "./concentration.js";
import { registerPartySettings, initParty } from "./party.js";
import { registerFormationSettings, initFormation, saveFormation, placeFormation } from "./formation.js";

Hooks.once("init", () => {
  registerInspirationSettings();
  registerConcentrationSettings();
  registerPartySettings();
  registerFormationSettings();
  // Für Makros: game.modules.get("imres-toolkit").api.placeFormation()
  game.modules.get(MOD).api = { saveFormation, placeFormation };
});

Hooks.once("ready", initSocket);

initInspiration();
initConcentration();
initParty();
initFormation();
