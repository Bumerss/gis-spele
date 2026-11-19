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
 * SVARĪGI: ja maini jautājumus pēc tam, kad kāds jau spēlējis,
 * palielini QUESTIONS_VERSION, lai notīrītu veco saglabāto progresu.
 */
const QUESTIONS_VERSION = 3;

const CATEGORIES = [
  {
    title: "PILSĒTAS",
    questions: [
      {
        points: 100,
        q: "Kuru pilsētu redzi aerouzņēmumā?",
        image: "img/pilseta-aerofoto.png",
        options: ["Jelgava", "Sigulda", "Cēsis", "Kuldīga", "Ogre"],
        answer: 4, // PDF nav norādīta pareizā atbilde – PĀRBAUDI!
        unverified: true,
      },
      {
        points: 200,
        draft: true,
        q: "Kura upe tek cauri Kuldīgai un veido platāko ūdenskritumu Eiropā?",
        options: ["Gauja", "Venta", "Daugava", "Abava"],
        answer: 1,
        explain: "Ventas rumba Kuldīgā ir platākais ūdenskritums Eiropā.",
      },
      {
        points: 300,
        draft: true,
        q: "Kura ir Latvijas otrā lielākā pilsēta pēc iedzīvotāju skaita?",
        options: ["Liepāja", "Jelgava", "Daugavpils", "Jūrmala"],
        answer: 2,
      },
      {
        points: 400,
        draft: true,
        q: "Kura Latvijas pilsēta atrodas vistālāk uz austrumiem?",
        options: ["Daugavpils", "Rēzekne", "Zilupe", "Ludza"],
        answer: 2,
      },
      {
        points: 500,
        draft: true,
        q: "Kura ir Latvijas mazākā pilsēta pēc iedzīvotāju skaita?",
        options: ["Subate", "Durbe", "Ape", "Pāvilosta"],
        answer: 1,
      },
    ],
  },
  {
    title: "KARŠU LASĪŠANA",
    questions: [
      {
        points: 100,
        draft: true,
        q: "Kurā kartes pusē parasti atrodas ziemeļi?",
        options: ["Augšā", "Apakšā", "Pa labi", "Pa kreisi"],
        answer: 0,
      },
      {
        points: 200,
        draft: true,
        q: "Ko kartē parasti apzīmē zilā krāsa?",
        options: ["Ceļus", "Ūdens objektus", "Mežus", "Apdzīvotas vietas"],
        answer: 1,
      },
      {
        points: 300,
        draft: true,
        q: "Kartes mērogs ir 1:50 000. Cik metriem dabā atbilst 1 cm kartē?",
        options: ["50 m", "500 m", "5 km", "50 km"],
        answer: 1,
        explain: "1 cm × 50 000 = 50 000 cm = 500 m.",
      },
      {
        points: 400,
        draft: true,
        q: "Ja horizontāles kartē atrodas ļoti tuvu cita citai, kāda ir nogāze?",
        options: ["Lēzena", "Stāva"],
        answer: 1,
        explain: "Jo tuvāk horizontāles, jo straujāk mainās augstums – nogāze ir stāva.",
      },
      {
        points: 500,
        draft: true,
        q: "Kartē ar mērogu 1:25 000 attālums starp diviem punktiem ir 8 cm. Cik liels tas ir dabā?",
        options: ["200 m", "800 m", "2 km", "20 km"],
        answer: 2,
        explain: "8 cm × 25 000 = 200 000 cm = 2 km.",
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
        q: "Kāpēc vista pārgāja pāri ceļam?",
        options: ["Lai nokļūtu otrā pusē", "Bēga no zupas", "Meklēja WiFi", "GPS tā teica"],
        answer: 0,
      },
      {
        points: 200,
        q: "Kurš dzīvnieks būtu labākais ĢIS speciālists?",
        options: ["Kurmis", "Zelta zivtiņa", "Kaķis", "Pingvīns"],
        answer: 0,
        explain: "Jo kurmis zina visu par pazemes slāņiem.",
      },
      {
        points: 300,
        q: "Kas ir ātrāks par gaismu?",
        options: ["Skaņa", "Gepards", "Students, kad pasniedzējs saka “šodien beigsim agrāk”", "Latvijas internets"],
        answer: 2,
      },
      {
        points: 400,
        q: "Kur Jelgavā viena stundiņa visbiežāk pārvēršas par piecām?",
        options: ["Bibliotēkā", "Pilī, meklējot īsto auditoriju", "Tonusā", "Konsultācijā pie pasniedzēja"],
        answer: 2,
      },
      {
        points: 500,
        q: "Students jau pusstundu riņķo pa Jelgavas centru. Ko viņš dara?",
        options: ["Meklē pazudušu maku", "Veic kvartāla izpēti", "Meklē bezmaksas stāvvietu", "Vāc soļus"],
        answer: 2,
      },
    ],
  },
];
