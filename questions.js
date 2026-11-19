/*
 * Spēles jautājumi.
 *
 * Katrai kategorijai ir 5 jautājumi (100–500 punkti).
 * Lauki:
 *   q        – jautājuma teksts
 *   options  – atbilžu varianti (2–5 gab.)
 *   answer   – pareizās atbildes indekss masīvā `options` (sākot no 0)
 *   image    – (neobligāts) attēla ceļš
 *   explain  – (neobligāts) skaidrojums, ko rāda pēc atbildes
 *   draft    – true = melnraksts, nav no oriģinālā PDF (pārbaudi/aizstāj)
 *
 * Kartes jautājums (spēlētāji pieskaras Latvijas kartei):
 *   type: "map", place – vietas nosaukums, target – [platums, garums],
 *   radiusKm – cik km attālumā punkts vēl skaitās pareizs
 *
 * SVARĪGI: ja maini jautājumus pēc tam, kad kāds jau spēlējis,
 * palielini QUESTIONS_VERSION, lai notīrītu veco saglabāto progresu.
 */
const QUESTIONS_VERSION = 5;

const CATEGORIES = [
  {
    title: "PILSĒTAS",
    questions: [
      {
        points: 100,
        q: "Kuru pilsētu redzi aerouzņēmumā?",
        image: "img/pilseta-aerofoto.png",
        options: ["Jelgava", "Sigulda", "Cēsis", "Kuldīga", "Ogre"],
        answer: 3, // Kuldīga
      },
      {
        points: 200,
        type: "map", // spēlētāji pieskaras Latvijas kartei
        q: "Ieliec punktu Latvijas kartē, kur atrodas apdzīvota vieta Dzērumi!",
        place: "Dzērumi",
        target: [56.73, 24.2], // [platums, garums] – Ķekavas pagasts
        radiusKm: 15, // pareizi, ja punkts ir ne tālāk par šo attālumu
      },
      {
        points: 300,
        q: "Arhīvā atrasti trīs vēsturiski pilsētu nosaukumi — Libau, Mitau un Dunaburg. Kurā rindā mūsdienu pilsētas uzrakstītas pareizajā secībā?",
        image: "img/vesturiska-karte.png",
        options: [
          "Liepāja, Jelgava, Daugavpils",
          "Lielvārde, Jelgava, Dobele",
          "Liepāja, Daugavpils, Dagda",
          "Liepāja, Jēkabpils, Daugavpils", // PDF šis variants atkārtoja A – nomainīts
          "Limbaži, Madona, Durbe",
        ],
        answer: 0,
        explain: "Libau ir Liepāja, Mitau ir Jelgava, un Dunaburg ir Daugavpils.",
      },
      {
        points: 400,
        q: "Kura Latvijas pilsēta atrodas vistālāk uz austrumiem?",
        options: ["Daugavpils", "Rēzekne", "Zilupe", "Ludza"],
        answer: 2,
      },
      {
        points: 500,
        type: "map",
        q: "Ieliec punktu Latvijas kartē, kur atrodas apdzīvota vieta Nākotne!",
        place: "Nākotne",
        target: [56.6145, 23.5409], // Glūdas pagasts, Jelgavas novads
        radiusKm: 15,
      },
    ],
  },
  {
    title: "KARŠU LASĪŠANA",
    questions: [
      {
        points: 100,
        q: "Kas atrodas uz austrumiem no skolas? Meklē objektu pie Ozolu ielas.",
        image: "img/karte-skola.png",
        options: ["Muzejs", "Bibliotēka", "Parks", "Stacija"],
        answer: 1,
      },
      {
        points: 200,
        q: "Cik tālu dabā atrodas abi punkti?",
        image: "img/merogs.png",
        options: ["40 m", "125 m", "250 m", "400 m", "32 m"],
        answer: 3,
        explain: "3,2 cm × 12 500 = 40 000 cm jeb 400 m.",
      },
      {
        points: 300,
        q: "Kur pie atzīmētā punkta nogāze ir stāvāka?",
        image: "img/nogaze-xy.png",
        options: ["Pie X", "Pie Y", "Abās vietās vienādi", "Ar šiem datiem to nevar noteikt"],
        answer: 0, // PDF nav norādīta atbilde – pie X augstumlīknes ir tuvāk viena otrai
        explain: "Pie X augstumlīknes atrodas tuvāk viena otrai – jo tuvāk līknes, jo stāvāka nogāze.",
      },
      {
        points: 400,
        q: "Augstuma starpība ir 5 m, horizontālais attālums ir 100 m. Kāds ir nogāzes slīpums procentos?",
        options: ["2 %", "10 %", "5 %", "20 %"],
        answer: 2,
        explain: "Augstuma starpība 5 m ÷ 100 m × 100 % = 5 %.",
      },
      {
        points: 500,
        q: "Kurš ir īsākais pieejamais maršruts no S līdz F? Plūdu dēļ drīkst izmantot tikai tiltus, kuru klājs ir vismaz 20 m virs jūras līmeņa.",
        image: "img/marsruti.png",
        options: ["A maršruts · 800 m", "B maršruts · 1 200 m", "C maršruts · 1 000 m", "C maršruts · 900 m"],
        answer: 2,
        explain: "A ir īsāks, bet tā tilta klājs ir tikai 18 m augstumā. No abiem pieejamajiem maršrutiem C ir par 200 m īsāks nekā B.",
      },
    ],
  },
  {
    title: "GIS — patiesība vai mīts?",
    questions: [
      {
        points: 100,
        q: "Vai Shapefile sastāv tikai no viena .shp faila?",
        options: ["Patiesība", "Mīts"],
        answer: 1,
        explain: "Shapefile datu formāts sastāv no vairākiem savstarpēji saistītiem failiem.",
      },
      {
        points: 200,
        q: "Vai, mainot slāņa simbolizāciju, mainās arī tā atribūtu tabulas vērtības?",
        options: ["Patiesība", "Mīts"],
        answer: 1,
        explain: "Simbolizācija maina tikai datu vizuālo attēlojumu kartē, piemēram, objektu krāsu, formu vai izmēru.",
      },
      {
        points: 300,
        q: "Vai NULL vērtības punktu simbolizācijā automātiski vienmēr tiek paslēptas?",
        options: ["Patiesība", "Mīts"],
        answer: 1,
        explain: "To attēlošana ir atkarīga no simbolizācijas un iestatījumiem.",
      },
      {
        points: 400,
        q: "Vai punktu slānī var glabāt informāciju par koka augstumu, sugu un stumbra diametru?",
        options: ["Patiesība", "Mīts"],
        answer: 0,
        explain: "Punktu slānī katram punktam ir ģeogrāfiskā atrašanās vieta, un tam var piesaistīt dažādus atribūtus.",
      },
      {
        points: 500,
        q: "Vai ArcGIS Pro ģeoprocesēšanas rīki var apstrādāt tikai atlasītos objektus, ja slānī ir aktīva atlase?",
        options: ["Patiesība", "Mīts"],
        answer: 0,
        explain: "ArcGIS Pro ģeoprocesēšanas rīki ņem vērā aktīvo objektu atlasi. Ja kā ievaddatus izmanto slāni, kurā atlasīti tikai noteikti objekti, rīks var apstrādāt tikai šos atlasītos objektus, nevis visu datu kopu.",
      },
    ],
  },
  {
    title: "Dendroloģijas izaicinājums",
    short: "Dendroloģija", // shorter title for narrow phone screens
    questions: [
      {
        points: 100,
        q: "Kā sauc koka vainaga formu, kas ir šaura, vertikāli izstiepta, ar uz augšu vērstiem zariem?",
        image: "img/vainagu-formas.png",
        options: ["Piramidāla", "Lodveida", "Kolonnveida", "Lietussargveida"],
        answer: 2,
      },
      {
        points: 200,
        q: "Kuram kokam ir šādas vēdekļveida lapas?",
        image: "img/ginka-lapa.png",
        options: ["Tulpjukokam", "Divdaivu ginkam", "Skābardim", "Baltajai robīnijai"],
        answer: 1,
      },
      {
        points: 300,
        q: "Kura no šīm koku sugām Latvijā atzīta par invazīvu?",
        image: "img/oslapu-klava.png",
        options: [
          "Parastā kļava (Acer platanoides)",
          "Ošlapu kļava (Acer negundo)",
          "Parastais osis (Fraxinus excelsior)",
          "Parastais ozols (Quercus robur)",
        ],
        answer: 1,
      },
      {
        points: 400,
        q: "Kā sauc lapu, kuras plātne sastāv no vairākām atsevišķām lapiņām?",
        image: "img/koku-lapas.png",
        options: ["Vienkārša lapa", "Veselmalaina lapa", "Salikta lapa", "Daivaina lapa"],
        answer: 2,
      },
      {
        points: 500,
        q: "Kā sauc koka stumbra audus, kas transportē fotosintēzē saražotās organiskās vielas uz citām auga daļām?",
        options: ["Ksilēma", "Kambijs", "Periderma", "Floēma"],
        answer: 3,
      },
    ],
  },
  {
    title: "HUMORS",
    questions: [
      {
        points: 100,
        q: "Rīgā cilvēks jau trešo reizi apiet vienu kvartālu. Ko viņš dara?",
        options: ["Meklē pazudušu maku", "Veic kvartāla izpēti", "Meklē bezmaksas stāvvietu", "Vāc soļus"],
        answer: 2,
      },
      {
        points: 200,
        q: "Trešdien LBTU bija Meža vakars. Kāpēc ceturtdienas pirmajā lekcijā daļa studentu nav ieradušies?",
        options: [
          "Viņi vēl meklē īsto auditoriju Jelgavas pilī.",
          "Viņi jau no astoņiem sēž bibliotēkā.",
          "Viņiem trešdiena beidzās tikai ceturtdienas rītā.",
          "Viņi gaida lekciju turpat, kur vakar bija Meža vakars.",
        ],
        answer: 2,
      },
      {
        points: 300,
        q: "Kur Jelgavā viena stundiņa visbiežāk pārvēršas par piecām?",
        options: ["Bibliotēkā", "Pilī, meklējot īsto auditoriju", "Tonusā", "Uz konsultāciju pie pasniedzēja"],
        answer: 1,
      },
      {
        points: 400,
        q: "Darbs jāiesniedz līdz 23.59. Students to iesniedz nākamajā dienā plkst. 00.01 un saka: “Es kavēju tikai vienu minūti!” Par cik minūtēm viņš patiesībā nokavēja?",
        options: ["Par vienu", "Par trim", "Par sešdesmit", "Par divām", "Par veselu dienu, jo datums jau cits"],
        answer: 3,
        explain: "Divas minūtes: viena līdz pusnaktij, otra pēc tās.",
      },
      {
        points: 500,
        // PDF 500 punktu slaids ir tukšs – pagaidām atstāts iepriekšējais jautājums
        q: "Kurš dzīvnieks būtu labākais ĢIS speciālists?",
        options: ["Kurmis", "Zelta zivtiņa", "Kaķis", "Pingvīns"],
        answer: 0,
        explain: "Jo kurmis zina visu par pazemes slāņiem.",
      },
    ],
  },
];
