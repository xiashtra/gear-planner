import { EquipmentSet, EquippedItem, EquipSlotKey, EquipSlots, GearItem, MeldableMateriaSlot, RawStats, Substat } from "@xivgear/xivmath/geartypes";
import { GearPlanSheet } from "./sheet";
import { ALL_STATS, ALL_SUB_STATS, MATERIA_ACCEPTABLE_OVERCAP_LOSS, MateriaSubstat } from "@xivgear/xivmath/xivconstants";
import { CharacterGearSet } from "./gear";
import { Item } from "@xivgear/data-api-client/dataapi";

class ItemWithStats {
    item: EquippedItem;
    stats: RawStats;

    constructor(item: EquippedItem, stats: RawStats) {
        this.item = item;
        this.stats = stats;
    }
}

class EquipmentSetWithStats {
    set: EquipmentSet;
    stats: RawStats;

    constructor(set: EquipmentSet, stats: RawStats) {
        this.set = set;
        this.stats = stats;
    }
}

export class MeldSolver {

    readonly _sheet: GearPlanSheet;
    private _gearset: CharacterGearSet;

    relevantStats: MateriaSubstat[]; //= ALL_SUB_STATS.filter(stat => this._sheet.isStatRelevant(stat) && stat != 'piety');

    public constructor(sheet: GearPlanSheet) {
        this._sheet = sheet;
    }

    public refresh(set: CharacterGearSet) {
        this._gearset = set;
        this.relevantStats = ALL_SUB_STATS.filter(stat => this._sheet.isStatRelevant(stat) && stat != 'piety');
    }

    public async buttonPress(): Promise<Map<string, EquipmentSetWithStats>> {
        //this.getAllMeldCombinationsForGearItem(this._gearset.equipment.Weapon);
        return this.getAllMeldCombinations(this._gearset.equipment, false);
    }

    async getAllMeldCombinations(equipment: EquipmentSet, keepExistingMateria: boolean): Promise<Map<string, EquipmentSetWithStats>> {

        let possibleMeldCombinations = new Map<string, EquipmentSetWithStats>();
        let baseEquipSet = new EquipmentSetWithStats(new EquipmentSet, new RawStats);

        // Generate these first to avoid re-doing them. Also saves memory by letting our EquipmentSets shallow copy EquippedItems which all reside in here.
        let allIndividualGearPieces: Map<string, Map<string, ItemWithStats>> = new Map<string, Map<string, ItemWithStats>>();
        for (let slotKey of EquipSlots) {
            if (equipment[slotKey] === null || equipment[slotKey] === undefined) continue;

            let pieceCombinations = this.getAllMeldCombinationsForGearItem(equipment[slotKey]);
            allIndividualGearPieces.set(slotKey, pieceCombinations);
            // console.log(`${slotKey}: ${combs.size}`);
        }

        possibleMeldCombinations.set(this.statsToString(baseEquipSet.stats, this.relevantStats), baseEquipSet);

        /**
         * Basic Algorithm (here n = number of equipment slots filled)
         * n = 0: Return all melds for 0th gear slot
         * n > 0: Find all possible combinations for n-1. For each of these, append all melds for n'th gear slot
         * 
         * Solve n=0, then iterate through n=11, caching the previous results.
         * This is O(m^11), where m is the number of unique-statted ways to meld one gear piece.
         * It may be better than O(m^11) if discarding duplicate/worse sets improves the complexit. idk
         * This code is very hot.
         */
        for (let slotKey of EquipSlots) {

            if (equipment[slotKey] === null || equipment[slotKey] === undefined) continue;

            let newGearsets = new Map<string, EquipmentSetWithStats>();
            for (let currSet of possibleMeldCombinations.values()) {

                for (let currPiece of allIndividualGearPieces.get(slotKey).values()) {

                    const setStatsWithPiece = this.addStats(Object.assign({}, currSet.stats), currPiece.stats);
                    const setPlusNewPieceKey = this.statsToString(setStatsWithPiece, this.relevantStats);

                    if (!newGearsets.has(setPlusNewPieceKey)) {
                        let setPlusNewPiece = this.cloneEquipmentSetWithStats(currSet);
                        setPlusNewPiece[slotKey] = currPiece;
                        setPlusNewPiece.stats = setStatsWithPiece;

                        newGearsets.set(setPlusNewPieceKey, setPlusNewPiece);
                    }
                }
            }

            possibleMeldCombinations = newGearsets;
        }

        //console.log(possibleMeldCombinations.size);
        return possibleMeldCombinations;
    }

    public getAllMeldCombinationsForGearItem(equippedItem: EquippedItem): Map<string, ItemWithStats> | null {
        let meldCombinations: Map<string, ItemWithStats> = new Map<string, ItemWithStats>();

        let basePiece = new ItemWithStats(this.cloneEquippedItem(equippedItem), this.getPieceEffectiveStats(equippedItem));
        meldCombinations.set(this.statsToString(equippedItem.gearItem.stats, this.relevantStats), basePiece);

        for (let slotNum = 0; slotNum < equippedItem.gearItem.materiaSlots.length; slotNum += 1) {

            // We are presuming that any pre-existing materia is locked. Skip this slot and continue from next.
            if (equippedItem.melds[slotNum].equippedMateria !== null && equippedItem.melds[slotNum].equippedMateria !== undefined) {
                continue;
            }

            // Add new items after the loop
            let itemsToAdd: Map<string, ItemWithStats> = new Map<string, ItemWithStats>(); 
            for (let [statsKey, existingCombination] of meldCombinations) {

                const stats = existingCombination.stats;

                for (let stat of this.relevantStats) {

                    let materia = this._sheet.getBestMateria(stat, existingCombination.item.melds[slotNum]);

                    let newStats: RawStats = Object.assign({}, stats);
                    newStats[stat] += materia.primaryStatValue;
                    const newStatsKey = this.statsToString(newStats, this.relevantStats);


                    if (stats[stat] + materia.primaryStatValue - existingCombination.item.gearItem.statCaps[stat] < MATERIA_ACCEPTABLE_OVERCAP_LOSS
                        && !itemsToAdd.has(newStatsKey) // Skip if this combination of stats has been found
                    ) {
                        let newMelds: MeldableMateriaSlot[] = this.cloneMelds(existingCombination.item.melds);
                        newMelds[slotNum].equippedMateria = materia;

                        itemsToAdd.set(newStatsKey, new ItemWithStats(new EquippedItem(equippedItem.gearItem, newMelds), newStats));
                    }
                }

                meldCombinations.delete(statsKey); // Only take fully melded items
            }

            for (let item of itemsToAdd) {
                meldCombinations.set(item[0], item[1]);
            }

        }
        
        return meldCombinations;
    }

    cloneEquipmentSetWithStats(set: EquipmentSetWithStats): EquipmentSetWithStats {

        // Shallow copy the individual pieces because they don't need to be unique. i.e. We only need one copy of a DET/DET weapon
        return new EquipmentSetWithStats(Object.assign({}, set.set), Object.assign({}, set.stats));
    }

    cloneEquippedItem(item: EquippedItem): EquippedItem {
        return new EquippedItem(item.gearItem, this.cloneMelds(item.melds));
    }

    cloneItemWithStats(itemWithStats: ItemWithStats): ItemWithStats {
        return new ItemWithStats (this.cloneEquippedItem(itemWithStats.item), Object.assign({}, itemWithStats.stats));
    }

    statsToString(stats: RawStats, relevantStats: MateriaSubstat[]): string {
        let result = "";
        for (let statKey of relevantStats) {
            result += "," + stats[statKey].toString();
        }

        return result;
    }

    addStats(target: RawStats, toAdd: RawStats): RawStats {

        for (let stat of this.relevantStats) {
            target[stat] += toAdd[stat];
        }

        return target;
    }

    getPieceEffectiveStats(item: EquippedItem): RawStats {
        let stats = Object.assign({}, item.gearItem.stats);
        for (let meld of item.melds) {
            if (meld.equippedMateria === null || meld.equippedMateria === undefined) continue;
            stats[meld.equippedMateria.primaryStat] += meld.equippedMateria.primaryStatValue;
        }

        return stats;
    }

    cloneMelds(melds: MeldableMateriaSlot[]): MeldableMateriaSlot[] {
        let newMelds: MeldableMateriaSlot[] = [];
        for (let meld of melds) {
            newMelds.push(Object.assign({}, meld));
        }
        return newMelds;

    }
}