// English / Swahili. Anything not translated falls back to English.
const en = {
  'nav.dashboard': 'Dashboard', 'nav.assets': 'All Assets', 'nav.photos': 'Photos', 'nav.videos': 'Videos',
  'nav.documents': 'Documents', 'nav.audio': 'Audio', 'nav.projects': 'Projects', 'nav.collections': 'Collections',
  'nav.shared': 'Shared Assets', 'nav.approvals': 'Approval Queue', 'nav.trash': 'Trash & Archive',
  'nav.reports': 'Reports & Analytics', 'nav.users': 'User Management', 'nav.settings': 'Settings',
  'nav.library': 'Public Library', 'nav.section.library': 'Library', 'nav.section.organise': 'Organise',
  'nav.section.manage': 'Manage',
  'common.upload': 'Upload', 'common.search': 'Search', 'common.save': 'Save changes', 'common.cancel': 'Cancel',
  'common.delete': 'Delete', 'common.download': 'Download', 'common.share': 'Share', 'common.view': 'View',
  'common.edit': 'Edit', 'common.create': 'Create', 'common.close': 'Close', 'common.back': 'Back',
  'common.loading': 'Loading…', 'common.none': 'None', 'common.all': 'All', 'common.signout': 'Sign out',
  'common.signin': 'Sign in', 'common.more': 'Load more', 'common.confirm': 'Confirm', 'common.restore': 'Restore',
  'common.clear': 'Clear filters', 'common.add': 'Add', 'common.remove': 'Remove', 'common.copy': 'Copy',
  'common.open': 'Open',
  'dash.title': 'Welcome back', 'dash.subtitle': 'Here is what is happening in your digital asset library.',
  'dash.total': 'Total assets', 'dash.photos': 'Photographs', 'dash.videos': 'Videos', 'dash.documents': 'Documents',
  'dash.audio': 'Audio files', 'dash.storage': 'Storage used', 'dash.pending': 'Pending approvals',
  'dash.recent': 'Recently uploaded', 'dash.updated': 'Recently updated', 'dash.shared': 'Recently shared',
  'dash.published': 'Recently published', 'dash.notifications': 'Notifications', 'dash.activity': 'Team activity',
  'dash.bytype': 'Assets by type', 'dash.byproject': 'Assets by project', 'dash.bymonth': 'Uploads per month',
  'status.draft': 'Draft', 'status.pending_review': 'Pending review', 'status.changes_requested': 'Changes requested',
  'status.approved': 'Approved', 'status.published': 'Published', 'status.archived': 'Archived', 'status.rejected': 'Rejected',
  'cat.photo': 'Photo', 'cat.video': 'Video', 'cat.document': 'Document', 'cat.audio': 'Audio', 'cat.other': 'Other',
  'conf.public': 'Public', 'conf.internal': 'Internal', 'conf.restricted': 'Restricted', 'conf.confidential': 'Confidential',
  'role.super_admin': 'Super Administrator', 'role.org_admin': 'Organization Administrator',
  'role.executive': 'Executive Leadership', 'role.project_manager': 'Project Manager',
  'role.contributor': 'Contributor', 'role.viewer': 'Viewer', 'role.external': 'External Collaborator',
  'pub.hero.title': 'Stories, science and resources from the field',
  'pub.hero.sub': 'Photographs, videos, publications and learning materials from Terraviva, approved for you to explore and use.',
  'pub.explore': 'Explore the library', 'pub.staff': 'Staff sign in', 'pub.latest': 'Latest from the library',
  'pub.programs': 'Our programme areas', 'pub.nothing': 'Nothing published here yet.',
  'pub.nav.home': 'Home', 'pub.nav.explore': 'Explore', 'pub.nav.photos': 'Photos', 'pub.nav.videos': 'Videos',
  'pub.nav.publications': 'Publications', 'pub.nav.environment': 'Environment', 'pub.nav.agriculture': 'Agriculture',
  'pub.nav.projects': 'Projects', 'pub.nav.about': 'About', 'pub.nav.contact': 'Contact',
};
const sw = {
  'nav.dashboard': 'Dashibodi', 'nav.assets': 'Mali Zote', 'nav.photos': 'Picha', 'nav.videos': 'Video',
  'nav.documents': 'Nyaraka', 'nav.audio': 'Sauti', 'nav.projects': 'Miradi', 'nav.collections': 'Mikusanyiko',
  'nav.shared': 'Zilizoshirikiwa', 'nav.approvals': 'Foleni ya Idhini', 'nav.trash': 'Taka na Kumbukumbu',
  'nav.reports': 'Ripoti na Takwimu', 'nav.users': 'Watumiaji', 'nav.settings': 'Mipangilio',
  'nav.library': 'Maktaba ya Umma', 'nav.section.library': 'Maktaba', 'nav.section.organise': 'Panga', 'nav.section.manage': 'Simamia',
  'common.upload': 'Pakia', 'common.search': 'Tafuta', 'common.save': 'Hifadhi mabadiliko', 'common.cancel': 'Ghairi',
  'common.delete': 'Futa', 'common.download': 'Pakua', 'common.share': 'Shiriki', 'common.view': 'Tazama',
  'common.edit': 'Hariri', 'common.create': 'Unda', 'common.close': 'Funga', 'common.back': 'Rudi',
  'common.loading': 'Inapakia…', 'common.none': 'Hakuna', 'common.all': 'Zote', 'common.signout': 'Toka',
  'common.signin': 'Ingia', 'common.more': 'Pakia zaidi', 'common.confirm': 'Thibitisha', 'common.restore': 'Rejesha',
  'common.clear': 'Futa vichujio', 'common.add': 'Ongeza', 'common.remove': 'Ondoa', 'common.copy': 'Nakili', 'common.open': 'Fungua',
  'dash.title': 'Karibu tena', 'dash.subtitle': 'Hii ndiyo hali ya maktaba yako ya mali za kidijitali.',
  'dash.total': 'Jumla ya mali', 'dash.photos': 'Picha', 'dash.videos': 'Video', 'dash.documents': 'Nyaraka',
  'dash.audio': 'Faili za sauti', 'dash.storage': 'Hifadhi iliyotumika', 'dash.pending': 'Zinazosubiri idhini',
  'dash.recent': 'Zilizopakiwa hivi karibuni', 'dash.updated': 'Zilizosasishwa hivi karibuni', 'dash.shared': 'Zilizoshirikiwa hivi karibuni',
  'dash.published': 'Zilizochapishwa hivi karibuni', 'dash.notifications': 'Arifa', 'dash.activity': 'Shughuli za timu',
  'dash.bytype': 'Mali kwa aina', 'dash.byproject': 'Mali kwa mradi', 'dash.bymonth': 'Upakiaji kwa mwezi',
  'status.draft': 'Rasimu', 'status.pending_review': 'Inasubiri ukaguzi', 'status.changes_requested': 'Marekebisho yameombwa',
  'status.approved': 'Imeidhinishwa', 'status.published': 'Imechapishwa', 'status.archived': 'Kumbukumbu', 'status.rejected': 'Imekataliwa',
  'cat.photo': 'Picha', 'cat.video': 'Video', 'cat.document': 'Nyaraka', 'cat.audio': 'Sauti', 'cat.other': 'Nyingine',
  'conf.public': 'Ya umma', 'conf.internal': 'Ya ndani', 'conf.restricted': 'Yenye vikwazo', 'conf.confidential': 'Siri',
  'role.super_admin': 'Msimamizi Mkuu', 'role.org_admin': 'Msimamizi wa Shirika', 'role.executive': 'Uongozi Mkuu',
  'role.project_manager': 'Meneja wa Mradi', 'role.contributor': 'Mchangiaji', 'role.viewer': 'Mtazamaji', 'role.external': 'Mshirika wa Nje',
  'pub.hero.title': 'Hadithi, sayansi na rasilimali kutoka uwandani',
  'pub.hero.sub': 'Picha, video, machapisho na vifaa vya kujifunzia kutoka Terraviva, vilivyoidhinishwa ili uvitazame na kuvitumia.',
  'pub.explore': 'Chunguza maktaba', 'pub.staff': 'Wafanyakazi ingia', 'pub.latest': 'Mpya kwenye maktaba',
  'pub.programs': 'Maeneo yetu ya programu', 'pub.nothing': 'Hakuna kilichochapishwa hapa bado.',
  'pub.nav.home': 'Mwanzo', 'pub.nav.explore': 'Chunguza', 'pub.nav.photos': 'Picha', 'pub.nav.videos': 'Video',
  'pub.nav.publications': 'Machapisho', 'pub.nav.environment': 'Mazingira', 'pub.nav.agriculture': 'Kilimo',
  'pub.nav.projects': 'Miradi', 'pub.nav.about': 'Kuhusu', 'pub.nav.contact': 'Wasiliana',
};
const dict = { en, sw };
let lang = (navigator.language || '').startsWith('sw') ? 'sw' : 'en';
try { lang = localStorage.getItem('tv_lang') || lang; } catch { /* ignore */ }
document.documentElement.lang = lang;

export const getLang = () => lang;
export function setLang(l) {
  lang = l === 'sw' ? 'sw' : 'en';
  document.documentElement.lang = lang;
  try { localStorage.setItem('tv_lang', lang); } catch { /* ignore */ }
}
export const t = (key) => dict[lang][key] ?? en[key] ?? key;
/** Inline translation: tr('English text', 'Maandishi ya Kiswahili'). Falls back to English. */
export const tr = (enText, swText) => (lang === 'sw' && swText ? swText : enText);
