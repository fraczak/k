import { parse } from "./value.mjs";
  
const str = "[{a: 0x1},{b: {}}]";
const v = parse(str);

console.log(v);
console.log(JSON.stringify(v, null, 2));

