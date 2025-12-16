/**
 * Ironic's Shop Module
 * A trading system for player-NPC interactions
 */

import { ShopApplication } from './apps/ShopApplication.js';
import { ShopAPI } from './api/ShopAPI.js';
import { MODULE_ID, TEMPLATES } from './constants.js';

// Register module
Hooks.once('init', async () => {
    console.log(`${MODULE_ID} | Initializing Ironic's Shop`);

    // Register module settings
    registerSettings();

    // Preload templates
    await preloadTemplates();

    // Expose API globally
    game.modules.get(MODULE_ID).api = ShopAPI;
    game.ironicShop = ShopAPI;
});

Hooks.once('ready', () => {
    console.log(`${MODULE_ID} | Ready`);
});

// ============================================
// Scene controls (adds: Shop, Shop Editor (GM))
// ============================================
Hooks.on('getSceneControlButtons', (controls) => {
    if (controls.ironic_options) {
        controls.ironic_options.tools.push({
            name: "ironic-shop",
            title: "Open Shop",
            icon: "fas fa-shop"
        });

        controls.ironic_options.tools.push({
            name: "ironic-shop-edit",
            title: "Shop Editor (GM)",
            icon: "fas fa-cash-register",
            visible: game.user.isGM
        });
    }
});

Hooks.on('renderSceneControls', (controls, html, data) => {
    // --- Player-facing: target-based shop button ---
    const shopButton = html.querySelector('[data-tool="ironic-shop"]');
    if (shopButton && !shopButton.dataset.bound) {
        shopButton.dataset.bound = "true";
        shopButton.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            // 1) If user already has a target, use it
            const preTarget = getFirstTargetOfCurrentUser();
            if (preTarget) {
                const ok = await openShopIfNPC(preTarget);
                if (ok) return;
            }

            // 2) Optional fallback: controlled or hovered token
            const preFallback = canvas.tokens.controlled[0] || canvas.tokens.placeables.find(t => t.hover);
            if (preFallback) {
                const ok = await openShopIfNPC(preFallback);
                if (ok) return;
            }

            // 3) Wait once for next target from THIS user
            ui.notifications.info("Target a merchant token to open their shop.");

            const onceTarget = async (token, userId, targeted) => {
                if (userId !== game.user.id || !targeted) return;
                Hooks.off('targetToken', onceTarget);
                await openShopIfNPC(token);
            };

            Hooks.on('targetToken', onceTarget);
        });
    }

    // --- GM-only: shop editor ---
    if (!game.user.isGM) return;
    const shopEditButton = html.querySelector('[data-tool="ironic-shop-edit"]');
    if (shopEditButton && !shopEditButton.dataset.bound) {
        shopEditButton.dataset.bound = "true";
        shopEditButton.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const pre = getTokenCandidate() || canvas.tokens?.controlled?.[0];
            if (pre?.actor?.type === "npc") {
                openShopEditor(pre.actor);
                return;
            }

            ui.notifications.info("GM: target an NPC token to open the Shop Editor.");

            const onceTargetGM = async (token, userId, targeted) => {
                if (userId !== game.user.id || !targeted) return;
                Hooks.off('targetToken', onceTargetGM);
                const a = token?.actor;
                if (!a || a.type !== "npc") return ui.notifications.warn("Please target an NPC.");
                openShopEditor(a);
            };

            Hooks.on('targetToken', onceTargetGM);
        });
    }
});

// =====================
// Helpers
// =====================
function isPCActor(a) {
    if (!a) return false;
    const t = a.type ?? a.document?.type;
    return t === "character" || a.hasPlayerOwner;
}

/** Best-effort PC for current user: assigned → controlled token → any owned character */
function getUserPCActor() {
    if (isPCActor(game.user.character)) return game.user.character;

    const ctrl = canvas.tokens?.controlled?.[0]?.actor;
    if (isPCActor(ctrl)) return ctrl;

    const owned = game.actors
        ?.filter(a => isPCActor(a) && (a.ownership?.[game.user.id] ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER);
    if (owned && owned[0]) return owned[0];

    return null;
}

function getFirstTargetOfCurrentUser() {
    const set = game.user?.targets;
    if (!set || set.size === 0) return null;
    return Array.from(set)[0];
}

// targeted → controlled → hovered
function getTokenCandidate() {
    const tgt = getFirstTargetOfCurrentUser();
    if (tgt) return tgt;
    if (canvas.tokens.controlled.length) return canvas.tokens.controlled[0];
    const hover = canvas.tokens.placeables.find(t => t.hover);
    if (hover) return hover;
    return null;
}

async function openShopIfNPC(token) {
    const actor = token?.actor;
    const type = actor?.type ?? actor?.document?.type;
    if (!actor || type !== "npc") {
        ui.notifications.warn("Please target an NPC token.");
        return false;
    }

    // Check if NPC has shop enabled
    const hasShop = actor.getFlag(MODULE_ID, 'isShop');
    if (!hasShop) {
        ui.notifications.warn(`${actor.name} is not a merchant.`);
        if (game.user.isGM) {
            ui.notifications.info("GM: Use the Shop Editor to set up this NPC as a merchant.");
        }
        return false;
    }

    const playerActor = getUserPCActor();
    if (!playerActor) {
        ui.notifications.warn("No player character found. Select a token or assign a character.");
        return false;
    }

    await ShopAPI.openShop({ shopActor: actor, playerActor });
    return true;
}

function openShopEditor(actor) {
    // For now, open a simple dialog to configure the shop
    // TODO: Create a full ShopEditor application
    new Dialog({
        title: `Shop Editor: ${actor.name}`,
        content: `
            <form>
                <div class="form-group">
                    <label>Enable as Shop?</label>
                    <input type="checkbox" name="isShop" ${actor.getFlag(MODULE_ID, 'isShop') ? 'checked' : ''}>
                </div>
                <p style="font-size: 0.85em; color: #888;">
                    The NPC's inventory and gold will be used as shop stock.
                    Add items to the NPC's inventory to stock the shop.
                </p>
            </form>
        `,
        buttons: {
            save: {
                icon: '<i class="fas fa-save"></i>',
                label: "Save",
                callback: async (html) => {
                    const isShop = html.find('[name="isShop"]').is(':checked');
                    await actor.setFlag(MODULE_ID, 'isShop', isShop);
                    ui.notifications.info(`${actor.name} ${isShop ? 'is now a merchant' : 'is no longer a merchant'}.`);
                }
            },
            openSheet: {
                icon: '<i class="fas fa-user"></i>',
                label: "Open Actor Sheet",
                callback: () => actor.sheet.render(true)
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            }
        },
        default: "save"
    }).render(true);
}

/**
 * Register module settings
 */
function registerSettings() {
    game.settings.register(MODULE_ID, 'defaultCurrency', {
        name: 'Default Currency',
        hint: 'The default currency property path on actors (e.g., system.currency.gp)',
        scope: 'world',
        config: true,
        type: String,
        default: 'system.currency.gp'
    });

    game.settings.register(MODULE_ID, 'itemPricePath', {
        name: 'Item Price Path',
        hint: 'The property path for item prices (e.g., system.price.value)',
        scope: 'world',
        config: true,
        type: String,
        default: 'system.price.value'
    });

    game.settings.register(MODULE_ID, 'allowNegativeGold', {
        name: 'Allow Negative Gold',
        hint: 'Allow trades that would result in negative gold for either party',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });
}

/**
 * Preload Handlebars templates
 */
async function preloadTemplates() {
    const templatePaths = Object.values(TEMPLATES);
    return loadTemplates(templatePaths);
}

// Export for external use
export { ShopApplication, ShopAPI };