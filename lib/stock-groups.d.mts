export declare const STOCK_GROUPS:ReadonlyArray<{key:string;label:string}>;
export declare function stockGroupOf(item:{id?:string;name?:string}):string;
export declare function needsRestock(item:{qty?:number;lowStock?:boolean;archived?:boolean}):boolean;
