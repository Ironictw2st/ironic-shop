/**
 * Module Constants
 */

export const MODULE_ID = 'ironic-shop';

export const TEMPLATES = {
    SHOP: `modules/${MODULE_ID}/templates/shop-application.hbs`
};

export const SOCKET_NAME = `module.${MODULE_ID}`;

export const SOCKET_ACTIONS = {
    TRADE_REQUEST: 'tradeRequest',
    TRADE_COMPLETE: 'tradeComplete',
    TRADE_CANCELLED: 'tradeCancelled',
    SYNC_SHOP: 'syncShop'
};