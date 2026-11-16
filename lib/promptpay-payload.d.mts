export declare const MAX_PROMPTPAY_SATANG:number;
export declare function normalizePromptPayId(raw:unknown):{type:"phone"|"national_id";value:string}|null;
export declare function buildPromptPayPayload(promptPayId:string,satang:number):string;
