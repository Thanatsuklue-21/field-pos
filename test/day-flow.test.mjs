import test from 'node:test';
import {runDayFlow} from '../scripts/qa-day-flow.mjs';
test('full day: decimal bills, delivery GP, VOID, produced refund loss, purchases and cash shortage agree',async()=>{await runDayFlow()});
test('full day: business loss can coexist with balanced drawer while delivery settlement flags a shortage',async()=>{await runDayFlow({extraBankExpense:1000,countedCash:515.50,receivedDeliveryAmount:76.34})});
