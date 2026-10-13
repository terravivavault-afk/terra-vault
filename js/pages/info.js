// Static public pages: About, Contact, Privacy policy, Terms of use.
import { state } from '../lib/state.js';
import { html, raw, mount } from '../lib/util.js';
import { t, tr } from '../lib/i18n.js';
import { icon } from '../lib/icons.js';
import { programName } from '../lib/ui.js';
import { setting } from '../shell.js';

const section = (h, ...paras) => html`<section class="prose-block"><h2>${h}</h2>${paras.map((p) => html`<p>${p}</p>`)}</section>`;

function about() {
  return html`
    <section class="page-banner"><div class="container"><h1>${tr('About TerraVault', 'Kuhusu TerraVault')}</h1>
      <p>${tr('The digital home of Terraviva’s photographs, videos, reports and learning materials.', 'Makazi ya kidijitali ya picha, video, ripoti na vifaa vya kujifunzia vya Terraviva.')}</p></div></section>
    <div class="container prose pad-lg">
      ${section(tr('Why we built it', 'Kwa nini tuliijenga'),
        tr('Terraviva works on environmental conservation, sustainable agriculture, youth and women empowerment, and reproductive health education around Mwanza and the Lake Victoria basin. Our work produces thousands of files. TerraVault keeps them organised, protected and easy to find.', 'Terraviva inafanya kazi katika uhifadhi wa mazingira, kilimo endelevu, uwezeshaji wa vijana na wanawake, na elimu ya afya ya uzazi kuzunguka Mwanza na bonde la Ziwa Victoria. Kazi yetu huzalisha maelfu ya mafaili. TerraVault huyapanga, kuyalinda na kuyafanya rahisi kupatikana.'))}
      ${section(tr('What is public and what is not', 'Nini ni cha umma na nini si cha umma'),
        tr('Only items that Terraviva has reviewed, approved and deliberately published appear in this library. Internal documents, drafts, confidential records and sensitive programme files stay private behind a sign-in.', 'Ni vipengee tu ambavyo Terraviva imevikagua, kuviidhinisha na kuvichapisha kwa makusudi ndivyo vinavyoonekana kwenye maktaba hii. Nyaraka za ndani, rasimu, rekodi za siri na mafaili nyeti ya programu hubaki faragha nyuma ya kuingia.'),
        tr('Partners and donors can be invited by name to see selected material that is not public.', 'Washirika na wafadhili wanaweza kualikwa kwa jina kuona vifaa teule visivyo vya umma.'))}
      <section class="prose-block"><h2>${tr('Our work areas', 'Maeneo yetu ya kazi')}</h2>
        <ul class="plain-list">${state.programs.map((p) => html`<li><b>${programName(p)}</b><span>${p.description || ''}</span></li>`)}</ul></section>
      <p><a class="btn btn-primary" href="#/explore">${t('pub.explore')}</a></p>
    </div>`;
}

function contact() {
  const email = setting('contact_email');
  const phone = setting('contact_phone');
  const address = setting('contact_address', 'Mwanza, Tanzania');
  const site = setting('website');
  return html`
    <section class="page-banner"><div class="container"><h1>${tr('Contact Terraviva', 'Wasiliana na Terraviva')}</h1>
      <p>${tr('Questions about a resource, a partnership or permission to use our material? Write to us.', 'Maswali kuhusu rasilimali, ushirikiano au ruhusa ya kutumia vifaa vyetu? Tuandikie.')}</p></div></section>
    <div class="container pad-lg">
      <div class="contact-grid">
        <div class="contact-card">
          <ul class="contact-list">
            <li>${raw(icon('pin', 20))}<div><b>${tr('Where we are', 'Tulipo')}</b><span>${address}</span></div></li>
            ${email ? html`<li>${raw(icon('mail', 20))}<div><b>${tr('Email', 'Barua pepe')}</b><a href="mailto:${email}">${email}</a></div></li>` : ''}
            ${phone ? html`<li>${raw(icon('phone', 20))}<div><b>${tr('Phone', 'Simu')}</b><a href="tel:${phone}">${phone}</a></div></li>` : ''}
            ${site ? html`<li>${raw(icon('globe', 20))}<div><b>${tr('Website', 'Tovuti')}</b><a href="${site}" rel="noopener" target="_blank">${site}</a></div></li>` : ''}
          </ul>
          ${!email && !phone ? html`<p class="muted-text">${tr('Contact details are being set up. Please check back soon.', 'Mawasiliano yanaandaliwa. Tafadhali rudi hivi karibuni.')}</p>` : ''}
          ${email ? html`<a class="btn btn-primary" href="mailto:${email}?subject=TerraVault">${raw(icon('send', 18))}${tr('Send an email', 'Tuma barua pepe')}</a>` : ''}
        </div>
        <div class="contact-card">
          <h2>${tr('Asking to use our material?', 'Unaomba kutumia vifaa vyetu?')}</h2>
          <p>${tr('Each public item shows its credit and usage terms. When in doubt, tell us the item title, how you plan to use it and where it will appear.', 'Kila kipengee cha umma kinaonyesha shukrani na masharti ya matumizi. Ukiwa na shaka, tuambie jina la kipengee, jinsi utakavyokitumia na kitakapoonekana.')}</p>
          <h2>${tr('Need access to non-public files?', 'Unahitaji mafaili yasiyo ya umma?')}</h2>
          <p>${tr('Partners and donors are invited by name. Ask your Terraviva contact to send you an invitation.', 'Washirika na wafadhili hualikwa kwa jina. Muulize mwasiliani wako wa Terraviva akutumie mwaliko.')}</p>
        </div>
      </div>
    </div>`;
}

function privacy() {
  return html`
    <section class="page-banner"><div class="container"><h1>${tr('Privacy policy', 'Sera ya faragha')}</h1>
      <p>${tr('How TerraVault handles information.', 'Jinsi TerraVault inavyoshughulikia taarifa.')}</p></div></section>
    <div class="container prose pad-lg">
      ${section(tr('Browsing the public library', 'Kutumia maktaba ya umma'),
        tr('You can browse and download published items without an account. We do not ask for personal details to do this. We keep simple counts of how often an item is viewed or downloaded.', 'Unaweza kutazama na kupakua vipengee vilivyochapishwa bila akaunti. Hatuombi taarifa binafsi kwa hili. Tunahifadhi hesabu rahisi ya mara ambazo kipengee kimetazamwa au kupakuliwa.'))}
      ${section(tr('Accounts for staff, partners and donors', 'Akaunti za wafanyakazi, washirika na wafadhili'),
        tr('If you have an account we store your name, email address, role, and a record of important actions such as uploads, approvals, sharing and downloads of internal files. This record exists for accountability and security.', 'Ikiwa una akaunti tunahifadhi jina lako, barua pepe, wadhifa na kumbukumbu ya vitendo muhimu kama kupakia, kuidhinisha, kushiriki na kupakua mafaili ya ndani. Kumbukumbu hii ipo kwa uwajibikaji na usalama.'),
        tr('Only authorised Terraviva administrators can see this record.', 'Ni wasimamizi walioidhinishwa wa Terraviva tu wanaoweza kuiona.'))}
      ${section(tr('Photographs of people', 'Picha za watu'),
        tr('Photographs showing people are published only where Terraviva has recorded consent. If you appear in a published item and want it removed, contact us and we will unpublish it promptly.', 'Picha zinazoonyesha watu huchapishwa tu pale Terraviva imerekodi ridhaa. Ikiwa unaonekana kwenye kipengee kilichochapishwa na unataka kiondolewe, wasiliana nasi nasi tutakiondoa haraka.'))}
      ${section(tr('Browser storage', 'Hifadhi ya kivinjari'),
        tr('We use your browser’s storage to keep you signed in and to remember your language choice. We do not use advertising or tracking cookies.', 'Tunatumia hifadhi ya kivinjari chako kukuweka umeingia na kukumbuka lugha uliyochagua. Hatutumii vidakuzi vya matangazo wala vya kukufuatilia.'))}
      ${section(tr('Your choices', 'Machaguo yako'),
        tr('You can ask us to correct or delete your account details at any time through the contact page.', 'Unaweza kutuomba kusahihisha au kufuta taarifa za akaunti yako wakati wowote kupitia ukurasa wa mawasiliano.'))}
    </div>`;
}

function terms() {
  return html`
    <section class="page-banner"><div class="container"><h1>${tr('Terms of use', 'Masharti ya matumizi')}</h1>
      <p>${tr('Please read these before using material from the library.', 'Tafadhali yasome kabla ya kutumia vifaa kutoka maktaba.')}</p></div></section>
    <div class="container prose pad-lg">
      ${section(tr('Using published material', 'Kutumia vifaa vilivyochapishwa'),
        tr('Each item shows its credit and usage terms. Follow them. Where no terms are shown, you may use the item for non-commercial education and awareness if you credit “Terraviva” and any named creator.', 'Kila kipengee kinaonyesha shukrani na masharti ya matumizi. Yafuate. Pale ambapo hakuna masharti, unaweza kukitumia kwa elimu na uhamasishaji usio wa kibiashara ukitaja “Terraviva” na muundaji aliyetajwa.'))}
      ${section(tr('Please do not', 'Tafadhali usifanye'),
        tr('Do not change an item so that it misrepresents Terraviva, the people shown, or the facts. Do not use material to suggest that Terraviva endorses a product, a political position or a person.', 'Usibadilishe kipengee kwa namna inayopotosha kuhusu Terraviva, watu walioonyeshwa, au ukweli. Usitumie vifaa kudokeza kwamba Terraviva inaunga mkono bidhaa, msimamo wa kisiasa au mtu.'))}
      ${section(tr('Accounts', 'Akaunti'),
        tr('Keep your sign-in details private. Do not share internal files outside the permissions you were given. Terraviva may suspend an account that breaks these terms.', 'Weka siri taarifa zako za kuingia. Usishiriki mafaili ya ndani nje ya ruhusa ulizopewa. Terraviva inaweza kusimamisha akaunti inayovunja masharti haya.'))}
      ${section(tr('Changes', 'Mabadiliko'),
        tr('We may update these terms as the library grows. The version on this page is the current one.', 'Tunaweza kusasisha masharti haya maktaba inavyokua. Toleo lililo kwenye ukurasa huu ndilo la sasa.'))}
    </div>`;
}

export default async function info(ctx) {
  const page = { about, contact, privacy, terms }[ctx.opts.page];
  mount(ctx.view, page());
}
