// Human wording for audit-log actions and shared colours.
import { tr } from './i18n.js';

export const CAT_COLOR = { photo: '#007C7E', video: '#4A7023', document: '#C4874A', audio: '#16B3A8', other: '#9AA58A' };

const ACTIONS = {
  'asset.upload': ['uploaded', 'alipakia'],
  'asset.pending_review': ['submitted for review', 'aliwasilisha kwa ukaguzi'],
  'asset.approved': ['approved', 'aliidhinisha'],
  'asset.changes_requested': ['requested changes to', 'aliomba marekebisho ya'],
  'asset.rejected': ['rejected', 'alikataa'],
  'asset.published': ['published', 'alichapisha'],
  'asset.archived': ['archived', 'aliweka kumbukumbuni'],
  'asset.draft': ['moved back to draft', 'alirudisha kuwa rasimu'],
  'asset.trashed': ['moved to trash', 'alihamisha kwenye taka'],
  'asset.restored': ['restored', 'alirejesha'],
  'asset.version_added': ['added a new version of', 'aliongeza toleo jipya la'],
  'asset.download': ['downloaded', 'alipakua'],
  'asset.view': ['viewed', 'alitazama'],
  'asset.confidentiality_changed': ['changed visibility of', 'alibadilisha uonekanaji wa'],
  'share.created': ['shared', 'alishiriki'],
  'share.revoked': ['revoked a share of', 'alifuta ushiriki wa'],
  'share.accessed': ['opened a shared item', 'alifungua kilichoshirikiwa'],
  'project.created': ['created project', 'aliunda mradi'],
  'collection.created': ['created collection', 'aliunda mkusanyiko'],
  'user.invited': ['invited', 'alialika'],
  'user.role_changed': ['changed the role of', 'alibadilisha wadhifa wa'],
  'user.status_changed': ['changed the account status of', 'alibadilisha hali ya akaunti ya'],
  'report.export': ['exported a report', 'alisafirisha ripoti'],
  'auth.login': ['signed in', 'aliingia'],
};
export const ACTION_KEYS = Object.keys(ACTIONS);
export const actionLabel = (a) => (ACTIONS[a] ? tr(ACTIONS[a][0], ACTIONS[a][1]) : a);
