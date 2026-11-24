export declare function normalizeVariantLabel(label: unknown): string;
export declare function quickAddVariant<T extends {label: string; available?: boolean}>(variants: readonly T[] | null | undefined, menuName?: string): T | null;
export declare function mustAskSweetness(name: unknown): boolean;
export declare function shortVariantLabel(label: string): string;
export declare function moveOneUnitToVariant<T extends {key: string; id: string; variant: string; qty: number}>(items: readonly T[], key: string, variantLabel: string): T[];
