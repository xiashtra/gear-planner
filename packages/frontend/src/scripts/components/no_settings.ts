// used in doc
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {Simulation} from "@xivgear/core/sims/sim_types";

/**
 * Basic implementation of {@link Simulation.makeResultDisplay} for sims which
 * do not actually have any settings.
 */
export function noSimSettings() {
    const outerDiv = document.createElement("div");
    const header = document.createElement("h1");
    header.textContent = "No Settings for This Simulation";
    outerDiv.replaceChildren(header);
    return outerDiv;
}


