/** Case- and accent-insensitive A–Z order for object names (reused: creating a
 *  collator per comparison is very slow for tens of thousands of names). */
export const nameCollator = new Intl.Collator('en', { sensitivity: 'base' });
