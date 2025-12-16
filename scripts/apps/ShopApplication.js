/**
 * ShopApplication - Main shop trading interface
 * Handles the UI and logic for player-NPC trading
 */

import { MODULE_ID, TEMPLATES } from '../constants.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ShopApplication extends HandlebarsApplicationMixin(ApplicationV2) {
    
    /** @type {Actor} The shop/NPC actor */
    shopActor = null;
    
    /** @type {Actor} The player's actor */
    playerActor = null;
    
    /** @type {Map<string, {item: Item, quantity: number}>} Items player is offering */
    playerTradeItems = new Map();
    
    /** @type {Map<string, {item: Item, quantity: number}>} Items shop is offering */
    shopTradeItems = new Map();
    
    /** @type {Object} Currency the player is offering */
    playerTradeCurrency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
    
    /** @type {Object} Currency the shop is offering */
    shopTradeCurrency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };

    /** @type {string} Search filter for shop inventory */
    shopSearch = '';
    
    /** @type {string} Search filter for player inventory */
    playerSearch = '';
    
    /** @type {string} Sort method for shop inventory (name, price, quantity) */
    shopSort = 'name';
    
    /** @type {string} Sort method for player inventory */
    playerSort = 'name';

    static DEFAULT_OPTIONS = {
        id: 'ironic-shop-{id}',
        classes: ['ironic-shop'],
        tag: 'div',
        window: {
            frame: true,
            positioned: true,
            title: 'Shop',
            icon: 'fa-solid fa-shop',
            controls: [],
            minimizable: true,
            resizable: true,
            contentTag: 'section',
            contentClasses: []
        },
        actions: {
            confirm: ShopApplication.#onConfirm,
            cancel: ShopApplication.#onCancel,
            'remove-player-item': ShopApplication.#onRemovePlayerItem,
            'remove-shop-item': ShopApplication.#onRemoveShopItem
        },
        position: {
            width: 900,
            height: 800
        }
    };

    static PARTS = {
        main: {
            id: 'main',
            template: TEMPLATES.SHOP
        }
    };

    /**
     * @param {Object} options
     * @param {Actor} options.shopActor - The NPC/shop actor
     * @param {Actor} options.playerActor - The player's actor
     */
    constructor(options = {}) {
        super(options);
        this.shopActor = options.shopActor;
        this.playerActor = options.playerActor;

        if (!this.shopActor || !this.playerActor) {
            throw new Error('ShopApplication requires both shopActor and playerActor');
        }
    }

    get title() {
        return `Trading with ${this.shopActor.name}`;
    }

    /**
     * Prepare context data for rendering
     */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);

        const pricePath = game.settings.get(MODULE_ID, 'itemPricePath');

        // Get currency values (D&D 5e has multiple currencies)
        context.shopCurrency = this.#prepareCurrency(this.shopActor);
        context.playerCurrency = this.#prepareCurrency(this.playerActor);
        
        // For backward compatibility, also provide total gold value
        context.shopGold = this.#calculateTotalGold(context.shopCurrency);
        context.playerGold = this.#calculateTotalGold(context.playerCurrency);

        // Get inventories (with search and sort applied)
        context.shopInventory = this.#prepareInventory(this.shopActor, pricePath, 'shop', this.shopSearch, this.shopSort);
        context.playerInventory = this.#prepareInventory(this.playerActor, pricePath, 'player', this.playerSearch, this.playerSort);

        // Search and sort state
        context.shopSearch = this.shopSearch;
        context.playerSearch = this.playerSearch;
        context.shopSort = this.shopSort;
        context.playerSort = this.playerSort;

        // Trade items
        context.playerTradeItems = this.#prepareTradeItems(this.playerTradeItems);
        context.shopTradeItems = this.#prepareTradeItems(this.shopTradeItems);

        // Trade currency
        context.playerTradeCurrency = { ...this.playerTradeCurrency };
        context.shopTradeCurrency = { ...this.shopTradeCurrency };
        
        // Calculate total trade gold values for balance calculation
        context.playerTradeGold = this.#calculateTotalGold(this.playerTradeCurrency);
        context.shopTradeGold = this.#calculateTotalGold(this.shopTradeCurrency);

        // Calculate trade balance
        const balance = this.#calculateTradeBalance();
        context.tradeBalance = balance >= 0 ? `+${balance}` : balance;
        context.tradeBalanceClass = balance > 0 ? 'positive' : balance < 0 ? 'negative' : 'neutral';

        // Can confirm trade?
        context.canConfirm = this.#canConfirmTrade(context.playerCurrency, context.shopCurrency);

        return context;
    }

    /**
     * Prepare currency object for display
     */
    #prepareCurrency(actor) {
        const currency = actor.system?.currency ?? {};
        return {
            pp: currency.pp ?? 0,
            gp: currency.gp ?? 0,
            ep: currency.ep ?? 0,
            sp: currency.sp ?? 0,
            cp: currency.cp ?? 0
        };
    }

    /**
     * Calculate total gold value from all currencies
     */
    #calculateTotalGold(currency) {
        return (currency.pp ?? 0) * 10 +
               (currency.gp ?? 0) +
               (currency.ep ?? 0) * 0.5 +
               (currency.sp ?? 0) * 0.1 +
               (currency.cp ?? 0) * 0.01;
    }

    // inside class
        #toGold(amount, denom = 'gp') {
        switch ((denom || 'gp').toLowerCase()) {
            case 'pp': return Number(amount) * 10;
            case 'gp': return Number(amount);
            case 'ep': return Number(amount) * 0.5;
            case 'sp': return Number(amount) * 0.1;
            case 'cp': return Number(amount) * 0.01;
            default:   return Number(amount); // fallback = gp
        }
        }

        #prepareInventory(actor, pricePath, source, searchFilter = '', sortMethod = 'name') {
        let items = actor.items.filter(item => {
            const validTypes = ['weapon', 'equipment', 'consumable', 'tool', 'loot', 'container', 'gear', '物品'];
            return validTypes.includes(item.type);
        });

        if (searchFilter) {
            const search = searchFilter.toLowerCase();
            items = items.filter(item => item.name.toLowerCase().includes(search));
        }

        const preparedItems = items.map(item => {
            // read value + denom (dnd5e v3 has system.price.value + system.price.denomination)
            const rawValue = Number(foundry.utils.getProperty(item, pricePath) ?? 0);
            const denom = String(foundry.utils.getProperty(item, 'system.price.denomination') ?? 'gp').toLowerCase();

            const quantity = Number(foundry.utils.getProperty(item, 'system.quantity') ?? 1);
            const tradeMap = source === 'shop' ? this.shopTradeItems : this.playerTradeItems;
            const inTrade  = tradeMap.has(item.id);

            const priceInGp = this.#toGold(rawValue, denom);
            const priceLabel = `${rawValue} ${denom.toUpperCase()}`;

            return {
            id: item.id,
            uuid: item.uuid,
            name: item.name,
            img: item.img,
            // keep raw fields and also provide normalized + label
            price: rawValue,
            denom,
            priceInGp,
            priceLabel,
            quantity,
            inTrade
            };
        });

        // sort: use normalized gold value for price sorts
        switch (sortMethod) {
            case 'price':
            preparedItems.sort((a, b) => b.priceInGp - a.priceInGp);
            break;
            case 'price-asc':
            preparedItems.sort((a, b) => a.priceInGp - b.priceInGp);
            break;
            case 'quantity':
            preparedItems.sort((a, b) => b.quantity - a.quantity);
            break;
            case 'name':
            default:
            preparedItems.sort((a, b) => a.name.localeCompare(b.name));
            break;
        }

        return preparedItems;
        }


    /**
     * Prepare trade items for display
     */
    #prepareTradeItems(tradeMap) {
        return Array.from(tradeMap.values()).map(({ item, quantity }) => ({
            id: item.id,
            uuid: item.uuid,
            name: item.name,
            img: item.img,
            quantity: quantity
        }));
    }

    /**
     * Calculate the trade balance (positive = player advantage)
     */
    #calculateTradeBalance() {
        const pricePath = game.settings.get(MODULE_ID, 'itemPricePath');

        // Calculate player's offer value (currency + items)
        let playerOfferValue = this.#calculateTotalGold(this.playerTradeCurrency);
        for (const { item, quantity } of this.playerTradeItems.values()) {
            const price = foundry.utils.getProperty(item, pricePath) ?? 0;
            playerOfferValue += price * quantity;
        }

        // Calculate shop's offer value (currency + items)
        let shopOfferValue = this.#calculateTotalGold(this.shopTradeCurrency);
        for (const { item, quantity } of this.shopTradeItems.values()) {
            const price = foundry.utils.getProperty(item, pricePath) ?? 0;
            shopOfferValue += price * quantity;
        }

        // Positive = player getting more value than giving
        return shopOfferValue - playerOfferValue;
    }

    /**
     * Check if the trade can be confirmed
     */
    #canConfirmTrade(playerCurrency, shopCurrency) {
        // Must have something to trade
        const hasPlayerOffer = this.playerTradeItems.size > 0 || this.#calculateTotalGold(this.playerTradeCurrency) > 0;
        const hasShopOffer = this.shopTradeItems.size > 0 || this.#calculateTotalGold(this.shopTradeCurrency) > 0;

        if (!hasPlayerOffer && !hasShopOffer) return false;

        // Check currency constraints - player can't offer more than they have
        const allowNegative = game.settings.get(MODULE_ID, 'allowNegativeGold');
        if (!allowNegative) {
            for (const type of ['pp', 'gp', 'ep', 'sp', 'cp']) {
                if (this.playerTradeCurrency[type] > (playerCurrency[type] ?? 0)) return false;
                if (this.shopTradeCurrency[type] > (shopCurrency[type] ?? 0)) return false;
            }
        }

        // Trade balance must be <= 0 (player can't get more value than they give)
        const balance = this.#calculateTradeBalance();
        if (balance > 0) return false;

        return true;
    }

    /** Remember focus + caret before a render */
    _rememberFocus(target = document.activeElement) {
    const isTextLike = el =>
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    if (!isTextLike(target)) { this._focusMem = null; return; }

    const name = target.name || null;
    const id   = target.id || null;
    const selector = name ? `input[name="${name}"]` : (id ? `#${id}` : null);

    // caret not supported on type="number" in some browsers
    const canSelect = typeof target.selectionStart === 'number' &&
                        target.type !== 'number';

    this._focusMem = selector ? {
        selector,
        caret: canSelect ? target.selectionStart : null
    } : null;
    }

    /** Restore focus + caret after a render */
    _restoreFocus(root = this.element) {
    if (!this._focusMem) return;
    const el = root.querySelector(this._focusMem.selector);
    if (!el) return;

    el.focus({ preventScroll: true });
    const atEnd = el.value?.length ?? 0;
    const pos = (this._focusMem.caret == null) ? atEnd : Math.max(0, Math.min(this._focusMem.caret, atEnd));

    // setSelectionRange can throw on unsupported types (e.g., number)
    try { requestAnimationFrame(() => el.setSelectionRange(pos, pos)); } catch {}
    }

    /**
     * Attach event listeners after render
     */
    _onRender(context, options) {
        super._onRender(context, options);

        const html = this.element;

        // Inventory item clicks
        html.querySelectorAll('.inventory-item').forEach(el => {
            el.addEventListener('click', this.#onInventoryItemClick.bind(this));
            el.addEventListener('contextmenu', this.#onInventoryItemContext.bind(this));
        });

        // Currency input changes - Player
        ['PP', 'GP', 'EP', 'SP', 'CP'].forEach(type => {
            const input = html.querySelector(`input[name="playerTrade${type}"]`);
            input?.addEventListener('change', (e) => {
                this.playerTradeCurrency[type.toLowerCase()] = Math.max(0, parseInt(e.target.value) || 0);
                this.render();
            });
        });

        // Currency input changes - Shop
        ['PP', 'GP', 'EP', 'SP', 'CP'].forEach(type => {
            const input = html.querySelector(`input[name="shopTrade${type}"]`);
            input?.addEventListener('change', (e) => {
                this.shopTradeCurrency[type.toLowerCase()] = Math.max(0, parseInt(e.target.value) || 0);
                this.render();
            });
        });

        // Drag and drop support
        this.#setupDragDrop(html);

        // Search input handlers (debounced to avoid cursor issues)
        // SHOP search
        const shopSearchInput = html.querySelector('input[name="shopSearch"]');
        if (shopSearchInput) {
        shopSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
            e.preventDefault();
            this.shopSearch = e.target.value;
            this._rememberFocus(e.target);
            this.render();
            }
        });
        }

        // PLAYER search
        const playerSearchInput = html.querySelector('input[name="playerSearch"]');
        if (playerSearchInput) {
        playerSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
            e.preventDefault();
            this.playerSearch = e.target.value;
            this._rememberFocus(e.target);
            this.render();
            }
        });



        console.log("About to refocus")
        this._restoreFocus(html);


        }


        // Track focused element before render
        html.querySelectorAll('input[name="shopSearch"], input[name="playerSearch"]').forEach(input => {
            input.addEventListener('focus', (e) => {
                this._focusedElement = e.target.name;
            });
            input.addEventListener('blur', () => {
                this._focusedElement = null;
            });
        });

        // Sort select handlers
        html.querySelector('select[name="shopSort"]')?.addEventListener('change', (e) => {
            this.shopSort = e.target.value;
            this.render();
        });

        html.querySelector('select[name="playerSort"]')?.addEventListener('change', (e) => {
            this.playerSort = e.target.value;
            this.render();
        });
    }

    /**
     * Handle inventory item click - add to trade
     */
    async #onInventoryItemClick(event) {
        event.preventDefault();
        const itemEl = event.currentTarget;
        const itemId = itemEl.dataset.itemId;
        const source = itemEl.dataset.source;

        const actor = source === 'shop' ? this.shopActor : this.playerActor;
        const tradeMap = source === 'shop' ? this.shopTradeItems : this.playerTradeItems;

        const item = actor.items.get(itemId);
        if (!item) return;

        // If already in trade, remove it
        if (tradeMap.has(itemId)) {
            tradeMap.delete(itemId);
            this.render();
            return;
        }

        const maxQuantity = item.system.quantity ?? 1;
        let quantity = 1;

        // Prompt for quantity if more than 1 available
        if (maxQuantity > 1) {
            quantity = await this.#promptQuantity(item.name, maxQuantity);
            if (quantity === null || quantity <= 0) return; // Cancelled or invalid
        }

        tradeMap.set(itemId, { item, quantity });
        this.render();
    }

    /**
     * Prompt user for quantity
     */
    async #promptQuantity(itemName, maxQuantity) {
        return new Promise((resolve) => {
            new Dialog({
                title: `Select Quantity`,
                content: `
                    <form>
                        <div class="form-group">
                            <label>How many "${itemName}" to trade?</label>
                            <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px;">
                                <input type="range" name="quantity" min="1" max="${maxQuantity}" value="1" style="flex: 1;">
                                <input type="number" name="quantityNum" min="1" max="${maxQuantity}" value="1" style="width: 60px; text-align: center;">
                            </div>
                            <p style="text-align: center; margin-top: 4px; color: #999; font-size: 0.85rem;">Max: ${maxQuantity}</p>
                        </div>
                    </form>
                `,
                buttons: {
                    confirm: {
                        icon: '<i class="fas fa-check"></i>',
                        label: "Confirm",
                        callback: (html) => {
                            const qty = parseInt(html.find('input[name="quantityNum"]').val()) || 1;
                            resolve(Math.min(Math.max(1, qty), maxQuantity));
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel",
                        callback: () => resolve(null)
                    }
                },
                default: "confirm",
                render: (html) => {
                    const slider = html.find('input[name="quantity"]');
                    const numInput = html.find('input[name="quantityNum"]');
                    slider.on('input', () => numInput.val(slider.val()));
                    numInput.on('change', () => slider.val(numInput.val()));
                },
                close: () => resolve(null)
            }).render(true);
        });
    }

    /**
     * Handle right-click on inventory item - show item sheet
     */
    #onInventoryItemContext(event) {
        event.preventDefault();
        const itemEl = event.currentTarget;
        const itemId = itemEl.dataset.itemId;
        const source = itemEl.dataset.source;

        const actor = source === 'shop' ? this.shopActor : this.playerActor;
        const item = actor.items.get(itemId);
        
        if (item) {
            item.sheet.render(true);
        }
    }

    /**
     * Setup drag and drop functionality
     */
    #setupDragDrop(html) {
        // Make inventory items draggable
        html.querySelectorAll('.inventory-item').forEach(el => {
            el.setAttribute('draggable', 'true');
            el.addEventListener('dragstart', this.#onDragStart.bind(this));
        });

        // Make trade lists drop targets
        html.querySelectorAll('.trade-list').forEach(el => {
            el.addEventListener('dragover', (e) => e.preventDefault());
            el.addEventListener('drop', this.#onDrop.bind(this));
        });
    }

    /**
     * Handle drag start
     */
    #onDragStart(event) {
        const itemEl = event.currentTarget;
        event.dataTransfer.setData('text/plain', JSON.stringify({
            itemId: itemEl.dataset.itemId,
            source: itemEl.dataset.source
        }));
    }

    /**
     * Handle drop on trade list
     */
    #onDrop(event) {
        event.preventDefault();
        
        try {
            const data = JSON.parse(event.dataTransfer.getData('text/plain'));
            const tradeType = event.currentTarget.dataset.trade;

            // Determine if drop is valid
            if (tradeType === 'player-items' && data.source === 'player') {
                const item = this.playerActor.items.get(data.itemId);
                if (item && !this.playerTradeItems.has(data.itemId)) {
                    this.playerTradeItems.set(data.itemId, { item, quantity: 1 });
                    this.render();
                }
            } else if (tradeType === 'shop-items' && data.source === 'shop') {
                const item = this.shopActor.items.get(data.itemId);
                if (item && !this.shopTradeItems.has(data.itemId)) {
                    this.shopTradeItems.set(data.itemId, { item, quantity: 1 });
                    this.render();
                }
            }
        } catch (e) {
            console.error('Drop error:', e);
        }
    }

    /**
     * Handle confirm button
     */
    static async #onConfirm(event, target) {
        await this.executeTrade();
    }

    /**
     * Handle cancel button
     */
    static #onCancel(event, target) {
        this.close();
    }

    /**
     * Handle remove player trade item
     */
    static #onRemovePlayerItem(event, target) {
        const itemId = target.dataset.itemId;
        this.playerTradeItems.delete(itemId);
        this.render();
    }

    /**
     * Handle remove shop trade item
     */
    static #onRemoveShopItem(event, target) {
        const itemId = target.dataset.itemId;
        this.shopTradeItems.delete(itemId);
        this.render();
    }

    /**
     * Execute the trade
     */
    async executeTrade() {
        try {
            // Get current currency values
            const playerCurrency = this.#prepareCurrency(this.playerActor);
            const shopCurrency = this.#prepareCurrency(this.shopActor);

            // Calculate new currency values
            const newPlayerCurrency = {};
            const newShopCurrency = {};
            
            for (const type of ['pp', 'gp', 'ep', 'sp', 'cp']) {
                newPlayerCurrency[type] = (playerCurrency[type] ?? 0) - (this.playerTradeCurrency[type] ?? 0) + (this.shopTradeCurrency[type] ?? 0);
                newShopCurrency[type] = (shopCurrency[type] ?? 0) - (this.shopTradeCurrency[type] ?? 0) + (this.playerTradeCurrency[type] ?? 0);
            }

            // Collect items to transfer
            const itemsToPlayer = [];
            const itemsToShop = [];

            for (const { item, quantity } of this.shopTradeItems.values()) {
                itemsToPlayer.push({ item, quantity });
            }

            for (const { item, quantity } of this.playerTradeItems.values()) {
                itemsToShop.push({ item, quantity });
            }

            // Execute transfers
            // Update currency
            await this.playerActor.update({
                'system.currency.pp': newPlayerCurrency.pp,
                'system.currency.gp': newPlayerCurrency.gp,
                'system.currency.ep': newPlayerCurrency.ep,
                'system.currency.sp': newPlayerCurrency.sp,
                'system.currency.cp': newPlayerCurrency.cp
            });
            await this.shopActor.update({
                'system.currency.pp': newShopCurrency.pp,
                'system.currency.gp': newShopCurrency.gp,
                'system.currency.ep': newShopCurrency.ep,
                'system.currency.sp': newShopCurrency.sp,
                'system.currency.cp': newShopCurrency.cp
            });

            // Transfer items from shop to player
            for (const { item, quantity } of itemsToPlayer) {
                await this.#transferItem(item, this.shopActor, this.playerActor, quantity);
            }

            // Transfer items from player to shop
            for (const { item, quantity } of itemsToShop) {
                await this.#transferItem(item, this.playerActor, this.shopActor, quantity);
            }

            // Show success notification
            ui.notifications.info(`Trade completed with ${this.shopActor.name}!`);

            // Reset trade state
            this.playerTradeItems.clear();
            this.shopTradeItems.clear();
            this.playerTradeCurrency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
            this.shopTradeCurrency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };

            // Re-render to show updated inventories
            this.render();

        } catch (error) {
            console.error('Trade execution error:', error);
            ui.notifications.error('Failed to complete trade. See console for details.');
        }
    }

    /**
     * Clear the current trade without closing
     */
    clearTrade() {
        this.playerTradeItems.clear();
        this.shopTradeItems.clear();
        this.playerTradeCurrency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
        this.shopTradeCurrency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
        this.render();
    }

    /**
     * Transfer an item from one actor to another, stacking if possible
     * @param {Item} item - The item to transfer
     * @param {Actor} fromActor - The source actor
     * @param {Actor} toActor - The destination actor
     * @param {number} quantity - The quantity to transfer
     */
    async #transferItem(item, fromActor, toActor, quantity) {
        // Find existing stackable item in target actor
        // Match by sourceId (if from compendium) or by name and type
        const sourceId = item.flags?.core?.sourceId;
        let existingItem = null;

        if (sourceId) {
            // Try to find by source ID first (most reliable for compendium items)
            existingItem = toActor.items.find(i => i.flags?.core?.sourceId === sourceId);
        }

        if (!existingItem) {
            // Fall back to matching by name and type
            existingItem = toActor.items.find(i => 
                i.name === item.name && 
                i.type === item.type
            );
        }

        if (existingItem) {
            // Stack onto existing item
            const existingQty = existingItem.system.quantity ?? 1;
            await existingItem.update({ 'system.quantity': existingQty + quantity });
        } else {
            // Create new item
            const itemData = item.toObject();
            itemData.system.quantity = quantity;
            // Remove the _id so a new one is generated
            delete itemData._id;
            await toActor.createEmbeddedDocuments('Item', [itemData]);
        }

        // Remove or reduce quantity from source
        const currentQty = item.system.quantity ?? 1;
        if (currentQty <= quantity) {
            await item.delete();
        } else {
            await item.update({ 'system.quantity': currentQty - quantity });
        }
    }

    /** Remember focus + caret before a render */


}