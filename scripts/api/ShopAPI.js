/**
 * ShopAPI - Public API for the shop module
 * Provides methods for opening shops and managing trades
 */

import { ShopApplication } from '../apps/ShopApplication.js';
import { MODULE_ID } from '../constants.js';

export class ShopAPI {
    
    /** @type {Map<string, ShopApplication>} Active shop windows */
    static #activeShops = new Map();

    /**
     * Open a shop interface between a player and an NPC
     * 
     * @param {Object} options
     * @param {Actor|string} options.shopActor - The shop/NPC actor or actor ID
     * @param {Actor|string} [options.playerActor] - The player's actor or actor ID (defaults to selected token's actor)
     * @returns {Promise<ShopApplication>}
     */
    static async openShop({ shopActor, playerActor } = {}) {
        // Resolve shop actor
        if (typeof shopActor === 'string') {
            shopActor = game.actors.get(shopActor) ?? game.actors.getName(shopActor);
        }
        
        if (!shopActor) {
            ui.notifications.error('Shop actor not found');
            return null;
        }

        // Resolve player actor
        if (!playerActor) {
            const token = canvas.tokens?.controlled?.[0];
            playerActor = token?.actor;
            
            if (!playerActor) {
                playerActor = game.user.character;
            }
        } else if (typeof playerActor === 'string') {
            playerActor = game.actors.get(playerActor) ?? game.actors.getName(playerActor);
        }

        if (!playerActor) {
            ui.notifications.error('No player actor found. Select a token or assign a character.');
            return null;
        }

        // Create unique key for this shop instance
        const shopKey = `${shopActor.id}-${playerActor.id}`;

        // Check if already open and still rendered
        if (this.#activeShops.has(shopKey)) {
            const existing = this.#activeShops.get(shopKey);
            // Verify the window is still rendered
            if (existing.element) {
                existing.bringToFront();
                return existing;
            } else {
                // Stale reference, remove it
                this.#activeShops.delete(shopKey);
            }
        }

        const shop = new ShopApplication({
            shopActor,
            playerActor
        });

        this.#activeShops.set(shopKey, shop);

        shop.addEventListener('close', () => {
            this.#activeShops.delete(shopKey);
        });

        await shop.render(true);

        return shop;
    }

    /**
     * Open a shop from a token
     */
    static async openShopFromToken(shopToken, playerToken) {
        if (typeof shopToken === 'string') {
            shopToken = canvas.tokens.get(shopToken);
        }

        if (!shopToken?.actor) {
            ui.notifications.error('Shop token not found or has no actor');
            return null;
        }

        let playerActor;
        if (playerToken) {
            if (typeof playerToken === 'string') {
                playerToken = canvas.tokens.get(playerToken);
            }
            playerActor = playerToken?.actor;
        }

        return this.openShop({
            shopActor: shopToken.actor,
            playerActor
        });
    }

    /**
     * Close all active shop windows
     */
    static closeAll() {
        for (const shop of this.#activeShops.values()) {
            shop.close();
        }
        this.#activeShops.clear();
    }

    /**
     * Get all active shop instances
     */
    static getActiveShops() {
        return Array.from(this.#activeShops.values());
    }

    /**
     * Check if an actor has a shop open
     */
    static hasActiveShop(actor) {
        const actorId = typeof actor === 'string' ? actor : actor.id;
        for (const key of this.#activeShops.keys()) {
            if (key.includes(actorId)) return true;
        }
        return false;
    }

    /**
     * Create a shop inventory for an actor
     */
    static async setupShop(actor, { gold = 1000, items = [] } = {}) {
        if (!actor) {
            throw new Error('Actor is required');
        }

        const currencyPath = game.settings.get(MODULE_ID, 'defaultCurrency');

        await actor.update({ [currencyPath]: gold });

        if (items.length > 0) {
            const itemData = items.map(item => {
                if (item instanceof Item) {
                    return item.toObject();
                }
                return item;
            });
            await actor.createEmbeddedDocuments('Item', itemData);
        }

        ui.notifications.info(`${actor.name} has been set up as a shop with ${gold} gold.`);
        return actor;
    }

    /**
     * Quick buy - purchase an item directly without opening the full interface
     */
    static async quickBuy({ shopActor, playerActor, item, quantity = 1 }) {
        const currencyPath = game.settings.get(MODULE_ID, 'defaultCurrency');
        const pricePath = game.settings.get(MODULE_ID, 'itemPricePath');

        if (typeof item === 'string') {
            item = shopActor.items.get(item);
        }

        if (!item) {
            ui.notifications.error('Item not found');
            return false;
        }

        const price = (foundry.utils.getProperty(item, pricePath) ?? 0) * quantity;
        const playerGold = foundry.utils.getProperty(playerActor, currencyPath) ?? 0;
        const shopGold = foundry.utils.getProperty(shopActor, currencyPath) ?? 0;

        if (playerGold < price) {
            ui.notifications.warn(`Not enough gold. Need ${price}, have ${playerGold}.`);
            return false;
        }

        const itemQty = item.system.quantity ?? 1;
        if (itemQty < quantity) {
            ui.notifications.warn(`Not enough in stock. Need ${quantity}, have ${itemQty}.`);
            return false;
        }

        try {
            await playerActor.update({ [currencyPath]: playerGold - price });
            await shopActor.update({ [currencyPath]: shopGold + price });

            const itemData = item.toObject();
            itemData.system.quantity = quantity;
            await playerActor.createEmbeddedDocuments('Item', [itemData]);

            if (itemQty <= quantity) {
                await item.delete();
            } else {
                await item.update({ 'system.quantity': itemQty - quantity });
            }

            ui.notifications.info(`Purchased ${quantity}x ${item.name} for ${price} gold.`);
            return true;

        } catch (error) {
            console.error('Quick buy error:', error);
            ui.notifications.error('Purchase failed. See console for details.');
            return false;
        }
    }

    /**
     * Quick sell - sell an item directly without opening the full interface
     */
    static async quickSell({ shopActor, playerActor, item, quantity = 1, sellRatio = 0.5 }) {
        const currencyPath = game.settings.get(MODULE_ID, 'defaultCurrency');
        const pricePath = game.settings.get(MODULE_ID, 'itemPricePath');

        if (typeof item === 'string') {
            item = playerActor.items.get(item);
        }

        if (!item) {
            ui.notifications.error('Item not found');
            return false;
        }

        const basePrice = foundry.utils.getProperty(item, pricePath) ?? 0;
        const sellPrice = Math.floor(basePrice * sellRatio) * quantity;
        const playerGold = foundry.utils.getProperty(playerActor, currencyPath) ?? 0;
        const shopGold = foundry.utils.getProperty(shopActor, currencyPath) ?? 0;

        if (shopGold < sellPrice) {
            ui.notifications.warn(`Shop doesn't have enough gold. Need ${sellPrice}, shop has ${shopGold}.`);
            return false;
        }

        const itemQty = item.system.quantity ?? 1;
        if (itemQty < quantity) {
            ui.notifications.warn(`Not enough items. Need ${quantity}, have ${itemQty}.`);
            return false;
        }

        try {
            await playerActor.update({ [currencyPath]: playerGold + sellPrice });
            await shopActor.update({ [currencyPath]: shopGold - sellPrice });

            const itemData = item.toObject();
            itemData.system.quantity = quantity;
            await shopActor.createEmbeddedDocuments('Item', [itemData]);

            if (itemQty <= quantity) {
                await item.delete();
            } else {
                await item.update({ 'system.quantity': itemQty - quantity });
            }

            ui.notifications.info(`Sold ${quantity}x ${item.name} for ${sellPrice} gold.`);
            return true;

        } catch (error) {
            console.error('Quick sell error:', error);
            ui.notifications.error('Sale failed. See console for details.');
            return false;
        }
    }
}