// GENERATED — do not edit by hand.
// Run `pnpm --filter @obelus/web build:sample-seed` to regenerate.
// Source: apps/web/scripts/sample-annotations.source.json

import type { PdfAnchorFields } from "@obelus/repo";

export const SAMPLE_TITLE = "Daedalus & Icarus";
export const SAMPLE_PDF_URL = "/sample/daedalus-icarus.pdf";

export interface SampleAnnotationSeed {
  category: string;
  note: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  anchor: PdfAnchorFields;
}

export const SAMPLE_SEED: ReadonlyArray<SampleAnnotationSeed> = [
  {
    category: "note",
    note: "*obprobrium* preserves the unassimilated prefix where most modern editions normalize to *opprobrium*. Is this an intentional archaism, following an older manuscript tradition, or a typo? Worth a glance from the editor before press.",
    quote: "creverat obprobrium generis",
    contextBefore:
      "B E R V I I I Daedalus & Icarus Publius Ovidius Naso · · · V ota Iovi Minos taurorum corpora centum solvit, ut egressus ratibus Curetida terram contigit, et spoliis decorata est regia fixis.",
    contextAfter:
      ", foedumque patebat matris adulterium monstri novitate biformis; destinat hunc Minos thalamo removere pudorem multiplicique domo caecisque includere tectis. Daedalus ingenio fabrae celeberrimus ar",
    anchor: {
      kind: "pdf",
      page: 1,
      bbox: [79.3594, 275.3025, 262.4356, 11.1975],
      textItemRange: {
        start: [24, 0],
        end: [24, 27],
      },
      rects: [[79.3594, 277.3425, 154.0383, 12.92]],
    },
  },
  {
    category: "note",
    note: "Ovid introduces Daedalus through *ingenium* (wit) rather than *ars* (skill). The choice foreshadows the failure mode: cunning unbound by paternal feeling, or perhaps cunning bound by it too tightly.",
    quote: "Daedalus ingenio fabrae celeberrimus artis",
    contextBefore:
      "gia fixis. creverat obprobrium generis, foedumque patebat matris adulterium monstri novitate biformis; destinat hunc Minos thalamo removere pudorem multiplicique domo caecisque includere tectis.",
    contextAfter:
      "ponit opus turbatque notas et lumina flexum ducit in errorem variarum ambage viarum. non secus ac liquidus Phrygiis Maeandros in arvis ludit et ambiguo lapsu refluitque fluitque occurrensque sib",
    anchor: {
      kind: "pdf",
      page: 1,
      bbox: [79.3594, 345.0525, 229.1454, 11.1975],
      textItemRange: {
        start: [32, 0],
        end: [32, 42],
      },
      rects: [[79.3594, 347.0925, 229.1454, 12.92]],
    },
  },
  {
    category: "rephrase",
    note: '*Ambages* carries the technical sense of legal circumlocution before it ever means a winding path. Worth flagging in the apparatus — "circuitous deceits" preserves the legal subtext that "meandering ways" loses.',
    quote: "ducit in errorem variarum ambage viarum",
    contextBefore:
      "itate biformis; destinat hunc Minos thalamo removere pudorem multiplicique domo caecisque includere tectis. Daedalus ingenio fabrae celeberrimus artis ponit opus turbatque notas et lumina flexum",
    contextAfter:
      ". non secus ac liquidus Phrygiis Maeandros in arvis ludit et ambiguo lapsu refluitque fluitque occurrensque sibi venturas aspicit undas et nunc ad fontes, nunc ad mare versus apertum incertas exe",
    anchor: {
      kind: "pdf",
      page: 1,
      bbox: [79.3594, 379.5525, 229.6605, 11.1975],
      textItemRange: {
        start: [36, 0],
        end: [36, 39],
      },
      rects: [[79.3594, 381.5925, 223.919, 12.92]],
    },
  },
  {
    category: "praise",
    note: "Chiastic — *lino medias / ceris imas* — the line's word order mirrors the layered construction of the wings themselves. A small piece of *ut pictura poesis* the prosody apparatus should call out.",
    quote: "tum lino medias et ceris alligat imas",
    contextBefore:
      "dimittit in artes naturamque novat. nam ponit in ordine pennas a minima coeptas, longam breviore sequenti, ut clivo crevisse putes: sic rustica quondam fistula disparibus paulatim surgit avenis;",
    contextAfter:
      "atque ita conpositas parvo curvamine flectit, ut veras imitetur aves. puer Icarus una stabat et, ignarus sua se tractare pericla, ore renidenti modo, quas vaga moverat aura, captabat plumas, fla",
    anchor: {
      kind: "pdf",
      page: 2,
      bbox: [79.3594, 363.8025, 191.8242, 11.1975],
      textItemRange: {
        start: [32, 0],
        end: [32, 37],
      },
      rects: [[79.3594, 365.8425, 191.8242, 12.92]],
    },
  },
  {
    category: "praise",
    note: "The participial *ignarus sua se tractare pericla* compresses the whole tragedy into five words — Icarus already handling the very thing that will kill him, and not knowing it. Ovid does in a phrase what later poets would need a stanza for.",
    quote: "stabat et, ignarus sua se tractare pericla",
    contextBefore:
      "putes: sic rustica quondam fistula disparibus paulatim surgit avenis; tum lino medias et ceris alligat imas atque ita conpositas parvo curvamine flectit, ut veras imitetur aves. puer Icarus una",
    contextAfter:
      ", ore renidenti modo, quas vaga moverat aura, captabat plumas, flavam modo pollice ceram mollibat lusuque suo mirabile patris impediebat opus. postquam manus ultima coepto inposita est, geminas o",
    anchor: {
      kind: "pdf",
      page: 2,
      bbox: [79.3594, 415.5525, 213.9168, 11.1975],
      textItemRange: {
        start: [38, 0],
        end: [38, 42],
      },
      rects: [[79.3594, 417.5925, 208.942, 12.92]],
    },
  },
  {
    category: "praise",
    note: "Daedalus testing the wings on his own body before fitting Icarus is the moment Ovid is most often accused of skipping. He doesn't skip it. The whole ethical weight of the episode hangs from this one hexameter.",
    quote: "ipse suum corpus motaque pependit in aura",
    contextBefore:
      "uas vaga moverat aura, captabat plumas, flavam modo pollice ceram mollibat lusuque suo mirabile patris impediebat opus. postquam manus ultima coepto inposita est, geminas opifex libravit in alas",
    contextAfter:
      "; instruit et natum ʻmedioʼ que ʻut limite curras, Icare,ʼ ait ʻmoneo, ne, si demissior ibis, unda gravet pennas, si celsior, ignis adurat: inter utrumque vola. nec te spectare Booten aut Helicen",
    anchor: {
      kind: "pdf",
      page: 2,
      bbox: [79.3594, 519.8025, 236.8605, 11.1975],
      textItemRange: {
        start: [50, 0],
        end: [50, 41],
      },
      rects: [[79.3594, 521.8425, 231.221, 12.92]],
    },
  },
  {
    category: "praise",
    note: "Aetiological closure — Icaria named for Icarus — is conventional; what's striking is the compression. No epitaph, no lament, just toponymy. Read alongside the longer mourning at *Aeneid* VI.30–33.",
    quote: "et tellus a nomine dicta sepulti",
    contextBefore:
      "lo. at pater infelix, nec iam pater, ʻIcare,ʼ dixit, ʻIcare,ʼ dixit ʻubi es? qua te regione requiram?ʼ ʻIcareʼ dicebat: pennas aspexit in undis devovitque suas artes corpusque sepulcro condidit,",
    contextAfter: ". · · · iii",
    anchor: {
      kind: "pdf",
      page: 3,
      bbox: [79.3594, 611.3025, 216.8281, 11.1975],
      textItemRange: {
        start: [70, 10],
        end: [70, 42],
      },
      rects: [[129.7845, 613.3425, 161.3605, 12.92]],
    },
  },
];
