// Separate from payment callbacks; no database, session or Origin dependency.
export const runtime='nodejs';
export const dynamic='force-dynamic';
export {receiveLineWebhook as POST} from '../../../../lib/line-webhook.mjs';
