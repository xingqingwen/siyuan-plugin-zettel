import { execSync } from "child_process";
execSync(`"node_modules/.bin/esbuild.cmd" src/cards.ts --bundle --platform=node --format=esm --alias:siyuan=./test/stub-siyuan.mjs --outfile=test/.cards-bundle.mjs`, { stdio: "inherit" });
const m = await import("./.cards-bundle.mjs");
console.log("titleFromText:", m.titleFromText("习惯是被重复了足够多次的行为，而不是被决定的行为。"));
console.log("safeTitle:", m.safeTitle('a/b:c?"d"|e'));
const cards = [
  {id:"a",title:"习惯靠环境触发，不靠意志力维持",book:"掌控习惯",source:"",created:"2026-10-01",refs:0,status:"待打磨"},
  {id:"b",title:"环境设计比自律更可靠",book:"掌控习惯",source:"",created:"2026-10-02",refs:1,status:"成熟"},
  {id:"c",title:"货币政策的传导有滞后",book:"经济学",source:"",created:"2026-10-03",refs:0,status:""},
];
const hits = m.findRelated(cards, cards[0], 5);
console.log("related:", hits.map(h=>`${h.card.id}(${h.score}) ${h.shared.join("/")}`));
console.log("expect a<->b 高, c 不出现");
