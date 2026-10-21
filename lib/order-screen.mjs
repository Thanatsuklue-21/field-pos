/** @template {{available?: boolean}} T @param {readonly T[]} menus @returns {T[]} */
export function availableMenusFirst(menus){
 return [...menus.filter(menu=>menu.available),...menus.filter(menu=>!menu.available)];
}
